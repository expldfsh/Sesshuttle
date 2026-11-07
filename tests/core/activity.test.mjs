import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { State } from '../../core/state.mjs';
import { clearActivity } from '../../core/activity.mjs';
import { id } from '../../core/util.mjs';

test('clear only confirmed records and keep baselines, pending recovery and new jobs', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sesshuttle-activity-'));
  const state = new State(root);
  t.after(async () => {
    state.close();
    await fs.rm(root, { recursive: true, force: true });
  });
  const keys = Array.from({ length: 40 }, () => 'job/' + id());
  for (const key of keys) state.set(key, { id: key.slice(4), status: 'completed' });
  const protectedKey = 'removal/' + id();
  state.set(protectedKey, { status: 'partial' });
  state.set('baseline/sample', { version: 'keep' });
  assert.throws(() => clearActivity(state, [keys[0], protectedKey]), { code: 'activity_pending' });
  assert.equal(state.keys('job/').length, 40);
  assert.equal(clearActivity(state, [keys.shift()]), 1);
  const newer = 'job/' + id();
  state.set(newer, { status: 'running' });
  assert.equal(clearActivity(state, keys), 39);
  assert.deepEqual(state.keys('job/'), [newer]);
  assert.equal(state.get('baseline/sample').version, 'keep');
  assert.equal(state.get(protectedKey).status, 'partial');
});
