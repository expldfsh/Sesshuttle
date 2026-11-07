import { useMemo, useState } from 'react';
import { PlaceError, useApp } from '../App';
import { useI18n } from '../i18n/I18n';
import { call } from '../hooks/useApi';
import { progress, useProgress } from '../store/progress';
import { StatusBadge } from '../components/StatusBadge';
import { EmptyState } from '../components/EmptyState';
import { Icon } from '../components/Icon';
import { RemovalResult } from '../RemovalFlow';

// The same rules as core/activity.mjs, so the filter matches the sidebar count.
const TRANSFER_ATTENTION = ['attention', 'interrupted', 'paused', 'failed'];
const REMOVAL_ATTENTION = ['interrupted', 'partial', 'attention'];
const RETRYABLE = ['failed', 'excluded', 'busy', 'blocked', 'conflict', 'conflict_preserved'];

type Entry = { key: string; at: string; kind: 'job' | 'removal'; job: any };

const entriesOf = (jobs: any[], removals: any[]): Entry[] => [
  ...jobs.map((job) => ({ key: 'job/' + job.id, at: job.startedAt, kind: 'job' as const, job })),
  ...removals.map((job) => ({
    key: 'removal/' + job.id,
    at: job.at,
    kind: 'removal' as const,
    job,
  })),
];
const needsAttention = (e: Entry) =>
  (e.kind === 'job' ? TRANSFER_ATTENTION : REMOVAL_ATTENTION).includes(e.job.status);
const clearableEntry = (e: Entry) =>
  e.kind === 'job' ? e.job.status !== 'running' : e.job.status === 'completed';

export function ActivityPage() {
  const app = useApp();
  const { t, tn } = useI18n();
  const { busy, work, jobs, removalJobs } = app;
  const live = useProgress();
  const [filter, setFilter] = useState<'all' | 'attention'>('all');
  const [chosen, setChosen] = useState<string[]>([]);
  const [older, setOlder] = useState<Entry[]>([]);
  // undefined: continue from the first page that came with the app state.
  const [cursor, setCursor] = useState<any>(undefined);
  const next = cursor === undefined ? app.init?.activityNext : cursor;
  const entries = useMemo(() => {
    const first = entriesOf(jobs, removalJobs);
    const seen = new Set(first.map((e) => e.key));
    const all = [...first, ...older.filter((e) => !seen.has(e.key))];
    // A task in progress shows its live state.
    const current = [
      live.job && { key: 'job/' + live.job.id, kind: 'job', job: live.job },
      live.removalJob && {
        key: 'removal/' + live.removalJob.id,
        kind: 'removal',
        job: live.removalJob,
      },
    ].filter(Boolean) as Entry[];
    for (const c of current) {
      const i = all.findIndex((e) => e.key === c.key);
      if (i >= 0) all[i] = { ...all[i], job: c.job };
      else all.unshift({ ...c, at: c.kind === 'job' ? c.job.startedAt : c.job.at });
    }
    return all.sort((a, b) => b.at.localeCompare(a.at) || b.key.localeCompare(a.key));
  }, [jobs, removalJobs, older, live.job, live.removalJob]);
  const shown = filter === 'attention' ? entries.filter(needsAttention) : entries;
  const clearable = new Set(entries.filter(clearableEntry).map((e) => e.key));
  const picked = chosen.filter((k) => clearable.has(k));
  async function loadMore() {
    const page = await call('activityPage', { before: next });
    setOlder((list) => [...list, ...entriesOf(page.jobs, page.removalJobs)]);
    setCursor(page.next);
  }
  async function clear(all: boolean) {
    const count = all ? null : picked.length;
    const ok = await app.ask({
      title: t(all ? 'clearAllLogs' : 'clearSelectedLogs'),
      message: t(all ? 'clearAllLogsConfirm' : 'clearLogConfirm'),
      detail: count !== null && <p>{tn('countRecords', count)}</p>,
      confirm: all ? t('clearAllLogs') : tn('clearRecordsN', count ?? 0),
      danger: true,
    });
    if (!ok) return;
    const removed = await call('clearActivity', all ? { all: true } : { keys: picked });
    const gone = (key: string) => (all ? clearable.has(key) : picked.includes(key));
    if (live.job && gone('job/' + live.job.id)) progress.setJob(null);
    if (live.removalJob && gone('removal/' + live.removalJob.id)) progress.setRemovalJob(null);
    setChosen([]);
    setOlder([]);
    setCursor(undefined);
    await app.reloadInit();
    app.notify({ text: tn('clearedRecords', removed) });
  }
  const attention = entries.filter(needsAttention).length;
  return (
    <div className="activity">
      <div className="toolbar" role="toolbar" aria-label={t('activity')}>
        <div className="segmented" role="radiogroup" aria-label={t('filters')}>
          {(['all', 'attention'] as const).map((f) => (
            <button
              key={f}
              role="radio"
              aria-checked={filter === f}
              className={filter === f ? 'active' : ''}
              onClick={() => setFilter(f)}
            >
              {t(f === 'all' ? 'activityAll' : 'activityAttention')}
              {f === 'attention' && attention > 0 && <span className="nav-count">{attention}</span>}
            </button>
          ))}
        </div>
        <span className="spacer" />
        <button
          disabled={busy || !picked.length}
          onClick={() => work(() => clear(false), 'working', 'activity')}
        >
          {tn('clearRecordsN', picked.length)}
        </button>
        <button
          className="danger-button"
          disabled={busy || !clearable.size}
          onClick={() => work(() => clear(true), 'working', 'activity')}
        >
          <Icon name="trash" /> {t('clearAllLogs')}
        </button>
      </div>
      <p className="muted">{t('clearLogHint')}</p>
      <PlaceError place="activity" />
      <ol className="timeline">
        {shown.map((e) => (
          <ActivityItem
            key={e.key}
            entry={e}
            checked={chosen.includes(e.key)}
            clearable={clearable.has(e.key)}
            onCheck={(checked) =>
              setChosen((list) => (checked ? [...list, e.key] : list.filter((k) => k !== e.key)))
            }
          />
        ))}
      </ol>
      {!shown.length && (
        <EmptyState
          icon="activity"
          title={t(filter === 'attention' && entries.length ? 'noAttentionRecords' : 'noJobs')}
          action={
            filter === 'attention' && entries.length ? (
              <button onClick={() => setFilter('all')}>{t('activityAll')}</button>
            ) : undefined
          }
        />
      )}
      {next && (
        <div className="load-more">
          <button disabled={busy} onClick={() => work(loadMore, 'loading', 'activity')}>
            {t('loadMore')}
          </button>
        </div>
      )}
      {!next && entries.length > 0 && <p className="muted end-note">{t('activityEnd')}</p>}
    </div>
  );
}

function ActivityItem({
  entry,
  checked,
  clearable,
  onCheck,
}: {
  entry: Entry;
  checked: boolean;
  clearable: boolean;
  onCheck: (checked: boolean) => void;
}) {
  const app = useApp();
  const { t, tn, date } = useI18n();
  const { job } = entry;
  const attention = needsAttention(entry);
  const [open, setOpen] = useState(attention || job.status === 'running');
  const body = 'activity-' + entry.key.replace('/', '-');
  const items = entry.kind === 'job' ? (job.items ?? []) : [];
  return (
    <li className={'timeline-item' + (attention ? ' attention' : '')}>
      <div className="timeline-head">
        <input
          type="checkbox"
          disabled={app.busy || !clearable}
          aria-label={t('selectLog') + ' · ' + date(entry.at)}
          title={clearable ? undefined : t('activity_pending')}
          checked={checked && clearable}
          onChange={(e) => onCheck(e.target.checked)}
        />
        <button
          className="timeline-toggle"
          aria-expanded={open}
          aria-controls={body}
          onClick={() => setOpen(!open)}
        >
          <Icon name="chevron" className={open ? 'sort-down' : 'chevron-right'} />
          <Icon name={entry.kind === 'job' ? 'history' : 'trash'} />
          <span className="timeline-title">
            <strong>{t(entry.kind === 'job' ? 'transferTask' : 'removalTask')}</strong>
            <small>
              {date(entry.at)} ·{' '}
              {entry.kind === 'job'
                ? tn('countConversations', job.total ?? items.length)
                : (job.titles ?? []).join(' · ')}
            </small>
          </span>
        </button>
        <StatusBadge status={job.status} />
      </div>
      {open && (
        <div className="timeline-body" id={body}>
          {entry.kind === 'removal' ? (
            <RemovalResult
              job={job}
              t={t}
              busy={app.busy}
              onRetry={app.reviewRemaining}
              onReview={app.reviseRemoval}
              onBackups={() => app.setPage('backups')}
            />
          ) : (
            <>
              {!items.length && <p className="muted">{t('noItemsYet')}</p>}
              {items.map((x: any, i: number) => (
                <div className="job-item" key={i}>
                  <div className="job-item-head">
                    <strong>{x.title}</strong>
                    <StatusBadge status={x.status} />
                  </div>
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
                  {!Object.keys(x.targets ?? {}).length && RETRYABLE.includes(x.status) && (
                    <button disabled={app.busy} onClick={() => app.fix(x)}>
                      {t('fixAndRetry')}
                    </button>
                  )}
                  <div className="target-results">
                    {Object.entries(x.targets ?? {}).map(([target, r]: any) => (
                      <span key={target}>
                        {t(target)}:{' '}
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
                          <button disabled={app.busy} onClick={() => app.fix(x, target)}>
                            {t('retryEntry')}
                          </button>
                        )}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </li>
  );
}
