import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { newKey, seal, unseal } from '../../core/crypto.mjs';
import { MemoryStore } from '../helpers/memory-store.mjs';
import { Vault } from '../../core/vault.mjs';
import { id } from '../../core/util.mjs';
import { scan } from '../../core/codex.mjs';
import { captureBundle } from '../../core/bundle.mjs';
import { bundleOf, tempRoot, writeRollout } from '../helpers/bundles.mjs';
const logical = id();
test('authenticated encryption rejects wrong key, object swapping and damage', () => {
  const key = newKey(),
    space = id(),
    data = seal({ text: 'secret' }, key, space, 'one');
  assert.deepEqual(unseal(data, key, space, 'one'), { text: 'secret' });
  assert.throws(() => unseal(data, newKey(), space, 'one'));
  assert.throws(() => unseal(data, key, space, 'two'));
  data[data.length - 1] ^= 1;
  assert.throws(() => unseal(data, key, space, 'one'));
});
test('round trip, repeat upload and conflict preserve every published version', async () => {
  const store = new MemoryStore(),
    key = newKey(),
    space = id(),
    a = new Vault(store, space, key),
    b = new Vault(store, space, key);
  await a.create();
  const first = await a.publish(await bundleOf(a, logical, 'Private title 中文'), { id: 'A' });
  assert.equal((await b.heads()).length, 1);
  const downloaded = await b.version(first.version);
  assert.equal(downloaded.title, 'Private title 中文');
  assert.equal(
    (await a.publish(await bundleOf(a, logical, 'Private title 中文'), { id: 'A' })).version,
    first.version,
  );
  const next = await b.publish(
    { ...(await bundleOf(b, logical, 'Private title 中文 B')), baseVersion: first.version },
    { id: 'B' },
  );
  assert.deepEqual(next.head.tips, [next.version]);
  const conflict = await a.publish(
    { ...(await bundleOf(a, logical, 'Private title 中文 A')), baseVersion: first.version },
    { id: 'A' },
  );
  assert.equal(conflict.head.tips.length, 2);
  assert.deepEqual(new Set(conflict.head.tips), new Set([next.version, conflict.version]));
  await a.version(first.version);
  for (const [k, v] of store.objects) {
    assert.ok(!k.includes('Private'));
    assert.ok(!v.body.includes(Buffer.from('Private title')));
  }
});
test('concurrent writers retain both branches', async () => {
  const s = new MemoryStore(),
    v = new Vault(s, id(), newKey());
  await v.create();
  const base = await v.publish(await bundleOf(v, logical, 'base'), { id: 'A' });
  const left = await bundleOf(v, logical, 'left'),
    right = await bundleOf(v, logical, 'right');
  await Promise.all([
    v.publish({ ...left, baseVersion: base.version }, { id: 'A' }),
    v.publish({ ...right, baseVersion: base.version }, { id: 'B' }),
  ]);
  assert.equal((await v.head(logical)).tips.length, 2);
});
test('wrong key and missing objects do not look like an empty space', async () => {
  const s = new MemoryStore(),
    space = id(),
    v = new Vault(s, space, newKey());
  await v.create();
  await assert.rejects(new Vault(s, space, newKey()).heads(), { code: 'decrypt_failed' });
  await assert.rejects(v.version('0'.repeat(64)), { code: 'missing_remote_object' });
});
test('unfinished records and active turns are not eligible snapshots', async () => {
  const root = await tempRoot(),
    home = path.join(root, 'codex'),
    partial = id(),
    active = id();
  const file = await writeRollout(home, partial, { texts: ['one'] });
  await fs.appendFile(file, '{"type":"event_msg","payload"');
  await writeRollout(home, active, {
    texts: ['two'],
    extra: [{ type: 'event_msg', payload: { type: 'task_started', turn_id: 't' } }],
  });
  const result = await scan([home]);
  assert.equal(result.errors.find((e) => e.file === file)?.code, 'busy');
  const row = result.rows.find((r) => r.id === active);
  assert.equal(row.busy, true);
  await assert.rejects(captureBundle(row, result.rows, { stageChunk: async () => {} }, root), {
    code: 'busy',
  });
});

test('choosing a conflict branch preserves versions and refuses an outdated decision', async () => {
  const v = new Vault(new MemoryStore(), id(), newKey());
  await v.create();
  const a = await v.publish(await bundleOf(v, logical, 'base'), { id: 'a' });
  const b = await v.publish(await bundleOf(v, logical, 'different'), { id: 'b' });
  await assert.rejects(v.choose(b.head.logicalId, a.version, a.head.etag), {
    code: 'concurrent_update',
  });
  await v.choose(b.head.logicalId, a.version, b.head.etag);
  const h = await v.head(b.head.logicalId);
  assert.deepEqual(h.tips, [a.version]);
  assert.equal(h.versions.length, 2);
});
