import { memo, useCallback, useDeferredValue, useMemo, useState } from 'react';
import { useApp } from '../App';
import { useI18n } from '../i18n/I18n';
import { ENTRIES, hasMissingImages, projectKey, projectLabel } from './rows';
import { call } from '../hooks/useApi';
import { Select } from '../Select';
import { StatusBadge } from '../components/StatusBadge';
import { ConversationActions } from '../ConversationActions';
import { ConversationTable } from './ConversationTable';

export function ConversationsPage() {
  const app = useApp();
  const { t, date } = useI18n();
  const { data, init, busy, work, view, updateView } = app;
  const query = useDeferredValue(view.query);
  const projectOptions = useMemo(
    () =>
      Array.from(
        new Map(data.rows.map((r: any) => [projectKey(r), projectLabel(r, t)])).entries(),
      ).map(([value, label]: any) => ({ value, label })),
    [data.rows, t],
  );
  const visible = useMemo(() => {
    const needle = query.toLowerCase();
    return data.rows.filter(
      (r: any) =>
        (view.filter === 'all'
          ? true
          : view.filter === 'cloud'
            ? r.remote
            : view.filter === 'main'
              ? r.kind !== 'background'
              : r.source === view.filter) &&
        (view.status === 'all' || r.status === view.status) &&
        (view.projectFilter === 'all' || projectKey(r) === view.projectFilter) &&
        `${r.title} ${r.project} ${projectLabel(r, t)}`.toLowerCase().includes(needle),
    );
  }, [data.rows, view.filter, view.status, view.projectFilter, query, t]);
  const stats = useMemo(() => {
    const count = (fn: (r: any) => boolean) => data.rows.filter(fn).length;
    return {
      main: count((r: any) => r.kind !== 'background'),
      background: count((r: any) => r.kind === 'background'),
      local: count((r: any) => ['local_only', 'local_changes'].includes(r.status)),
      remote: count((r: any) => ['remote_only', 'remote_changes'].includes(r.status)),
    };
  }, [data.rows]);
  const visibleIds = useMemo(() => new Set(visible.map((r: any) => r.id)), [visible]);
  const chosenRows = useMemo(
    () => data.rows.filter((r: any) => view.selected.has(r.id)),
    [data.rows, view.selected],
  );
  const hiddenCount = chosenRows.filter((r: any) => !visibleIds.has(r.id)).length;
  const row = visible.find((r: any) => r.id === view.focus);
  const [version, setVersion] = useState('');

  const focusRow = useCallback(
    (id: string) => {
      updateView({ focus: id });
      setVersion('');
      if (window.innerWidth <= 1150)
        requestAnimationFrame(() =>
          document.querySelector('.detail-head')?.scrollIntoView({ block: 'start' }),
        );
    },
    [updateView],
  );
  const selectAll = (checked: boolean) => {
    const next = new Set(view.selected);
    for (const r of visible) {
      if (checked) next.add(r.id);
      else next.delete(r.id);
    }
    updateView({ selected: next });
  };
  const actions = (items: any[]) => (
    <ConversationActions
      items={items}
      t={t}
      busy={busy}
      open={(dir: string) =>
        app.startFlow(
          dir,
          items.map((r) => r.id),
        )
      }
      resume={(id: string, e: string) => work(() => app.openNative(id, e), 'openingNative')}
      versions={() => app.showVersions(items[0].id)}
      remove={() => {
        app.notify(null);
        app.setRemoval({
          ids: items.map((r) => r.id),
          titles: items.map((r) => r.title),
          hasLocal: items.some((r) => r.local),
          hasCloud: items.some((r) => r.remote),
        });
      }}
    />
  );
  async function downloadVersion(logical: string, chosen: string) {
    if (!(await app.ask(t('saveCloudCopyHint')))) return;
    const location = await call('downloadCopy', { logical, version: chosen });
    if (location) app.notify({ text: t('savedCopyAt'), detail: location });
  }
  const filtered = view.query || view.status !== 'all' || view.projectFilter !== 'all';

  return (
    <>
      {app.needsRefresh && (
        <div className="notice">
          <span>{t('manualRefreshHint')}</span>
          <button disabled={busy} onClick={() => work(app.refresh, 'refreshing')}>
            {t('refresh')}
          </button>
        </div>
      )}
      {!init?.connected && (
        <div className="connect-banner">
          <span>{t('connectHint')}</span>
          <button onClick={() => app.setPage('settings')}>{t('configure')}</button>
        </div>
      )}
      {data.cloudError && (
        <div className="notice error">
          {t('cloudStale')} {t(data.cloudError.code)}
        </div>
      )}
      <ScanIssues errors={data.errors} showIssue={app.showIssue} />
      <div className="stats">
        <div>
          <span>{t('mainChats')}</span>
          <strong>{stats.main}</strong>
        </div>
        <div>
          <span>{t('backgroundChats')}</span>
          <strong>{stats.background}</strong>
        </div>
        <div>
          <span>{t('local_changes')}</span>
          <strong>{stats.local}</strong>
        </div>
        <div>
          <span>{t('remote_changes')}</span>
          <strong>{stats.remote}</strong>
        </div>
        <div>
          <span>{t('lastCheck')}</span>
          <small>{date(data.checkedAt)}</small>
        </div>
      </div>
      {chosenRows.length > 0 && (
        <div className="selection-bar">
          <div>
            <strong>
              {t('selectedScope')} {chosenRows.length}
            </strong>
            {hiddenCount > 0 && (
              <small>
                {t('hiddenSelection')} {hiddenCount}
              </small>
            )}
          </div>
          {actions(chosenRows)}
          <button className="text-button" onClick={() => updateView({ selected: new Set() })}>
            {t('clearSelection')}
          </button>
          <details className="selection-list">
            <summary>{t('reviewSelectedTitles')}</summary>
            <ul>
              {chosenRows.map((r: any) => (
                <li key={r.id}>
                  {r.title} · {projectLabel(r, t)}
                  {!visibleIds.has(r.id) && <small>{t('outsideFilters')}</small>}
                </li>
              ))}
            </ul>
          </details>
        </div>
      )}
      <section className="workspace">
        <div className="list-pane">
          <div className="filters">
            <div className="tabs">
              {['main', 'cloud', ...ENTRIES, 'unknown', 'subagent', 'all'].map((x) => (
                <button
                  className={view.filter === x ? 'active' : ''}
                  key={x}
                  onClick={() => updateView({ filter: x })}
                >
                  {t(x)}
                </button>
              ))}
            </div>
            <div className="search-row">
              <Select
                label={t('originProject')}
                value={view.projectFilter}
                onChange={(projectFilter) => updateView({ projectFilter })}
                options={[{ value: 'all', label: t('allProjects') }, ...projectOptions]}
              />
              <input
                value={view.query}
                onChange={(e) => updateView({ query: e.target.value })}
                placeholder={t('search')}
              />
              <Select
                label={t('status')}
                value={view.status}
                onChange={(status) => updateView({ status })}
                options={[
                  'all',
                  'local_only',
                  'remote_only',
                  'local_changes',
                  'remote_changes',
                  'synced',
                  'conflict',
                ].map((value) => ({ value, label: t(value) }))}
              />
            </div>
          </div>
          <ConversationTable
            rows={visible}
            selected={view.selected}
            focus={view.focus}
            onToggle={app.toggleSelected}
            onFocus={focusRow}
            onSelectAll={selectAll}
            empty={
              <div className="empty">
                <h3>{t('empty')}</h3>
                <p>
                  {t(
                    filtered
                      ? 'emptyFiltered'
                      : view.filter === 'cloud'
                        ? 'cloudEmptyHint'
                        : 'emptyHint',
                  )}
                </p>
                <button
                  onClick={() =>
                    updateView({ filter: 'all', query: '', status: 'all', projectFilter: 'all' })
                  }
                >
                  {t('refreshEmpty')}
                </button>
              </div>
            }
          />
          <div className="list-footer">
            {chosenRows.length} {t('selected')}{' '}
            {hiddenCount > 0 && (
              <small>
                {t('hiddenSelection')} {hiddenCount}
              </small>
            )}
            <button className="text-button" onClick={() => updateView({ selected: new Set() })}>
              {t('clearSelection')}
            </button>
            <span>
              {visible.length} / {data.rows.length}
            </span>
          </div>
        </div>
        <aside className="detail">
          {row ? (
            <Detail
              row={row}
              actions={!chosenRows.length ? actions([row]) : null}
              selecting={chosenRows.length > 0}
              version={version}
              setVersion={setVersion}
              downloadVersion={downloadVersion}
            />
          ) : (
            <div className="empty detail-empty">
              <p>{t('noHistory')}</p>
            </div>
          )}
        </aside>
      </section>
    </>
  );
}

const ScanIssues = memo(function ScanIssues({
  errors,
  showIssue,
}: {
  errors: any[];
  showIssue: (id: string) => void;
}) {
  const { t, has } = useI18n();
  if (!errors.length) return null;
  return (
    <div className="notice error">
      <details className="scan-issues" open={errors.length === 1}>
        <summary>
          {t('scanSummary')} ({errors.length})
        </summary>
        {errors.map((e: any, i: number) => (
          <div className="scan-issue" key={i}>
            <b>{has(e.code) ? t(e.code) : t('scanFileError')}</b>
            {!has(e.code) && <small>{e.code}</small>}
            <code>{e.file ?? e.home}</code>
            {e.code === 'duplicate_identity' && e.id && (
              <button onClick={() => showIssue(e.id)}>{t('inspectCopies')}</button>
            )}
          </div>
        ))}
      </details>
    </div>
  );
});

function Detail({ row, actions, selecting, version, setVersion, downloadVersion }: any) {
  const app = useApp();
  const { t, date, size } = useI18n();
  const { busy, work } = app;
  return (
    <>
      <div className="detail-head">
        <span className="source-tag">{t(row.source)}</span>
        <h2>{row.title}</h2>
        {actions}
        <StatusBadge status={row.status} />
        {row.busy && <StatusBadge status="busy" />}
        {row.cloudRemoved && <small>{t('cloudRemovalHistory')}</small>}
        {hasMissingImages(row) && <small className="amber-text">{t('someImagesMissing')}</small>}
      </div>
      <dl>
        <dt>{t('originProject')}</dt>
        <dd>
          {projectLabel(row, t)}
          <small>{t('projectMatch_' + (row.originProject?.match ?? 'directory'))}</small>
        </dd>
        <dt>{t('local')}</dt>
        <dd>{date(row.updatedAt)}</dd>
        <dt>{t('cloud')}</dt>
        <dd>{date(row.cloudUpdatedAt)}</dd>
        <dt>{t('sourceDevice')}</dt>
        <dd>{row.device?.name ?? '—'}</dd>
        <dt>{t('bytes')}</dt>
        <dd>{size(row.bytes)}</dd>
        {row.local && (
          <>
            <dt>{t('fileSize')}</dt>
            <dd>{size(row.fileBytes)}</dd>
            {row.compressed && (
              <>
                <dt>{t('expandedSize')}</dt>
                <dd>{size(row.historyBytes)}</dd>
              </>
            )}
            <dt>{t('databaseSize')}</dt>
            <dd>{size(row.databaseBytes)}</dd>
          </>
        )}
        {row.parent && (
          <>
            <dt>{t('parentChat')}</dt>
            <dd>{row.parentTitle ?? row.parent}</dd>
          </>
        )}
      </dl>
      {row.local && <small className="muted">{t('sizeHint')}</small>}
      {row.continuation === false && <p className="warning-box">{t('missing_rollout')}</p>}
      {row.issues.length > 0 && (
        <div className="warning-box">
          {row.issues.map((x: string) => (
            <p key={x}>{t(x)}</p>
          ))}
        </div>
      )}
      {!!row.copies?.length && (
        <section id="copy-choices" className="scope-item">
          <h3>{t('inspectCopies')}</h3>
          <p>{t('copyInstructions')}</p>
          {row.copies.map((c: any) => (
            <div className="scope-file" key={c.file}>
              <strong>{c.title}</strong>
              <code>{c.file}</code>
              <small>
                {size(c.bytes)} · {date(c.updatedAt)}
              </small>
              {c.sample && <p>{c.sample}</p>}
              {!c.canUse ? (
                <p>
                  {t('copies_indexed')} <code>{c.indexedFile}</code>
                </p>
              ) : (
                <div className="actions">
                  <button
                    disabled={busy}
                    onClick={() =>
                      app.startFlow('upload', [row.id], {
                        copyChoice: { file: c.file, token: row.copyToken },
                      })
                    }
                  >
                    {t('uploadThisCopy')}
                  </button>
                  <button
                    disabled={busy}
                    onClick={() => work(() => app.keepCopy(row, c.file), 'stageBackup')}
                  >
                    {t('keepThisCopy')}
                  </button>
                </div>
              )}
            </div>
          ))}
        </section>
      )}
      <h3>{t('entryStates')}</h3>
      {Object.values(row.targets).some((r: any) => r.omittedAttachments?.length > 0) && (
        <p className="warning-box">{t('missingImageNotice')}</p>
      )}
      {ENTRIES.map((entry) => {
        const target = row.targets[entry];
        return (
          <div className="entry-state" key={entry}>
            <div>
              <strong>{t(entry)}</strong>
              {target && (
                <small>
                  {t('importVersion')} · {t(target.syncStatus)}{' '}
                  {target.nativeProjectName && (
                    <b>
                      {t('projectLabelVerified')} · {target.nativeProjectName}
                    </b>
                  )}
                </small>
              )}
            </div>
            {target ? (
              <StatusBadge
                status={
                  target.status === 'verified' && target.omittedAttachments?.length
                    ? 'imported_missing_attachments'
                    : target.status
                }
              />
            ) : (
              <small>{t('notImported')}</small>
            )}
            {target?.status === 'verified' ? (
              <button onClick={() => work(() => app.openNative(row.id, entry), 'openingNative')}>
                {t('continue')} · {t(entry)}
              </button>
            ) : row.remote && !selecting ? (
              <button
                disabled={busy}
                onClick={() => app.startFlow('download', [row.id], { targets: [entry] })}
              >
                {t('importLocal')} · {t(entry)}…
              </button>
            ) : null}
          </div>
        );
      })}
      <small className="muted">{t('nativeHint')}</small>
      {row.versions.length > 0 && (
        <>
          <h3 id="cloud-versions">{t('versions')}</h3>
          <Select
            label={t('versions')}
            value={version}
            onChange={setVersion}
            options={[
              { value: '', label: '—' },
              ...row.versions.map((v: any) => ({
                value: v.id,
                label: `${date(v.at)} · ${v.device?.name ?? '—'} · ${v.id.slice(0, 6)}`,
              })),
            ]}
          />
          <button
            disabled={!version || busy}
            onClick={() => app.startFlow('download', [row.id], { version })}
          >
            {t('useVersion')}
          </button>
          <button
            disabled={busy || (!version && row.tips.length !== 1)}
            onClick={() =>
              work(() => downloadVersion(row.id, version || row.tips[0]), 'stageDownload')
            }
          >
            {t('saveCloudCopy')}…
          </button>
          <small className="muted">{t('versionHint')}</small>
        </>
      )}
      <h3>{t('history')}</h3>
      <small className="muted">{t('recentMessages')}</small>
      <div className="messages">
        {row.messages.map((m: any, i: number) => (
          <div className={`message ${m.role}`} key={i}>
            <small>{m.role === 'user' ? t('you') : m.role === 'tool' ? t('tool') : 'Codex'}</small>
            <p>{m.text}</p>
          </div>
        ))}
        {!row.messages.length && <p className="muted">{t('noMessages')}</p>}
      </div>
    </>
  );
}
