import { restoreReview } from '../../core/manual-backups.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { id } from '../../core/util.mjs';
import { Engine } from '../../core/engine.mjs';
import { keepLocalCopy } from '../../core/local-copies.mjs';
import { downloadCopy } from '../../core/download-copy.mjs';
import { Importer } from '../../core/importer.mjs';
import { Trash } from '../../core/trash.mjs';
import { State } from '../../core/state.mjs';
import { Vault } from '../../core/vault.mjs';
import { MemoryStore } from '../helpers/memory-store.mjs';
import { newKey } from '../../core/crypto.mjs';

test('a divergent pair does not prevent independent transfer, removal and restore', async (t) => {
  const root = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), 'sesshuttle-divergence-')),
  );
  const home = path.join(root, 'codex'),
    sessions = path.join(home, 'sessions');
  const state = new State(path.join(root, 'state'));
  t.after(async () => {
    state.close();
    await fs.rm(root, { recursive: true, force: true });
  });
  await fs.mkdir(sessions, { recursive: true });
  const conflict = id(),
    normal = id();
  const make = async (name, logical, message) => {
    const records = [
      {
        type: 'session_meta',
        payload: {
          id: logical,
          cli_version: '0.166.0',
          timestamp: '2026-11-01T00:00:00Z',
          cwd: root,
          source: 'cli',
        },
      },
      { type: 'event_msg', payload: { type: 'user_message', message } },
    ];
    const file = path.join(sessions, name + '.jsonl');
    await fs.writeFile(file, records.map((r) => JSON.stringify(r)).join('\n') + '\n');
    return file;
  };
  const a = await make('left', conflict, 'same name'),
    b = await make('right', conflict, 'different copy');
  const independent = await make('normal', normal, 'same name');
  const originals = await Promise.all([a, b, independent].map((f) => fs.readFile(f)));
  const vault = new Vault(new MemoryStore(), id(), newKey());
  await vault.create();
  const importer = new Importer(state, { testRoot: root, processGuard: async () => {} });
  const engine = new Engine(state, { vault, importer }),
    trash = new Trash(state, importer);
  state.set('config', { sourceHomes: [home], targets: {}, bindings: {} });
  const scan = await engine.refresh(),
    row = scan.rows.find((r) => r.id === conflict);
  assert.equal(scan.errors[0].id, conflict);
  assert.equal(row.copies.length, 2);
  const mixed = await engine.preview({ ids: [conflict, normal], direction: 'upload', targets: [] });
  assert.equal(mixed.items[0].excludedReason, 'duplicate_identity');
  const job = await engine.execute(mixed.token, { onlyEligible: true });
  assert.deepEqual(
    job.items.map((i) => i.status),
    ['excluded', 'uploaded'],
  );
  const plan = await trash.preview([home], { ids: [normal] });
  const removed = await trash.remove(plan.token);
  await trash.restore(removed.id);
  assert.deepEqual(await Promise.all([a, b, independent].map((f) => fs.readFile(f))), originals);
  const choice = { token: row.copyToken, file: b };
  const chosen = await engine.preview({
    ids: [conflict],
    direction: 'upload',
    targets: [],
    copyChoice: choice,
  });
  assert.equal((await engine.execute(chosen.token)).items[0].status, 'uploaded');
  const version = (await vault.head(conflict)).tips[0];
  const copy = await downloadCopy(vault, conflict, version, root);
  assert.deepEqual(
    await fs.readFile(
      path.join(
        copy,
        conflict,
        'rollout-' + (await vault.version(version)).files[0].artifacts[0].hash,
      ),
    ),
    originals[1],
  );
  const manual = await importer.backup(home);
  const resolved = await keepLocalCopy(engine, { logical: conflict, ...choice });
  assert.deepEqual(await fs.readFile(b), originals[1]);
  assert.equal((await engine.refresh()).errors.length, 0);
  assert.equal(resolved.backup, null);
  assert.equal(state.keys('backup/').length, 1);
  await importer.restore(manual.id, (await restoreReview(manual)).token);
  assert.deepEqual(await Promise.all([a, b, independent].map((f) => fs.readFile(f))), originals);
});

test('a change before the first deletion write keeps the original and does not lock recovery', async (t) => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'sesshuttle-prewrite-')));
  const home = path.join(root, 'codex'),
    folder = path.join(home, 'sessions'),
    logical = id();
  await fs.mkdir(folder, { recursive: true });
  const file = path.join(folder, logical + '.jsonl');
  const history =
    JSON.stringify({
      type: 'session_meta',
      payload: { id: logical, source: 'cli', cli_version: '0.166.0', cwd: root },
    }) + '\n';
  const update =
    JSON.stringify({
      type: 'event_msg',
      payload: { type: 'user_message', message: 'Added during review' },
    }) + '\n';
  await fs.writeFile(file, history);
  const state = new State(path.join(root, 'app'));
  t.after(async () => {
    state.close();
    await fs.rm(root, { recursive: true, force: true });
  });
  let checks = 0;
  const importer = new Importer(state, {
    testRoot: root,
    processGuard: async () => {
      if (++checks === 2) await fs.appendFile(file, update);
    },
  });
  const trash = new Trash(state, importer),
    plan = await trash.preview([home], { ids: [logical] });
  await assert.rejects(trash.remove(plan.token), { code: 'stale_plan' });
  assert.equal(await fs.readFile(file, 'utf8'), history + update);
  assert.equal(trash.list().length, 0);
  const next = await trash.preview([home], { ids: [logical] });
  await trash.remove(next.token);
  await trash.restore(next.token);
  assert.equal(await fs.readFile(file, 'utf8'), history + update);
});
