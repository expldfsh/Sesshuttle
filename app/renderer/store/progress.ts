import { useSyncExternalStore } from 'react';

// Transfer and removal progress arrives every 150 ms. It lives outside React state
// so that only the components showing it re-render, never the conversation table.
export type Progress = { job: any; removalJob: any };

let snapshot: Progress = { job: null, removalJob: null };
const listeners = new Set<() => void>();

function publish(next: Progress) {
  snapshot = next;
  for (const listener of listeners) listener();
}

export const progress = {
  get: () => snapshot,
  setJob: (job: any) => publish({ ...snapshot, job }),
  setRemovalJob: (removalJob: any) => publish({ ...snapshot, removalJob }),
  // Main-process events: a removal update replaces the transfer view and vice versa.
  receive(event: any) {
    if (event?.kind === 'removal-progress') publish({ ...snapshot, removalJob: { ...event.job } });
    else publish({ removalJob: null, job: { ...event } });
  },
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

export const useProgress = () => useSyncExternalStore(progress.subscribe, progress.get);
