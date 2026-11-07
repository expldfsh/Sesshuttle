import { useSyncExternalStore } from 'react';

// Transfer and removal progress arrives every 150 ms. It lives outside React state
// so that only the task indicator and panel re-render, never the conversation table.
export type Progress = { job: any; removalJob: any; open: boolean };

let snapshot: Progress = { job: null, removalJob: null, open: false };
const listeners = new Set<() => void>();

function publish(next: Partial<Progress>) {
  snapshot = { ...snapshot, ...next };
  for (const listener of listeners) listener();
}

export const progress = {
  get: () => snapshot,
  // A task the user just started opens the panel; dismissing it clears the task.
  setJob: (job: any, open = snapshot.open) =>
    publish({ job, open: job ? open : snapshot.removalJob ? snapshot.open : false }),
  setRemovalJob: (removalJob: any, open = snapshot.open) =>
    publish({ removalJob, open: removalJob ? open : snapshot.job ? snapshot.open : false }),
  setOpen: (open: boolean) => publish({ open }),
  // Main-process events: a removal update replaces the transfer view and vice versa.
  receive(event: any) {
    if (event?.kind === 'removal-progress') publish({ removalJob: { ...event.job } });
    else publish({ removalJob: null, job: { ...event } });
  },
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

export const useProgress = () => useSyncExternalStore(progress.subscribe, progress.get);
