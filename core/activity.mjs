import { requireThat } from './util.mjs';

// A side counts as started when it says so, or when its status can only follow a
// start: records from early releases may not carry the flag.
const sideStarted = (side) =>
  side.started === true ||
  side.erasing === true ||
  ['running', 'done', 'cleanup', 'localCleanup'].includes(side.status);
// Nothing left to finish on this computer: the recycle copy is gone or settled. A
// permanent deletion is only finished once the copy has been erased.
function localSettled(side, job, state) {
  const copy = side.token ? state.get('trash/' + side.token) : null;
  if (!copy || copy.status === 'restored') return true;
  return copy.status === 'removed' && ['trash', 'restore'].includes(job.mode);
}
const blocked = (reason) => ({ clearable: false, reason });

// Whether a removal record may be cleared or given up, and otherwise why not.
// `started` says whether it may have changed anything. Only a user's click reads the
// cloud: `marker` is the space marker it read, null when that failed and absent while
// a list is shown, where `confirm` marks a record that still depends on the reading.
export function removalClearance(job, state, { activeId = null, space = null, marker } = {}) {
  if (activeId && job.id === activeId) return blocked('removal_running');
  const sides = job.sides ?? [],
    started = sides.some(sideStarted);
  if (['completed', 'replaced'].includes(job.status) || !started)
    return { clearable: true, started };
  if (sides.some((s) => s.side === 'local' && sideStarted(s) && !localSettled(s, job, state)))
    return blocked('removal_local_unfinished');
  // A finished cloud side has no transaction left, so it needs no reading.
  if (!sides.some((s) => s.side === 'cloud' && sideStarted(s) && s.status !== 'done'))
    return { clearable: true, started };
  if (!job.space || job.space !== space || marker === null)
    return blocked('removal_cloud_unconfirmed');
  if (marker === undefined) return { clearable: true, started, confirm: true };
  return marker.pending?.id === job.id
    ? blocked('removal_cloud_pending')
    : { clearable: true, started };
}
// The removal record and the plan it could continue from.
export function removeRemovalRecord(state, id) {
  state.remove('removal/' + id);
  state.remove('removal-plan/' + id);
}

// `context` is what removalClearance needs; the cloud marker is read before this call
// because the transaction below cannot wait for it.
export function clearActivity(state, keys, context = {}) {
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
      if (k.startsWith('removal/')) {
        const verdict = removalClearance(j, state, context);
        requireThat(verdict.clearable && !verdict.confirm, verdict.reason ?? 'activity_pending');
        removeRemovalRecord(state, k.slice('removal/'.length));
      } else {
        requireThat(j.status !== 'running', 'activity_pending');
        state.remove(k);
      }
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

// Every record that clearActivity() accepts with the same context.
export function clearableActivity(state, removalJobs, context = {}) {
  return [
    ...state.keys('job/').filter((k) => state.get(k) && state.get(k).status !== 'running'),
    ...removalJobs
      .filter((job) => {
        const verdict = removalClearance(job, state, context);
        return verdict.clearable && !verdict.confirm;
      })
      .map((job) => 'removal/' + job.id),
  ];
}
