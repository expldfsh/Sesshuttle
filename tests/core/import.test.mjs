import { restoreReview, backupSummary, deleteBackup } from '../../core/manual-backups.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { State } from '../../core/state.mjs';
import { Importer } from '../../core/importer.mjs';
import { scan } from '../../core/codex.mjs';
import { id, hash } from '../../core/util.mjs';
import { captureBundle } from '../../core/bundle.mjs';
import { Vault } from '../../core/vault.mjs';
import { newKey } from '../../core/crypto.mjs';
import { MemoryStore } from '../helpers/memory-store.mjs';
import { rolloutText, writeRollout } from '../helpers/bundles.mjs';
async function setup() {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'sesshuttle-core-')));
  const home = path.join(root, 'target'),
    project = path.join(root, 'project'),
    source = path.join(root, 'source');
  await fs.mkdir(home);
  await fs.mkdir(project);
  const state = new State(path.join(root, 'state'));
  const logical = id();
  const raw = Buffer.from(
    rolloutText(logical, { texts: ['Synthetic history'], cwd: project, version: '0.164.0' }),
  );
  await writeRollout(source, logical, { raw });
  const binary = path.join(root, 'codex-test-binary');
  await fs.writeFile(binary, '#!/bin/sh\nprintf "codex-cli 0.166.0\\n"\n', { mode: 0o700 });
  const vault = new Vault(new MemoryStore(), id(), newKey());
  await vault.create();
  const rows = (await scan([source])).rows,
    stage = path.join(root, 'stage');
  await fs.mkdir(stage);
  const published = await vault.publish(await captureBundle(rows[0], rows, vault, stage), {
    name: 'synthetic',
  });
  const payload = await vault.version(published.version);
  return { root, home, project, state, payload, raw, binary, vault };
}
// A real installed Codex binary is required only by the separate native integration.
// These checks focus on guard failure and restore without starting any native app.
test('import refuses running Codex before changing anything', async () => {
  const x = await setup();
  const importer = new Importer(x.state, {
    testRoot: x.root,
    processGuard: async () => {
      throw Object.assign(new Error(), { code: 'codex_running' });
    },
  });
  await assert.rejects(
    importer.import(
      x.payload,
      { home: x.home, project: x.project, binary: x.binary },
      { vault: x.vault },
    ),
    { code: 'codex_running' },
  );
  assert.deepEqual(await fs.readdir(x.home), []);
  x.state.close();
});
test('corrupt payload, legacy formats and out-of-scope targets never reach native writes', async () => {
  const x = await setup();
  const importer = new Importer(x.state, { testRoot: x.root, processGuard: async () => {} });
  const bad = structuredClone(x.payload);
  bad.files[0].artifacts[0].bytes += 1;
  await assert.rejects(importer.import(bad, { home: x.home }, { vault: x.vault }), {
    code: 'corrupt_data',
  });
  await assert.rejects(
    importer.import({ ...x.payload, format: 1 }, { home: x.home }, { vault: x.vault }),
    { code: 'legacy_format_unsupported' },
  );
  await assert.rejects(importer.guard(os.homedir()), { code: 'unsafe_path' });
  assert.deepEqual(await fs.readdir(x.home), []);
  x.state.close();
});
test('backup recovery restores bytes without creating another backup', async () => {
  const x = await setup();
  await fs.mkdir(path.join(x.home, 'sessions'));
  const file = path.join(x.home, 'sessions', 'fixture.jsonl');
  await fs.writeFile(file, x.raw);
  const importer = new Importer(x.state, { testRoot: x.root, processGuard: async () => {} });
  const b = await importer.backup(x.home);
  await fs.writeFile(file, 'different');
  const summary = await backupSummary(x.state, b);
  assert.ok(summary.diskBytes > 0);
  assert.equal(summary.reason, 'manual');
  const review = await restoreReview(b);
  const extra = path.join(x.home, 'sessions', 'extra.jsonl');
  await fs.writeFile(extra, 'extra');
  await assert.rejects(importer.restore(b.id, review.token), { code: 'stale_plan' });
  const updated = await restoreReview(b);
  assert.deepEqual(updated.remove, ['sessions/extra.jsonl']);
  const result = await importer.restore(b.id, updated.token);
  assert.equal(result.status, 'restored_needs_validation');
  assert.deepEqual(await fs.readFile(file), x.raw);
  assert.equal(x.state.keys('backup/').length, 1);
  await deleteBackup(x.state, b.id);
  assert.equal(x.state.keys('backup/').length, 0);
  assert.deepEqual(await fs.readFile(file), x.raw);
  x.state.close();
});
test('scanner reports corruption and distinguishes origin without rewriting data', async () => {
  const x = await setup();
  await fs.mkdir(path.join(x.home, 'sessions'));
  await fs.writeFile(path.join(x.home, 'sessions', 'a.jsonl'), x.raw);
  await fs.writeFile(path.join(x.home, 'sessions', 'bad.jsonl'), 'truncated');
  const s = await scan([x.home]);
  assert.equal(s.errors.length, 1);
  assert.equal(s.rows.length, 1);
  assert.equal(s.rows[0].source, 'cli');
  const bundle = await captureBundle(s.rows[0], s.rows, { stageChunk: async () => {} }, x.root);
  assert.equal(bundle.files[0].artifacts[0].hash, hash(x.raw));
  assert.deepEqual(await fs.readFile(path.join(x.home, 'sessions', 'a.jsonl')), x.raw);
  x.state.close();
});
