import { useSyncExternalStore } from 'react';

// Transfer and removal progress arrives every 150 ms. It lives outside React state
// so that only the task indicator and panel re-render, never the conversation table.
//
// A task that could not run is kept here as a failure until the user closes it,
// uses its recovery, or the next task of the same kind starts. Refreshing or
// changing pages does not clear it. Failures are not saved across restarts.
export type FailureKind = 'transfer' | 'removal' | 'native' | 'inspect' | 'retryRemoval';
export type Failure = {
  id: number;
  kind: FailureKind;
  error: { code: string; detail?: string };
  // Whether anything may have been changed before the error.
  started: boolean;
  // What the recovery opens again: the transfer request, the removal request, the app.
  request?: any;
  // The previewed plan that could not run, discarded when the failure goes away.
  token?: string;
  // The conversation and app it concerns.
  subject?: string;
  // Transfer direction or removal mode, for the label.
  direction?: string;
  at: string;
};
export type Progress = { job: any; removalJob: any; open: boolean; failures: Failure[] };

let snapshot: Progress = { job: null, removalJob: null, open: false, failures: [] };
let sequence = 0;
const listeners = new Set<() => void>();

function publish(next: Partial<Progress>) {
  snapshot = { ...snapshot, ...next };
  for (const listener of listeners) listener();
}
// Whether the panel still has something to show without the task being replaced.
const stays = (other: any) => !!other || snapshot.failures.length > 0;

export const progress = {
  get: () => snapshot,
  // A task the user just started opens the panel; dismissing it clears the task.
  setJob: (job: any, open = snapshot.open) =>
    publish({ job, open: job ? open : stays(snapshot.removalJob) && snapshot.open }),
  setRemovalJob: (removalJob: any, open = snapshot.open) =>
    publish({ removalJob, open: removalJob ? open : stays(snapshot.job) && snapshot.open }),
  setOpen: (open: boolean) => publish({ open }),
  // Records a task that could not run and opens the panel to show it. A newer
  // failure of the same kind replaces the older one.
  fail(failure: Omit<Failure, 'id' | 'at'>) {
    publish({
      failures: [
        ...snapshot.failures.filter((f) => f.kind !== failure.kind),
        { ...failure, id: ++sequence, at: new Date().toISOString() },
      ],
      open: true,
    });
  },
  failure: (kind: FailureKind) => snapshot.failures.find((f) => f.kind === kind),
  clearFailure(kind: FailureKind) {
    if (snapshot.failures.some((f) => f.kind === kind))
      publish({ failures: snapshot.failures.filter((f) => f.kind !== kind) });
  },
  dismissFailure(id: number) {
    const failures = snapshot.failures.filter((f) => f.id !== id);
    publish({
      failures,
      open: (failures.length > 0 || !!snapshot.job || !!snapshot.removalJob) && snapshot.open,
    });
  },
  // Main-process events: a removal update replaces the transfer view and vice versa.
  // An event means that a task of that kind has started.
  receive(event: any) {
    if (event?.kind === 'removal-progress') {
      progress.clearFailure('removal');
      publish({ removalJob: { ...event.job } });
    } else {
      if (event?.status === 'running') progress.clearFailure('transfer');
      publish({ removalJob: null, job: { ...event } });
    }
  },
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

export const useProgress = () => useSyncExternalStore(progress.subscribe, progress.get);
