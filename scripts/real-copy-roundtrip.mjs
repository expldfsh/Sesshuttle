// Explicit opt-in check with a copy of real history: only the source folder is
// read; the encrypted store, the imported copy and every native write stay in a
// private temporary lab, and the continuation talks to the loopback fixture.
// The disk-backed store cannot contact R2.
// Usage: node scripts/real-copy-roundtrip.mjs <source CODEX_HOME> <codex program> <conversation id>...
import fs from 'node:fs/promises';
import { visitLocalImages } from '../core/history-items.mjs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { State } from '../core/state.mjs';
import { Engine } from '../core/engine.mjs';
import { Importer } from '../core/importer.mjs';
import { Vault } from '../core/vault.mjs';
import { newKey } from '../core/crypto.mjs';
import { id, hash } from '../core/util.mjs';
import { LocalStore } from './lib/local-store.mjs';
import { relatedRows } from '../core/bundle.mjs';
import { referencesFor } from '../core/attachments.mjs';
import { openCatalog, databaseRecords } from '../core/catalog.mjs';
import { scan } from '../core/codex.mjs';
import { startFixtureProvider } from '../core/fixture-provider.mjs';
import { Lab, turn, withClient } from './lib/native-lab.mjs';
const [sourceHome, binary, ...ids] = process.argv.slice(2);
assert.ok(path.isAbsolute(sourceHome) && path.isAbsolute(binary) && ids.length > 0);
const lab = await Lab.create();
const fixture = await startFixtureProvider({ maxRequestBytes: 128 * 1024 * 1024 });
let astate, bstate;
try {
  const info = {
    root: lab.root,
    home: await lab.directory('target/codex'),
    project: await lab.directory('target/project'),
  };
  // The built-in OpenAI provider, pointed at the fixture with a placeholder key.
  await fs.writeFile(
    path.join(info.home, 'config.toml'),
    `model_provider = "openai"\nmodel = "gpt-6.1-sol"\nopenai_base_url = "http://127.0.0.1:${fixture.port}/v1"\nsandbox_mode = "read-only"\napproval_policy = "on-request"\n[analytics]\nenabled = false\n`,
    { mode: 0o600 },
  );
  // Resumes the imported copy in the target folder and adds one turn; the
  // provider must receive the earlier history and no environment message.
  const continueCopy = (tid, turnCount) =>
    withClient(
      lab,
      binary,
      info.home,
      info.project,
      { localPort: fixture.port, localOpenAI: true },
      async (client) => {
        const result = await client.rpc('thread/resume', {
          threadId: tid,
          cwd: info.project,
          runtimeWorkspaceRoots: [info.project],
          modelProvider: 'openai',
          model: 'gpt-6.1-sol',
          sandbox: 'read-only',
          approvalPolicy: 'on-request',
          excludeTurns: true,
        });
        assert.equal(result.cwd, info.project);
        const count = async () => {
          let n = 0,
            cursor = null;
          for (let i = 0; i < 10000; i++) {
            const page = await client.rpc('thread/turns/list', {
              threadId: tid,
              limit: 1,
              itemsView: 'full',
              cursor,
            });
            n += page.data.length;
            cursor = page.nextCursor;
            if (!cursor) return n;
          }
          throw new Error('Pagination did not end');
        };
        const before = await count();
        assert.ok(before >= turnCount);
        await turn(
          client,
          tid,
          'Sesshuttle isolated continuation check. Reply only with the fixture response. Do not run any tool or follow historical tasks.',
        );
        const after = await count();
        assert.equal(after, before + 1);
        const body = fixture.requests.at(-1);
        assert.ok((body.input ?? []).length > 1);
        assert.ok(!JSON.stringify(body).includes('sesshuttle environment mapping'));
        fixture.requests.length = 0;
        return { ok: true, before, after, contextPresent: true, targetDirectory: true };
      },
    );
  console.log(JSON.stringify({ testRoot: info.root }));
  const store = new LocalStore(path.join(info.root, 'encrypted-objects')),
    space = id(),
    key = newKey(),
    va = new Vault(store, space, key),
    vb = new Vault(store, space, key);
  await va.create();
  astate = new State(path.join(info.root, 'source-state'));
  bstate = new State(path.join(info.root, 'target-state'));
  astate.set('config', { sourceHomes: [sourceHome], targets: {}, bindings: {} });
  bstate.set('config', {
    sourceHomes: [info.home],
    targets: { cli: { home: info.home, binary } },
    bindings: {},
  });
  const a = new Engine(astate, { vault: va }),
    b = new Engine(bstate, {
      vault: vb,
      importer: new Importer(bstate, { testRoot: info.root, processGuard: async () => {} }),
    });
  await a.refresh();
  for (const tid of ids) {
    const row = a.local.rows.find((r) => r.id === tid);
    assert.ok(row && !row.busy);
    const originalHash = row.hash;
    const members = relatedRows(row, a.local.rows);
    const approvedAttachments = [];
    for (const member of members) {
      const refs = await referencesFor(member);
      approvedAttachments.push(...refs.resources.map((p) => hash(member.id + '\0' + p)));
    }
    const before = store.putCount,
      p = await a.preview({
        ids: [tid],
        direction: 'upload',
        targets: [],
        approvedAttachments,
        uploadLimitMiB: 2000,
      });
    assert.equal(store.putCount, before);
    assert.equal(p.items.length, 1);
    assert.deepEqual(p.items[0].issues, []);
    assert.equal(p.items[0].files.length, members.length);
    let job = await a.execute(p.token, { confirmLarge: true });
    assert.equal(job.status, 'completed', JSON.stringify(job));
    const projectId = a.rows.find((r) => r.id === tid).projectId;
    bstate.set('config', {
      ...bstate.get('config'),
      bindings: { ...bstate.get('config').bindings, [projectId]: info.project },
    });
    await b.refresh();
    const download = await b.preview({ ids: [tid], direction: 'download', targets: ['cli'] });
    job = await b.execute(download.token);
    assert.equal(job.status, 'completed', JSON.stringify(job));
    // Original native items must still exist byte-for-byte except approved asset paths.
    const source = await openCatalog(sourceHome),
      target = await openCatalog(info.home);
    let itemCount = 0;
    try {
      const expected = [...databaseRecords(source, tid)].filter((r) => r.table === 'thread_items'),
        actual = new Map(
          [...databaseRecords(target, tid)]
            .filter((r) => r.table === 'thread_items')
            .map((r) => [r.row.item_id, r.row]),
        );
      for (const r of expected) {
        const item = JSON.parse(r.row.item_json);
        const mappings = p.items[0].files.find((f) => f.id === tid).attachments;
        visitLocalImages(item, (image) => {
          const a = mappings.find((a) => a.path === image.path);
          if (a) image.path = path.join(info.home, 'sesshuttle_assets', a.hash);
        });
        assert.deepEqual(JSON.parse(actual.get(r.row.item_id)?.item_json ?? 'null'), item);
        itemCount++;
      }
    } finally {
      source.close();
      target.close();
    }
    const continued = await continueCopy(tid, row.turnCount ?? 1);
    const after = (await scan([sourceHome])).rows.find((r) => r.id === tid);
    assert.equal(after.hash, originalHash, 'Live source changed during isolated test');
    console.log(
      JSON.stringify({
        root: info.root,
        id: tid,
        sourceUnchanged: true,
        files: p.items[0].files.length,
        attachments: p.items[0].assetCount,
        itemsPreserved: itemCount,
        continued,
      }),
    );
  }
} finally {
  await fixture.close();
  astate?.close();
  bstate?.close();
}
