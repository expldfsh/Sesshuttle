import React, { useRef, useState } from 'react';
import { Modal } from './components/Modal';
import { call } from './hooks/useApi';

const folderOf = (file: string) =>
  /^([a-zA-Z]:)?[\\/]/.test(file) ? file.replace(/[\\/][^\\/]*$/, '') || '/' : '';

// The "Codex runtime" field of each app: choosing or typing a path writes the unsaved
// draft and checks that file. Nothing is saved and no quick check starts from here.
export function useRuntimePaths(
  binaryOf: (entry: string) => string,
  write: (entry: string, binary: string) => void,
) {
  const [inspections, setInspections] = useState<Record<string, any>>({});
  const [pickErrors, setPickErrors] = useState<Record<string, string>>({});
  const turns = useRef<Record<string, number>>({});
  const put = (entry: string, value: any) => setInspections((old) => ({ ...old, [entry]: value }));
  async function inspect(entry: string, path: string) {
    const turn = (turns.current[entry] = (turns.current[entry] ?? 0) + 1);
    if (!path) return put(entry, null);
    put(entry, { path, checking: true });
    let result: any;
    try {
      result = { path, report: await call('inspectBinary', { path }) };
    } catch (e: any) {
      result = { path, error: e.code ?? 'operation_failed' };
    }
    if (turns.current[entry] === turn) put(entry, result);
  }
  function apply(entry: string, binary: string) {
    write(entry, binary);
    void inspect(entry, binary);
  }
  async function choose(entry: string) {
    setPickErrors((old) => ({ ...old, [entry]: '' }));
    try {
      const defaultPath = folderOf(binaryOf(entry));
      const file = await call('pickBinary', { entry, ...(defaultPath && { defaultPath }) });
      if (file) apply(entry, file);
    } catch (e: any) {
      setPickErrors((old) => ({ ...old, [entry]: e.code ?? 'operation_failed' }));
    }
  }
  return {
    inspect,
    apply,
    choose,
    pickError: (entry: string) => pickErrors[entry],
    // The result for the path now in the field; a result for an older path is ignored.
    current: (entry: string, path: string) =>
      inspections[entry]?.path === path ? inspections[entry] : null,
  };
}
export type RuntimePaths = ReturnType<typeof useRuntimePaths>;

// The program that really runs, shown when it is not the file the path names.
export function ActualRuntime({ path, t }: { path?: string | null; t: (key: string) => string }) {
  if (!path) return null;
  return (
    <small className="actual-runtime">
      {t('actualRuntime')} <code>{path}</code>
    </small>
  );
}

// What is known about the path now in the field: the latest check, or for an unedited
// saved path what appStatus reported without running anything.
function BinaryState({ entry, binary, saved, paths, t }: any) {
  if (!binary) return null;
  const inspection = paths.current(entry, binary);
  if (inspection?.checking)
    return (
      <small className="binary-state muted" role="status">
        {t('binaryChecking')}
      </small>
    );
  const known = !inspection && saved?.binary === binary ? saved : null;
  const report = inspection?.report;
  const code =
    inspection?.error ??
    report?.error ??
    (known?.runtime === 'launcher'
      ? 'runtime_launcher'
      : known?.runtime === 'missing'
        ? 'binary_missing'
        : null);
  const resolved = report ? report.resolved : known?.resolved;
  const candidate = report ? report.candidate : known?.candidate;
  if (!code && !resolved && !report) return null;
  return (
    <div className="binary-state">
      {report && !report.error && (
        <small className="folder-state ok" role="status">
          {t('binaryVersion', { version: report.version })} ·{' '}
          {t(report.status === 'untested' ? 'needsCheck' : 'binaryVerified')}
        </small>
      )}
      <ActualRuntime path={resolved} t={t} />
      {code && (
        <div className="binary-problem warning-box" role="alert">
          <span>{t(code)}</span>
          <div className="actions">
            <button type="button" onClick={() => paths.choose(entry)}>
              {t('chooseRuntime')}
            </button>
            {candidate && (
              <button type="button" onClick={() => paths.apply(entry, candidate)}>
                {t('useRuntime', { path: candidate })}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

type Props = {
  target: any;
  entry: string;
  t: (key: string, vars?: Record<string, string | number>) => string;
  pick: (method: string) => Promise<string | null>;
  change: (target: any) => void;
  paths: RuntimePaths;
  // Saved state of this app: what appStatus reported for the saved path.
  saved?: any;
};
export function EntryFields({ target, entry, t, pick, change, paths, saved }: Props) {
  const [error, setError] = useState('');
  const focused = useRef('');
  async function chooseFolder() {
    setError('');
    try {
      const file = await pick('pickDirectory');
      if (file) change({ ...target, home: file });
    } catch (e: any) {
      setError(t(e.code ?? 'operation_failed'));
    }
  }
  const pickError = paths.pickError(entry);
  return (
    <div className="entry-fields">
      {(['binary', 'home'] as const).map((key) => (
        <div className="entry-field" key={key}>
          <strong>{t(key === 'binary' ? 'kernelProgram' : 'historyFolder')}</strong>
          <small>{t(key === 'binary' ? 'kernelMeaning' : 'historyMeaning')}</small>
          <span className="input-action">
            <input
              aria-label={t(entry) + ' ' + t(key === 'binary' ? 'kernelProgram' : 'historyFolder')}
              value={target?.[key] ?? ''}
              onChange={(e) => change({ ...target, [key]: e.target.value })}
              onFocus={(e) => {
                if (key === 'binary') focused.current = e.target.value;
              }}
              onBlur={(e) => {
                if (key === 'binary' && e.target.value !== focused.current)
                  void paths.inspect(entry, e.target.value);
              }}
            />
            <button
              type="button"
              onClick={() => (key === 'binary' ? paths.choose(entry) : chooseFolder())}
            >
              {t('browse')}
            </button>
          </span>
          {key === 'binary' && (
            <BinaryState entry={entry} binary={target?.binary} saved={saved} paths={paths} t={t} />
          )}
        </div>
      ))}
      {(error || pickError) && (
        <p role="alert" className="warning-box">
          {error || t(pickError!)}
        </p>
      )}
    </div>
  );
}

export function DetectionPanel({
  report,
  cfg,
  t,
  onApply,
  onRetry,
  onClose,
  inFlow = false,
  pathsReady = false,
}: any) {
  const entries = ['desktop', 'cli', 'ide'];
  function suggestions(candidates: any[]) {
    const initial: Record<string, number> = {};
    for (const entry of entries) {
      const indexes = candidates
        .map((v: any, index: number) => ({ v, index }))
        .filter(({ v }: any) => v.entry === entry && v.runtime && v.homeAvailable);
      const current = cfg.targets[entry];
      if (
        indexes.length === 1 &&
        !indexes[0].v.assumedHome &&
        !current?.binary &&
        (!current?.home || current.home === indexes[0].v.home)
      )
        initial[entry] = indexes[0].index;
    }
    return initial;
  }
  const [chosen, setChosen] = useState(() => suggestions(report.candidates));
  const [homes, setHomes] = useState<string[]>([]);
  const [applying, setApplying] = useState(false),
    [error, setError] = useState('');
  const count = Object.keys(chosen).length + homes.length;
  async function apply() {
    setApplying(true);
    const targets = { ...cfg.targets };
    const sources = new Set<string>([...cfg.sourceHomes, ...homes]);
    for (const [entry, index] of Object.entries(chosen)) {
      const candidate = report.candidates[index];
      targets[entry] = { binary: candidate.binary, home: candidate.home };
      sources.add(candidate.home);
    }
    try {
      await onApply({ ...cfg, targets, sourceHomes: [...sources] });
    } catch (e: any) {
      setError(t(e.code ?? 'operation_failed'));
    } finally {
      setApplying(false);
    }
  }
  return (
    <Modal
      title={t('detectEnvironment')}
      className="detection-panel"
      busy={applying}
      onClose={onClose}
    >
      <p>{t('detectApplyHint')}</p>
      <button
        disabled={applying}
        onClick={async () => {
          setApplying(true);
          try {
            const next = await onRetry();
            setChosen(suggestions(next.candidates));
            setHomes([]);
            setError('');
          } catch (e: any) {
            setError(t(e.code ?? 'operation_failed'));
          } finally {
            setApplying(false);
          }
        }}
      >
        {t('restartDetection')}
      </button>
      {entries.map((entry) => (
        <section className="candidate-group" key={entry}>
          <h3>{t(entry)}</h3>
          {cfg.targets[entry]?.binary && (
            <div className="saved-paths">
              <small>
                {t('savedKernelPath')} <code>{cfg.targets[entry].binary}</code>
              </small>
              <small>
                {t('savedHistoryPath')} <code>{cfg.targets[entry]?.home}</code>
              </small>
            </div>
          )}
          {entry === 'desktop' && report.launchers?.length > 0 && (
            <div>
              <small>{t('detectedLauncher')}</small>
              {report.launchers.map((file: string) => (
                <code key={file}>{file}</code>
              ))}
            </div>
          )}
          {!report.candidates.some((c: any) => c.entry === entry) && (
            <p className="warning-box">
              {t(entry === 'desktop' ? 'launchDesktopToDetect' : 'noCandidate')}
            </p>
          )}
          {report.candidates.map((c: any, i: number) => {
            if (c.entry !== entry) return null;
            const saved = cfg.targets[entry]?.binary;
            const same =
              (saved === c.binary || (!!saved && saved === c.resolvedFrom)) &&
              cfg.targets[entry]?.home === c.home;
            return (
              <label className="candidate" key={i}>
                <input
                  type="checkbox"
                  disabled={!c.runtime || !c.homeAvailable || same || applying}
                  checked={same || chosen[entry] === i}
                  onChange={(e) =>
                    setChosen((old) => {
                      const next = { ...old };
                      if (e.target.checked) next[entry] = i;
                      else delete next[entry];
                      return next;
                    })
                  }
                />
                <span>
                  <strong>
                    {t(
                      same
                        ? 'configured'
                        : cfg.targets[entry]?.binary
                          ? 'replaceSaved'
                          : 'suggested',
                    )}{' '}
                    · {t(c.evidence)}
                  </strong>
                  {c.app && (
                    <small>
                      {t('desktopApp')} <code>{c.app}</code>
                    </small>
                  )}
                  <small>
                    {t('kernelProgram')} <code>{c.binary}</code>{' '}
                    {c.runtime || t(c.error || 'binary_unavailable')}
                  </small>
                  {c.resolvedFrom && (
                    <small>
                      {t('resolvedFromLauncher')} <code>{c.resolvedFrom}</code>
                    </small>
                  )}
                  <small>
                    {t('historyFolder')} <code>{c.home}</code>{' '}
                    {t(
                      !c.homeAvailable
                        ? 'pathMissing'
                        : c.assumedHome
                          ? 'checkProposedFolder'
                          : 'pathFound',
                    )}
                  </small>
                </span>
              </label>
            );
          })}
        </section>
      ))}
      {!count && (
        <small>
          {t(inFlow ? (pathsReady ? 'reusePathsHint' : 'manualPathsHint') : 'noChangesToApply')}
        </small>
      )}
      <details>
        <summary>{t('sourceHomes')}</summary>
        {report.sourceHomes.map((x: any) => (
          <label className="check" key={x.path}>
            <input
              type="checkbox"
              disabled={!x.available || cfg.sourceHomes.includes(x.path)}
              checked={cfg.sourceHomes.includes(x.path) || homes.includes(x.path)}
              onChange={(e) =>
                setHomes(e.target.checked ? [...homes, x.path] : homes.filter((h) => h !== x.path))
              }
            />
            <code>{x.path}</code>
          </label>
        ))}
      </details>
      {error && (
        <p role="alert" className="warning-box">
          {error}
        </p>
      )}
      <div className="modal-actions">
        <button disabled={applying} className={!count ? 'primary' : ''} onClick={onClose}>
          {t(inFlow ? (pathsReady ? 'reuseAndReturn' : 'backToImportSetup') : 'returnManual')}
        </button>
        {count > 0 && (
          <button disabled={applying} className="primary" onClick={apply}>
            {t(applying ? 'applying' : inFlow ? 'saveAndReturn' : 'applySelected')} ({count})
          </button>
        )}
      </div>
    </Modal>
  );
}
