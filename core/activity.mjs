import { requireThat } from './util.mjs';

export function clearActivity(state, keys) {
  requireThat(
    Array.isArray(keys) &&
      keys.length &&
      keys.every((k) => typeof k === 'string' && /^(job|removal)\/[0-9a-f-]{36}$/.test(k)),
    'invalid_selection',
  );
  state.db.exec('BEGIN IMMEDIATE');
  try {
    for (const k of new Set(keys)) {
      const j = state.get(k);
      requireThat(j, 'stale_plan');
      requireThat(
        k.startsWith('removal/') ? j.status === 'completed' : j.status !== 'running',
        'activity_pending',
      );
      state.remove(k);
      if (k.startsWith('removal/')) state.remove('removal-plan/' + j.id);
    }
    state.db.exec('COMMIT');
  } catch (e) {
    state.db.exec('ROLLBACK');
    throw e;
  }
  return new Set(keys).size;
}

const cursor = (x) => x && typeof x.at === 'string' && typeof x.id === 'string';
const removalNeedsAttention = (job) => ['interrupted', 'partial', 'attention'].includes(job.status);
const transferNeedsAttention = (job) =>
  ['attention', 'interrupted', 'paused', 'failed'].includes(job.status);

// Transfer and removal tasks as one timeline, newest first. `before` is the
// { at, id } cursor of the last item already shown; `next` continues after it.
export function activityPage(state, removalJobs, { before = null, limit = 50 } = {}) {
  requireThat(Number.isInteger(limit) && limit >= 1 && limit <= 200, 'invalid_selection');
  requireThat(before === null || cursor(before), 'invalid_selection');
  const items = [
    ...state
      .keys('job/')
      .map((k) => state.get(k))
      .filter(Boolean)
      .map((job) => ({ at: job.startedAt, id: job.id, kind: 'job', job })),
    ...removalJobs.map((job) => ({ at: job.at, id: job.id, kind: 'removal', job })),
  ].sort((a, b) => b.at.localeCompare(a.at) || b.id.localeCompare(a.id));
  const older = before
    ? items.filter((x) => x.at < before.at || (x.at === before.at && x.id < before.id))
    : items;
  const page = older.slice(0, limit),
    last = page.at(-1);
  return {
    jobs: page.filter((x) => x.kind === 'job').map((x) => x.job),
    removalJobs: page.filter((x) => x.kind === 'removal').map((x) => x.job),
    next: older.length > limit ? { at: last.at, id: last.id } : null,
  };
}

// Counts over every saved task, not just a loaded page.
export function activitySummary(state, removalJobs) {
  const jobs = state
    .keys('job/')
    .map((k) => state.get(k))
    .filter(Boolean);
  return {
    attention:
      jobs.filter(transferNeedsAttention).length + removalJobs.filter(removalNeedsAttention).length,
    pendingRemovals: removalJobs.filter(removalNeedsAttention),
  };
}

// Every record that clearActivity() accepts: finished transfers and completed removals.
export function clearableActivity(state, removalJobs) {
  return [
    ...state.keys('job/').filter((k) => state.get(k) && state.get(k).status !== 'running'),
    ...removalJobs.filter((j) => j.status === 'completed').map((j) => 'removal/' + j.id),
  ];
}
