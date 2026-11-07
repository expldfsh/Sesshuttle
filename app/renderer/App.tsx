import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { I18nProvider, dateFormatter, makeI18n, useI18n, type Locale } from './i18n/I18n';
import { call, useWork, type ApiError } from './hooks/useApi';
import { useNotice, type Notice } from './hooks/useNotice';
import { useConfirm, type Question } from './hooks/useConfirm';
import { progress } from './store/progress';
import { applyTheme } from './theme';
import { Modal } from './components/Modal';
import { Toasts, toast } from './components/Toast';
import { Icon, type IconName } from './components/Icon';
import { ErrorNotice } from './components/ErrorNotice';
import { emptyConnection } from './ConnectionForm';
import { TransferDialog } from './transfer/TransferDialog';
import { RemovalFlow } from './RemovalFlow';
import { DetectionPanel } from './Environment';
import { TaskIndicator, TaskPanel } from './TaskPanel';
import { ConversationsPage } from './pages/ConversationsPage';
import { ProjectsPage } from './pages/ProjectsPage';
import { SettingsPage } from './pages/SettingsPage';
import { BackupsPage } from './pages/BackupsPage';
import { ActivityPage } from './pages/ActivityPage';
import { errorRule, FIX_LABELS } from './errors';

export type Page = 'conversations' | 'projects' | 'activity' | 'backups' | 'settings';
export const PAGES: Page[] = ['conversations', 'projects', 'activity', 'backups', 'settings'];
const PAGE_ICONS: Record<Page, IconName> = {
  conversations: 'history',
  projects: 'app',
  activity: 'activity',
  backups: 'backup',
  settings: 'settings',
};

// The conversation list view survives switching pages.
export type ConversationView = {
  location: 'all' | 'local' | 'cloud';
  sources: string[];
  showBackground: boolean;
  status: string;
  query: string;
  projectFilter: string;
  sort: { key: 'updated' | 'title' | 'size'; descending: boolean };
  selected: Set<string>;
  focus: string | null;
};
export const initialView: ConversationView = {
  location: 'all',
  sources: [],
  showBackground: false,
  status: 'all',
  query: '',
  projectFilter: 'all',
  sort: { key: 'updated', descending: true },
  selected: new Set(),
  focus: null,
};

type AppValue = ReturnType<typeof useAppState>;
const AppContext = createContext<AppValue | null>(null);
export const useApp = () => useContext(AppContext)!;

function useAppState() {
  const [init, setInit] = useState<any>(null),
    [cfg, setCfg] = useState<any>(null),
    [data, setData] = useState<any>({ rows: [], errors: [] }),
    [page, setPageState] = useState<Page>('conversations'),
    [view, setView] = useState<ConversationView>(initialView),
    [needsRefresh, setNeedsRefresh] = useState(true),
    [flow, setFlow] = useState<any>(null),
    [removal, setRemoval] = useState<any>(null),
    [detection, setDetection] = useState<any>(null),
    [deferred, setDeferred] = useState<any>(null),
    [diagnostic, setDiagnostic] = useState<any>(null),
    [targetIssue, setTargetIssue] = useState<any>(null),
    [branches, setBranches] = useState<any>(null),
    [jobs, setJobs] = useState<any[]>([]),
    [removalJobs, setRemovalJobs] = useState<any[]>([]),
    [deviceName, setDeviceName] = useState(''),
    [connection, setConnection] = useState<any>({ ...emptyConnection });
  const offeredRecovery = useRef(false);
  // The interface language changes when the setting is saved, not while editing it.
  const locale: Locale = init?.config?.language ?? cfg?.language ?? 'zh-CN';
  const i18n = useMemo(() => makeI18n(locale), [locale]);
  const { t } = i18n;
  const { notice, setNotice, clearNotice } = useNotice();
  const { question, ask, answer } = useConfirm();
  const onError = useCallback(
    (e: ApiError, place: string) =>
      setNotice({
        error: true,
        code: e.code,
        text: t(e.code ?? 'operation_failed'),
        detail: e.detail,
        place,
      }),
    [setNotice, t],
  );
  const { busy, phase, setPhase, work } = useWork(clearNotice, onError);
  // Success goes to a toast; errors and warnings stay where they happened.
  const notify = useCallback(
    (n: Notice | null) => {
      if (!n) setNotice(null);
      else if (n.error) setNotice({ place: 'page', ...n });
      else toast(n.text, n.detail);
    },
    [setNotice],
  );
  const updateView = useCallback(
    (patch: Partial<ConversationView>) => setView((old) => ({ ...old, ...patch })),
    [],
  );
  const toggleSelected = useCallback(
    (id: string, checked: boolean) =>
      setView((old) => {
        const selected = new Set(old.selected);
        if (checked) selected.add(id);
        else selected.delete(id);
        return { ...old, selected };
      }),
    [],
  );
  const [section, setSection] = useState('');
  // Opening a page can also scroll to one of its sections.
  const setPage = useCallback((next: Page, anchor = '') => {
    setPageState(next);
    setSection(anchor);
  }, []);

  async function reloadInit() {
    const x = await call('init');
    setInit(x);
    setCfg(x.config);
    setDeviceName(x.device.name);
    setJobs(x.jobs ?? []);
    setRemovalJobs(x.removalJobs ?? []);
    if (!offeredRecovery.current) {
      offeredRecovery.current = true;
      const pending = x.pendingRemovals?.[0];
      if (pending) progress.setRemovalJob(pending, true);
    }
    if (x.connection)
      setConnection((c: any) => (c.recoveryToken ? c : { ...c, ...x.connection, mode: 'join' }));
    return x;
  }
  async function refresh() {
    const result = await call('refresh');
    setData(result);
    setNeedsRefresh(false);
    return result;
  }
  async function persist(next: any) {
    await call('saveConfig', { ...next, deviceName });
    setCfg(next);
    setInit((old: any) => ({ ...old, config: next, device: { ...old.device, name: deviceName } }));
  }
  function startFlow(direction: string, ids: string[], extra: any = {}) {
    const request = { direction, ids, ...extra };
    if (!init.connected) {
      setDeferred(request);
      setPage('settings', 'storage');
      notify({ text: t('connectThenReturn') });
      return;
    }
    setNotice(null);
    setFlow(request);
  }
  function viewCloud() {
    setPage('conversations');
    updateView({ location: 'cloud', status: 'all', projectFilter: 'all', query: '', focus: null });
    void work(refresh, 'refreshing');
  }
  function showIssue(logical: string) {
    setPage('conversations');
    setView((old) => ({
      ...initialView,
      selected: old.selected,
      sort: old.sort,
      showBackground: true,
      focus: logical,
    }));
    requestAnimationFrame(() =>
      document.getElementById('copy-choices')?.scrollIntoView({ block: 'center' }),
    );
  }
  function showScanIssues() {
    setPage('conversations');
    requestAnimationFrame(() => {
      const d = document.querySelector<HTMLDetailsElement>('.scan-issues');
      if (d) {
        d.open = true;
        d.scrollIntoView({ block: 'center' });
      }
    });
  }
  function showVersions(id: string) {
    void work(
      async () => setBranches({ id, options: await call('versionDetails', { id }) }),
      'readingVersions',
      'detail',
    );
  }
  // The repair for a failed task or app comes from errors.ts. It opens the place to
  // fix the problem; it never retries a data operation by itself.
  function fix(item: any, entry?: string) {
    const error = entry ? item.targets?.[entry]?.error : item.error;
    const code = error?.code;
    if (code === 'conflict' || item.status === 'conflict' || item.status === 'conflict_preserved')
      return showVersions(item.id);
    const action = errorRule(code).fix;
    if (action === 'inspectCopies' || action === 'showScanIssues') {
      if (entry) {
        const logical = code === 'duplicate_identity' ? error.detail || item.id : item.id;
        void work(
          async () =>
            setTargetIssue({
              ...(await call('inspectTarget', { logical, entry })),
              retryId: item.id,
            }),
          'checkingEntries',
          'task',
        );
        return;
      }
      if (action === 'inspectCopies') return showIssue(error?.detail || item.id);
      return showScanIssues();
    }
    if (action === 'openSettings') {
      setDeferred({
        direction: entry
          ? 'download'
          : (item.requestedDirection ?? (item.action === 'upload' ? 'upload' : 'download')),
        ids: [item.id],
        ...(entry ? { targets: [entry] } : {}),
      });
      return setPage('settings', 'storage');
    }
    if (action === 'openBackups') return setPage('backups');
    startFlow(
      entry
        ? 'download'
        : (item.requestedDirection ??
            (item.action === 'upload'
              ? 'upload'
              : item.action === 'upload_import'
                ? 'both'
                : 'download')),
      [item.id],
      entry ? { targets: [entry], offerCopy: code === 'native_provider_missing' } : {},
    );
  }
  async function openNative(id: string, entry: string) {
    const value = data.rows.find((r: any) => r.id === id)?.targets?.[entry];
    if (!value) return;
    if (!cfg.skipNativeConfirm) {
      const remember = { checked: false };
      const ok = await ask({
        title: t('continue') + ' · ' + t(entry),
        message: t('nativeConfirm'),
        detail: (
          <>
            <code className="question-path">{value.project}</code>
            <label className="check">
              <input type="checkbox" onChange={(e) => (remember.checked = e.target.checked)} />
              {t('dontAskAgain')}
            </label>
          </>
        ),
        confirm: t('openInApp'),
      });
      if (!ok) return;
      if (remember.checked) await persist({ ...cfg, skipNativeConfirm: true });
    }
    await call('continue', { logicalId: id, entry });
    notify({ text: t('launchRequested') + ' · ' + t(entry) });
  }
  function reviewRemaining(id: string) {
    void work(
      async () => setRemoval({ plan: await call('retryRemovalPlan', { id }) }),
      'readingRemoval',
      'task',
    );
  }
  async function keepCopy(record: any, file: string) {
    const others = record.copies.filter((c: any) => c.file !== file).map((c: any) => c.file);
    const ok = await ask({
      title: t('keepThisCopy'),
      message: t('keepCopyConfirm'),
      detail: (
        <>
          <code className="question-path">{file}</code>
          <details className="question-list">
            <summary>
              {t('copiesMoved')} ({others.length})
            </summary>
            {others.map((f: string) => (
              <code key={f}>{f}</code>
            ))}
          </details>
        </>
      ),
      confirm: t('keepThisCopy'),
    });
    if (!ok) return;
    const moved = await call('keepLocalCopy', {
      logical: record.id,
      token: record.copyToken,
      file,
      entry: record.entry,
    });
    setNeedsRefresh(true);
    setTargetIssue(null);
    notify({ text: t('copyKept'), detail: moved.location });
  }
  // Counts on the sidebar, from data already on screen or saved locally.
  const attention = useMemo(
    () => ({
      conversations: data.rows.filter((r: any) =>
        ['local_changes', 'remote_changes', 'conflict'].includes(r.status),
      ).length,
      activity: init?.activityAttention ?? 0,
      backups: init?.backupAttention ?? 0,
    }),
    [data.rows, init],
  );

  return {
    i18n,
    init,
    setInit,
    cfg,
    setCfg,
    data,
    setData,
    page,
    setPage,
    section,
    view,
    updateView,
    toggleSelected,
    needsRefresh,
    setNeedsRefresh,
    flow,
    setFlow,
    removal,
    setRemoval,
    detection,
    setDetection,
    deferred,
    setDeferred,
    diagnostic,
    setDiagnostic,
    targetIssue,
    setTargetIssue,
    branches,
    setBranches,
    jobs,
    removalJobs,
    setJobs,
    setRemovalJobs,
    deviceName,
    setDeviceName,
    connection,
    setConnection,
    notice,
    notify,
    question,
    ask: ask as (q: Question | string) => Promise<boolean>,
    answer,
    busy,
    phase,
    setPhase,
    work,
    reloadInit,
    refresh,
    persist,
    startFlow,
    viewCloud,
    showIssue,
    showScanIssues,
    showVersions,
    fix,
    openNative,
    reviewRemaining,
    keepCopy,
    attention,
  };
}

// Refreshing reads this computer's Codex data folders and, when connected, the cloud.
export function useRefresh() {
  const app = useApp();
  const { t } = useI18n();
  return () =>
    app.work(async () => {
      const result = await app.refresh();
      // A failed cloud check is shown once, as the page banner above the list.
      if (!result.cloudError) app.notify({ text: t('refreshDone') });
    }, 'refreshing');
}

function TopBar() {
  const app = useApp();
  const { t, locale } = useI18n();
  const refresh = useRefresh();
  const { init, page, busy, data } = app;
  const checked = data.checkedAt ? new Date(data.checkedAt) : null;
  const time =
    checked && dateFormatter(locale, { hour: '2-digit', minute: '2-digit' }).format(checked);
  const full =
    checked &&
    dateFormatter(locale, { dateStyle: 'full', timeStyle: 'long' }).format(checked) +
      ' (' +
      Intl.DateTimeFormat().resolvedOptions().timeZone +
      ')';
  const space = init?.connection?.space?.slice(0, 8);
  return (
    <header className="topbar">
      <h1>{t(page)}</h1>
      <div className="top-right">
        {init?.testMode && <span className="badge tone-warning">{t('testMode')}</span>}
        <button
          type="button"
          className={'connection-chip ' + (init?.connected ? 'on' : 'off')}
          onClick={() => app.setPage('settings', 'storage')}
          title={t('openConnection')}
        >
          <span className="badge-dot" aria-hidden="true" />
          {t(init?.connected ? 'connected' : 'offline')}
          {init?.connected && space && <code>{space}</code>}
        </button>
        {page === 'conversations' && (
          <span className="refresh-group">
            <button
              className="primary"
              disabled={busy}
              onClick={refresh}
              aria-keyshortcuts="Meta+R Control+R"
            >
              <Icon name="refresh" /> {t('refresh')}
            </button>
            <small title={full ?? undefined}>
              {time ? t('lastCheckAt', { time }) : t('notCheckedYet')}
            </small>
          </span>
        )}
        <TaskIndicator />
      </div>
    </header>
  );
}

function Sidebar() {
  const { page, setPage, deviceName, init, attention } = useApp();
  const { t } = useI18n();
  return (
    <aside className="sidebar">
      <div className="brand">
        <span className="brand-mark" aria-hidden="true">
          <Icon name="cloud" size={20} />
        </span>
        <span className="brand-name">sesshuttle</span>
      </div>
      <nav aria-label={t('navigation')}>
        {PAGES.map((name) => {
          const count = (attention as Record<string, number>)[name] ?? 0;
          return (
            <button
              key={name}
              className={page === name ? 'active' : ''}
              aria-current={page === name ? 'page' : undefined}
              aria-label={count ? `${t(name)} · ${t('needsAttention', { n: count })}` : t(name)}
              title={t(name)}
              onClick={() => setPage(name)}
            >
              <Icon name={PAGE_ICONS[name]} size={20} />
              <span className="nav-label">{t(name)}</span>
              {count > 0 && (
                <span className="nav-count" aria-hidden="true">
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </nav>
      <div className="sidebar-bottom" title={deviceName}>
        <strong>{deviceName}</strong>
        <span className="version">v{init?.version}</span>
      </div>
    </aside>
  );
}

// Errors without a closer place, and the working line of a running operation.
function PageMessages() {
  const app = useApp();
  const { t } = useI18n();
  const { notice, init, page, busy, phase } = app;
  const action = notice?.error && errorRule(notice.code).fix;
  const fixButton =
    action === 'openSettings' ? (
      <button onClick={() => app.setPage('settings', 'storage')}>
        {t(FIX_LABELS.openSettings)}
      </button>
    ) : action === 'openBackups' ? (
      <button onClick={() => app.setPage('backups')}>{t(FIX_LABELS.openBackups)}</button>
    ) : action === 'openApps' ? (
      <button onClick={() => app.setPage('projects')}>{t('projects')}</button>
    ) : action === 'showScanIssues' ? (
      <button onClick={app.showScanIssues}>{t(FIX_LABELS.showScanIssues)}</button>
    ) : null;
  return (
    <>
      {notice?.error && notice.place === 'page' && (
        <ErrorNotice
          error={{ code: notice.code, detail: notice.detail }}
          severity={errorRule(notice.code).severity}
          action={fixButton}
          onDismiss={() => app.notify(null)}
        />
      )}
      {init?.credentialError && page !== 'settings' && (
        <div className="banner warning">
          <Icon name="alert" />
          <span>
            <strong>{t(init.connected ? 'spaceJoined' : 'signInAgain')}</strong>{' '}
            {t(
              init.connected
                ? init.credentialError === 'credential_save_pending'
                  ? 'credential_save_pending'
                  : 'onlyThisSession'
                : init.canRestore
                  ? init.credentialError
                  : 'reconnectAfterSession',
            )}
          </span>
          <button onClick={() => app.setPage('settings', 'storage')}>
            {t(init.connected ? 'manageConnection' : 'openConnection')}
          </button>
        </div>
      )}
      {busy && phase !== 'transferRunning' && (
        <div role="status" className="working">
          <progress />
          {t(phase)}
        </div>
      )}
    </>
  );
}

// A failure from an action in this place (a card, the details panel, the task panel).
export function PlaceError({ place }: { place: string }) {
  const app = useApp();
  const notice = app.notice;
  if (!notice?.error || notice.place !== place) return null;
  return (
    <ErrorNotice
      error={{ code: notice.code, detail: notice.detail }}
      severity={errorRule(notice.code).severity}
      onDismiss={() => app.notify(null)}
    />
  );
}

// Dialogs that any page or task can open.
function GlobalDialogs() {
  const app = useApp();
  const { t, tn, date, size } = useI18n();
  const { busy, work } = app;
  return (
    <>
      {app.flow && (
        <TransferDialog
          onCopies={(id: string) => {
            app.setFlow(null);
            app.showIssue(id);
          }}
          request={app.flow}
          rows={app.data.rows}
          cfg={app.cfg}
          setConfig={app.persist}
          refreshRows={app.setData}
          onClose={() => app.setFlow(null)}
          onStart={(p: any, confirmLarge: boolean, acceptedByItem: any, onlyEligible: boolean) => {
            app.setFlow(null);
            progress.setRemovalJob(null);
            progress.setJob(
              {
                id: p.token,
                status: 'running',
                total: p.items.length,
                items: [],
                progress: {
                  stage: 'stageCheck',
                  index: 1,
                  total: p.items.length,
                  title: p.items[0]?.title,
                  bytes: 0,
                },
              },
              true,
            );
            void work(
              async () => {
                try {
                  progress.setJob(
                    await call('execute', {
                      token: p.token,
                      confirmLarge,
                      acceptedByItem,
                      onlyEligible,
                    }),
                    true,
                  );
                } catch (e) {
                  progress.setJob(null);
                  throw e;
                }
                await app.reloadInit();
                app.setNeedsRefresh(true);
              },
              'transferRunning',
              'task',
            );
          }}
        />
      )}
      {app.removal && (
        <RemovalFlow
          key={app.removal.plan?.token ?? app.removal.binId ?? 'live'}
          t={t}
          size={size}
          locale={app.i18n.locale}
          connected={app.init.connected}
          call={call}
          initial={app.removal}
          onClose={() => app.setRemoval(null)}
          onRepair={(p: string) => {
            app.setRemoval(null);
            if (p === 'scan') app.showScanIssues();
            else app.setPage(p as any, p === 'settings' ? 'storage' : '');
          }}
          onExecute={(p: any, permanent: boolean, upgrade: boolean) => {
            app.setRemoval(null);
            void work(
              async () => {
                const answer = await call('executeRemoval', { token: p.token, permanent, upgrade });
                progress.setRemovalJob(answer, true);
                if (answer.status === 'completed')
                  app.updateView({ selected: new Set(), focus: null });
                await app.reloadInit();
                app.setNeedsRefresh(true);
              },
              'removingNow',
              'task',
            );
          }}
        />
      )}
      {app.detection && (
        <DetectionPanel
          report={app.detection}
          cfg={app.cfg}
          t={t}
          onRetry={async () => {
            const next = await call('detectPaths');
            app.setDetection(next);
            return next;
          }}
          onClose={() => app.setDetection(null)}
          onApply={async (next: any) => {
            await app.persist(next);
            app.setDetection(null);
            app.setNeedsRefresh(true);
            app.notify({ text: t('pathsApplied') });
          }}
        />
      )}
      {app.targetIssue && (
        <Modal
          title={t(app.targetIssue.entry) + ' · ' + t('scanSummary')}
          busy={busy}
          onClose={() => app.setTargetIssue(null)}
          footer={
            <button
              className="primary"
              disabled={busy}
              onClick={() => {
                app.startFlow('download', [app.targetIssue.retryId], {
                  targets: [app.targetIssue.entry],
                });
                app.setTargetIssue(null);
              }}
            >
              {t('reviewAndRetry')}
            </button>
          }
        >
          <code>{app.targetIssue.home}</code>
          {app.targetIssue.errors.map((e: any, i: number) => (
            <p key={i}>
              {t(e.code)} <code>{e.file ?? e.home}</code>
            </p>
          ))}
          {app.targetIssue.copies.length > 1 &&
            app.targetIssue.copies.map((c: any) => (
              <div key={c.file} className="scope-file">
                <b>{c.title}</b>
                <code>{c.file}</code>
                <small>
                  {size(c.bytes)} · {date(c.updatedAt)}
                </small>
                <p>{c.sample}</p>
                {!c.canUse ? (
                  <p>
                    {t('copies_indexed')} <code>{c.indexedFile}</code>
                  </p>
                ) : (
                  <button
                    disabled={busy}
                    onClick={() =>
                      work(() => app.keepCopy(app.targetIssue, c.file), 'stageBackup', 'issue')
                    }
                  >
                    {t('keepThisCopy')}
                  </button>
                )}
              </div>
            ))}
          <PlaceError place="issue" />
        </Modal>
      )}
      {app.branches && (
        <Modal title={t('compareVersions')} onClose={() => app.setBranches(null)}>
          <p>{t('versionHint')}</p>
          {app.branches.options.map((v: any) => (
            <div className="scope-item" key={v.id}>
              <b>{v.title}</b>
              <p>
                {v.device} · {date(v.at)} · {size(v.bytes)} · {tn('countHistoryFiles', v.files)}
              </p>
              <small>{v.lastMessage}</small>
              <button
                onClick={() => {
                  app.setBranches(null);
                  app.startFlow('download', [app.branches.id], { version: v.id });
                }}
              >
                {t('chooseVersion')}
              </button>
            </div>
          ))}
        </Modal>
      )}
      {app.question && (
        <Modal
          title={app.question.title ?? t('confirm')}
          size="small"
          onClose={() => app.answer(false)}
          footer={
            <>
              <button autoFocus onClick={() => app.answer(false)}>
                {t('cancel')}
              </button>
              <button
                className={app.question.danger ? 'danger-action' : 'primary'}
                onClick={() => app.answer(true)}
              >
                {app.question.confirm ?? t('confirm')}
              </button>
            </>
          }
        >
          <div className="question">{app.question.message}</div>
          {app.question.detail}
        </Modal>
      )}
      {app.diagnostic && (
        <Modal
          title={t('diagnostics')}
          onClose={() => app.setDiagnostic(null)}
          footer={
            <button
              onClick={() =>
                work(
                  async () => {
                    await call('copyText', { text: JSON.stringify(app.diagnostic, null, 2) });
                    app.notify({ text: t('copied') });
                  },
                  'working',
                  'diagnostics',
                )
              }
            >
              <Icon name="copy" /> {t('copy')}
            </button>
          }
        >
          <p>{t('diagnosticHint')}</p>
          <pre>{JSON.stringify(app.diagnostic, null, 2)}</pre>
          <PlaceError place="diagnostics" />
        </Modal>
      )}
    </>
  );
}

// ⌘/Ctrl+R refreshes the conversation list when nothing else runs; ⌘/Ctrl+F focuses
// its search. No other shortcut starts a data operation.
function useShortcuts(app: AppValue, refresh: () => void) {
  const latest = useRef({ app, refresh });
  latest.current = { app, refresh };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey;
      if (!mod || event.altKey || event.shiftKey) return;
      const key = event.key.toLowerCase();
      if (key !== 'r' && key !== 'f') return;
      event.preventDefault();
      const current = latest.current;
      if (document.querySelector('dialog[open]') || current.app.page !== 'conversations') return;
      if (key === 'r' && !current.app.busy) current.refresh();
      if (key === 'f') document.querySelector<HTMLInputElement>('#conversation-search')?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

function Shell() {
  const app = useApp();
  const refresh = useRefresh();
  useShortcuts(app, refresh);
  const { page, section } = app;
  // A new page starts at its top, or at the section it was opened for.
  useEffect(() => {
    if (section)
      requestAnimationFrame(() =>
        document.getElementById(section)?.scrollIntoView({ block: 'start' }),
      );
    else document.querySelector('.content')?.scrollTo(0, 0);
  }, [page, section]);
  return (
    <div className="shell">
      <Sidebar />
      <main>
        <TopBar />
        <TaskPanel />
        <div className={'content page-' + page}>
          <PageMessages />
          {page === 'conversations' && <ConversationsPage />}
          {page === 'settings' && <SettingsPage />}
          {page === 'projects' && <ProjectsPage />}
          {page === 'backups' && <BackupsPage />}
          {page === 'activity' && <ActivityPage />}
        </div>
      </main>
      <GlobalDialogs />
      <Toasts />
    </div>
  );
}

export function App() {
  const app = useAppState();
  const { t } = app.i18n;
  const { cfg, notice, work } = app;
  useEffect(() => {
    void work(async () => {
      await app.reloadInit();
    });
    return window.sesshuttle.onProgress((event) => progress.receive(event));
    // Load saved local state once at startup and subscribe to progress events.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => applyTheme(cfg?.theme), [cfg?.theme]);
  useEffect(
    () =>
      window.sesshuttle.onClosePending((deleting?: boolean) =>
        app.notify({ text: t(deleting ? 'closeAfterRemoval' : 'closePending') }),
      ),
    // `t` changes with the language only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [app.i18n.locale],
  );
  if (!cfg)
    return (
      <I18nProvider locale={app.i18n.locale}>
        <div className="loading">
          <p>{notice?.text ?? t('loading')}</p>
          {notice?.error && (
            <button onClick={() => work(app.reloadInit, 'refreshing')}>{t('checkAgain')}</button>
          )}
        </div>
      </I18nProvider>
    );
  return (
    <I18nProvider locale={app.i18n.locale}>
      <AppContext.Provider value={app}>
        <Shell />
      </AppContext.Provider>
    </I18nProvider>
  );
}
