import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { Vault } from '../../core/vault.mjs';
import { newKey } from '../../core/crypto.mjs';
import { id } from '../../core/util.mjs';
import { withSpaceWriter } from '../../core/space-writer.mjs';
import { materialize } from '../../core/bundle.mjs';
import { MemoryStore } from '../helpers/memory-store.mjs';
import { bundleOf, tempRoot } from '../helpers/bundles.mjs';

// Each put waits, so concurrent uploads really overlap.
function slowStore() {
  const store = new MemoryStore();
  const put = store.put.bind(store),
    inventory = store.inventory.bind(store);
  Object.assign(store, { active: 0, peak: 0, listings: 0 });
  store.put = async (...args) => {
    store.active++;
    store.peak = Math.max(store.peak, store.active);
    await delay(150);
    try {
      return await put(...args);
    } finally {
      store.active--;
    }
  };
  store.inventory = async (prefix) => {
    store.listings++;
    return inventory(prefix);
  };
  return store;
}
const blobBytes = (store, vault) =>
  [...store.objects]
    .filter(([k]) => k.startsWith(vault.prefix + 'blobs/'))
    .reduce((n, [, v]) => n + v.body.length, 0);
// Five 4 MiB chunks of incompressible history.
const large = () => randomBytes(15 * 1024 * 1024).toString('base64');

test('concurrent chunk uploads keep the byte count and the upload budget exact', async () => {
  const store = slowStore(),
    vault = new Vault(store, id(), newKey());
  await vault.create();
  const payload = await bundleOf(vault, id(), large());
  const chunks = new Set(payload.files[0].artifacts[0].chunks.map((c) => c.hash));
  assert.ok(chunks.size > 4);
  let counted = 0;
  vault.beginTransfer(1024 * 1024 * 1024);
  vault.onBytes = (n) => (counted += n);
  const before = vault.writeBudget.remaining;
  await vault.publish(payload, { name: 'test' });
  assert.equal(store.peak, 4);
  const blobs = blobBytes(store, vault);
  const spent = before - vault.writeBudget.remaining;
  assert.equal(counted, spent, 'every written byte is reported once');
  assert.ok(
    spent >= blobs && spent - blobs < 64 * 1024,
    'only manifest and head exceed the chunks',
  );
  vault.endTransfer();
  assert.equal(vault.writeBudget, null);
  const restored = await materialize(
    await vault.version((await vault.head(payload.logicalId)).tips[0]),
    vault,
    await tempRoot(),
  );
  assert.equal(restored.files[0].artifacts[0].bytes, payload.files[0].artifacts[0].bytes);
});

test('the upload budget stops concurrent chunk writes before it is exceeded', async () => {
  const store = slowStore(),
    vault = new Vault(store, id(), newKey());
  await vault.create();
  const payload = await bundleOf(vault, id(), large());
  const budget = 9 * 1024 * 1024;
  let counted = 0;
  vault.beginTransfer(budget);
  vault.onBytes = (n) => (counted += n);
  await assert.rejects(vault.publish(payload, { name: 'test' }), { code: 'upload_limit' });
  const blobs = blobBytes(store, vault);
  assert.ok(blobs <= budget && blobs > 0);
  assert.equal(counted, blobs);
  assert.equal(budget - vault.writeBudget.remaining, blobs);
  assert.equal(await vault.head(payload.logicalId), null, 'no version or head without all chunks');
  vault.endTransfer();
});

test('a transfer lists the space once and again after another device removed cloud data', async () => {
  const store = slowStore(),
    vault = new Vault(store, id(), newKey());
  await vault.create();
  const other = new Vault(store, vault.space, vault.key, { installation: id() });
  vault.beginTransfer(1024 * 1024 * 1024);
  await vault.publish(await bundleOf(vault, id(), 'first'), {});
  await vault.publish(await bundleOf(vault, id(), 'second'), {});
  assert.equal(store.listings, 1);
  await withSpaceWriter(other, (guard) => guard.update({ completed: [id()] }));
  await vault.publish(await bundleOf(vault, id(), 'third'), {});
  assert.equal(store.listings, 2);
  vault.endTransfer();
  await vault.publish(await bundleOf(vault, id(), 'outside a transfer'), {});
  assert.equal(store.listings, 3);
});
