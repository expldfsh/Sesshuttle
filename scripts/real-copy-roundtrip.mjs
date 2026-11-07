// Explicit opt-in: only the source is read; all outputs and native writes use a
// private temporary lab. Disk-backed encrypted store cannot contact R2.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import readline from 'node:readline';
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
const [sourceHome, binary, ...ids] = process.argv.slice(2);
assert.ok(path.isAbsolute(sourceHome) && path.isAbsolute(binary) && ids.length > 0);
const child = spawn('python3', ['-u', '-m', 'tools.codex_lab.real_copy_bridge', binary], {
  stdio: ['pipe', 'pipe', 'inherit'],
});
const rl = readline.createInterface({ input: child.stdout }),
  queue = [],
  waiters = [];
rl.on('line', (line) => {
  const value = JSON.parse(line);
  if (waiters.length) waiters.shift()(value);
  else queue.push(value);
});
const next = () =>
  queue.length
    ? Promise.resolve(queue.shift())
    : new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(Error('bridge timeout')), 120000);
        waiters.push((v) => {
          clearTimeout(timer);
          resolve(v);
        });
      });
let astate, bstate;
try {
  const info = await next();
  assert.ok(info.root.includes('/sesshuttle-lab-'));
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
        function change(v) {
          if (!v || typeof v !== 'object') return;
          if (['localImage', 'local_image'].includes(v.type)) {
            const a = mappings.find((a) => a.path === v.path);
            if (a) v.path = path.join(info.home, 'sesshuttle_assets', a.hash);
          }
          for (const x of Object.values(v)) if (typeof x === 'object') change(x);
        }
        change(item);
        assert.deepEqual(JSON.parse(actual.get(r.row.item_id)?.item_json ?? 'null'), item);
        itemCount++;
      }
    } finally {
      source.close();
      target.close();
    }
    child.stdin.write(JSON.stringify({ id: tid, turnCount: row.turnCount ?? 1 }) + '\n');
    const continued = await next();
    assert.equal(continued.ok, true, JSON.stringify(continued));
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
  child.stdin.end();
  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.kill();
      resolve();
    }, 5000);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });
  rl.close();
  astate?.close();
  bstate?.close();
}
