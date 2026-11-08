import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { State } from '../../core/state.mjs';
import { clearActivity, clearableActivity, removalClearance } from '../../core/activity.mjs';
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
  const protectedKey = 'removal/' + id(),
    token = id();
  state.set('trash/' + token, { id: token, status: 'needs_recovery' });
  state.set(protectedKey, {
    status: 'partial',
    sides: [{ side: 'local', token, status: 'failed', started: true }],
  });
  state.set('baseline/sample', { version: 'keep' });
  assert.throws(() => clearActivity(state, [keys[0], protectedKey]), {
    code: 'removal_local_unfinished',
  });
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
  const token = id();
  state.set('trash/' + token, { id: token, status: 'needs_recovery' });
  const removals = [0, 1, 2].map((n) => ({
    id: id(),
    at: at(n * 4 + 1),
    status: n ? 'completed' : 'partial',
    sides: n ? [] : [{ side: 'local', token, status: 'failed', started: true }],
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

// §10.1: which removal records may be cleared.
function clearanceFixture(t) {
  const root = fs.mkdtemp(path.join(os.tmpdir(), 'sesshuttle-clearance-'));
  const ready = root.then((dir) => {
    const state = new State(dir);
    t.after(async () => {
      state.close();
      await fs.rm(dir, { recursive: true, force: true });
    });
    return state;
  });
  return ready;
}
const SPACE = 'space-a';
const localSide = (over = {}) => ({
  side: 'local',
  home: '/h',
  token: id(),
  status: 'failed',
  count: 1,
  ...over,
});
const cloudSide = (over = {}) => ({ side: 'cloud', status: 'failed', count: 1, ...over });
const record = (sides, over = {}) => ({
  id: id(),
  at: '2026-11-03T00:00:00.000Z',
  scope: 'both',
  mode: 'trash',
  kind: 'live',
  space: SPACE,
  titles: ['A'],
  status: 'attention',
  sides,
  ...over,
});
const connected = { space: SPACE };

test('a removal that changed nothing or has nothing left to finish can be cleared', async (t) => {
  const state = await clearanceFixture(t);
  const trash = (status) => {
    const token = id();
    state.set('trash/' + token, { id: token, status });
    return token;
  };
  const clearable = (job, context, started) =>
    assert.deepEqual(removalClearance(job, state, context), { clearable: true, started });

  clearable(record([], { status: 'completed' }), {}, false);
  clearable(record([localSide({ started: true })], { status: 'completed' }), {}, true);
  clearable(
    record([localSide({ token: trash('needs_recovery') })], { status: 'replaced' }),
    {},
    false,
  );
  // Neither side started: the checks stopped before any change, even offline.
  clearable(record([localSide(), cloudSide()]), {}, false);
  clearable(record([localSide({ status: 'waiting' })], { status: 'interrupted' }), {}, false);
  clearable(record([localSide({ token: trash('removed') })], { mode: 'purge' }), {}, false);
  // Started, nothing left on this computer.
  clearable(record([localSide({ started: true })]), {}, true);
  clearable(
    record([localSide({ started: true, token: trash('restored') })], { mode: 'purge' }),
    {},
    true,
  );
  clearable(record([localSide({ started: true, token: trash('removed') })]), {}, true);
  clearable(
    record([localSide({ started: true, token: trash('removed') })], {
      kind: 'bin',
      mode: 'restore',
    }),
    {},
    true,
  );
  // A finished cloud side needs no cloud read.
  clearable(
    record([cloudSide({ started: true, status: 'done' })], { status: 'partial' }),
    {},
    true,
  );
  // The cloud marker has no transaction of this record, or one of another record.
  clearable(record([cloudSide({ started: true })]), { ...connected, marker: {} }, true);
  clearable(
    record([cloudSide({ started: true })]),
    { ...connected, marker: { pending: { id: id() } } },
    true,
  );
});

test('a record from an early release is judged by what it does record', async (t) => {
  const state = await clearanceFixture(t);
  // No `started` on any side, no plan, no space.
  assert.equal(
    removalClearance({ id: id(), status: 'attention', sides: [{ side: 'local' }] }, state)
      .clearable,
    true,
  );
  assert.equal(removalClearance({ id: id(), status: 'attention' }, state).clearable, true);
  // A side that says it ran counts as started without the flag.
  const token = id();
  state.set('trash/' + token, { id: token, status: 'needs_recovery' });
  assert.deepEqual(
    removalClearance(
      { id: id(), status: 'partial', sides: [{ side: 'local', token, status: 'done' }] },
      state,
    ),
    { clearable: false, reason: 'removal_local_unfinished' },
  );
  assert.deepEqual(
    removalClearance(
      { id: id(), status: 'partial', sides: [{ side: 'cloud', status: 'cleanup' }] },
      state,
    ),
    { clearable: false, reason: 'removal_cloud_unconfirmed' },
  );
});

test('a removal with work left to finish cannot be cleared', async (t) => {
  const state = await clearanceFixture(t);
  const blocked = (job, context, reason) =>
    assert.deepEqual(removalClearance(job, state, context), { clearable: false, reason });
  for (const status of [
    'staging',
    'prepared',
    'removing',
    'restoring',
    'needs_recovery',
    'purging',
    'unknown',
  ]) {
    const token = id();
    state.set('trash/' + token, { id: token, status });
    blocked(record([localSide({ started: true, token })]), {}, 'removal_local_unfinished');
  }
  // In a permanent deletion, a copy still in the recycle bin is not finished.
  for (const kind of ['live', 'bin']) {
    const token = id();
    state.set('trash/' + token, { id: token, status: 'removed' });
    blocked(
      record([localSide({ started: true, token })], { mode: 'purge', kind }),
      {},
      'removal_local_unfinished',
    );
  }
  const job = record([cloudSide({ started: true })]);
  blocked(job, { ...connected, marker: { pending: { id: job.id } } }, 'removal_cloud_pending');
  blocked(job, {}, 'removal_cloud_unconfirmed');
  blocked(job, { space: 'space-b', marker: {} }, 'removal_cloud_unconfirmed');
  blocked(job, { ...connected, marker: null }, 'removal_cloud_unconfirmed');
  blocked(
    record([cloudSide({ started: true })], { space: undefined }),
    connected,
    'removal_cloud_unconfirmed',
  );
  blocked(job, { ...connected, activeId: job.id, marker: {} }, 'removal_running');
  const running = record([localSide()], { status: 'running' });
  blocked(running, { activeId: running.id }, 'removal_running');
});

test('the cloud is only read once the user asks, and a list marks what still needs it', async (t) => {
  const state = await clearanceFixture(t);
  const job = record([cloudSide({ started: true })]);
  // No marker yet, connected to the same space: offered, to be confirmed on the click.
  assert.deepEqual(removalClearance(job, state, connected), {
    clearable: true,
    started: true,
    confirm: true,
  });
});

test('clearing follows the same rules and removes the record with its plan', async (t) => {
  const state = await clearanceFixture(t);
  const save = (job) => {
    state.set('removal/' + job.id, job);
    state.set('removal-plan/' + job.id, { token: job.id });
    return 'removal/' + job.id;
  };
  const token = id();
  state.set('trash/' + token, { id: token, status: 'needs_recovery' });
  const unstarted = record([localSide()]);
  const replaced = record([localSide()], { status: 'replaced' });
  const stuck = record([localSide({ started: true, token })], { status: 'partial' });
  const pending = record([cloudSide({ started: true })]);
  const keys = [unstarted, replaced, stuck, pending].map(save);
  const marker = { pending: { id: pending.id } };

  assert.throws(() => clearActivity(state, [keys[0], keys[2]], { ...connected, marker }), {
    code: 'removal_local_unfinished',
  });
  assert.ok(state.get(keys[0]), 'a rejected selection clears nothing');
  assert.throws(() => clearActivity(state, [keys[3]], { ...connected, marker }), {
    code: 'removal_cloud_pending',
  });
  const jobs = [unstarted, replaced, stuck, pending];
  assert.deepEqual(clearableActivity(state, jobs, { ...connected, marker }), keys.slice(0, 2));
  assert.equal(clearActivity(state, keys.slice(0, 2), { ...connected, marker }), 2);
  assert.equal(state.get(keys[0]), null);
  assert.equal(state.get('removal-plan/' + unstarted.id), null);
  assert.equal(state.get('removal-plan/' + replaced.id), null);
  assert.ok(state.get('removal-plan/' + stuck.id), 'the plan of a kept record stays');
});
