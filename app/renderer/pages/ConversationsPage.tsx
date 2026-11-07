import { Fragment, memo, useCallback, useDeferredValue, useMemo, useRef, useState } from 'react';
import { PlaceError, useApp, useRefresh } from '../App';
import { useI18n } from '../i18n/I18n';
import { call } from '../hooks/useApi';
import { Select } from '../Select';
import { StatusBadge, toneOf } from '../components/StatusBadge';
import { EmptyState } from '../components/EmptyState';
import { Icon } from '../components/Icon';
import { ConversationActions } from '../ConversationActions';
import { ConversationTable } from './ConversationTable';
import { Onboarding } from './Onboarding';
import { ENTRIES, hasMissingImages, projectKey, projectLabel } from './rows';

export const SOURCES = ['desktop', 'cli', 'ide', 'unknown'];
export const STATUSES = [
  'local_only',
  'remote_only',
  'local_changes',
  'remote_changes',
  'conflict',
  'synced',
];

export function ConversationsPage() {
  const app = useApp();
  const { t, tn } = useI18n();
  const refresh = useRefresh();
  const { data, init, cfg, busy, work, view, updateView } = app;
  const query = useDeferredValue(view.query);
  const projectOptions = useMemo(
    () =>
      Array.from(
        new Map(data.rows.map((r: any) => [projectKey(r), projectLabel(r, t)])).entries(),
      ).map(([value, label]: any) => ({ value, label })),
    [data.rows, t],
  );
  // Every filter except status; the status chips count within this set.
  const scoped = useMemo(() => {
    const needle = query.toLowerCase();
    return data.rows.filter(
      (r: any) =>
        (view.location === 'all' || (view.location === 'local' ? r.local : r.remote)) &&
        (r.kind === 'background'
          ? view.showBackground
          : !view.sources.length || view.sources.includes(r.source)) &&
        (view.projectFilter === 'all' || projectKey(r) === view.projectFilter) &&
        (!needle || `${r.title} ${r.project} ${projectLabel(r, t)}`.toLowerCase().includes(needle)),
    );
  }, [data.rows, view.location, view.sources, view.showBackground, view.projectFilter, query, t]);
  const counts = useMemo(() => {
    const out: Record<string, number> = { all: scoped.length };
    for (const r of scoped) out[r.status] = (out[r.status] ?? 0) + 1;
    return out;
  }, [scoped]);
  const visible = useMemo(() => {
    const rows =
      view.status === 'all' ? [...scoped] : scoped.filter((r: any) => r.status === view.status);
    const { key, descending } = view.sort;
    const value = (r: any) =>
      key === 'title'
        ? r.title.toLowerCase()
        : key === 'size'
          ? (r.bytes ?? 0)
          : (r.updatedAt ?? r.cloudUpdatedAt ?? '');
    rows.sort((a: any, b: any) => {
      const x = value(a),
        y = value(b);
      const order = typeof x === 'number' ? x - (y as number) : String(x).localeCompare(String(y));
      // Equal values keep one order across reloads, so rows do not trade places.
      return (descending ? -order : order) || a.id.localeCompare(b.id);
    });
    return rows;
  }, [scoped, view.status, view.sort]);
  const visibleIds = useMemo(() => new Set(visible.map((r: any) => r.id)), [visible]);
  const chosenRows = useMemo(
    () => data.rows.filter((r: any) => view.selected.has(r.id)),
    [data.rows, view.selected],
  );
  const hiddenCount = chosenRows.filter((r: any) => !visibleIds.has(r.id)).length;
  const row = visible.find((r: any) => r.id === view.focus);
  const filtered =
    view.location !== 'all' ||
    view.sources.length > 0 ||
    view.showBackground ||
    view.status !== 'all' ||
    view.projectFilter !== 'all' ||
    !!view.query;
  const clearFilters = () =>
    updateView({
      location: 'all',
      sources: [],
      showBackground: false,
      status: 'all',
      projectFilter: 'all',
      query: '',
    });
  const focusRow = useCallback(
    (id: string) => {
      updateView({ focus: id });
      if (window.innerWidth <= 1150)
        requestAnimationFrame(() =>
          document.querySelector('.detail-head')?.scrollIntoView({ block: 'nearest' }),
        );
    },
    [updateView],
  );
  const setSelection = useCallback(
    (selected: Set<string>) => updateView({ selected }),
    [updateView],
  );
  const selectAll = (checked: boolean) => {
    const next = new Set(view.selected);
    for (const r of visible) {
      if (checked) next.add(r.id);
      else next.delete(r.id);
    }
    setSelection(next);
  };
  const actions = (items: any[], compact = false) => (
    <ConversationActions
      items={items}
      compact={compact}
      t={t}
      busy={busy}
      open={(dir: string) =>
        app.startFlow(
          dir,
          items.map((r) => r.id),
        )
      }
      resume={(id: string, e: string) =>
        work(() => app.openNative(id, e), 'openingNative', 'detail')
      }
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
  const detected = ENTRIES.some((e) => cfg.targets?.[e]?.binary && cfg.targets?.[e]?.home);
  const empty = !data.rows.length ? (
    !detected ? (
      <EmptyState
        icon="app"
        title={t('emptyNoCodex')}
        action={<button onClick={() => detect(app)}>{t('detect')}</button>}
      >
        {t('emptyNoCodexHint')}
      </EmptyState>
    ) : (
      <EmptyState
        icon="refresh"
        title={t(data.checkedAt ? 'empty' : 'notCheckedYet')}
        action={
          <button className="primary" disabled={busy} onClick={refresh}>
            <Icon name="refresh" /> {t('refresh')}
          </button>
        }
      >
        {t(data.checkedAt ? 'emptyHint' : 'manualRefreshHint')}
      </EmptyState>
    )
  ) : filtered ? (
    <EmptyState
      icon="info"
      title={t('empty')}
      action={
        <>
          {view.location === 'cloud' && !init.connected && (
            <button className="primary" onClick={() => app.setPage('settings', 'storage')}>
              {t('openConnection')}
            </button>
          )}
          <button onClick={clearFilters}>{t('clearFilters')}</button>
        </>
      }
    >
      {view.location === 'cloud' && !data.rows.some((r: any) => r.remote)
        ? init.connected
          ? t('cloudEmptyHint')
          : t('connectHint')
        : t('emptyFiltered')}
    </EmptyState>
  ) : null;

  return (
    <div className="conversations">
      <Onboarding />
      {data.cloudError && (
        <div className="banner danger" role="alert">
          <Icon name="alert" />
          <span>
            {t('cloudStale')} {t(data.cloudError.code)}
          </span>
          <button disabled={busy} onClick={refresh}>
            {t('refreshAndRetry')}
          </button>
        </div>
      )}
      <ScanIssues errors={data.errors} showIssue={app.showIssue} />
      <Filters
        projectOptions={projectOptions}
        counts={counts}
        filtered={filtered}
        clearFilters={clearFilters}
      />
      <section className="workspace">
        <div className="list-pane">
          <ConversationTable
            rows={visible}
            selected={view.selected}
            focus={view.focus}
            sort={view.sort}
            onSort={(sort) => updateView({ sort })}
            onToggle={app.toggleSelected}
            onFocus={focusRow}
            onSelectAll={selectAll}
            onSelect={setSelection}
            empty={empty}
            padded={chosenRows.length > 0}
          />
          <div className="list-footer">
            <span>{tn('countConversations', visible.length)}</span>
            {visible.length !== data.rows.length && (
              <small>{t('ofTotal', { n: data.rows.length })}</small>
            )}
          </div>
          {/* Floats over the bottom of the list, so the table keeps its size. */}
          {chosenRows.length > 0 && (
            <SelectionBar
              chosenRows={chosenRows}
              hiddenCount={hiddenCount}
              visibleIds={visibleIds}
              actions={actions(chosenRows, true)}
            />
          )}
        </div>
        <aside className="detail" aria-label={t('details')}>
          {row ? (
            <Detail
              key={row.id}
              row={row}
              actions={!chosenRows.length ? actions([row]) : null}
              selecting={chosenRows.length > 0}
            />
          ) : (
            <EmptyState icon="info" title={t('noHistory')} />
          )}
        </aside>
      </section>
    </div>
  );
}

const detect = (app: any) =>
  app.work(async () => app.setDetection(await call('detectPaths')), 'checkingEntries');

function Filters({ projectOptions, counts, filtered, clearFilters }: any) {
  const app = useApp();
  const { t } = useI18n();
  const { view, updateView } = app;
  return (
    <div className="filters">
      <div className="filter-row">
        <div className="segmented" role="radiogroup" aria-label={t('location')}>
          {(['all', 'local', 'cloud'] as const).map((value) => (
            <button
              key={value}
              role="radio"
              aria-checked={view.location === value}
              className={view.location === value ? 'active' : ''}
              onClick={() => updateView({ location: value })}
            >
              {value !== 'all' && <Icon name={value === 'local' ? 'laptop' : 'cloud'} />}
              {t(value === 'all' ? 'allLocations' : value === 'local' ? 'thisComputer' : 'cloud')}
            </button>
          ))}
        </div>
        <div className="source-tags" role="group" aria-label={t('source')}>
          {SOURCES.map((source) => {
            const on = view.sources.includes(source);
            return (
              <button
                key={source}
                aria-pressed={on}
                className={'tag' + (on ? ' active' : '')}
                onClick={() =>
                  updateView({
                    sources: on
                      ? view.sources.filter((s: string) => s !== source)
                      : [...view.sources, source],
                  })
                }
              >
                {on && <Icon name="check" />}
                {t(source)}
              </button>
            );
          })}
        </div>
        <label className="switch">
          <input
            type="checkbox"
            role="switch"
            checked={view.showBackground}
            onChange={(e) => updateView({ showBackground: e.target.checked })}
          />
          <span>{t('showBackground')}</span>
        </label>
      </div>
      <div className="filter-row">
        <Select
          label={t('originProject')}
          value={view.projectFilter}
          onChange={(projectFilter) => updateView({ projectFilter })}
          options={[{ value: 'all', label: t('allProjects') }, ...projectOptions]}
        />
        <input
          id="conversation-search"
          className="search"
          type="search"
          value={view.query}
          aria-keyshortcuts="Meta+F Control+F"
          onChange={(e) => updateView({ query: e.target.value })}
          placeholder={t('search')}
          aria-label={t('search')}
        />
        {filtered && (
          <button className="text-button" onClick={clearFilters}>
            {t('clearFilters')}
          </button>
        )}
      </div>
      <div className="status-chips" role="group" aria-label={t('status')}>
        {['all', ...STATUSES].map((status) => {
          const on = view.status === status;
          return (
            <button
              key={status}
              aria-pressed={on}
              className={'chip' + (on ? ' active' : '')}
              onClick={() => updateView({ status: on || status === 'all' ? 'all' : status })}
            >
              {status !== 'all' && <StatusDot status={status} />}
              {t(status === 'all' ? 'allStatuses' : status)}
              <span className="chip-count">{counts[status] ?? 0}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function StatusDot({ status }: { status: string }) {
  return <span className={'status-dot tone-' + toneOf(status)} aria-hidden="true" />;
}

function SelectionBar({ chosenRows, hiddenCount, visibleIds, actions }: any) {
  const app = useApp();
  const { t, tn } = useI18n();
  return (
    <div className="selection-bar" role="region" aria-label={t('selectedScope')}>
      <div className="selection-count">
        <strong>{t('selectedCount', { n: chosenRows.length })}</strong>
        {hiddenCount > 0 && <small>{t('hiddenSelectionCount', { n: hiddenCount })}</small>}
      </div>
      {actions}
      <details className="selection-list">
        <summary>{t('reviewSelectedTitles')}</summary>
        <div className="popover">
          <p>{tn('countConversations', chosenRows.length)}</p>
          <ul>
            {chosenRows.map((r: any) => (
              <li key={r.id}>
                {r.title} · {projectLabel(r, t)}
                {!visibleIds.has(r.id) && <small>{t('outsideFilters')}</small>}
              </li>
            ))}
          </ul>
        </div>
      </details>
      <button className="text-button" onClick={() => app.updateView({ selected: new Set() })}>
        {t('clearSelection')}
      </button>
    </div>
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
    <div className="banner warning">
      <Icon name="alert" />
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

function Section({ title, children, open = true }: any) {
  return (
    <details className="detail-section" open={open}>
      <summary>
        <Icon name="chevron" className="section-caret" />
        {title}
      </summary>
      <div className="detail-section-body">{children}</div>
    </details>
  );
}

function Detail({ row, actions, selecting }: any) {
  const app = useApp();
  const { t, date, size } = useI18n();
  const { busy, work } = app;
  const [version, setVersion] = useState('');
  async function downloadVersion(logical: string, chosen: string) {
    const ok = await app.ask({
      title: t('saveCloudCopy'),
      message: t('saveCloudCopyHint'),
      confirm: t('chooseFolderAndSave'),
    });
    if (!ok) return;
    const location = await call('downloadCopy', { logical, version: chosen });
    if (location) app.notify({ text: t('savedCopyAt'), detail: location });
  }
  const more = [
    row.versions.length > 0 && {
      key: 'compare',
      label: t('compareVersions'),
      icon: 'history',
      run: () => app.showVersions(row.id),
    },
    row.local &&
      row.remote && {
        key: 'both',
        label: t('both') + '…',
        icon: 'refresh',
        run: () => app.startFlow('both', [row.id]),
      },
    row.remote &&
      row.tips.length === 1 && {
        key: 'copy',
        label: t('saveCloudCopy') + '…',
        icon: 'download',
        run: () => work(() => downloadVersion(row.id, row.tips[0]), 'stageDownload', 'detail'),
      },
    {
      key: 'remove',
      label: t('removeChats') + '…',
      icon: 'trash',
      danger: true,
      run: () =>
        app.setRemoval({
          ids: [row.id],
          titles: [row.title],
          hasLocal: row.local,
          hasCloud: row.remote,
        }),
    },
  ].filter(Boolean) as any[];
  return (
    <>
      <div className="detail-head">
        <div className="detail-tags">
          <span className="source-tag">{t(row.source)}</span>
          <StatusBadge status={row.status} />
          {row.busy && <StatusBadge status="busy" />}
        </div>
        <h2>{row.title}</h2>
        <div className="detail-actions">
          {actions}
          <MoreMenu items={more} disabled={busy || selecting} />
        </div>
        {row.cloudRemoved && <small className="muted">{t('cloudRemovalHistory')}</small>}
        {hasMissingImages(row) && <small className="amber-text">{t('someImagesMissing')}</small>}
        <PlaceError place="detail" />
      </div>
      <div className="detail-body">
        <Section title={t('overview')}>
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
            <dd>
              {size(row.bytes)}
              {row.local && (
                <small>
                  {t('fileSize')} {size(row.fileBytes)}
                  {row.compressed && ` · ${t('expandedSize')} ${size(row.historyBytes)}`} ·{' '}
                  {t('databaseSize')} {size(row.databaseBytes)}
                </small>
              )}
            </dd>
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
        </Section>
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
                      onClick={() => work(() => app.keepCopy(row, c.file), 'stageBackup', 'detail')}
                    >
                      {t('keepThisCopy')}
                    </button>
                  </div>
                )}
              </div>
            ))}
          </section>
        )}
        <Section title={t('entryStates')}>
          {Object.values(row.targets).some((r: any) => r.omittedAttachments?.length > 0) && (
            <p className="warning-box">{t('missingImageNotice')}</p>
          )}
          {ENTRIES.map((entry) => {
            const target = row.targets[entry];
            return (
              <Fragment key={entry}>
                <div className="entry-state">
                  <div>
                    <strong>{t(entry)}</strong>
                    {target ? (
                      <small>
                        {t('importVersion')} · {t(target.syncStatus)}
                        {target.nativeProjectName &&
                          ` · ${t('projectLabelVerified')} · ${target.nativeProjectName}`}
                      </small>
                    ) : (
                      <small>{t('notImported')}</small>
                    )}
                  </div>
                  {target && (
                    <StatusBadge
                      status={
                        target.status === 'verified' && target.omittedAttachments?.length
                          ? 'imported_missing_attachments'
                          : target.status
                      }
                    />
                  )}
                  {target?.status === 'verified' ? (
                    <button
                      onClick={() =>
                        work(
                          () => app.openNative(row.id, entry),
                          'openingNative',
                          'native:' + entry,
                        )
                      }
                    >
                      {t('continue')}
                    </button>
                  ) : row.remote && !selecting ? (
                    <button
                      disabled={busy}
                      onClick={() => app.startFlow('download', [row.id], { targets: [entry] })}
                    >
                      <Icon name="download" /> {t('importHere')}
                    </button>
                  ) : null}
                </div>
                {/* Opening this app failed: shown next to its row. */}
                <PlaceError place={'native:' + entry} />
              </Fragment>
            );
          })}
          <small className="muted">{t('nativeHint')}</small>
        </Section>
        {row.versions.length > 0 && (
          <Section title={t('versions')} open={row.status === 'conflict'}>
            <Select
              label={t('versions')}
              value={version}
              onChange={setVersion}
              options={[
                { value: '', label: t('chooseVersionOption') },
                ...row.versions.map((v: any) => ({
                  value: v.id,
                  label: `${date(v.at)} · ${v.device?.name ?? '—'} · ${v.id.slice(0, 6)}${
                    row.tips.includes(v.id) ? ' · ' + t('currentVersion') : ''
                  }`,
                })),
              ]}
            />
            <div className="actions">
              <button
                disabled={!version || busy}
                onClick={() => app.startFlow('download', [row.id], { version })}
              >
                {t('useVersion')}
              </button>
              <button
                disabled={busy || (!version && row.tips.length !== 1)}
                onClick={() =>
                  work(
                    () => downloadVersion(row.id, version || row.tips[0]),
                    'stageDownload',
                    'detail',
                  )
                }
              >
                {t('saveCloudCopy')}…
              </button>
            </div>
            <small className="muted">{t('versionHint')}</small>
          </Section>
        )}
        <Section title={t('history')}>
          <small className="muted">{t('recentMessages')}</small>
          <div className="messages">
            {row.messages.map((m: any, i: number) => (
              <Message key={i} message={m} />
            ))}
            {!row.messages.length && <p className="muted">{t('noMessages')}</p>}
          </div>
        </Section>
      </div>
    </>
  );
}

// User messages on the right, Codex on the left; tool output folds into one line.
function Message({ message: m }: any) {
  const { t, tn } = useI18n();
  if (m.role === 'tool') {
    const lines = m.text.split('\n').length;
    return (
      <details className="message tool">
        <summary>{tn('toolOutputLines', lines)}</summary>
        <pre>{m.text}</pre>
      </details>
    );
  }
  return (
    <div className={`message ${m.role}`}>
      <small>{m.role === 'user' ? t('you') : 'Codex'}</small>
      <p>{m.text}</p>
    </div>
  );
}

// "⋯": less frequent actions for the conversation in the details panel.
function MoreMenu({ items, disabled }: { items: any[]; disabled: boolean }) {
  const { t } = useI18n();
  const ref = useRef<HTMLDetailsElement>(null);
  const close = () => ref.current?.removeAttribute('open');
  return (
    <details
      className="more-menu"
      ref={ref}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && ref.current?.open) {
          e.stopPropagation();
          close();
          ref.current.querySelector('summary')?.focus();
        }
      }}
    >
      <summary
        aria-label={t('moreActions')}
        title={t('moreActions')}
        className={'icon-button' + (disabled ? ' disabled' : '')}
      >
        <Icon name="more" />
      </summary>
      <div className="menu" role="menu">
        {items.map((item) => (
          <button
            key={item.key}
            role="menuitem"
            disabled={disabled}
            className={item.danger ? 'danger-text' : ''}
            onClick={() => {
              close();
              item.run();
            }}
          >
            <Icon name={item.icon} /> {item.label}
          </button>
        ))}
      </div>
    </details>
  );
}
