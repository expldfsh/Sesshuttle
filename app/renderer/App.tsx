import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { I18nProvider, makeI18n, translate, useI18n, type Locale } from './i18n/I18n';
import { call, useWork, type ApiError } from './hooks/useApi';
import { useNotice, type Notice } from './hooks/useNotice';
import { useConfirm, type Question } from './hooks/useConfirm';
import { progress } from './store/progress';
import { applyTheme } from './theme';
import { Select } from './Select';
import { Modal } from './components/Modal';
import { Toasts } from './components/Toast';
import { emptyConnection } from './ConnectionForm';
import { TransferFlow } from './TransferFlow';
import { RemovalFlow } from './RemovalFlow';
import { DetectionPanel } from './Environment';
import { TaskPanel } from './TaskPanel';
import { ConversationsPage } from './pages/ConversationsPage';
import { ProjectsPage } from './pages/ProjectsPage';
import { SettingsPage } from './pages/SettingsPage';
import { BackupsPage } from './pages/BackupsPage';
import { ActivityPage } from './pages/ActivityPage';

export type Page = 'conversations' | 'projects' | 'activity' | 'backups' | 'settings';
export const PAGES: Page[] = ['conversations', 'projects', 'activity', 'backups', 'settings'];

// The conversation list view survives switching pages.
export type ConversationView = {
  filter: string;
  status: string;
  query: string;
  projectFilter: string;
  selected: Set<string>;
  focus: string | null;
};
const initialView: ConversationView = {
  filter: 'main',
  status: 'all',
  query: '',
  projectFilter: 'all',
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
    [page, setPage] = useState<Page>('conversations'),
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
  const locale: Locale = cfg?.language ?? 'zh-CN';
  const i18n = useMemo(() => makeI18n(locale), [locale]);
  const { t } = i18n;
  const { notice, setNotice, clearNotice } = useNotice();
  const { question, ask, answer } = useConfirm();
  const onError = useCallback(
    (e: ApiError) =>
      setNotice({
        error: true,
        code: e.code,
        text: t(e.code ?? 'operation_failed'),
        detail: e.detail,
      }),
    [setNotice, t],
  );
  const { busy, phase, setPhase, work } = useWork(clearNotice, onError);
  const notify = useCallback((n: Notice | null) => setNotice(n), [setNotice]);
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
      if (pending) progress.setRemovalJob(pending);
    }
    if (x.connection)
      setConnection((c: any) => (c.recoveryToken ? c : { ...c, ...x.connection, mode: 'join' }));
    return x;
  }
  async function refresh() {
    setData(await call('refresh'));
    setNeedsRefresh(false);
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
      setPage('settings');
      setNotice({ text: t('connectThenReturn') });
      return;
    }
    setNotice(null);
    setFlow(request);
  }
  function viewCloud() {
    setPage('conversations');
    updateView({ filter: 'cloud', status: 'all', projectFilter: 'all', query: '', focus: null });
    void work(refresh, 'refreshing');
  }
  function showIssue(logical: string) {
    setPage('conversations');
    updateView({ filter: 'all', status: 'all', projectFilter: 'all', query: '', focus: logical });
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
    );
  }
  // The repair for a failed task or app: it opens the place to fix it, never retries by itself.
  function fix(item: any, entry?: string) {
    const e = entry ? item.targets?.[entry]?.error?.code : item.error?.code;
    if (entry && ['scan_incomplete', 'duplicate_identity'].includes(e)) {
      const logical =
        e === 'duplicate_identity' ? item.targets[entry].error.detail || item.id : item.id;
      void work(
        async () =>
          setTargetIssue({
            ...(await call('inspectTarget', { logical, entry })),
            retryId: item.id,
          }),
        'checkingEntries',
      );
      return;
    }
    if (e === 'duplicate_identity') {
      showIssue(item.targets?.[entry ?? '']?.error?.detail || item.error?.detail || item.id);
      return;
    }
    if (e === 'scan_incomplete') return showScanIssues();
    if (
      [
        'storage_permission',
        'storage_write_permission',
        'storage_not_connected',
        'decrypt_failed',
      ].includes(e)
    ) {
      setDeferred({
        direction: entry
          ? 'download'
          : (item.requestedDirection ?? (item.action === 'upload' ? 'upload' : 'download')),
        ids: [item.id],
        ...(entry ? { targets: [entry] } : {}),
      });
      setPage('settings');
      return;
    }
    if (e === 'conflict' || item.status === 'conflict' || item.status === 'conflict_preserved')
      return showVersions(item.id);
    if (['import_needs_recovery', 'recovery_required', 'trash_recovery_required'].includes(e)) {
      setPage('backups');
      return;
    }
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
      entry ? { targets: [entry], offerCopy: e === 'native_provider_missing' } : {},
    );
  }
  async function openNative(id: string, entry: string) {
    const value = data.rows.find((r: any) => r.id === id)?.targets?.[entry];
    if (!value) return;
    if (!(await ask(t('nativeConfirm') + '\n' + value.project))) return;
    await call('continue', { logicalId: id, entry });
    setNotice({ text: t('launchRequested') + ' · ' + t(entry) });
  }
  function reviewRemaining(id: string) {
    void work(
      async () => setRemoval({ plan: await call('retryRemovalPlan', { id }) }),
      'readingRemoval',
    );
  }
  async function keepCopy(record: any, file: string) {
    const others = record.copies.filter((c: any) => c.file !== file).map((c: any) => c.file);
    if (
      !(await ask(
        t('keepCopyConfirm') + '\n' + file + '\n\n' + t('copiesMoved') + '\n' + others.join('\n'),
      ))
    )
      return;
    const moved = await call('keepLocalCopy', {
      logical: record.id,
      token: record.copyToken,
      file,
      entry: record.entry,
    });
    setNeedsRefresh(true);
    setTargetIssue(null);
    setNotice({ text: t('copyKept'), detail: moved.location });
  }

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
  };
}

function TopBar() {
  const app = useApp();
  const { t, locale } = useI18n();
  const { init, cfg, page, busy, work } = app;
  const dirty =
    JSON.stringify(cfg) !== JSON.stringify(init?.config) || app.deviceName !== init?.device?.name;
  return (
    <header className="topbar">
      <h1>{t(page)}</h1>
      <div className="top-right">
        {init?.testMode && <span className="badge tone-warning">{t('testMode')}</span>}
        <span className={`connection-state ${init?.connected ? 'on' : ''}`}>
          {t(init?.connected ? 'connected' : 'offline')}
        </span>
        <Select
          label={t('language')}
          value={locale}
          options={[
            { value: 'zh-CN', label: '简体中文' },
            { value: 'en', label: 'English' },
          ]}
          onChange={(language) =>
            work(async () => {
              await call('saveConfig', { ...init.config, language });
              app.setInit({ ...init, config: { ...init.config, language } });
              app.setCfg({ ...cfg, language });
              app.notify({ text: translate(language as Locale, 'languageSaved') });
            }, 'applying')
          }
        />
        {page === 'conversations' ? (
          <button
            disabled={busy}
            onClick={() =>
              work(async () => {
                const result = await call('refresh');
                app.setData(result);
                app.setNeedsRefresh(false);
                app.notify({
                  error: !!result.cloudError,
                  text: t(result.cloudError ? 'cloudStale' : 'refreshDone'),
                });
              }, 'refreshing')
            }
          >
            {t('refresh')}
          </button>
        ) : page === 'projects' || page === 'settings' ? (
          <button
            className="primary"
            disabled={busy || !dirty}
            onClick={() =>
              work(async () => {
                await app.persist(cfg);
                app.notify({ text: t('saved') });
              }, 'applying')
            }
          >
            {t(dirty ? 'save' : 'savedShort')}
          </button>
        ) : null}
      </div>
    </header>
  );
}

function Sidebar() {
  const { page, setPage, deviceName, init } = useApp();
  const { t } = useI18n();
  return (
    <aside className="sidebar">
      <div className="brand">sesshuttle</div>
      <nav>
        {PAGES.map((name) => (
          <button
            key={name}
            className={page === name ? 'active' : ''}
            onClick={() => setPage(name)}
          >
            {t(name)}
          </button>
        ))}
      </nav>
      <div className="sidebar-bottom">
        <strong>{deviceName}</strong>
        <span className="version">v{init?.version}</span>
      </div>
    </aside>
  );
}

function GlobalNotices() {
  const app = useApp();
  const { t } = useI18n();
  const { notice, init, page, busy, phase } = app;
  return (
    <>
      {notice && (
        <div role="alert" className={`notice ${notice.error ? 'error' : ''}`}>
          <span>
            {notice.text}
            {notice.detail && <small>{notice.detail}</small>}
          </span>
          <button
            className="notice-dismiss"
            aria-label={t('close')}
            onClick={() => app.notify(null)}
          >
            ×
          </button>
        </div>
      )}
      {init?.credentialError && page !== 'settings' && (
        <div className="credential-strip">
          <strong>{t(init.connected ? 'spaceJoined' : 'signInAgain')}</strong>{' '}
          {t(
            init.connected
              ? init.credentialError === 'credential_save_pending'
                ? 'credential_save_pending'
                : 'onlyThisSession'
              : init.canRestore
                ? init.credentialError
                : 'reconnectAfterSession',
          )}{' '}
          <button onClick={() => app.setPage('settings')}>
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

// Dialogs that any page or task can open.
function GlobalDialogs() {
  const app = useApp();
  const { t, tn, date, size } = useI18n();
  const { busy, work } = app;
  return (
    <>
      {app.flow && (
        <TransferFlow
          onCopies={(id: string) => {
            app.setFlow(null);
            app.showIssue(id);
          }}
          request={app.flow}
          rows={app.data.rows}
          cfg={app.cfg}
          setConfig={app.persist}
          call={call}
          refreshRows={app.setData}
          t={t}
          size={size}
          onClose={() => app.setFlow(null)}
          onStart={(p: any, confirmLarge: boolean, acceptedByItem: any, onlyEligible: boolean) => {
            app.setFlow(null);
            progress.setRemovalJob(null);
            progress.setJob({
              id: p.token,
              status: 'running',
              total: p.items.length,
              items: [],
              progress: {
                stage: 'stageCheck',
                index: 1,
                total: p.items.length,
                title: p.items[0]?.title,
              },
            });
            void work(async () => {
              try {
                progress.setJob(
                  await call('execute', {
                    token: p.token,
                    confirmLarge,
                    acceptedByItem,
                    onlyEligible,
                  }),
                );
              } catch (e) {
                progress.setJob(null);
                throw e;
              }
              await app.reloadInit();
              app.setNeedsRefresh(true);
            }, 'transferRunning');
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
            else app.setPage(p as any);
          }}
          onExecute={(p: any, permanent: boolean, upgrade: boolean) => {
            app.setRemoval(null);
            void work(async () => {
              const answer = await call('executeRemoval', { token: p.token, permanent, upgrade });
              progress.setRemovalJob(answer);
              if (answer.status === 'completed')
                app.updateView({ selected: new Set(), focus: null });
              await app.reloadInit();
              app.setNeedsRefresh(true);
            }, 'removingNow');
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
                    onClick={() => work(() => app.keepCopy(app.targetIssue, c.file), 'stageBackup')}
                  >
                    {t('keepThisCopy')}
                  </button>
                )}
              </div>
            ))}
          {app.notice?.error && (
            <p role="alert">
              {app.notice.text} {app.notice.detail}
            </p>
          )}
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
        <Modal title={t('diagnostics')} onClose={() => app.setDiagnostic(null)}>
          <p>{t('diagnosticHint')}</p>
          <pre>{JSON.stringify(app.diagnostic, null, 2)}</pre>
        </Modal>
      )}
    </>
  );
}

export function App() {
  const app = useAppState();
  const { t } = app.i18n;
  const { cfg, notice, page, work } = app;
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
            <button
              onClick={() =>
                work(async () => {
                  await app.reloadInit();
                  await app.refresh();
                }, 'refreshing')
              }
            >
              {t('checkAgain')}
            </button>
          )}
        </div>
      </I18nProvider>
    );
  return (
    <I18nProvider locale={app.i18n.locale}>
      <AppContext.Provider value={app}>
        <div className="shell">
          <Sidebar />
          <main>
            <TopBar />
            <div className="content">
              <GlobalNotices />
              {page === 'conversations' && <ConversationsPage />}
              {page === 'settings' && <SettingsPage />}
              {page === 'projects' && <ProjectsPage />}
              {page === 'backups' && <BackupsPage />}
              {page === 'activity' && <ActivityPage />}
              <TaskPanel />
            </div>
          </main>
          <GlobalDialogs />
          <Toasts />
        </div>
      </AppContext.Provider>
    </I18nProvider>
  );
}
