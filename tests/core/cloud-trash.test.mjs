import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hash, id } from '../../core/util.mjs';
import { newKey, seal } from '../../core/crypto.mjs';
import { Vault } from '../../core/vault.mjs';
import { MemoryStore } from '../helpers/memory-store.mjs';
import { bundleOf, tempRoot } from '../helpers/bundles.mjs';
import { Importer } from '../../core/importer.mjs';
import { Engine } from '../../core/engine.mjs';
import { State } from '../../core/state.mjs';
import { downloadCopy } from '../../core/download-copy.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { changeCloud, cloudBins, cloudRemovalPlan } from '../../core/cloud-trash.mjs';

async function apply(v, request, op = id()) {
  const { preview } = await cloudRemovalPlan(v, request);
  await changeCloud(v, request, preview.signature, op, { upgrade: true });
  return { op, preview };
}
test('cloud bin survives reopening, keeps divergent edits and never restores to a device', async () => {
  const store = new MemoryStore(),
    key = newKey(),
    v = new Vault(store, id(), key);
  await v.create();
  const t = id(),
    other = new Vault(store, v.space, key);
  const first = await v.publish(await bundleOf(v, t, 'sample'), { name: 'Fake Mac' });
  const op = id(),
    request = { action: 'trash', ids: [t] },
    snapshot = [...store.objects].map(([k, x]) => [k, x.etag]);
  const { preview } = await cloudRemovalPlan(v, request);
  assert.deepEqual(
    snapshot,
    [...store.objects].map(([k, x]) => [k, x.etag]),
  );
  await changeCloud(v, request, preview.signature, op, { upgrade: true });
  assert.equal(await other.head(t), null);
  assert.equal((await cloudBins(other)).bins[0].id, op);
  const next = await other.publish(await bundleOf(other, t, 'a different edit'), {
    name: 'Fake Linux',
  });
  await apply(other, { action: 'restore', ids: [t], binId: op });
  assert.deepEqual(new Set((await v.head(t)).tips), new Set([first.version, next.version]));
  assert.equal((await cloudBins(v)).bins.length, 0);
});
test('hard deletion rejects stale previews and resumes partial object cleanup', async () => {
  const s = new MemoryStore(),
    v = new Vault(s, id(), newKey());
  await v.create();
  const t = id(),
    outside = new Vault(s, id(), newKey());
  await outside.create();
  const first = await v.publish(await bundleOf(v, t, 'old'), { id: 'm' }),
    request = { action: 'purge', ids: [t] };
  const stale = await cloudRemovalPlan(v, request);
  await v.publish(await bundleOf(v, t, 'another branch'), { id: 'l' });
  await assert.rejects(changeCloud(v, request, stale.preview.signature, id(), { upgrade: true }), {
    code: 'stale_plan',
  });
  const foreign = await outside.publish(await bundleOf(outside, t, 'other space'), { id: 'm' });
  const { preview } = await cloudRemovalPlan(v, request),
    op = id();
  const remove = s.remove.bind(s);
  let fail = true;
  s.remove = async (k) => {
    if (fail) {
      fail = false;
      throw Error('injected transport loss');
    }
    return remove(k);
  };
  await assert.rejects(changeCloud(v, request, preview.signature, op, { upgrade: true }));
  assert.equal((await cloudBins(v)).pending.id, op);
  await assert.rejects(v.publish(await bundleOf(v, t, 'new'), {}), {
    code: 'cloud_cleanup_pending',
  });
  await changeCloud(v, null, null, op);
  await changeCloud(v, null, null, op);
  await assert.rejects(v.version(first.version), { code: 'missing_remote_object' });
  assert.equal((await outside.version(foreign.version)).title, 'other space');
});
test('partial version removal shows the surviving head and does not reactivate resolved branches', async () => {
  const v = new Vault(new MemoryStore(), id(), newKey());
  await v.create();
  const t = id();
  const one = await v.publish(await bundleOf(v, t, 'one'), {}),
    two = await v.publish(await bundleOf(v, t, 'two'), {});
  await v.choose(t, two.version, two.head.etag);
  const { preview } = await apply(v, {
    ids: [t],
    action: 'purge',
    versions: { [t]: [two.version] },
  });
  assert.deepEqual(
    preview.items[0].nextTips.map((x) => x.id),
    [one.version],
  );
  assert.equal((await v.head(t)).title, 'one');
  const { op } = await apply(v, { ids: [t], action: 'trash' });
  await apply(v, { ids: [t], binId: op, action: 'purgeBin' });
  assert.equal((await cloudBins(v)).bins.length, 0);
  await assert.rejects(v.version(one.version), { code: 'missing_remote_object' });
});

test('embedded histories in another backup are disclosed even when only the local dependent is also removed', async () => {
  const v = new Vault(new MemoryStore(), id(), newKey());
  await v.create();
  const root = id(),
    child = id(),
    other = id(),
    r = await bundleOf(v, root, 'root'),
    sub = await bundleOf(v, child, 'child'),
    independent = await bundleOf(v, other, 'other project');
  await v.publish(r, { name: 'Mac' });
  independent.files.push(sub.files[0]);
  const kept = await v.publish(independent, { name: 'Linux' });
  const request = { ids: [root], inspectIds: [child], action: 'purge' },
    p = await cloudRemovalPlan(v, request);
  assert.ok(p.preview.retained.some((c) => c.id === kept.version && c.members.includes('child')));
  await changeCloud(v, request, p.preview.signature, id(), { upgrade: true });
  assert.equal((await v.version(kept.version)).files.length, 2);
});

test('permanent removal leaves a manifest still referenced by another recovery entry', async () => {
  const store = new MemoryStore(),
    v = new Vault(store, id(), newKey());
  await v.create();
  const tid = id();
  const first = await v.publish(await bundleOf(v, tid, 'same saved revision'), { name: 'test' }),
    { op } = await apply(v, { ids: [tid], action: 'trash' });
  const h = await v.rawHead(tid),
    name = 'heads/' + tid;
  const duplicated = { ...first.head, trash: h.trash };
  delete duplicated.etag;
  await store.put(v.prefix + name, seal(duplicated, v.key, v.space, name), h.etag);
  const p = await apply(v, { ids: [tid], action: 'purge' });
  assert.equal(p.preview.freeBytes, 0);
  assert.ok(p.preview.retained.some((r) => r.id === first.version && r.place === 'cloudBin'));
  assert.equal((await v.version(first.version)).title, 'same saved revision');
  await apply(v, { ids: [tid], binId: op, action: 'purgeBin' });
  await assert.rejects(v.version(first.version), { code: 'missing_remote_object' });
});

test('an early test-release manifest stays opaque: removal lists and deletes it, other paths refuse it', async () => {
  const store = new MemoryStore(),
    v = new Vault(store, id(), newKey());
  await v.create();
  const t = id(),
    raw = Buffer.from('{}\n');
  const manifest = {
    format: 1,
    logicalId: t,
    title: 'early',
    source: 'cli',
    project: '/sample',
    archived: false,
    issues: [],
    files: [{ id: t, raw: raw.toString('base64'), hash: hash(raw), version: '0.164.0' }],
  };
  const version = hash(JSON.stringify(manifest)),
    name = 'versions/' + version;
  await store.put(v.prefix + name, seal(manifest, v.key, v.space, name), null);
  const head = {
    format: 1,
    logicalId: t,
    title: 'early',
    source: 'cli',
    project: '/sample',
    tips: [version],
    versions: [
      { id: version, parents: [], device: { name: 'rc' }, at: '2026-01-01T00:00:00.000Z' },
    ],
  };
  await store.put(v.prefix + 'heads/' + t, seal(head, v.key, v.space, 'heads/' + t), null);
  await assert.rejects(v.version(version), { code: 'legacy_format_unsupported' });
  await assert.rejects(new Importer(null).import(manifest, {}), {
    code: 'legacy_format_unsupported',
  });
  const root = await tempRoot();
  await assert.rejects(downloadCopy(v, t, version, root), { code: 'legacy_format_unsupported' });
  assert.deepEqual(await fs.readdir(root), []);
  const state = new State(path.join(root, 'state'));
  try {
    await fs.mkdir(path.join(root, 'codex'));
    state.set('config', { sourceHomes: [path.join(root, 'codex')], targets: {}, bindings: {} });
    const engine = new Engine(state, { vault: v });
    await engine.refresh();
    const plan = await engine.preview({ ids: [t], direction: 'download', targets: ['desktop'] });
    assert.equal(plan.items[0].excludedReason, 'legacy_format_unsupported');
    await engine.discardPlan(plan.token);
  } finally {
    state.close();
  }
  const request = { ids: [t], action: 'purge' },
    { preview } = await cloudRemovalPlan(v, request);
  assert.equal(preview.items[0].versions[0].legacy, true);
  assert.deepEqual(preview.items[0].versions[0].files, []);
  assert.equal(preview.freeBytes, store.objects.get(v.prefix + name).body.length);
  await changeCloud(v, request, preview.signature, id(), { upgrade: true });
  assert.equal(store.objects.has(v.prefix + name), false);
  assert.equal(await v.head(t), null);
});
test('a new upload beside an early test-release version keeps both branches; the legacy one can go to the bin', async () => {
  const store = new MemoryStore(),
    v = new Vault(store, id(), newKey());
  await v.create();
  const t = id();
  const manifest = { format: 1, logicalId: t, title: 'early', files: [] },
    version = hash(JSON.stringify(manifest)),
    name = 'versions/' + version;
  await store.put(v.prefix + name, seal(manifest, v.key, v.space, name), null);
  await store.put(
    v.prefix + 'heads/' + t,
    seal(
      {
        format: 1,
        logicalId: t,
        title: 'early',
        tips: [version],
        versions: [{ id: version, parents: [], at: '2026-01-01T00:00:00.000Z' }],
      },
      v.key,
      v.space,
      'heads/' + t,
    ),
    null,
  );
  const next = await v.publish(await bundleOf(v, t, 'current'), { name: 'Mac' });
  assert.deepEqual(new Set(next.head.tips), new Set([version, next.version]));
  const { preview } = await apply(v, { ids: [t], action: 'trash', versions: { [t]: [version] } });
  assert.deepEqual(
    preview.items[0].nextTips.map((x) => x.id),
    [next.version],
  );
  assert.deepEqual((await v.head(t)).tips, [next.version]);
  assert.equal((await cloudBins(v)).bins[0].count, 1);
});

test('version descriptions are cached per space, extended for new versions and dropped after deletion', async () => {
  const store = new MemoryStore(),
    v = new Vault(store, id(), newKey());
  await v.create();
  const t = id();
  const one = await v.publish(await bundleOf(v, t, 'one'), {});
  const root = await tempRoot();
  const state = new State(path.join(root, 'state'));
  const key = (version) => 'version-desc/' + v.space + '/' + version;
  try {
    let reads = 0;
    const get = store.get.bind(store);
    store.get = async (k) => {
      if (k.includes('/versions/')) reads++;
      return get(k);
    };
    const request = { ids: [t], action: 'trash' };
    const first = await cloudRemovalPlan(v, request, { cache: state });
    assert.equal(reads, 1);
    const again = await cloudRemovalPlan(v, request, { cache: state });
    assert.equal(reads, 1, 'cached descriptions are not downloaded again');
    assert.equal(again.preview.signature, first.preview.signature);
    assert.deepEqual(again.preview.items, first.preview.items);
    const two = await v.publish(await bundleOf(v, t, 'two'), {});
    reads = 0;
    await cloudRemovalPlan(v, request, { cache: state });
    assert.equal(reads, 1, 'only the new version is read');
    state.set(key(one.version), { v: 1 });
    reads = 0;
    await cloudRemovalPlan(v, request, { cache: state });
    assert.equal(reads, 1, 'a damaged entry is recomputed');
    const purge = { ids: [t], action: 'purge', versions: { [t]: [one.version] } };
    const plan = await cloudRemovalPlan(v, purge, { cache: state });
    await changeCloud(v, purge, plan.preview.signature, id(), { cache: state, upgrade: true });
    await cloudRemovalPlan(v, request, { cache: state });
    assert.equal(state.get(key(one.version)), null);
    assert.ok(state.get(key(two.version)));
  } finally {
    state.close();
  }
});
