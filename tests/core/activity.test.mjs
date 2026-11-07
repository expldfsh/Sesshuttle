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

test('activity pages merge transfers and removals newest first and continue from a cursor', async (t) => {
  const { activityPage, activitySummary, clearableActivity } =
    await import('../../core/activity.mjs');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sesshuttle-activity-'));
  const state = new State(root);
  t.after(async () => {
    state.close();
    await fs.rm(root, { recursive: true, force: true });
  });
  const at = (n) => new Date(Date.UTC(2026, 10, 1, 0, n)).toISOString();
  for (let n = 0; n < 7; n++) {
    const job = {
      id: id(),
      startedAt: at(n * 2),
      status: n === 3 ? 'attention' : 'completed',
      items: [],
    };
    state.set('job/' + job.id, job);
  }
  const removals = [0, 1, 2].map((n) => ({
    id: id(),
    at: at(n * 4 + 1),
    status: n ? 'completed' : 'partial',
  }));
  const seen = [];
  let page = activityPage(state, removals, { limit: 4 });
  for (;;) {
    seen.push(...page.jobs.map((j) => j.startedAt), ...page.removalJobs.map((j) => j.at));
    if (!page.next) break;
    page = activityPage(state, removals, { limit: 4, before: page.next });
  }
  assert.equal(seen.length, 10);
  assert.deepEqual([...seen].sort().reverse(), [...new Set(seen)].sort().reverse());
  const first = activityPage(state, removals, { limit: 4 });
  const times = [
    ...first.jobs.map((j) => j.startedAt),
    ...first.removalJobs.map((j) => j.at),
  ].sort();
  assert.deepEqual(times, [at(8), at(9), at(10), at(12)]);
  assert.throws(() => activityPage(state, removals, { limit: 0 }), { code: 'invalid_selection' });
  assert.throws(() => activityPage(state, removals, { before: 'x' }), {
    code: 'invalid_selection',
  });
  const summary = activitySummary(state, removals);
  assert.equal(summary.attention, 2);
  assert.equal(summary.pendingRemovals.length, 1);
  assert.equal(clearableActivity(state, removals).length, 9);
});
