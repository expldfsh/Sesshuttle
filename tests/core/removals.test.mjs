import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import readline from 'node:readline';
import { id, exists, hash, Fault } from '../../core/util.mjs';
import { State } from '../../core/state.mjs';
import { Engine } from '../../core/engine.mjs';
import { Importer } from '../../core/importer.mjs';
import { Trash } from '../../core/trash.mjs';
import { Removals } from '../../core/removals.mjs';
import { R2Store } from '../../core/storage.mjs';
import { Vault } from '../../core/vault.mjs';
import { newKey } from '../../core/crypto.mjs';
import { cloudBins } from '../../core/cloud-trash.mjs';

let root, child, store;
before(async () => {
  root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'sesshuttle-ui-removal-')));
  await fs.writeFile(path.join(root, '.sesshuttle-test.json'), '{"format":1}');
  child = spawn(process.execPath, ['scripts/ui-storage.mjs', root], {
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  const lines = readline.createInterface({ input: child.stdout }),
    line = await lines[Symbol.asyncIterator]().next();
  lines.close();
  store = new R2Store(JSON.parse(line.value), { allowLocal: true });
});
after(async () => {
  store?.client.destroy();
  child?.kill();
  if (root) await fs.rm(root, { recursive: true, force: true });
});

async function fixture() {
  const dir = path.join(root, id()),
    home = path.join(dir, 'home'),
    other = path.join(dir, 'other-device'),
    project = path.join(dir, 'code');
  for (const p of [home + '/sessions', home + '/assets', other, project])
    await fs.mkdir(p, { recursive: true });
  const a = id(),
    b = id(),
    asset = home + '/assets/exclusive.png',
    shared = home + '/assets/shared.png',
    logo = project + '/source.png';
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
    'base64',
  );
  for (const [i, file] of [asset, shared, logo].entries())
    await fs.writeFile(file, Buffer.concat([png, Buffer.from([i])]));
  for (const [tid, paths] of [
    [a, [asset, shared, logo]],
    [b, [shared]],
  ]) {
    const header = {
      type: 'session_meta',
      payload: {
        id: tid,
        cwd: project,
        originator: 'codex_cli_rs',
        source: 'cli',
        cli_version: '0.166.0',
        timestamp: '2026-11-03T00:00:00Z',
      },
    };
    const message = {
      type: 'event_msg',
      payload: { type: 'user_message', message: 'Sample ' + tid },
    };
    const images = {
      type: 'event_msg',
      payload: {
        item: { type: 'userMessage', content: paths.map((p) => ({ type: 'localImage', path: p })) },
      },
    };
    await fs.writeFile(
      home + '/sessions/' + tid + '.jsonl',
      [header, message, images].map((v) => JSON.stringify(v)).join('\n') + '\n',
    );
  }
  const state = new State(dir + '/app'),
    key = newKey(),
    vault = new Vault(store, id(), key, { installation: state.get('device').id });
  await vault.create();
  const importer = new Importer(state, { testRoot: root, processGuard: async () => {} });
  const engine = new Engine(state, { vault, importer });
  state.set('config', {
    sourceHomes: [home],
    targets: { desktop: { home }, cli: { home } },
    bindings: {},
  });
  const trash = new Trash(state, importer),
    removals = new Removals(engine, trash);
  async function upload(tid) {
    await engine.refresh();
    const p = await engine.preview({ ids: [tid], direction: 'upload', targets: [] });
    const j = await engine.execute(p.token);
    assert.equal(j.status, 'completed', JSON.stringify(j));
    return (await vault.head(tid)).tips[0];
  }
  const old = await upload(a);
  await fs.appendFile(
    home + '/sessions/' + a + '.jsonl',
    JSON.stringify({ type: 'event_msg', payload: { type: 'user_message', message: 'next' } }) +
      '\n',
  );
  const latest = await upload(a);
  await upload(b);
  await engine.refresh();
  await fs.cp(home, other, { recursive: true });
  const sample = await fs.readFile(other + '/sessions/' + a + '.jsonl');
  const second = new Vault(store, vault.space, key);
  return {
    dir,
    home,
    other,
    project,
    a,
    b,
    old,
    latest,
    asset,
    shared,
    logo,
    sample,
    state,
    importer,
    engine,
    trash,
    removals,
    vault,
    second,
    upload,
  };
}
for (const scope of ['local', 'cloud', 'both'])
  for (const mode of ['trash', 'purge']) {
    test(scope + ' + ' + mode + ' changes only reviewed copies over loopback S3', async () => {
      const x = await fixture();
      try {
        const backup = await x.importer.backup(x.home),
          opts = { scope, mode, ids: [x.a] },
          before = await x.vault.inventory();
        const plan = await x.removals.preview(opts);
        assert.equal((await x.vault.inventory()).bytes, before.bytes);
        assert.ok(plan.retained.some((r) => r.id === backup.id));
        if (scope !== 'cloud') {
          assert.deepEqual(plan.local[0].entries, ['desktop', 'cli']);
          assert.ok(
            plan.local[0].assets.some((a) => a.path === x.logo && a.disposition === 'protected'),
          );
        }
        if (scope !== 'local') {
          assert.equal(plan.cloud.count, 2);
          assert.equal(plan.cloud.items[0].versions.length, 2);
        }
        if (mode === 'purge')
          await assert.rejects(x.removals.execute(plan.token), { code: 'permanent_confirmation' });
        const job = await x.removals.execute(plan.token, {
          permanent: mode === 'purge',
          upgrade: true,
        });
        assert.equal(job.status, 'completed', JSON.stringify(job));
        assert.ok(job.sides.every((s) => s.status === 'done'));
        assert.equal(await exists(x.home + '/sessions/' + x.a + '.jsonl'), scope === 'cloud');
        assert.equal(await exists(x.asset), scope === 'cloud');
        assert.ok(await exists(x.logo));
        assert.ok(await exists(x.shared));
        assert.ok(await exists(x.home + '/sessions/' + x.b + '.jsonl'));
        assert.deepEqual(await fs.readFile(x.other + '/sessions/' + x.a + '.jsonl'), x.sample);
        const observerState = new State(x.dir + '/observer-index');
        try {
          observerState.set('config', { sourceHomes: [x.other], targets: {}, bindings: {} });
          const observer = new Engine(observerState, { vault: x.second });
          const beforeRefresh = await x.second.inventory(),
            observed = await observer.refresh();
          assert.ok(observed.rows.some((r) => r.id === x.a && r.local));
          if (scope !== 'local') {
            const retained = observed.rows.find((r) => r.id === x.a);
            assert.equal(retained.status, 'local_only');
            assert.equal(retained.cloudRemoved, true);
          }
          assert.equal((await x.second.inventory()).bytes, beforeRefresh.bytes);
          assert.deepEqual(await fs.readFile(x.other + '/sessions/' + x.a + '.jsonl'), x.sample);
        } finally {
          observerState.close();
        }
        assert.equal(!!(await x.second.head(x.a)), scope === 'local');
        assert.ok(await x.second.head(x.b));
        const bins = await cloudBins(x.second);
        assert.equal(bins.bins.length, scope !== 'local' && mode === 'trash' ? 1 : 0);
        const sharedChunk = hash(await fs.readFile(x.shared));
        assert.ok((await x.vault.readChunk(sharedChunk)).length);
        if (scope !== 'local' && mode === 'purge') {
          await assert.rejects(x.vault.version(x.old), { code: 'missing_remote_object' });
          await assert.rejects(x.vault.version(x.latest), { code: 'missing_remote_object' });
          await assert.rejects(
            x.vault.readChunk(hash(await fs.readFile(x.other + '/assets/exclusive.png'))),
            { code: 'missing_remote_object' },
          );
        }
        if (scope !== 'cloud' && mode === 'trash') {
          const bin = x.trash.list()[0],
            restore = await x.removals.preview({
              scope: 'local',
              kind: 'bin',
              mode: 'restore',
              ids: bin.ids,
              binId: bin.id,
            });
          assert.equal((await x.removals.execute(restore.token)).status, 'completed');
          assert.deepEqual(await fs.readFile(x.home + '/sessions/' + x.a + '.jsonl'), x.sample);
          const empty = await x.removals.preview({
            scope: 'local',
            kind: 'bin',
            mode: 'purge',
            ids: bin.ids,
            binId: bin.id,
          });
          assert.equal(
            (await x.removals.execute(empty.token, { permanent: true })).status,
            'completed',
          );
          assert.deepEqual(x.trash.list(), []);
        } else assert.equal(x.trash.list().length, 0);
        assert.ok(await exists(x.state.root + '/backups/' + backup.id + '/manifest.json'));
      } finally {
        x.state.close();
      }
    });
  }
test('review includes copies in other cloud bins and protects shared chunks kept only there', async () => {
  const x = await fixture();
  try {
    const bin = await x.removals.preview({ scope: 'cloud', mode: 'trash', ids: [x.b] });
    await x.removals.execute(bin.token, { upgrade: true });
    const p = await x.removals.preview({
      scope: 'cloud',
      mode: 'purge',
      ids: [x.a],
      versions: { [x.a]: [x.old, x.latest] },
    });
    const assets = p.cloud.items[0].versions.flatMap((v) => v.files.flatMap((f) => f.assets));
    assert.ok(assets.some((a) => a.path === x.shared && a.disposition === 'shared'));
    await x.removals.execute(p.token, { permanent: true });
    assert.deepEqual(
      await x.second.readChunk(hash(await fs.readFile(x.shared))),
      await fs.readFile(x.shared),
    );
    const recover = await x.removals.preview({
      scope: 'cloud',
      kind: 'bin',
      mode: 'restore',
      ids: [x.b],
      binId: bin.token,
    });
    assert.equal((await x.removals.execute(recover.token)).status, 'completed');
    assert.ok(await x.second.head(x.b));
  } finally {
    x.state.close();
  }
});
test('a two-side failure preserves the completed side across a restart and never retries it', async () => {
  const x = await fixture();
  try {
    const p = await x.removals.preview({ scope: 'both', mode: 'trash', ids: [x.a] });
    let fail = true;
    x.importer.processGuard = async () => {
      if (fail && !(await x.second.head(x.a))) throw new Fault('codex_running');
    };
    const job = await x.removals.execute(p.token, { upgrade: true });
    assert.equal(job.status, 'partial');
    assert.equal(job.sides[0].status, 'done');
    assert.ok(await exists(x.asset));
    const etag = (await x.vault.rawHead(x.a)).etag;
    fail = false;
    const reopened = new Removals(x.engine, x.trash);
    assert.ok(reopened.retryPlan(job.id).previous);
    const done = await reopened.execute(job.id, { upgrade: true });
    assert.equal(done.status, 'completed');
    assert.equal((await x.vault.rawHead(x.a)).etag, etag);
  } finally {
    x.state.close();
  }
});
test('stale new local images or a changed space stop before either side writes', async () => {
  const x = await fixture();
  try {
    const p = await x.removals.preview({ scope: 'both', mode: 'purge', ids: [x.a] });
    await fs.appendFile(x.asset, 'changed');
    const job = await x.removals.execute(p.token, { permanent: true, upgrade: true });
    assert.equal(job.error.code, 'stale_plan');
    assert.ok(await x.second.head(x.a));
    assert.ok(await exists(x.asset));
    x.engine.vault = new Vault(store, id(), newKey());
    await assert.rejects(x.removals.execute(p.token, { permanent: true, upgrade: true }), {
      code: 'space_changed',
    });
  } finally {
    x.state.close();
  }
});

test('two home folders are reviewed separately, and a shared asset is kept across homes', async () => {
  const x = await fixture();
  try {
    const cfg = x.engine.config();
    cfg.sourceHomes = [x.home, x.other];
    cfg.targets.ide = { home: x.other };
    x.state.set('config', cfg);
    await x.engine.refresh();
    const plan = await x.removals.preview({ scope: 'local', mode: 'purge', ids: [x.a] });
    assert.equal(plan.local.length, 2);
    assert.deepEqual(plan.local.find((g) => g.home === x.other).entries, ['ide']);
    assert.ok(
      plan.local.every((g) =>
        g.assets.some((a) => a.path === x.asset && a.disposition === 'shared'),
      ),
    );
    const job = await x.removals.execute(plan.token, { permanent: true });
    assert.equal(job.status, 'completed', JSON.stringify(job));
    assert.ok(await exists(x.asset));
    assert.equal(await exists(x.other + '/sessions/' + x.a + '.jsonl'), false);
  } finally {
    x.state.close();
  }
});

test('a failed final local purge reports the remaining recovery copy and retries cleanup only', async () => {
  const x = await fixture();
  try {
    const p = await x.removals.preview({ scope: 'local', mode: 'purge', ids: [x.a] });
    x.trash.purge = async (tid) => {
      const bin = x.state.get('trash/' + tid);
      x.state.set('trash/' + tid, { ...bin, status: 'purging' });
      throw new Fault('local_permission_denied');
    };
    const job = await x.removals.execute(p.token, { permanent: true });
    assert.equal(job.status, 'partial');
    assert.equal(job.sides[0].status, 'localCleanup');
    const path = x.home + '/sessions/' + x.a + '.jsonl';
    assert.equal(await exists(path), false);
    await fs.writeFile(path, 'different, newly created file');
    const resumed = new Removals(x.engine, new Trash(x.state, x.importer));
    assert.equal((await resumed.execute(p.token, { permanent: true })).status, 'completed');
    assert.equal(await fs.readFile(path, 'utf8'), 'different, newly created file');
    assert.equal(x.trash.list().length, 0);
  } finally {
    x.state.close();
  }
});
