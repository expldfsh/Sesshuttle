import { useApp } from './App';
import { useI18n } from './i18n/I18n';
import { call } from './hooks/useApi';
import { progress, useProgress } from './store/progress';
import { TaskFeedback } from './TaskFeedback';
import { RemovalResult } from './RemovalFlow';

// The running or last finished task. Progress events re-render only this panel.
export function TaskPanel() {
  const app = useApp();
  const { t, size } = useI18n();
  const { job, removalJob } = useProgress();
  if (removalJob)
    return (
      <div className="persistent-task removal-task">
        <RemovalResult
          job={removalJob}
          busy={app.busy}
          t={t}
          onRetry={app.reviewRemaining}
          onBackups={() => app.setPage('backups')}
          onDismiss={() => progress.setRemovalJob(null)}
        />
      </div>
    );
  if (!job) return null;
  return (
    <div className="persistent-task">
      <TaskFeedback
        job={job}
        t={t}
        size={size}
        onDismiss={() => progress.setJob(null)}
        onActivity={() => app.setPage('activity')}
        onRepair={app.fix}
        onOpen={(id: string, e: string) => app.work(() => app.openNative(id, e), 'openingNative')}
      />
      {job.status === 'running' && (
        <button
          className="text-button"
          onClick={() => call('cancel').then(() => app.notify({ text: t('closePending') }))}
        >
          {t('pause')}
        </button>
      )}
    </div>
  );
}
