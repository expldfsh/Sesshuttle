import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { State } from '../../core/state.mjs';
import { Importer } from '../../core/importer.mjs';
import { Engine } from '../../core/engine.mjs';
import { Vault } from '../../core/vault.mjs';
import { MemoryStore } from '../helpers/memory-store.mjs';
import { newKey } from '../../core/crypto.mjs';
import { id, Fault } from '../../core/util.mjs';
import { scan } from '../../core/codex.mjs';
import { captureBundle } from '../../core/bundle.mjs';
import { rolloutText, writeRollout } from '../helpers/bundles.mjs';
async function fixture() {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'sesshuttle-recovery-'))),
    home = path.join(root, 'codex'),
    project = path.join(root, 'project'),
    source = path.join(root, 'source'),
    binary = path.join(root, 'codex-test-binary');
  await fs.mkdir(home);
  await fs.mkdir(project);
  await fs.writeFile(binary, '#!/bin/sh\nprintf "codex-cli 0.164.0\\n"\n', { mode: 0o700 });
  const tid = id(),
    projectId = id(),
    raw = Buffer.from(
      rolloutText(tid, { texts: ['Synthetic recovery fixture'], cwd: project, version: '0.164.0' }),
    );
  await writeRollout(source, tid, { raw });
  const vault = new Vault(new MemoryStore(), id(), newKey());
  await vault.create();
  const state = new State(path.join(root, 'state'));
  // Publishes the source conversation as another device would, bound to one project identity.
  async function publish() {
    const rows = (await scan([source])).rows,
      stage = path.join(root, 'stage-' + id());
    await fs.mkdir(stage);
    const published = await vault.publish(
      { ...(await captureBundle(rows[0], rows, vault, stage)), projectId },
      { name: 'synthetic' },
    );
    return vault.version(published.version);
  }
  return { root, home, project, source, binary, tid, projectId, raw, vault, state, publish };
}
test('failed validation keeps the error and permits explicit retry without a backup', async () => {
  const x = await fixture();
  const payload = await x.publish();
  const importer = new Importer(x.state, {
    testRoot: x.root,
    processGuard: async () => {},
    native: async () => {
      throw new Fault('native_timeout');
    },
  });
  await assert.rejects(importer.import(payload, x, { vault: x.vault }), { code: 'native_timeout' });
  assert.equal((await scan([x.home])).rows.length, 1);
  importer.native = async () => {};
  assert.equal((await importer.import(payload, x, { vault: x.vault })).status, 'verified');
  assert.equal(x.state.keys('backup/').length, 0);
  x.state.close();
});
test('preview hashes reject a destination changed before import', async () => {
  const x = await fixture();
  const payload = await x.publish();
  await fs.mkdir(path.join(x.home, 'sessions'));
  await fs.writeFile(path.join(x.home, 'sessions', 'other.jsonl'), x.raw);
  let called = false;
  const importer = new Importer(x.state, {
    testRoot: x.root,
    processGuard: async () => {},
    native: async () => {
      called = true;
    },
  });
  await assert.rejects(
    importer.import(payload, x, { vault: x.vault, expectedHashes: { [x.tid]: null } }),
    { code: 'stale_plan' },
  );
  assert.equal(called, false);
  assert.equal(x.state.keys('backup/').length, 0);
  x.state.close();
});
test('missing target binary yields partial success and preserves successful entry on retry', async () => {
  const x = await fixture();
  await x.publish();
  let calls = 0;
  const importer = new Importer(x.state, {
    testRoot: x.root,
    processGuard: async () => {},
    native: async () => {
      calls++;
    },
  });
  const engine = new Engine(x.state, { vault: x.vault, importer });
  x.state.set('config', {
    sourceHomes: [x.home],
    bindings: { [x.projectId]: x.project },
    targets: {
      desktop: { home: x.home, binary: x.binary },
      ide: { home: x.home, binary: path.join(x.root, 'missing') },
    },
  });
  await engine.refresh();
  let plan = await engine.preview({
    ids: [x.tid],
    direction: 'download',
    targets: ['desktop', 'ide'],
  });
  let job = await engine.execute(plan.token);
  assert.equal(job.items[0].status, 'partial');
  assert.equal(job.items[0].targets.desktop.status, 'verified');
  assert.equal(job.items[0].targets.ide.status, 'failed');
  x.state.set('config', {
    ...engine.config(),
    targets: { ...engine.config().targets, ide: { home: x.home, binary: x.binary } },
  });
  await engine.refresh();
  plan = await engine.preview({ ids: [x.tid], direction: 'download', targets: ['ide'] });
  job = await engine.execute(plan.token);
  assert.equal(job.items[0].status, 'downloaded');
  assert.equal(calls, 1, 'same shared data and runtime require no second native write');
  assert.equal(x.state.keys('backup/').length, 0);
  x.state.close();
});

test('two-way sync uploads a local conversation and imports selected destinations in one plan', async () => {
  const x = await fixture();
  const importer = new Importer(x.state, {
      testRoot: x.root,
      processGuard: async () => {},
      native: async () => {},
    }),
    engine = new Engine(x.state, { vault: x.vault, importer });
  x.state.set('association/' + x.tid, { projectId: x.projectId, source: 'cli' });
  x.state.set('config', {
    sourceHomes: [x.source],
    bindings: { [x.projectId]: x.project },
    targets: { desktop: { home: x.home, binary: x.binary } },
  });
  await engine.refresh();
  const plan = await engine.preview({ ids: [x.tid], direction: 'both', targets: ['desktop'] });
  assert.equal(plan.items[0].action, 'upload_import');
  const job = await engine.execute(plan.token);
  assert.equal(job.items[0].status, 'downloaded');
  assert.equal(job.items[0].cloudStatus, 'uploaded');
  assert.equal(job.items[0].targets.desktop.status, 'verified');
  assert.equal((await scan([x.home])).rows.length, 1);
  x.state.close();
});
