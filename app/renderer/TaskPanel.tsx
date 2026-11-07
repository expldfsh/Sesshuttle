import { useEffect, useRef } from 'react';
import { useApp } from './App';
import { useI18n } from './i18n/I18n';
import { call } from './hooks/useApi';
import { progress, useProgress } from './store/progress';
import { TaskFeedback } from './TaskFeedback';
import { RemovalResult } from './RemovalFlow';
import { Icon } from './components/Icon';

// Fraction of a running transfer: finished items plus the current item's bytes.
export function taskFraction(job: any) {
  const p = job?.progress;
  if (!p?.total) return null;
  const within = p.bytesTotal > 0 ? Math.min(1, p.bytes / p.bytesTotal) : 0;
  return Math.min(1, (p.index - 1 + within) / p.total);
}

// The top bar shows the running or last task; the panel opens from here.
export function TaskIndicator() {
  const { t } = useI18n();
  const { job, removalJob, open } = useProgress();
  if (!job && !removalJob) return null;
  const removal = !!removalJob;
  const running = removal
    ? ['checking', 'running'].includes(removalJob.status)
    : job.status === 'running';
  const fraction = removal ? null : taskFraction(job);
  const label = running
    ? t(removal ? 'removingNow' : (job.progress?.stage ?? 'stageCheck'))
    : t(removal ? 'removalTask' : 'transferTask');
  return (
    <button
      type="button"
      className={'task-indicator' + (running ? ' running' : '')}
      aria-expanded={open}
      aria-controls="task-panel"
      onClick={() => progress.setOpen(!open)}
    >
      <Icon name={running ? 'refresh' : 'activity'} className={running ? 'spin' : ''} />
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
  const { job, removalJob, open } = useProgress();
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
  if (!open || (!job && !removalJob)) return null;
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
      {removalJob ? (
        <RemovalResult
          job={removalJob}
          busy={app.busy}
          t={t}
          onRetry={app.reviewRemaining}
          onBackups={() => app.setPage('backups')}
          onDismiss={() => progress.setRemovalJob(null)}
        />
      ) : (
        <>
          <TaskFeedback
            job={job}
            t={t}
            size={size}
            onDismiss={() => progress.setJob(null)}
            onActivity={() => app.setPage('activity')}
            onRepair={app.fix}
            onOpen={(id: string, e: string) =>
              app.work(() => app.openNative(id, e), 'openingNative', 'task')
            }
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
      )}
    </section>
  );
}
