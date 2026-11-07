import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../i18n/I18n';
import { call } from '../hooks/useApi';
import { Modal } from '../components/Modal';
import { Stepper } from '../components/Stepper';
import { ErrorNotice } from '../components/ErrorNotice';
import { Icon } from '../components/Icon';
import { RuntimeCheck } from '../RuntimeCheck';
import { DetectionPanel, EntryFields } from '../Environment';
import { Select } from '../Select';
import { ENTRIES } from '../pages/rows';
import { errorRule } from '../errors';
import { ReviewStep } from './ReviewStep';
import { DirectionIcon } from './DirectionIcon';

type Step = 'apps' | 'projects' | 'options' | 'review';

// One dialog for every transfer. Importing: apps → projects and folders → review.
// Uploading: options → review. Both ways: apps → projects → options → review.
// Opening it reads saved settings only; checks, previews and cloud reads start
// when the user moves to the next step.
export function TransferDialog({
  request,
  rows,
  cfg,
  setConfig,
  refreshRows,
  onClose,
  onStart,
  onCopies,
}: any) {
  const { t, tn } = useI18n();
  const direction = request.direction,
    uploading = direction !== 'download',
    importing = direction !== 'upload' || !!request.version;
  const steps: Step[] = importing
    ? uploading
      ? ['apps', 'projects', 'options', 'review']
      : ['apps', 'projects', 'review']
    : ['options', 'review'];
  const [step, setStep] = useState<Step>(steps[0]);
  const [draft, setDraft] = useState(() => structuredClone(cfg));
  const [targets, setTargets] = useState<string[]>(request.targets ?? ['desktop']);
  const [saved, setSaved] = useState<Record<string, any>>({});
  const [info, setInfo] = useState<Record<string, any>>({});
  const [report, setReport] = useState<any>(null),
    [plan, setPlan] = useState<any>(null);
  const [pending, setPending] = useState(''),
    [error, setError] = useState<any>(null);
  const [children, setChildren] = useState(false),
    [limit, setLimit] = useState(500),
    [incomplete, setIncomplete] = useState(false);
  const [checking, setChecking] = useState(''),
    [copyResult, setCopyResult] = useState('');
  const [pathsApplied, setPathsApplied] = useState(false);
  const [replacements, setReplacements] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState('');
  const lock = useRef(false);

  const chosen = rows.filter((r: any) => request.ids.includes(r.id));
  const needed = chosen.filter((r: any) =>
    direction === 'download' ? r.remote : direction === 'upload' ? r.local : true,
  );
  const projects = [
    ...new Map<string, any>(
      needed
        .filter(
          (r: any) =>
            (!r.busy || direction === 'download') &&
            (direction !== 'download' || r.continuation !== false),
        )
        .map((r: any) => [r.projectId, r]),
    ).values(),
  ];
  const homeGroups = [
    ...new Set<string>(targets.map((e) => draft.targets[e]?.home).filter(Boolean)),
  ];
  const infoFor = (entry: string) =>
    info[entry]?.binary === draft.targets[entry]?.binary &&
    info[entry]?.home === draft.targets[entry]?.home
      ? info[entry]
      : null;
  const databases = Object.fromEntries(
    homeGroups.map((home) => {
      const group = targets.filter((e) => draft.targets[e]?.home === home).map((e) => infoFor(e));
      return [
        home,
        { projects: group[0]?.projects ?? [], supported: group.every((value) => value?.supported) },
      ];
    }),
  );
  const missingEntry = targets.find((e) => !infoFor(e) || infoFor(e).error);
  const untested = targets.filter((e) => infoFor(e)?.proof?.status === 'untested');
  const ready = targets.filter(
    (e) => infoFor(e) && !infoFor(e).error && infoFor(e).proof?.status !== 'untested',
  );
  const requiresChoice = (r: any, h: string) =>
    !Object.hasOwn(draft.nativeBindings?.[r.projectId] ?? {}, h);
  const staleChoice = projects.some((r) =>
    homeGroups.some((h) => {
      const value = draft.nativeBindings?.[r.projectId]?.[h];
      return (
        value &&
        (!databases[h]?.supported || !databases[h]?.projects?.some((p: any) => p.id === value))
      );
    }),
  );
  // Why "Next" is unavailable on the current step, shown next to the button.
  const checked = targets.every((e) => infoFor(e));
  const invalid =
    step === 'apps'
      ? !targets.length
        ? 'target_required'
        : checked && missingEntry
          ? 'resolveEntry'
          : checked && untested.length
            ? 'runtime_check_needed'
            : ''
      : step === 'projects'
        ? staleChoice
          ? 'destination_project_missing'
          : projects.some((r) => !draft.bindings[r.projectId])
            ? 'project_required'
            : projects.some((r) => homeGroups.some((h) => requiresChoice(r, h)))
              ? 'chooseDestination'
              : ''
        : step === 'options' && !(limit >= 1)
          ? 'invalid_settings'
          : '';

  async function run(label: string, fn: () => Promise<any>) {
    if (lock.current || checking) return;
    lock.current = true;
    setPending(label);
    setError(null);
    try {
      await fn();
    } catch (e: any) {
      setError(e);
    } finally {
      lock.current = false;
      setPending('');
    }
  }
  async function inspect(next = draft) {
    const result = await call('destinationInfo', { targets: next.targets });
    setInfo(result);
    return result;
  }
  async function rebuild(approved: string[] = [], paths = replacements) {
    const result = await call('preview', {
      ids: request.ids,
      copyChoice: request.copyChoice,
      direction,
      targets,
      chosenVersion: request.version ?? null,
      includeDescendants: children,
      uploadLimitMiB: limit,
      allowIncomplete: incomplete,
      approvedAttachments: approved,
      replacements: paths,
    });
    result.displayProjects = Object.fromEntries(
      projects.map((r) => [
        r.projectId,
        Object.fromEntries(
          targets.map((entry) => {
            const value = draft.nativeBindings?.[r.projectId]?.[draft.targets[entry]?.home];
            return [
              entry,
              info[entry]?.projects?.find((p: any) => p.id === value)?.name ?? t('historyOnly'),
            ];
          }),
        ),
      ]),
    );
    setPlan(result);
    setReplacements(paths);
    setStep('review');
  }
  // Saved app states only (no program runs, no data folder is read).
  useEffect(() => {
    if (importing) call('appStatus').then(setSaved, () => {});
  }, [importing]);
  const go = (next: Step) => setStep(next);
  const stepIndex = steps.indexOf(step);
  async function next() {
    if (step === 'apps') {
      const result = await inspect();
      const okay = targets.every(
        (e) => !result[e]?.error && result[e]?.proof?.status !== 'untested',
      );
      if (okay) go('projects');
    } else if (step === 'projects') {
      await setConfig(draft);
      await call('validateFolders', { projectIds: projects.map((p) => p.projectId) });
      if (uploading) go('options');
      else await rebuild();
    } else if (step === 'options') await rebuild();
  }
  async function back() {
    if (step === 'review' && plan) {
      await call('discardPlan', { token: plan.token });
      setPlan(null);
    }
    go(steps[stepIndex - 1]);
  }
  async function close() {
    if (lock.current || checking) return;
    if (plan) await call('discardPlan', { token: plan.token });
    onClose();
  }
  async function recheck(keys: string[] = plan?.selection?.approvedAttachments ?? []) {
    const result = await call('refresh');
    refreshRows(result);
    if (result.cloudError) throw result.cloudError;
    await rebuild(keys);
  }
  const stepLabels: Record<Step, string> = {
    apps: 'stepApps',
    projects: 'stepProjects',
    options: 'stepOptions',
    review: 'stepReview',
  };
  const title = (
    <span className="title-with-icon">
      <DirectionIcon direction={direction} />
      {t(
        direction === 'upload' ? 'uploadCloud' : direction === 'download' ? 'importLocal' : 'both',
      )}
    </span>
  );
  const busy = !!pending || !!checking;
  const activity = pending && (
    <div role="status" className="flow-activity">
      <progress />
      <strong>{t(pending)}</strong>
    </div>
  );
  const issue = error && (
    <ErrorNotice
      error={error}
      severity={errorRule(error.code).severity}
      action={
        request.copyChoice && error.code === 'stale_plan' ? (
          <button onClick={() => onCopies(request.ids[0])}>{t('inspectCopies')}</button>
        ) : (
          errorRule(error.code).fix === 'refreshRetry' && (
            <button disabled={busy} onClick={() => run('refreshing', () => recheck())}>
              {t('refreshAndRetry')}
            </button>
          )
        )
      }
    />
  );

  if (step === 'review' && plan)
    return (
      <ReviewStep
        key={plan.token}
        title={title}
        steps={steps.map((s) => t(stepLabels[s]))}
        current={stepIndex}
        plan={plan}
        cfg={draft}
        busy={!!pending}
        feedback={
          <>
            {activity}
            {issue}
            {plan.items
              .filter((i: any) => i.excludedReason === 'duplicate_identity')
              .map((i: any) => (
                <button
                  className="primary"
                  key={i.id}
                  onClick={() =>
                    run('checkingEntries', async () => {
                      await call('discardPlan', { token: plan.token });
                      onCopies(i.id);
                    })
                  }
                >
                  {t('inspectCopies')} · {i.title}
                </button>
              ))}
          </>
        }
        onClose={() => void close()}
        onBack={() => run('checkingEntries', back)}
        onRebuild={(keys: string[]) => run('preparingPreview', () => recheck(keys))}
        onLocate={(key: string, keys: string[]) =>
          run('preparingPreview', async () => {
            const file = await call('pickImage');
            if (file) await rebuild(keys, { ...replacements, [key]: file });
          })
        }
        onUndo={(key: string, keys: string[]) =>
          run('preparingPreview', async () => {
            const paths = { ...replacements };
            delete paths[key];
            await rebuild(keys, paths);
          })
        }
        onExecute={(large: boolean, accepted: any, onlyEligible: boolean) =>
          run('stageCheck', async () => onStart(plan, large, accepted, onlyEligible))
        }
      />
    );

  const footer = (
    <>
      {invalid && (
        <span className="next-reason" role="status">
          <Icon name="info" /> {t(invalid)}
        </span>
      )}
      <button disabled={busy} onClick={() => void close()}>
        {t('cancel')}
      </button>
      {stepIndex > 0 && (
        <button disabled={busy} onClick={() => run('checkingEntries', back)}>
          {t('previousStep')}
        </button>
      )}
      <button
        className="primary"
        disabled={busy || !!invalid || !needed.length}
        onClick={() =>
          run(
            step === 'apps'
              ? 'checkingEntries'
              : step === 'projects' && uploading
                ? 'checkingEntries'
                : 'preparingPreview',
            next,
          )
        }
      >
        {t(steps[stepIndex + 1] === 'review' ? 'reviewAction' : 'nextStep')}
      </button>
    </>
  );

  return (
    <>
      <Modal
        title={title}
        className="flow"
        size="large"
        busy={busy}
        onClose={() => void close()}
        step={step}
        footer={footer}
      >
        <Stepper steps={steps.map((s) => t(stepLabels[s]))} current={stepIndex} />
        <fieldset disabled={!!pending} className="flow-fields">
          <p className="scope-line">
            {needed.length === 1 ? needed[0].title : tn('countConversations', needed.length)}
            {chosen.length > needed.length && ` · ${needed.length} / ${chosen.length}`}
          </p>
          {chosen.length > needed.length && (
            <p className="warning-box">
              {t('skippedScope')}{' '}
              {chosen
                .filter((r: any) => !needed.includes(r))
                .map((r: any) => r.title)
                .join('、')}
            </p>
          )}
          {step === 'apps' && (
            <>
              <div className="step-head">
                <p>{t('chooseApp')}</p>
                <button
                  disabled={busy}
                  onClick={() =>
                    run('checkingEntries', async () => setReport(await call('detectPaths')))
                  }
                >
                  {t('detectEnvironment')}
                </button>
              </div>
              {pathsApplied && (
                <p className="inline-status" role="status">
                  <Icon name="check" /> {t('detectedApplied')}
                </p>
              )}
              <div className="entry-choices">
                {ENTRIES.map((entry) => {
                  const now = infoFor(entry);
                  const label = now
                    ? (now.error ??
                      (now.proof?.status === 'untested' ? 'runtimePendingShort' : 'configured'))
                    : (saved[entry]?.status ?? 'needsCheck');
                  return (
                    <label className="entry-choice" key={entry}>
                      <input
                        type="checkbox"
                        disabled={!!checking}
                        checked={targets.includes(entry)}
                        onChange={(e) =>
                          setTargets(
                            e.target.checked
                              ? [...targets, entry]
                              : targets.filter((v) => v !== entry),
                          )
                        }
                      />
                      <span>
                        <b>{t(entry)}</b>
                        <small>{t(label)}</small>
                      </span>
                    </label>
                  );
                })}
              </div>
              {targets.some((e) => info[e]?.manualOpen) && (
                <p className="warning-box">{t('launchManualHint')}</p>
              )}
              {targets.map((entry) => {
                const now = infoFor(entry);
                return (
                  <div key={entry}>
                    {now?.proof && (
                      <RuntimeCheck
                        key={draft.targets[entry].binary}
                        binary={draft.targets[entry].binary}
                        info={now.proof}
                        t={t}
                        call={call}
                        onBusy={(isBusy: boolean) => setChecking(isBusy ? entry : '')}
                        disabled={!!checking}
                        onDone={() => inspect()}
                      />
                    )}
                    {now?.projectWarning && <p className="warning-box">{t(now.projectWarning)}</p>}
                    {now && !now.error && editing !== entry && (
                      <button
                        className="text-button"
                        disabled={!!checking}
                        onClick={() => setEditing(entry)}
                      >
                        {t('editPaths')} · {t(entry)}
                      </button>
                    )}
                    {(now?.error ||
                      editing === entry ||
                      (!now &&
                        saved[entry] &&
                        saved[entry].status !== 'appReady' &&
                        saved[entry].status !== 'needsCheck')) && (
                      <div className="setup-repair">
                        <strong>
                          {t(entry)} · {t(now?.error ?? saved[entry]?.status ?? 'needsCheck')}
                        </strong>
                        <EntryFields
                          t={t}
                          entry={entry}
                          target={draft.targets[entry]}
                          pick={call}
                          change={(v) =>
                            setDraft({ ...draft, targets: { ...draft.targets, [entry]: v } })
                          }
                        />
                        <button
                          disabled={busy}
                          onClick={() =>
                            run('checkingEntries', async () => {
                              await inspect();
                              setEditing('');
                            })
                          }
                        >
                          {t('checkAgain')}
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
              {(missingEntry || untested.length > 0) && checked && ready.length > 0 && (
                <button disabled={!!checking} onClick={() => setTargets(ready)}>
                  {t('useReadyEntries')} · {ready.map((e) => t(e)).join(' + ')}
                </button>
              )}
              {(request.offerCopy || (checked && (missingEntry || untested.length > 0))) &&
                needed
                  .filter((r: any) => r.remote && (request.version || r.tips?.length === 1))
                  .map((r: any) => (
                    <button
                      key={r.id}
                      disabled={!!checking}
                      onClick={() =>
                        run('stageDownload', async () => {
                          const folder = await call('downloadCopy', {
                            logical: r.id,
                            version: request.version ?? r.tips[0],
                          });
                          if (folder) setCopyResult(folder);
                        })
                      }
                    >
                      <Icon name="download" /> {t('downloadFolderOnly')} · {r.title}
                    </button>
                  ))}
              {copyResult && (
                <p role="status" className="inline-status">
                  <Icon name="check" /> {t('savedCopyAt')} <code>{copyResult}</code>
                </p>
              )}
            </>
          )}
          {step === 'projects' && (
            <>
              <p>{t('userHandoff')}</p>
              {projects.map((r) => (
                <ProjectChoice
                  key={r.projectId}
                  row={r}
                  homeGroups={homeGroups}
                  targets={targets}
                  draft={draft}
                  databases={databases}
                  setDraft={setDraft}
                  run={run}
                />
              ))}
            </>
          )}
          {step === 'options' && (
            <section className="setup-project">
              <label className="check">
                <input
                  type="checkbox"
                  checked={children}
                  onChange={(e) => setChildren(e.target.checked)}
                />
                {t('includeDescendants')}
              </label>
              <label className="field">
                <span>{t('uploadLimit')}</span>
                <input
                  type="number"
                  min="1"
                  value={limit}
                  onChange={(e) => setLimit(Number(e.target.value))}
                />
              </label>
              {direction === 'upload' && (
                <label className="check">
                  <input
                    type="checkbox"
                    checked={incomplete}
                    onChange={(e) => setIncomplete(e.target.checked)}
                  />
                  {t('incomplete')}
                </label>
              )}
            </section>
          )}
          {activity}
          {issue}
        </fieldset>
      </Modal>
      {report && (
        <DetectionPanel
          inFlow
          pathsReady={!!targets.length && !missingEntry}
          report={report}
          cfg={draft}
          t={t}
          onRetry={async () => {
            const result = await call('detectPaths');
            setReport(result);
            return result;
          }}
          onClose={() => setReport(null)}
          onApply={async (next: any) => {
            await setConfig(next);
            setDraft(next);
            await inspect(next);
            setPathsApplied(true);
            setReport(null);
          }}
        />
      )}
    </>
  );
}

// Destination project per Codex data folder and the project folder for one source project.
function ProjectChoice({ row: r, homeGroups, targets, draft, databases, setDraft, run }: any) {
  const { t } = useI18n();
  const setBinding = (folder: string) =>
    setDraft((old: any) => ({ ...old, bindings: { ...old.bindings, [r.projectId]: folder } }));
  function selectProject(home: string, id: string) {
    const project = databases[home]?.projects?.find((p: any) => p.id === id);
    setDraft((old: any) => ({
      ...old,
      nativeBindings: {
        ...old.nativeBindings,
        [r.projectId]: { ...old.nativeBindings?.[r.projectId], [home]: id },
      },
      bindings: {
        ...old.bindings,
        [r.projectId]:
          project?.folders?.length === 1 ? project.folders[0] : (old.bindings[r.projectId] ?? ''),
      },
    }));
  }
  return (
    <section className="setup-project">
      <strong>
        <Icon name="folder" /> {t('originProject')} · {r.originProject?.name || r.project}
      </strong>
      {homeGroups.map((home: string) => {
        const catalog = databases[home],
          value = draft.nativeBindings?.[r.projectId]?.[home],
          selectable = catalog?.supported ? catalog.projects : [];
        const proposed = selectable.filter((p: any) => p.name === r.originProject?.name);
        return (
          <div key={home}>
            <small>
              {targets
                .filter((e: string) => draft.targets[e]?.home === home)
                .map((e: string) => t(e))
                .join(' + ')}
            </small>
            <Select
              label={t('destinationProject')}
              value={value === undefined ? '__choose__' : value || '__history__'}
              onChange={(id) => {
                if (id !== '__choose__') selectProject(home, id === '__history__' ? '' : id);
              }}
              options={[
                { value: '__choose__', label: t('chooseDestination') },
                ...selectable.map((p: any) => ({
                  value: p.id,
                  label: p.name + (p.roots[0] ? ' · ' + p.roots[0] : ' · ' + p.id.slice(0, 8)),
                })),
                { value: '__history__', label: t('historyOnly') },
              ]}
            />
            {proposed.length === 1 && value === undefined && (
              <button className="text-button" onClick={() => selectProject(home, proposed[0].id)}>
                {t('chooseMatching')} {proposed[0].name}
              </button>
            )}
            {value !== '' &&
              (!selectable.length || (value && !selectable.some((p: any) => p.id === value))) && (
                <button onClick={() => selectProject(home, '')}>{t('chooseHistoryOnly')}</button>
              )}
            {(!selectable.length || value === '') && <small>{t('historyOnlyHint')}</small>}
            {value && (
              <small>
                {t('selectedDestination')}{' '}
                {selectable.find((p: any) => p.id === value)?.name ??
                  t('destination_project_missing')}
              </small>
            )}
          </div>
        );
      })}
      <label className="field">
        <span>{t('projectPath')}</span>
        <input
          value={draft.bindings[r.projectId] ?? ''}
          placeholder={t('workingFolderHint')}
          onChange={(e) => setBinding(e.target.value)}
        />
      </label>
      <div className="actions">
        <button
          onClick={() =>
            run('chooseFolder', async () => {
              const dir = await call('pickDirectory');
              if (dir) setBinding(dir);
            })
          }
        >
          <Icon name="folder" /> {t('bind')}
        </button>
        <button
          onClick={() =>
            run('chooseFolder', async () =>
              setBinding(await call('createWorkspace', { projectId: r.projectId })),
            )
          }
        >
          {t('createWorkingFolder')}
        </button>
      </div>
    </section>
  );
}
