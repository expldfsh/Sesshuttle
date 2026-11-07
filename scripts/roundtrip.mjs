// Production engine round trip with real Codex programs on synthetic data:
// Codex A creates a conversation, the engine uploads it encrypted to an
// in-memory store, imports it for Codex B, B continues, and the result goes
// back to A, which continues again. Everything lives in a temporary lab.
// Usage: node scripts/roundtrip.mjs <source codex> <target codex>
//   SESSHUTTLE_COMPRESSED=1     source rollouts compressed as .zst
//   SESSHUTTLE_DATABASE_ONLY=1  source has only database records (import must refuse)
//   SESSHUTTLE_DUPLICATE_TEST=1 B also holds an unrelated duplicate identity
//   SESSHUTTLE_PROJECT_TEST=1   B binds a native project before import
import fs from 'node:fs/promises';
import { zstdCompressSync } from 'node:zlib';
import { walk } from '../core/util.mjs';
import { materialize } from '../core/bundle.mjs';
import { records } from '../core/stream.mjs';
import { openCatalog, databaseRecords, encodeRecord } from '../core/catalog.mjs';
import assert from 'node:assert/strict';
import path from 'node:path';
import { State } from '../core/state.mjs';
import { Engine } from '../core/engine.mjs';
import { Importer } from '../core/importer.mjs';
import { Vault } from '../core/vault.mjs';
import { MemoryStore } from '../tests/helpers/memory-store.mjs';
import { newKey } from '../core/crypto.mjs';
import { id } from '../core/util.mjs';
import { startFixtureProvider, writeFixtureConfig } from '../core/fixture-provider.mjs';
import {
  Lab,
  historyEqual,
  marker,
  proveDirectory,
  startThread,
  turn,
  turns,
  withClient,
} from './lib/native-lab.mjs';
const [source, target] = process.argv.slice(2);
assert.ok(source && target);
const lab = await Lab.create();
const fixture = await startFixtureProvider();
const options = { localPort: fixture.port };
const states = [];
try {
  const homeA = await lab.directory('a/codex'),
    homeB = await lab.directory('b/codex');
  const pa = await lab.directory('a/project 中文'),
    pb = await lab.directory('b/project with spaces');
  await lab.write('a/project 中文/proof.txt', 'A-LOCAL-PROOF');
  await lab.write('b/project with spaces/proof.txt', 'B-LOCAL-PROOF');
  for (const home of [homeA, homeB]) await writeFixtureConfig(home, fixture.port);
  const early = marker('PRODUCT-EARLY');
  let tid, expected;
  await withClient(lab, source, homeA, pa, options, async (client) => {
    tid = await startThread(client, pa);
    await turn(client, tid, early);
    await turn(client, tid, 'Embedded image round', { image: true });
    await proveDirectory(client, tid, pa, 'A-LOCAL-PROOF');
    expected = await turns(client, tid);
  });
  let destinationProject = null;
  if (process.env.SESSHUTTLE_PROJECT_TEST === '1')
    await withClient(lab, target, homeB, pb, options, async (client) => {
      const result = await client.rpc('project/create', {
        name: 'linux',
        roots: [{ path: pb }],
        idempotencyKey: id(),
      });
      destinationProject = result.project.id;
      const listed = await client.rpc('thread/list', {
        projectId: destinationProject,
        modelProviders: [],
      });
      assert.equal(listed.data.length, 0);
    });
  const info = { root: lab.root, a: homeA, b: homeB, pa, pb, tid, destinationProject };
  // Resume on one side: same history, same working folder, the early marker
  // still reaches the provider and no environment message is added.
  const continueOn = (side) => {
    const [home, project, binary] = side === 'B' ? [homeB, pb, target] : [homeA, pa, source];
    return withClient(lab, binary, home, project, options, async (client) => {
      if (destinationProject && side === 'B') {
        const read = await client.rpc('thread/read', { threadId: tid });
        assert.equal(read.thread.projectId, destinationProject);
        const listed = await client.rpc('thread/list', {
          projectId: destinationProject,
          modelProviders: [],
        });
        assert.ok(listed.data.some((t) => t.id === tid));
      }
      assert.equal((await client.rpc('thread/read', { threadId: tid })).thread.cwd, project);
      await client.rpc('thread/resume', {
        threadId: tid,
        sandbox: 'read-only',
        approvalPolicy: 'on-request',
        excludeTurns: true,
      });
      assert.ok(
        historyEqual(await turns(client, tid), expected),
        'Native history changed during product transfer',
      );
      await proveDirectory(client, tid, project, side + '-LOCAL-PROOF');
      await turn(client, tid, 'Continue on ' + side + ' without repeating the early marker');
      const body = JSON.stringify(fixture.requests.at(-1));
      assert.ok(body.includes(early) && !body.includes('sesshuttle environment mapping'));
      expected = await turns(client, tid);
      return {
        ok: true,
        side,
        turns: expected.length,
        cwd: true,
        earlyContext: true,
        automaticEnvironmentMessage: false,
      };
    });
  };
  if (process.env.SESSHUTTLE_COMPRESSED === '1') {
    for (const file of await walk(path.join(info.a, 'sessions'))) {
      const raw = await fs.readFile(file);
      await fs.writeFile(file + '.zst', zstdCompressSync(raw));
      const kept = path.join(info.root, 'original-source', path.basename(file));
      await fs.mkdir(path.dirname(kept), { recursive: true });
      await fs.rename(file, kept);
    }
  }
  if (process.env.SESSHUTTLE_DATABASE_ONLY === '1')
    await fs.rename(
      path.join(info.a, 'sessions'),
      path.join(info.root, 'source-rollouts-preserved'),
    );
  const store = new MemoryStore(),
    space = id(),
    key = newKey(),
    va = new Vault(store, space, key),
    vb = new Vault(store, space, key);
  await va.create();
  if (process.env.SESSHUTTLE_DUPLICATE_TEST === '1') {
    const dir = path.join(info.b, 'sessions', 'conflict-test');
    await fs.mkdir(dir, { recursive: true });
    const logical = id();
    for (const name of ['left', 'right']) {
      const lines = [
        {
          type: 'session_meta',
          payload: { id: logical, source: 'cli', cwd: info.pb, cli_version: '0.166.0' },
        },
        { type: 'event_msg', payload: { type: 'user_message', message: name } },
      ];
      await fs.writeFile(
        path.join(dir, name + '.jsonl'),
        lines.map((l) => JSON.stringify(l)).join('\n') + '\n',
      );
    }
  }
  const sa = new State(path.join(info.root, 'state-a')),
    sb = new State(path.join(info.root, 'state-b'));
  states.push(sa, sb);
  sa.set('config', {
    sourceHomes: [info.a],
    targets: { desktop: { home: info.a, binary: source } },
    bindings: {},
  });
  sb.set('config', {
    sourceHomes: [info.b],
    targets: { cli: { home: info.b, binary: target } },
    bindings: {},
  });
  const a = new Engine(sa, {
      vault: va,
      importer: new Importer(sa, { testRoot: info.root, processGuard: async () => {} }),
    }),
    b = new Engine(sb, {
      vault: vb,
      importer: new Importer(sb, { testRoot: info.root, processGuard: async () => {} }),
    });
  const sync = async (engine, direction, targets = []) => {
    await engine.refresh();
    const plan = await engine.preview({
      ids: [info.tid],
      direction,
      targets,
      allowIncomplete: direction === 'upload' && process.env.SESSHUTTLE_DATABASE_ONLY === '1',
    });
    const job = await engine.execute(plan.token);
    assert.equal(job.status, 'completed', JSON.stringify(job));
    return job;
  };
  await a.refresh();
  const projectId = a.rows[0].projectId;
  sa.set('config', { ...sa.get('config'), bindings: { [projectId]: info.pa } });
  sb.set('config', {
    ...sb.get('config'),
    bindings: { [projectId]: info.pb },
    nativeBindings: { [projectId]: { [info.b]: info.destinationProject } },
  });
  await sync(a, 'upload');
  if (process.env.SESSHUTTLE_DATABASE_ONLY === '1') {
    const head = await va.head(info.tid),
      payload = await va.version(head.tips[0]);
    assert.equal(payload.continuation, false);
    const restored = await materialize(payload, vb, path.join(info.root, 'database-restored'));
    const artifact = restored.files[0].artifacts.find((x) => x.kind === 'database');
    const catalog = await openCatalog(info.a);
    const expected = [...databaseRecords(catalog, info.tid)].map((x) => encodeRecord(x).toString());
    catalog.close();
    const actual = [];
    for await (const r of records(artifact.file)) actual.push(encodeRecord(r).toString());
    assert.deepEqual(actual, expected);
    await b.refresh();
    const p = await b.preview({ ids: [info.tid], direction: 'download', targets: ['cli'] });
    const before = await fs.readdir(info.b);
    const j = await b.execute(p.token);
    assert.equal(j.items[0].error.code, 'missing_rollout');
    assert.deepEqual(await fs.readdir(info.b), before);
    console.log(
      JSON.stringify({
        root: info.root,
        result:
          'PASS database-only full encrypted backup and exact restore; missing rollout blocks native import before writes',
        records: actual.length,
      }),
    );
  } else {
    await sync(b, 'download', ['cli']);
    const continuedB = await continueOn('B');
    await sync(b, 'upload');
    await a.refresh();
    assert.equal(a.rows[0].status, 'remote_changes');
    await sync(a, 'download', ['desktop']);
    const continuedA = await continueOn('A');
    console.log(
      JSON.stringify(
        {
          root: info.root,
          continuedB,
          continuedA,
          result: 'PASS production encrypted A → B continuation → A continuation',
        },
        null,
        2,
      ),
    );
  }
} finally {
  await fixture.close();
  for (const state of states) state.close();
}
