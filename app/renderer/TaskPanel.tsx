import { useEffect, useRef } from 'react';
import { useApp } from './App';
import { useI18n } from './i18n/I18n';
import { call } from './hooks/useApi';
import { progress, useProgress, type Failure } from './store/progress';
import { TaskFeedback } from './TaskFeedback';
import { RemovalResult } from './RemovalFlow';
import { Icon } from './components/Icon';
import { ErrorNotice } from './components/ErrorNotice';
import { errorRule } from './errors';
import { failureLabel, failureNote, removalNotStarted } from './failures';

// A transfer or removal that could not start is shown first; failures of an action
// on a task (opening an app, checking a target) follow the task they belong to.
const leading = (f: Failure) => f.kind === 'transfer' || f.kind === 'removal';

// Fraction of a running transfer: finished items plus the current item's bytes.
export function taskFraction(job: any) {
  const p = job?.progress;
  if (!p?.total) return null;
  const within = p.bytesTotal > 0 ? Math.min(1, p.bytes / p.bytesTotal) : 0;
  return Math.min(1, (p.index - 1 + within) / p.total);
}

// The top bar shows the running task, a task that could not run, or the last task;
// the panel opens from here.
export function TaskIndicator() {
  const { t } = useI18n();
  const { job, removalJob, open, failures } = useProgress();
  if (!job && !removalJob && !failures.length) return null;
  const removal = !!removalJob;
  const running = removal
    ? ['checking', 'running'].includes(removalJob.status)
    : job?.status === 'running';
  const failure = !running && (failures.find(leading) ?? failures[0]);
  const stopped = !running && removal && removalNotStarted(removalJob);
  const failed = !!failure || stopped;
  const fraction = removal || !job ? null : taskFraction(job);
  const label = running
    ? t(removal ? 'removingNow' : (job.progress?.stage ?? 'stageCheck'))
    : failure
      ? t(failureLabel(failure))
      : stopped
        ? t(removalJob.mode === 'restore' ? 'restoreNotStarted' : 'removalNotStarted')
        : t(removal ? 'removalTask' : 'transferTask');
  return (
    <button
      type="button"
      className={'task-indicator' + (running ? ' running' : failed ? ' failed' : '')}
      aria-expanded={open}
      aria-controls="task-panel"
      onClick={() => progress.setOpen(!open)}
    >
      <Icon
        name={running ? 'refresh' : failed ? 'alert' : 'activity'}
        className={running ? 'spin' : ''}
      />
      <span className="task-indicator-label">
        {label}
        {running && !removal && job.progress && (
          <small>
            {job.progress.index}/{job.progress.total}
          </small>
        )}
      </span>
      {running && (
        <span className="mini-progress" aria-hidden="true">
          <span
            style={{ width: fraction === null ? undefined : `${fraction * 100}%` }}
            className={fraction === null ? 'indeterminate' : ''}
          />
        </span>
      )}
    </button>
  );
}

export function TaskPanel() {
  const app = useApp();
  const { t, size } = useI18n();
  const { job, removalJob, open, failures } = useProgress();
  const panel = useRef<HTMLElement>(null);
  // A popover: it closes on a click elsewhere, on Esc and when the page changes.
  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => {
      const target = e.target as Element;
      if (!panel.current?.contains(target) && !target.closest?.('.task-indicator, dialog'))
        progress.setOpen(false);
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.querySelector('dialog[open]')) progress.setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);
  useEffect(() => {
    progress.setOpen(false);
  }, [app.page]);
  if (!open || (!job && !removalJob && !failures.length)) return null;
  return (
    <section id="task-panel" className="task-panel" ref={panel} aria-label={t('taskResult')}>
      <button
        type="button"
        className="icon-button task-collapse"
        aria-label={t('collapseDetails')}
        onClick={() => progress.setOpen(false)}
      >
        <Icon name="chevron" />
      </button>
      {failures.filter(leading).map((f) => (
        <TaskFailure key={f.id} failure={f} />
      ))}
      {removalJob ? (
        <RemovalResult
          job={removalJob}
          busy={app.busy}
          t={t}
          onRetry={app.reviewRemaining}
          onReview={app.reviseRemoval}
          onBackups={() => app.setPage('backups')}
          onDiscard={(id: string) => app.discardRemovalTask(id)}
          onDismiss={() => progress.setRemovalJob(null)}
        />
      ) : (
        job && (
          <>
            <TaskFeedback
              job={job}
              t={t}
              size={size}
              onDismiss={() => progress.setJob(null)}
              onActivity={() => app.setPage('activity')}
              onRepair={app.fix}
              onOpen={app.openNativeTask}
            />
            {job.status === 'running' && (
              <button
                className="text-button"
                onClick={() => call('cancel').then(() => app.notify({ text: t('closePending') }))}
              >
                {t('pause')}
              </button>
            )}
          </>
        )
      )}
      {failures
        .filter((f) => !leading(f))
        .map((f) => (
          <TaskFailure key={f.id} failure={f} />
        ))}
    </section>
  );
}

// A task that could not run: what happened, whether anything was changed, and the
// way to continue. It stays until closed, recovered or replaced by a new task.
function TaskFailure({ failure }: { failure: Failure }) {
  const app = useApp();
  const { t } = useI18n();
  const actions = app.failureActions(failure);
  return (
    <section className="task-failure" aria-label={t(failureLabel(failure))}>
      <div className="task-heading">
        <strong>{t(failureLabel(failure))}</strong>
      </div>
      <ErrorNotice
        error={failure.error}
        subject={failure.subject}
        severity={errorRule(failure.error.code).severity}
        note={t(failureNote(failure))}
        action={
          actions.length > 0 &&
          actions.map((a, i) => (
            <button
              key={a.label}
              className={i === 0 ? 'primary' : ''}
              disabled={app.busy}
              onClick={a.run}
            >
              {t(a.label)}
            </button>
          ))
        }
        onDismiss={() => void app.dismissFailure(failure)}
      />
    </section>
  );
}
