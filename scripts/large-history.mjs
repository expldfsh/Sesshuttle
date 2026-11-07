// Explicit synthetic 1.6 GiB fixture; never reads user history or uses real R2.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { State } from '../core/state.mjs';
import { Engine } from '../core/engine.mjs';
import { Vault } from '../core/vault.mjs';
import { MemoryStore } from '../tests/helpers/memory-store.mjs';
import { newKey } from '../core/crypto.mjs';
import { id } from '../core/util.mjs';
import { materialize } from '../core/bundle.mjs';
import { digestFile, writeStream } from '../core/stream.mjs';
import { Importer } from '../core/importer.mjs';
const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'sesshuttle-large-'))),
  home = path.join(root, 'home');
await fs.mkdir(path.join(home, 'sessions'), { recursive: true });
const disk = await fs.statfs(root);
assert.ok(disk.bavail * disk.bsize > 8 * 1024 ** 3, 'At least 8 GiB free is required');
const tid = id(),
  file = path.join(home, 'sessions', tid + '.jsonl');
const line = Buffer.from(
  JSON.stringify({ type: 'token_usage_record', payload: { synthetic: 'x'.repeat(1024 * 1024) } }) +
    '\n',
);
async function* data() {
  yield Buffer.from(
    JSON.stringify({
      type: 'session_meta',
      payload: {
        id: tid,
        timestamp: '2026-11-01T00:00:00Z',
        cli_version: '0.166.0',
        source: 'cli',
        cwd: root,
      },
    }) + '\n',
  );
  for (let n = 0; n < 1600; n++) yield line;
  yield Buffer.from(
    JSON.stringify({
      type: 'event_msg',
      payload: { type: 'user_message', message: 'Final full-history marker' },
    }) + '\n',
  );
}
await writeStream(file, data());
const original = await digestFile(file),
  state = new State(path.join(root, 'app'));
state.set('config', { sourceHomes: [home], targets: {}, bindings: {} });
const store = new MemoryStore(),
  vault = new Vault(store, id(), newKey());
await vault.create();
const engine = new Engine(state, { vault });
let peak = 0;
const timer = setInterval(() => (peak = Math.max(peak, process.memoryUsage().rss)), 100);
try {
  await engine.refresh();
  assert.equal(engine.rows.length, 1);
  assert.equal(engine.rows[0].fileBytes, original.bytes);
  const plan = await engine.preview({ ids: [tid], direction: 'upload', targets: [] });
  const job = await engine.execute(plan.token, { confirmLarge: true });
  assert.equal(job.status, 'completed', JSON.stringify(job));
  const head = await vault.head(tid),
    payload = await vault.version(head.tips[0]);
  const restored = await materialize(payload, vault, path.join(root, 'download'));
  assert.deepEqual(await digestFile(restored.files[0].artifacts[0].file), original);
  const importer = new Importer(state, { testRoot: root, processGuard: async () => {} });
  const backup = await importer.backup(home);
  await fs.writeFile(file, 'synthetic replacement');
  await importer.restore(backup.id);
  assert.deepEqual(await digestFile(file), original);
  console.log(
    JSON.stringify({
      result: 'PASS',
      sourceBytes: original.bytes,
      encryptedBytes: (await vault.inventory()).bytes,
      chunks: payload.files[0].artifacts[0].chunks.length,
      peakRssBytes: peak,
      hash: original.hash,
      checks: [
        'stream scan',
        'preview no cloud writes',
        'encrypted chunk roundtrip',
        'over-1-GiB backup and restore',
      ],
    }),
  );
} finally {
  clearInterval(timer);
  state.close();
  await fs.rm(root, { recursive: true, force: true });
}
