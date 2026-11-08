import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { I18nProvider, dateFormatter, makeI18n, useI18n, type Locale } from './i18n/I18n';
import { call, useWork, type ApiError } from './hooks/useApi';
import { useNotice, type Notice } from './hooks/useNotice';
import { useConfirm, type Question } from './hooks/useConfirm';
import { progress, type Failure } from './store/progress';
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
    [connection, setConnection] = useState<any>({ ...emptyConnection }),
    // Increase after a user action that may have changed saved local state, or the
    // cloud recycle bin. Pages that read saved state when they open read it again.
    [localRevision, setLocalRevision] = useState(0),
    [cloudRevision, setCloudRevision] = useState(0);
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
        native: (e as any).native === true,
      }),
    [setNotice, t],
  );
  const { busy, phase, setPhase, work } = useWork(clearNotice, onError);
  // A task-panel operation. Its failure is kept with the tasks, not in the single
  // notice, so a refresh or another action does not clear it; success clears an
  // earlier failure of the same kind.
  function taskWork(
    failure: Omit<Failure, 'id' | 'at' | 'error' | 'started'>,
    fn: () => Promise<unknown>,
    label: string,
  ) {
    return work(async () => {
      try {
        await fn();
        progress.clearFailure(failure.kind);
      } catch (e: any) {
        const previous = progress.failure(failure.kind);
        if (previous?.token && previous.token !== failure.token) void discardPlan(previous.token);
        progress.fail({
          ...failure,
          error: {
            code: e?.code ?? 'operation_failed',
            detail: e?.detail ?? e?.message ?? '',
            targets: e?.targets,
          },
          started: e?.started === true,
        });
      }
    }, label);
  }
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

  // Unsaved edits on the settings pages survive reading saved state again.
  const edits = useRef({ cfg, init, deviceName });
  edits.current = { cfg, init, deviceName };
  async function reloadInit() {
    const x = await call('init');
    const before = edits.current;
    const dirty =
      !!before.init &&
      (JSON.stringify(before.cfg) !== JSON.stringify(before.init.config) ||
        before.deviceName !== before.init.device?.name);
    setInit(x);
    if (!dirty) {
      setCfg(x.config);
      setDeviceName(x.device.name);
    }
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
  // After a user action finished, failed or stopped part way: pages read their saved
  // local state again and the app state behind the sidebar counts is reloaded. Lists
  // read from the cloud are only marked out of date (`cloud`), never read again here.
  async function localChanged(cloud = false) {
    setLocalRevision((n) => n + 1);
    if (cloud) setCloudRevision((n) => n + 1);
    await reloadInit().catch((e) => onError(e, 'page'));
  }
  async function refresh() {
    const result = await call('refresh');
    setData(result);
    setNeedsRefresh(false);
    return result;
  }
  // This computer's list only, read again for a repair the user clicked. What is known
  // of the cloud stays as it was and the cloud is not read.
  async function refreshLocal() {
    const result = await call('refresh', { localOnly: true });
    setData(result);
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
        void taskWork(
          { kind: 'inspect', request: { item, entry }, subject: item.title + ' · ' + t(entry) },
          async () =>
            setTargetIssue({
              ...(await call('inspectTarget', { logical, entry })),
              retryId: item.id,
            }),
          'checkingEntries',
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
    try {
      await call('continue', { logicalId: id, entry });
    } catch (e: any) {
      // Shown with what this means: the app did not open and nothing changed.
      throw { ...e, native: true };
    }
    progress.clearFailure('native');
    notify({ text: t('launchRequested') + ' · ' + t(entry) });
  }
  // Opening a native app from the task panel; a failure stays in the panel.
  function openNativeTask(id: string, entry: string) {
    const title = data.rows.find((r: any) => r.id === id)?.title ?? '';
    return taskWork(
      { kind: 'native', request: { id, entry }, subject: title + ' · ' + t(entry) },
      () => openNative(id, entry),
      'openingNative',
    );
  }
  function reviewRemaining(id: string) {
    void taskWork(
      { kind: 'retryRemoval', request: { id } },
      async () => setRemoval({ plan: await call('retryRemovalPlan', { id }) }),
      'readingRemoval',
    );
  }
  // A new removal list from the same request, replacing the record that stopped.
  // The list of this computer is read first: the conversations may have gone since.
  function reviseRemoval(id: string, options: { onlyRemaining?: boolean } = {}) {
    void taskWork(
      { kind: 'retryRemoval', request: { id, revise: true } },
      async () => {
        await refreshLocal();
        setRemoval({ plan: await call('reviseRemovalPlan', { id, ...options }) });
      },
      'readingRemoval',
    );
  }
  // Gives up a removal task after saying what that means. It only forgets the record;
  // a task with work left is refused by the main process.
  async function discardRemovalJob(id: string) {
    const verdict = await call('checkRemovalClearance', { id });
    if (!verdict.clearable) {
      await localChanged();
      throw { code: verdict.reason };
    }
    const ok = await ask({
      title: t('discardRemovalJob'),
      message: t(verdict.started ? 'discardNoPendingWork' : 'discardNothingChanged'),
      detail: <p>{t('discardKeepsChats')}</p>,
      confirm: t('discardRemovalJob'),
    });
    if (!ok) return;
    try {
      await call('discardRemovalJob', { id });
      if (progress.get().removalJob?.id === id) progress.setRemovalJob(null);
      if (progress.failure('retryRemoval')?.request?.id === id)
        progress.clearFailure('retryRemoval');
      notify({ text: t('removalDiscarded') });
    } finally {
      await localChanged();
    }
  }
  const discardRemovalTask = (id: string, place = 'page') =>
    work(() => discardRemovalJob(id), 'working', place);
  // The previewed plan of a transfer that did not run is dropped with its staging
  // copy. It is awaited before the next request: both change the transfer state.
  function discardPlan(token: string) {
    return call('discardPlan', { token }).catch(() => {});
  }
  function dismissFailure(f: Failure) {
    progress.dismissFailure(f.id);
    return f.token ? discardPlan(f.token) : Promise.resolve();
  }
  // Opens the transfer dialog again with the same request and options; it checks
  // each step and previews again, stopping at the first step that needs the user.
  function reopenTransfer(request: any) {
    const { direction, ids, ...rest } = request;
    startFlow(direction, ids, { ...rest, autoPreview: true });
  }
  function reopenRemoval(request: any) {
    if (request.revise) return reviseRemoval(request.revise);
    void work(async () => {
      await refreshLocal();
      setRemoval({ ...request.initial, review: request.q });
    }, 'readingRemoval');
  }
  // The recovery buttons of a task that could not run. Each one only opens the
  // place to continue; none repeats a data operation by itself.
  function failureActions(f: Failure): { label: string; run: () => void; count?: number }[] {
    const code = f.error.code;
    const repair = errorRule(code).fix;
    const go = (label: string, run: () => void) => ({
      label,
      run: () => void dismissFailure(f).then(run),
    });
    const settings = go(FIX_LABELS.openSettings, () => setPage('settings', 'storage'));
    const apps = go('projects', () => setPage('projects'));
    const refreshList = go('refresh', () => {
      setPage('conversations');
      void work(refresh, 'refreshing');
    });
    const activity = { label: 'activity', run: () => setPage('activity') };
    const actions: { label: string; run: () => void; count?: number }[] = [];
    if (code === 'task_running') return f.started ? [activity] : [];
    if (repair === 'discardRemoval' && f.kind === 'retryRemoval') {
      const remaining = f.error.targets?.remaining?.length ?? 0;
      if (remaining > 0)
        actions.push({
          ...go('reviseRemainingTargets', () =>
            reviseRemoval(f.request.id, { onlyRemaining: true }),
          ),
          count: remaining,
        });
      actions.push({
        label: 'discardRemovalJob',
        run: () => void discardRemovalTask(f.request.id),
      });
      return actions;
    }
    if (f.kind === 'transfer') {
      if (repair === 'refreshRetry')
        actions.push(
          go('refreshAndPreview', () =>
            work(async () => {
              await refresh();
              reopenTransfer(f.request);
            }, 'refreshing'),
          ),
        );
      else if (repair === 'openSettings')
        actions.push(
          go(FIX_LABELS.openSettings, () => {
            setDeferred(f.request);
            setPage('settings', 'storage');
          }),
        );
      else if (repair === 'openApps') actions.push(apps);
      else if (repair === 'openBackups')
        actions.push(go(FIX_LABELS.openBackups, () => setPage('backups')));
      else actions.push(go('reopenReview', () => reopenTransfer(f.request)));
      if (f.started) actions.push(activity);
    } else if (f.kind === 'removal') {
      if (repair === 'openBackups')
        actions.push(go(FIX_LABELS.openBackups, () => setPage('backups')));
      else if (repair === 'openSettings' && code !== 'space_changed') actions.push(settings);
      else actions.push(go('reviewRemovalAgain', () => reopenRemoval(f.request)));
      if (f.started) actions.push(activity);
    } else if (f.kind === 'native') {
      if (repair === 'openApps') actions.push(apps);
      else if (code === 'not_verified' || repair === 'refreshRetry') actions.push(refreshList);
    } else {
      if (repair === 'openSettings') actions.push(settings);
      else if (repair === 'openApps') actions.push(apps);
      else if (repair === 'showScanIssues')
        actions.push(go(FIX_LABELS.showScanIssues, showScanIssues));
      else if (f.kind === 'retryRemoval' && code === 'stale_plan')
        actions.push(go('activity', () => setPage('activity')));
      else if (repair === 'refreshRetry') actions.push(refreshList);
      else
        actions.push(
          go('checkAgain', () =>
            f.kind === 'inspect'
              ? fix(f.request.item, f.request.entry)
              : f.request.revise
                ? reviseRemoval(f.request.id)
                : reviewRemaining(f.request.id),
          ),
        );
    }
    return actions;
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
    try {
      const moved = await call('keepLocalCopy', {
        logical: record.id,
        token: record.copyToken,
        file,
        entry: record.entry,
      });
      setTargetIssue(null);
      notify({ text: t('copyKept'), detail: moved.location });
    } finally {
      setNeedsRefresh(true);
      await localChanged();
    }
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
    localChanged,
    refreshLocal,
    localRevision,
    cloudRevision,
    refresh,
    persist,
    startFlow,
    viewCloud,
    showIssue,
    showScanIssues,
    showVersions,
    fix,
    openNative,
    openNativeTask,
    reviewRemaining,
    reviseRemoval,
    discardRemovalTask,
    taskWork,
    failureActions,
    dismissFailure,
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

// Places that currently show their own errors. A failure whose place is not on
// screen (its dialog closed, the user changed pages, or a place was never added)
// is shown at the top of the page instead, so that no failure goes unseen.
const mountedPlaces = new Map<string, number>();
let placesVersion = 0;
const placeListeners = new Set<() => void>();
function markPlace(place: string, delta: number) {
  mountedPlaces.set(place, (mountedPlaces.get(place) ?? 0) + delta);
  placesVersion++;
  for (const listener of placeListeners) listener();
}
function useShownPlaces() {
  useSyncExternalStore(
    (listener) => {
      placeListeners.add(listener);
      return () => placeListeners.delete(listener);
    },
    () => placesVersion,
  );
  return (place?: string) => !!place && (mountedPlaces.get(place) ?? 0) > 0;
}

// An error from a user action: what happened, for a native app what that means,
// and the button to continue where one exists.
function NoticeError({ notice }: { notice: Notice }) {
  const app = useApp();
  const { t } = useI18n();
  const action = errorRule(notice.code).fix;
  const button = (label: string, run: () => void) => (
    <button
      onClick={() => {
        app.notify(null);
        run();
      }}
    >
      {t(label)}
    </button>
  );
  const fixButton = notice.native
    ? action === 'openApps'
      ? button('projects', () => app.setPage('projects'))
      : notice.code === 'not_verified' || action === 'refreshRetry'
        ? button('refresh', () => {
            app.setPage('conversations');
            void app.work(app.refresh, 'refreshing');
          })
        : null
    : action === 'openSettings'
      ? button(FIX_LABELS.openSettings, () => app.setPage('settings', 'storage'))
      : action === 'openBackups'
        ? button(FIX_LABELS.openBackups, () => app.setPage('backups'))
        : action === 'openApps'
          ? button('projects', () => app.setPage('projects'))
          : action === 'showScanIssues'
            ? button(FIX_LABELS.showScanIssues, app.showScanIssues)
            : null;
  return (
    <ErrorNotice
      error={{ code: notice.code, detail: notice.detail }}
      severity={errorRule(notice.code).severity}
      note={notice.native ? t('appNotOpened') : undefined}
      action={fixButton}
      onDismiss={() => app.notify(null)}
    />
  );
}

// Errors without a closer place, and the working line of a running operation.
function PageMessages() {
  const app = useApp();
  const { t } = useI18n();
  const shown = useShownPlaces();
  const { notice, init, page, busy, phase } = app;
  return (
    <>
      {notice?.error && (notice.place === 'page' || !shown(notice.place)) && (
        <NoticeError notice={notice} />
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

// A failure from an action in this place (a card, the details panel, a dialog).
export function PlaceError({ place }: { place: string }) {
  const app = useApp();
  // Registered before paint, so the page-level fallback never shows it twice.
  useLayoutEffect(() => {
    markPlace(place, 1);
    return () => markPlace(place, -1);
  }, [place]);
  const notice = app.notice;
  if (!notice?.error || notice.place !== place || place === 'page') return null;
  return <NoticeError notice={notice} />;
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
          onLocalChange={() => void app.localChanged()}
          onClose={() => app.setFlow(null)}
          onStart={(
            p: any,
            confirmLarge: boolean,
            acceptedByItem: any,
            onlyEligible: boolean,
            resume: any,
          ) => {
            // What "Refresh and preview again" opens if the transfer cannot start.
            const { autoPreview: _auto, ...request } = { ...app.flow, resume };
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
            void app.taskWork(
              { kind: 'transfer', direction: request.direction, request, token: p.token },
              async () => {
                let started = true;
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
                } catch (e: any) {
                  progress.setJob(null);
                  started = e?.started === true;
                  throw e;
                } finally {
                  // Saved state is read again whatever happened; the list is
                  // marked out of date only when the transfer ran.
                  if (started) app.setNeedsRefresh(true);
                  await app.localChanged();
                }
              },
              'transferRunning',
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
          onRefreshLocal={app.refreshLocal}
          onRevise={(id: string) => {
            app.setRemoval(null);
            app.reviseRemoval(id);
          }}
          onRepair={(p: string) => {
            app.setRemoval(null);
            if (p === 'scan') app.showScanIssues();
            else app.setPage(p as any, p === 'settings' ? 'storage' : '');
          }}
          onExecute={(p: any, permanent: boolean, upgrade: boolean) => {
            // What "Review the removal list again" opens if the removal cannot start:
            // the same request, or a revised list for a removal that already has a record.
            const request = {
              initial: {
                ...app.removal,
                knownTitles: Object.fromEntries(
                  (p.selected ?? []).map((r: any) => [r.id, r.title]),
                ),
              },
              q: p.q,
              revise: p.previous ? p.token : p.replaces,
            };
            app.setRemoval(null);
            void app.taskWork(
              {
                kind: 'removal',
                direction: p.q.mode,
                request,
                subject: (app.removal.titles ?? p.selected?.map((r: any) => r.title))?.join(' · '),
              },
              async () => {
                try {
                  const answer = await call('executeRemoval', {
                    token: p.token,
                    permanent,
                    upgrade,
                  });
                  progress.setRemovalJob(answer, true);
                  if (answer.status === 'completed')
                    app.updateView({ selected: new Set(), focus: null });
                  app.setNeedsRefresh(true);
                } finally {
                  // A removal that touched the cloud leaves a shown cloud recycle
                  // bin out of date; it is not read again until the user refreshes.
                  await app.localChanged(p.q.scope !== 'local');
                }
              },
              'removingNow',
            );
          }}
        />
      )}
      {app.detection && (
        <DetectionPanel
          report={app.detection}
          cfg={app.cfg}
          t={t}
          repairLabel="projects"
          onRepair={() => {
            app.setDetection(null);
            app.setPage('projects');
          }}
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
