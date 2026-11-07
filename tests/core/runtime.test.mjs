import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { State } from '../../core/state.mjs';
import { requireRuntime, runtimeInfo, receiptMatchesRuntime } from '../../core/runtime.mjs';
import { verifyRuntime } from '../../core/runtime-check.mjs';
import { attachmentReview } from '../../core/attachment-policy.mjs';

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
