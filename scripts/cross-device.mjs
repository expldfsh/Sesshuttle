// Cross-device check with real Codex programs on synthetic data: run "source" on
// the Mac, "receive" on the Linux or Windows VM, then "return" on the Mac. The exchange file
// and the S3 endpoint are temporary, synthetic and loopback-only (forward the
// port to the VM). Linux runs only inside the disposable VM marked with
// /run/sesshuttle-isolated-vm.
// Usage: node scripts/cross-device.mjs <source|receive|return> <codex program> <tmp>/sesshuttle-*/exchange.json <S3 port>
//   SESSHUTTLE_DUPLICATE_TEST=1 (receive) adds an unrelated duplicate identity
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { State } from '../core/state.mjs';
import { Engine } from '../core/engine.mjs';
import { Importer } from '../core/importer.mjs';
import { Vault } from '../core/vault.mjs';
import { R2Store } from '../core/storage.mjs';
import { newKey } from '../core/crypto.mjs';
import { runtimeInfo } from '../core/runtime.mjs';
import { verifyRuntime } from '../core/runtime-check.mjs';
import { canonical, id } from '../core/util.mjs';
import { startFixtureProvider, writeFixtureConfig } from '../core/fixture-provider.mjs';
import { Lab, proveDirectory, startThread, turn, turns, withClient } from './lib/native-lab.mjs';

const [mode, binary, exchange, port] = process.argv.slice(2);
assert.ok(['source', 'receive', 'return'].includes(mode) && path.isAbsolute(binary));
const tmp = await fs.realpath(os.tmpdir()),
  parent = await fs.realpath(path.dirname(exchange));
assert.ok(
  [tmp, ...(process.platform === 'win32' ? [] : [await fs.realpath('/tmp')])].includes(
    path.dirname(parent),
  ) &&
    path.basename(parent).startsWith('sesshuttle-') &&
    path.basename(exchange) === 'exchange.json',
);
const info =
  mode === 'source'
    ? { key: newKey(), space: id(), marker: 'EARLY-' + id() }
    : JSON.parse(await fs.readFile(exchange, 'utf8'));
// One side of the fixture: the lab, its data folder and working folder, the
// loopback provider and, for the source, the original conversation.
const lab = mode === 'return' ? await Lab.open(info.macRoot) : await Lab.create();
const fixture = await startFixtureProvider();
const options = { localPort: fixture.port };
let state, app;
try {
  const home = await lab.directory('codex'),
    project = await lab.directory('working copy');
  await lab.write('working copy/proof.txt', mode + '-LOCAL');
  await writeFixtureConfig(home, fixture.port);
  let tid = info.tid,
    projectId = null;
  await withClient(lab, binary, home, project, options, async (client) => {
    if (mode === 'source') {
      tid = await startThread(client, project);
      await turn(client, tid, info.marker);
      await turn(client, tid, 'Keep the small fixture image', { image: true });
      await proveDirectory(client, tid, project, 'source-LOCAL');
    }
    if (mode === 'receive') {
      projectId = (
        await client.rpc('project/create', {
          name: process.platform,
          roots: [{ path: project }],
          idempotencyKey: id(),
        })
      ).project.id;
      const listed = await client.rpc('thread/list', { projectId, modelProviders: [] });
      assert.equal(listed.data.length, 0);
    }
  });
  const here = { root: lab.root, home, project, tid, projectId };
  // After the import: same working folder (and native project on receive), the
  // early marker reaches the provider, and the user's own handoff message is the
  // only new text (no automatic environment message).
  const continueHere = () =>
    withClient(lab, binary, home, project, options, async (client) => {
      const read = (await client.rpc('thread/read', { threadId: tid })).thread;
      assert.equal(await canonical(read.cwd), project);
      if (projectId) {
        assert.equal(read.projectId, projectId);
        const listed = await client.rpc('thread/list', { projectId, modelProviders: [] });
        assert.ok(listed.data.some((t) => t.id === tid));
      }
      await client.rpc('thread/resume', {
        threadId: tid,
        cwd: project,
        sandbox: 'read-only',
        approvalPolicy: 'on-request',
        excludeTurns: true,
      });
      const before = await turns(client, tid);
      const imageHistory = before
        .flatMap((t) => t.items)
        .some(
          (item) =>
            item.type === 'userMessage' &&
            item.content?.some((part) => part.type === 'image' || part.type === 'localImage'),
        );
      assert.ok(imageHistory, 'The original image is present in native history');
      const replyMarker = 'handoff-' + info.marker;
      if (mode === 'return')
        assert.ok(
          JSON.stringify(before).includes(replyMarker),
          'The receiving computer’s message is present before continuing',
        );
      const directoryProof = await proveDirectory(client, tid, project, mode + '-LOCAL');
      await turn(
        client,
        tid,
        'I switched computers. Here is the working folder: ' +
          project +
          (mode === 'receive' ? ' ' + replyMarker : ''),
      );
      const after = await turns(client, tid);
      const body = JSON.stringify(fixture.requests.at(-1));
      assert.ok(body.includes(info.marker) && !body.includes('sesshuttle environment mapping'));
      assert.equal(after.length, before.length + directoryProof.recordedTurns + 1);
      return {
        before: before.length,
        after: after.length,
        projectVerified: !!projectId,
        cwdVerified: true,
        directoryMethod: directoryProof.method,
        imageHistory,
        returnedMessage: mode === 'return',
        manualHandoff: true,
      };
    });
  if (mode === 'receive' && process.env.SESSHUTTLE_DUPLICATE_TEST === '1') {
    const logical = id(),
      folder = path.join(here.home, 'sessions', 'unrelated-conflict');
    await fs.mkdir(folder, { recursive: true });
    for (const message of ['left', 'right']) {
      const records = [
        {
          type: 'session_meta',
          payload: { id: logical, source: 'cli', cli_version: '0.166.0', cwd: here.project },
        },
        { type: 'event_msg', payload: { type: 'user_message', message } },
      ];
      await fs.writeFile(
        path.join(folder, message + '.jsonl'),
        records.map((r) => JSON.stringify(r)).join('\n') + '\n',
      );
    }
  }
  const store = new R2Store(
    {
      endpoint: 'http://127.0.0.1:' + Number(port),
      bucket: 'sesshuttle-ui',
      accessKeyId: 'fixture',
      secretAccessKey: 'fixture',
    },
    { allowLocal: true },
  );
  const vault = new Vault(store, info.space, info.key);
  if (mode === 'source') await vault.create();
  else await vault.open();
  const packaged = mode === 'receive' && process.env.SESSHUTTLE_ACCEPTANCE_APP;
  state = new State(path.join(here.root, packaged ? 'app-data' : 'application'));
  const entry = process.platform === 'darwin' ? 'desktop' : 'cli';
  state.set('config', {
    sourceHomes: [here.home],
    targets: { [entry]: { home: here.home, binary } },
    bindings: info.sourceProject ? { [info.sourceProject]: here.project } : {},
    nativeBindings: here.projectId ? { [info.sourceProject]: { [here.home]: here.projectId } } : {},
  });
  let request;
  if (packaged) {
    const { launchApp, invoke } = await import('./lib/test-app.mjs');
    await lab.write('.sesshuttle-test.json', JSON.stringify({ format: 1 }));
    const desktop = await launchApp(lab.root, { executablePath: packaged });
    app = desktop.app;
    await desktop.page.waitForSelector('.shell');
    request = async (method, args) => {
      const result = await invoke(desktop.page, method, args);
      assert.ok(result.ok, method + ': ' + JSON.stringify(result.error));
      return result.data;
    };
    await request('connect', {
      mode: 'join',
      endpoint: 'http://127.0.0.1:' + Number(port),
      bucket: 'sesshuttle-ui',
      accessKeyId: 'fixture',
      secretAccessKey: 'fixture',
      key: info.key,
      space: info.space,
    });
    await request('verifyRuntime', { id: id(), binary });
  } else if (mode !== 'source' && (await runtimeInfo(binary, state)).status === 'untested')
    await verifyRuntime(binary, state);
  const engine = new Engine(state, {
    vault,
    importer: new Importer(state, { testRoot: here.root, processGuard: async () => {} }),
  });
  async function sync(direction) {
    const checked = request ? await request('refresh', {}) : await engine.refresh();
    if (mode === 'receive' && process.env.SESSHUTTLE_DUPLICATE_TEST === '1')
      assert.ok(checked.errors.some((e) => e.code === 'duplicate_identity'));
    const selection = {
      ids: [here.tid],
      direction,
      targets: direction === 'upload' ? [] : [entry],
    };
    const p = request ? await request('preview', selection) : await engine.preview(selection);
    const job = request
      ? await request('execute', { token: p.token })
      : await engine.execute(p.token);
    assert.equal(job.status, 'completed', JSON.stringify(job));
  }
  if (mode === 'source') {
    await sync('upload');
    Object.assign(info, {
      tid: here.tid,
      macRoot: here.root,
      sourceProject: engine.rows.find((r) => r.id === here.tid).projectId,
    });
    await fs.writeFile(exchange, JSON.stringify(info), { mode: 0o600 });
  } else {
    await sync('download');
    const proof = await continueHere();
    console.log(JSON.stringify(proof));
    if (mode === 'receive') await sync('upload');
  }
  assert.equal(state.keys('backup/').length, 0, 'manual sync must not create a local backup');
  console.log('PASS ' + mode + ' on ' + process.platform + ' ' + process.arch);
} finally {
  if (app) await app.close();
  await fixture.close();
  state?.close();
}
