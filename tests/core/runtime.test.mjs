import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { State } from '../../core/state.mjs';
import {
  requireRuntime,
  resolveLauncher,
  runtimeInfo,
  receiptMatchesRuntime,
} from '../../core/runtime.mjs';
import { verifyRuntime } from '../../core/runtime-check.mjs';
import { attachmentReview } from '../../core/attachment-policy.mjs';
import { canCompile, compileStandIn, fakeBundle } from '../helpers/stand-in.mjs';

test('a version warning does not block valid history or mask a required dependency', () => {
  assert.deepEqual(
    attachmentReview({ issues: ['unknown_version'], files: [{ issues: ['unknown_version'] }] })
      .blockingIssues,
    [],
  );
  assert.deepEqual(
    attachmentReview({ issues: ['unknown_version', 'missing_dependency'], files: [] })
      .blockingIssues,
    ['missing_dependency'],
  );
});

test('discovery is distinct from permission to import, and a replacement binary invalidates a stored proof', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sesshuttle-identity-')),
    file = path.join(root, 'codex');
  const state = new State(path.join(root, 'app'));
  t.after(async () => {
    state.close();
    await fs.rm(root, { recursive: true, force: true });
  });
  const version = '9.9.9-dev.1';
  const program = '#!/bin/sh\necho "warning from wrapper" >&2\necho "codex-cli ' + version + '"\n';
  await fs.writeFile(file, program, { mode: 0o700 });
  const pending = await runtimeInfo(file, state);
  assert.equal(pending.version, version);
  assert.equal(pending.status, 'untested');
  await assert.rejects(requireRuntime(file, state), { code: 'runtime_check_needed' });
  await assert.rejects(verifyRuntime(file, state), { code: 'runtime_launcher' });
  assert.equal(state.keys('runtime-proof/').length, 0);
  // Seed the cache to exercise a same-version replacement across both path aliases.
  state.set(pending.key, { passed: true, projects: false });
  const alias = path.join(root, 'other-entry');
  await fs.symlink(file, alias);
  assert.equal((await requireRuntime(alias, state)).key, pending.key);
  await fs.writeFile(path.join(root, 'update'), program, { mode: 0o700 });
  await fs.rename(path.join(root, 'update'), file);
  assert.equal((await runtimeInfo(alias, state)).status, 'untested');
  await assert.rejects(requireRuntime(alias, state), { code: 'runtime_check_needed' });
  await fs.writeFile(file, '#!/bin/sh\necho "warning" >&2\necho "codex-cli 0.166.0"\n');
  assert.equal((await requireRuntime(file, state)).status, 'builtin');
});

test('old receipts survive a known-version upgrade path, but do not attest a replacement unlisted executable', () => {
  const legacy = { runtime: '0.166.0' },
    proof = { ...legacy, runtimeKey: 'first-build' };
  const identity = { version: legacy.runtime, key: 'first-build', status: 'verified' };
  assert.ok(receiptMatchesRuntime(legacy, { ...identity, status: 'builtin' }));
  assert.equal(receiptMatchesRuntime(legacy, identity), false);
  assert.ok(receiptMatchesRuntime(proof, identity));
  assert.equal(receiptMatchesRuntime(proof, { ...identity, key: 'replacement' }), false);
});

test('saved runtime status reads only saved state and never runs the program', async (t) => {
  const { savedRuntimeStatus } = await import('../../core/runtime.mjs');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sesshuttle-saved-runtime-'));
  const state = new State(path.join(root, 'app'));
  t.after(async () => {
    state.close();
    await fs.rm(root, { recursive: true, force: true });
  });
  const file = path.join(root, 'codex'),
    marker = path.join(root, 'ran');
  // The program leaves a marker whenever it runs.
  const program = (version) => `#!/bin/sh\ntouch '${marker}'\necho "codex-cli ${version}"\n`;
  await fs.writeFile(file, program('9.9.9-dev.2'), { mode: 0o700 });
  assert.equal(await savedRuntimeStatus(path.join(root, 'absent'), state), 'missing');
  assert.equal(await savedRuntimeStatus(file, state), 'unchecked');
  await assert.rejects(fs.stat(marker));
  const info = await runtimeInfo(file, state);
  await fs.rm(marker);
  assert.equal(await savedRuntimeStatus(file, state), 'untested');
  state.set(info.key, { passed: true });
  assert.equal(await savedRuntimeStatus(file, state), 'verified');
  await fs.writeFile(file, program('0.166.0'), { mode: 0o700 });
  assert.equal(
    await savedRuntimeStatus(file, state),
    'unchecked',
    'a replaced file needs a new check',
  );
  await runtimeInfo(file, state);
  await fs.rm(marker);
  assert.equal(await savedRuntimeStatus(file, state), 'builtin');
  await assert.rejects(fs.stat(marker), 'status checks never run the program');
});

// §10.1: an app bundle's launcher script resolves to the program inside the same bundle.
test('a known app bundle launcher resolves to the real program', async (t) => {
  if (!canCompile()) return t.skip('needs a C compiler for the stand-in program');
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'sesshuttle-bundle-')));
  const state = new State(path.join(root, 'app'));
  t.after(async () => {
    state.close();
    await fs.rm(root, { recursive: true, force: true });
  });
  for (const name of ['ChatGPT.app', 'Codex.app']) {
    const { launcher, program } = await fakeBundle(root, name, '9.9.1');
    const viaLauncher = await runtimeInfo(launcher, state);
    const direct = await runtimeInfo(program, state);
    assert.equal(viaLauncher.file, program);
    assert.equal(viaLauncher.script, false);
    assert.equal(viaLauncher.key, direct.key, 'a proof applies to both paths');
    assert.equal(viaLauncher.version, '9.9.1');
    // A symbolic link to the launcher is the launcher.
    const link = path.join(root, name + '-link');
    await fs.symlink(launcher, link);
    assert.equal((await runtimeInfo(link, state)).file, program);
  }
});

test('a launcher is not resolved when its program is not safely inside the bundle', async (t) => {
  if (!canCompile()) return t.skip('needs a C compiler for the stand-in program');
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'sesshuttle-bundle-')));
  const state = new State(path.join(root, 'app'));
  t.after(async () => {
    state.close();
    await fs.rm(root, { recursive: true, force: true });
  });
  const unresolved = async (launcher) => {
    assert.equal(await resolveLauncher(launcher), null);
    await assert.rejects(verifyRuntime(launcher, state), { code: 'runtime_launcher' });
    assert.equal(state.keys('runtime-proof/').length, 0);
  };
  // The launcher itself answers --version so that only the launcher rule is exercised.
  const answering = async (launcher) =>
    fs.writeFile(launcher, '#!/bin/sh\necho "codex-cli 9.9.2"\n', { mode: 0o755 });

  const missing = await fakeBundle(root, 'ChatGPT.app', '', { compile: false });
  await answering(missing.launcher);
  await unresolved(missing.launcher);

  const script = await fakeBundle(path.join(root, 'script'), 'ChatGPT.app', '9.9.2');
  await answering(script.launcher);
  await fs.rm(script.program);
  await fs.writeFile(script.program, '#!/bin/sh\necho "codex-cli 9.9.2"\n', { mode: 0o755 });
  await unresolved(script.launcher);

  const folder = await fakeBundle(path.join(root, 'folder'), 'ChatGPT.app', '', { compile: false });
  await answering(folder.launcher);
  await fs.mkdir(folder.program);
  await unresolved(folder.launcher);

  const outside = await fakeBundle(path.join(root, 'outside'), 'ChatGPT.app', '', {
    compile: false,
  });
  await answering(outside.launcher);
  const elsewhere = path.join(root, 'elsewhere', 'codex');
  await compileStandIn(elsewhere, '9.9.2');
  await fs.symlink(elsewhere, outside.program);
  await unresolved(outside.launcher);

  // Only verified bundle names and the exact layout are followed.
  const other = await fakeBundle(root, 'Other.app', '9.9.2');
  await answering(other.launcher);
  await unresolved(other.launcher);
});

test('a program at the launcher position is used as it is', async (t) => {
  if (!canCompile()) return t.skip('needs a C compiler for the stand-in program');
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'sesshuttle-bundle-')));
  const state = new State(path.join(root, 'app'));
  t.after(async () => {
    state.close();
    await fs.rm(root, { recursive: true, force: true });
  });
  const { launcher } = await fakeBundle(root, 'ChatGPT.app', '9.9.3');
  await fs.rm(launcher);
  await compileStandIn(launcher, '9.9.4');
  assert.equal(await resolveLauncher(launcher), null);
  assert.equal((await runtimeInfo(launcher, state)).version, '9.9.4');
});
