import type { Failure } from './store/progress';

// The top bar and task panel name a task that could not run by what it was for.
export function failureLabel(f: Failure) {
  if (f.error.code === 'removal_targets_missing') return 'removalTargetsShort';
  if (f.kind === 'transfer')
    return f.started
      ? 'transferStopped'
      : f.direction === 'upload'
        ? 'uploadNotStarted'
        : f.direction === 'download'
          ? 'importNotStarted'
          : 'syncNotStarted';
  if (f.kind === 'removal')
    return f.started
      ? 'removalStopped'
      : f.direction === 'restore'
        ? 'restoreNotStarted'
        : 'removalNotStarted';
  return f.kind === 'native' ? 'appNotOpenedShort' : 'checkNotFinished';
}

// What was and was not done. "Nothing" is only said when the main process rejected
// the task before it wrote anything; an error after the start says so instead.
export function failureNote(f: Failure) {
  if (f.kind === 'transfer') return f.started ? 'transferMaybeStarted' : 'nothingTransferred';
  if (f.kind === 'removal') return f.started ? 'removalMaybeStarted' : 'nothingRemoved';
  return f.kind === 'native' ? 'appNotOpened' : 'nothingChanged';
}

// A removal that stopped before either side started: nothing was deleted or restored.
export const removalNotStarted = (job: any) =>
  !!job?.error &&
  !['checking', 'running'].includes(job.status) &&
  (job.sides ?? []).every((s: any) => !s.started);
