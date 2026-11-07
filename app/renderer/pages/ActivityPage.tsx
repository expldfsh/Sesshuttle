import { useState } from 'react';
import { useApp } from '../App';
import { useI18n } from '../i18n/I18n';
import { call } from '../hooks/useApi';
import { progress, useProgress } from '../store/progress';
import { StatusBadge } from '../components/StatusBadge';
import { RemovalResult } from '../RemovalFlow';

export function ActivityPage() {
  const app = useApp();
  const { t, date } = useI18n();
  const { busy, work, jobs, removalJobs } = app;
  const { job, removalJob } = useProgress();
  const [logKeys, setLogKeys] = useState<string[]>([]);
  const clearable = [
    ...jobs.filter((j) => j.status !== 'running').map((j) => 'job/' + j.id),
    ...removalJobs.filter((j) => j.status === 'completed').map((j) => 'removal/' + j.id),
  ];
  const logCheck = (key: string) => (
    <input
      type="checkbox"
      disabled={busy || !clearable.includes(key)}
      aria-label={t('selectLog')}
      checked={logKeys.includes(key)}
      onChange={(e) =>
        setLogKeys(e.target.checked ? [...logKeys, key] : logKeys.filter((k) => k !== key))
      }
    />
  );
  async function clearLogs(all: boolean) {
    const keys = all ? clearable : clearable.filter((k) => logKeys.includes(k));
    if (!keys.length || !(await app.ask(t('clearLogConfirm') + ' (' + keys.length + ')'))) return;
    const count = await call('clearActivity', { keys });
    if (keys.includes('job/' + job?.id)) progress.setJob(null);
    if (keys.includes('removal/' + removalJob?.id)) progress.setRemovalJob(null);
    setLogKeys([]);
    await app.reloadInit();
    app.notify({ text: t('clearedLogs') + ' ' + count });
  }
  const transfers = [job, ...jobs.filter((j) => j.id !== job?.id)].filter(Boolean);
  return (
    <>
      <section className="card">
        <p>{t('clearLogHint')}</p>
        <div className="actions">
          <button
            disabled={busy || !clearable.some((k) => logKeys.includes(k))}
            onClick={() => work(() => clearLogs(false))}
          >
            {t('clearSelectedLogs')} ({clearable.filter((k) => logKeys.includes(k)).length})
          </button>
          <button disabled={busy || !clearable.length} onClick={() => work(() => clearLogs(true))}>
            {t('clearAllLogs')}
          </button>
        </div>
      </section>
      {removalJobs.length > 0 && (
        <section className="card">
          <h2>{t('removalActivity')}</h2>
          {removalJobs.map((j: any) => (
            <div key={j.id}>
              {logCheck('removal/' + j.id)}
              <RemovalResult
                job={j}
                t={t}
                busy={busy}
                onRetry={app.reviewRemaining}
                onBackups={() => app.setPage('backups')}
              />
            </div>
          ))}
        </section>
      )}
      <section className="card">
        {transfers.map((j: any) => (
          <div className="job-card" key={j.id}>
            <div className="card-title">
              <h3>
                {logCheck('job/' + j.id)} {date(j.startedAt)}
              </h3>
              <StatusBadge status={j.status} />
            </div>
            {j.items.map((x: any, i: number) => (
              <div className="job-item" key={i}>
                <strong>{x.title}</strong>
                <StatusBadge status={x.status} />
                {x.cloudStatus && (
                  <small>
                    {t('cloud')}: {t(x.cloudStatus)}
                  </small>
                )}
                {x.historyReady && <small>{t('historyReceived')}</small>}
                {x.error && (
                  <p className="error-text">
                    {t(x.error.code)} {x.error.detail}
                  </p>
                )}
                {!Object.keys(x.targets ?? {}).length &&
                  [
                    'failed',
                    'excluded',
                    'busy',
                    'blocked',
                    'conflict',
                    'conflict_preserved',
                  ].includes(x.status) && (
                    <button disabled={busy} onClick={() => app.fix(x)}>
                      {t('fixAndRetry')}
                    </button>
                  )}
                <div className="target-results">
                  {Object.entries(x.targets ?? {}).map(([entry, r]: any) => (
                    <span key={entry}>
                      {t(entry)}:{' '}
                      {t(
                        r.status === 'verified' && r.omittedAttachments?.length
                          ? 'imported_missing_attachments'
                          : r.status,
                      )}
                      {r.error && <small>{t(r.error.code)}</small>}
                      {r.nativeProjectName && (
                        <small>
                          {t('projectLabelVerified')} · {r.nativeProjectName}
                        </small>
                      )}
                      {['failed', 'not_configured', 'imported'].includes(r.status) && (
                        <button disabled={busy} onClick={() => app.fix(x, entry)}>
                          {t('retryEntry')}
                        </button>
                      )}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ))}
        {!transfers.length && !removalJobs.length && (
          <div className="empty">
            <p>{t('noJobs')}</p>
          </div>
        )}
      </section>
    </>
  );
}
