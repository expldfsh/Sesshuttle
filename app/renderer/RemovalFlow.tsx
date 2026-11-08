import { Icon } from './components/Icon';
import { useEffect, useRef, useState } from 'react';
import { Modal } from './components/Modal';
import { useI18n } from './i18n/I18n';
import { ErrorNotice } from './components/ErrorNotice';
import { errorRule, fixLabel, type FixAction } from './errors';
import { removalNotStarted } from './failures';

const dateLabel = (v: string | undefined, locale: string) =>
  v ? new Date(v).toLocaleString(locale) : '—';
const scopes = ['local', 'cloud', 'both'];
// Repairs that leave the dialog for another place.
const REPAIR_PLACE: Partial<Record<FixAction, string>> = {
  openSettings: 'settings',
  openBackups: 'backups',
  showScanIssues: 'scan',
  openApps: 'projects',
  inspectCopies: 'conversations',
  compareVersions: 'conversations',
};
const scopeHint = (s: string) =>
  ({ local: 'removeHereHint', cloud: 'removeCloudHint', both: 'removeBothHint' })[s] ?? s;
const scopeKey = (s: string) =>
  ({ local: 'removeHere', cloud: 'removeCloud', both: 'removeBoth' })[s] ?? s;
const modeKey = (s: string) =>
  ({ trash: 'toBin', purge: 'permanentDelete', restore: 'restoreCopy' })[s] ?? s;

function ConfirmationLabel({ t, mode, local, cloud }: any) {
  const { tn } = useI18n();
  const destinations = [
    local > 0 ? t('thisDevice') + ' ' + tn('countConversations', local) : '',
    cloud > 0 ? t('cloud') + ' ' + tn('countBackupVersions', cloud) : '',
  ].filter(Boolean);
  return (
    <>
      {t(modeKey(mode))} · {destinations.join(' + ')}
    </>
  );
}
// Radio choices drawn as cards, each with one line on what it changes.
function ChoiceCards({
  legend,
  name,
  value,
  options,
  disabled,
  danger,
  onChange,
}: {
  legend: string;
  name: string;
  value: string;
  options: { value: string; label: string; hint: string; available: boolean }[];
  disabled: boolean;
  danger?: string;
  onChange: (value: string) => void;
}) {
  return (
    <fieldset className="choice-cards">
      <legend>{legend}</legend>
      {options.map((o) => (
        <label
          key={o.value}
          className={
            'choice-card' +
            (value === o.value ? ' chosen' : '') +
            (danger === o.value ? ' danger' : '') +
            (o.available ? '' : ' unavailable')
          }
        >
          <input
            type="radio"
            name={name}
            checked={value === o.value}
            disabled={disabled || !o.available}
            onChange={() => onChange(o.value)}
          />
          <span>
            <b>{o.label}</b>
            <small>{o.hint}</small>
          </span>
        </label>
      ))}
    </fieldset>
  );
}
function CopyList({ items, t, locale }: any) {
  return (
    <details className="removal-copies">
      <summary>
        {t('keptCopies')} ({items.length})
      </summary>
      {!items.length && <p>{t('noKnownCopies')}</p>}
      <ul>
        {items.map((c: any, i: number) => (
          <li key={i}>
            <b>{t(c.place)}</b> · {c.title ?? c.home} {c.at && ' · ' + dateLabel(c.at, locale)}{' '}
            <code>{c.id?.slice(0, 12)}</code>
            {c.place === 'wholeBackup' && <small>{t('wholeBackupHint')}</small>}
            {c.members?.length > 0 && <small>{c.members.join(' · ')}</small>}
          </li>
        ))}
      </ul>
    </details>
  );
}

// The conversations a removal could not find, and what can be done about it. `discard`
// is set where the task has a record that can be given up.
export function MissingTargets({ targets, discard = false }: any) {
  const { t } = useI18n();
  const names = (place: string) =>
    targets.missing
      .filter((m: any) => m.place === place)
      .map((m: any) => m.title)
      .join(' · ');
  return (
    <span className="missing-targets">
      {names('local') && (
        <span>
          <b>{t('targetsGoneLocal')}</b> {names('local')}
        </span>
      )}
      {names('cloud') && (
        <span>
          <b>{t('targetsGoneCloud')}</b> {names('cloud')}
        </span>
      )}
      {discard && (
        <span>
          {t(targets.remaining.length ? 'removalTargetsSomeGone' : 'removalTargetsAllGone')}
        </span>
      )}
    </span>
  );
}

export function RemovalFlow({
  initial,
  call,
  t,
  size,
  locale,
  connected,
  onClose,
  onExecute,
  onRepair,
  onRevise,
  onRefreshLocal,
}: any) {
  const { tn } = useI18n();
  const [q, setQ] = useState<any>(
    () =>
      initial.review ??
      initial.plan?.q ?? {
        ids: initial.ids,
        scope: initial.scope ?? (initial.hasLocal ? 'local' : 'cloud'),
        mode: initial.mode ?? 'trash',
        kind: initial.binId ? 'bin' : 'live',
        binId: initial.binId,
        includeDependents: false,
      },
  );
  const [plan, setPlan] = useState<any>(initial.plan ?? null),
    [versions, setVersions] = useState<Record<string, string[]>>({});
  const [pending, setPending] = useState(false),
    [error, setError] = useState<any>(null),
    [permanent, setPermanent] = useState(false),
    [upgrade, setUpgrade] = useState(false);
  const lock = useRef(false);
  const refresh = async (request: any, readLocal = false) => {
    if (lock.current) return;
    lock.current = true;
    setPending(true);
    setError(null);
    setPermanent(false);
    setUpgrade(false);
    try {
      if (readLocal) await onRefreshLocal();
      const next = await call('reviewRemoval', { ...request, titles: initial.knownTitles });
      setQ(next.q);
      setPlan(next);
      setVersions({});
    } catch (e) {
      setError(e);
    } finally {
      lock.current = false;
      setPending(false);
    }
  };
  const reset = () => {
    setPlan(null);
    setVersions({});
    setPermanent(false);
    setUpgrade(false);
    setError(null);
  };
  // A removal reopened after it could not start lists the same request again.
  useEffect(() => {
    if (initial.review) void refresh(initial.review);
    // Once, when the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const previous = plan?.previous;
  const done = (side: string, home?: string) =>
    previous?.sides.some(
      (s: any) => s.side === side && (!home || s.home === home) && s.status === 'done',
    );
  const groups = (plan?.local ?? []).filter((g: any) => !done('local', g.home));
  const totalLocal = new Set(groups.flatMap((g: any) => g.ids)).size;
  const totalCloud = done('cloud') ? 0 : (plan?.cloud?.count ?? 0);
  const noWork = !!plan && !totalLocal && !totalCloud;
  const changed = Object.keys(versions).length > 0;
  const blocked = groups.some((g: any) => g.blockers.length);
  const needUpgrade = totalCloud > 0 && plan?.cloud?.upgrade && !previous?.upgradeAccepted;
  const needPermanent = q.mode === 'purge';
  const canRun =
    !pending &&
    !changed &&
    !blocked &&
    !noWork &&
    (!needPermanent || permanent) &&
    (!needUpgrade || upgrade);
  function toggleVersion(row: any, version: string, checked: boolean) {
    const original = row.versions.filter((v: any) => v.selected).map((v: any) => v.id);
    const current = versions[row.id] ?? original;
    const next = {
      ...versions,
      [row.id]: checked
        ? [...new Set([...current, version])]
        : current.filter((v: string) => v !== version),
    };
    setVersions(next);
    void refresh({ ...q, versions: { ...q.versions, ...next } });
  }
  const scopeAvailable = (s: string) =>
    s === 'local'
      ? initial.hasLocal
      : s === 'cloud'
        ? connected && initial.hasCloud
        : connected && initial.hasLocal && initial.hasCloud;
  const wrongVersion = ['stale_plan', 'invalid_selection'].includes(previous?.error?.code);
  const remainingTargets: string[] = error?.targets?.remaining ?? [];
  const repair: FixAction | undefined = error ? errorRule(error.code).fix : undefined;
  const warning = (
    <div className="other-device-note">
      <b>{t('otherDevices')}</b>{' '}
      {t(
        q.scope === 'local'
          ? 'otherNoChange'
          : q.mode === 'restore'
            ? 'remoteRestoreHint'
            : q.kind === 'bin'
              ? 'otherBinImpact'
              : 'otherCloudImpact',
      )}
    </div>
  );
  const footer = (
    <>
      <button disabled={pending} onClick={onClose}>
        {t('cancel')}
      </button>
      {!plan ? (
        <button className="primary" disabled={pending} onClick={() => refresh(q)}>
          {t('showRemovalList')}
        </button>
      ) : (
        <>
          {!previous && (
            <button disabled={pending} onClick={reset}>
              {t('changeDeleteOptions')}
            </button>
          )}
          {previous && wrongVersion && (
            <button disabled={pending} onClick={() => onRevise(plan.token)}>
              {t('reviewChangedRemoval')}
            </button>
          )}
          {changed ? (
            <button
              className="primary"
              disabled={pending}
              onClick={() => refresh({ ...q, versions: { ...q.versions, ...versions } })}
            >
              {t('recomputeRemoval')}
            </button>
          ) : (
            <button
              className={q.mode === 'purge' ? 'danger-action' : 'primary'}
              disabled={!canRun}
              onClick={() => onExecute(plan, permanent, upgrade)}
            >
              <ConfirmationLabel t={t} mode={q.mode} local={totalLocal} cloud={totalCloud} />
            </button>
          )}
        </>
      )}
    </>
  );
  return (
    <Modal
      className="removal-dialog"
      size="large"
      title={t(plan ? 'reviewRemoval' : q.kind === 'bin' ? 'manageBinCopy' : 'removeChats')}
      busy={pending}
      onClose={onClose}
      step={plan ? 'review' : 'options'}
      footer={footer}
    >
      {!plan ? (
        <>
          <p>{initial.titles?.join(' · ')}</p>
          {q.kind === 'live' ? (
            <>
              <ChoiceCards
                legend={'1. ' + t('deleteWhere')}
                name="place"
                value={q.scope}
                disabled={pending}
                options={scopes.map((s) => ({
                  value: s,
                  label: t(scopeKey(s)),
                  hint: t(scopeHint(s)),
                  available: scopeAvailable(s),
                }))}
                onChange={(scope) => setQ({ ...q, scope })}
              />
              {(!initial.hasLocal || !initial.hasCloud || !connected) && (
                <p className="muted">
                  {t(
                    !connected
                      ? 'deleteOffline'
                      : !initial.hasLocal
                        ? 'cloudOnlyRemoval'
                        : 'localOnlyRemoval',
                  )}
                </p>
              )}
              <ChoiceCards
                legend={'2. ' + t('deleteHow')}
                name="method"
                value={q.mode}
                disabled={pending}
                danger="purge"
                options={['trash', 'purge'].map((m) => ({
                  value: m,
                  label: t(modeKey(m)),
                  hint: t(m === 'trash' ? 'binPolicy' : 'permanentPolicy'),
                  available: true,
                }))}
                onChange={(mode) => setQ({ ...q, mode })}
              />
            </>
          ) : (
            <p>
              <b>
                {t(scopeKey(q.scope))} · {t(modeKey(q.mode))}
              </b>
              <small>{t('onlyBinCopy')}</small>
            </p>
          )}
          {warning}
        </>
      ) : (
        <>
          <p className="preview-state">
            {t(scopeKey(q.scope))} · {t(modeKey(q.mode))} · {t('removalPreviewOnly')}
          </p>
          {previous && (
            <div className="warning-box">
              {t('retryOnlyRemaining')}
              {previous.sides
                .filter((s: any) => s.status === 'done')
                .map((s: any) => (
                  <small key={s.home ?? s.side}>
                    {t('sideDone')} · {s.home ?? t('cloud')}
                  </small>
                ))}
            </div>
          )}
          {warning}
          {!!plan.selected.length && (
            <details>
              <summary>
                {t('directSelections')} ({plan.selected.length})
              </summary>
              <ul>
                {plan.selected.map((r: any) => (
                  <li key={r.id}>
                    {r.title} · {r.project} ·{' '}
                    {t(r.local ? (r.remote ? 'bothCopies' : 'thisDevice') : 'cloud')}
                    {(q.scope === 'local' && !r.local) || (q.scope === 'cloud' && !r.remote)
                      ? ' · ' + t('outsideRemoval')
                      : ''}
                  </li>
                ))}
              </ul>
            </details>
          )}
          {groups.map((g: any) => (
            <section key={g.home} className="removal-section">
              <h3>
                {t('thisDevice')} · {plan.device}
              </h3>
              {g.binPath && (
                <div>
                  <b>{t('binStorageFolder')}</b>
                  <code>{g.binPath}</code>
                  <small>{t('nativeHistoryLocation')}</small>
                </div>
              )}
              <code>{g.home}</code>
              {g.entries?.length > 0 && (
                <p>
                  {t('sharingEntries')} {g.entries.map(t).join(' + ')}
                </p>
              )}
              {q.kind === 'bin' && <p>{t('onlyBinCopy')}</p>}
              {(q.kind === 'live' || q.mode === 'restore') && <p>{t('closeBeforeLocal')}</p>}
              {g.rows.length > new Set(g.rows.map((r: any) => r.id)).size && (
                <p className="warning-box">{t('allCopiesRemoval')}</p>
              )}
              <ul>
                {g.rows.map((r: any, index: number) => (
                  <li key={index}>
                    <b>{r.title}</b> ·{' '}
                    {t(r.kind === 'background' ? 'backgroundChats' : 'mainChats')} ·{' '}
                    {r.originProject?.name ?? '—'}
                    {r.indexOnly && <small>{t('indexOnlyRemoval')}</small>}
                  </li>
                ))}
              </ul>
              <p>
                {t('listedFilesSize')} <b>{size(g.bytes)}</b> ·{' '}
                {t(
                  q.mode === 'trash'
                    ? 'binUsesSpace'
                    : q.mode === 'purge'
                      ? 'fileBytesHint'
                      : 'restoreCopy',
                )}
              </p>
              {!!g.blockers.length && (
                <div className="warning-box">
                  <b>{t('trash_dependencies')}</b>
                  <ul>
                    {g.blockers.map((b: any) => (
                      <li key={b.id}>{b.title}</li>
                    ))}
                  </ul>
                  <button
                    disabled={pending || !!previous}
                    onClick={() => refresh({ ...q, includeDependents: true })}
                  >
                    {t('includeAndReview')}
                  </button>
                </div>
              )}
              <details>
                <summary>
                  {t('historyFiles')} ({g.files.filter((f: any) => f.kind === 'history').length})
                </summary>
                {g.files
                  .filter((f: any) => f.kind === 'history')
                  .map((f: any) => (
                    <div key={f.path}>
                      <code>
                        {g.binPath && q.mode === 'purge' ? g.binPath + '/' + f.saved : f.path}
                      </code>
                      <small>
                        {size(f.bytes)}
                        {g.binPath && q.mode === 'purge'
                          ? ' · ' + t('originalLocation') + ' ' + f.path
                          : ''}
                      </small>
                    </div>
                  ))}
              </details>
              <details open={g.assets.length > 0}>
                <summary>
                  {t('attachments')} ({g.assets.length})
                </summary>
                {g.assets.map((a: any) => (
                  <div className="removal-resource" key={a.path}>
                    <code>
                      {g.binPath && q.mode === 'purge' && a.disposition === 'remove'
                        ? g.binPath + '/' + g.files.find((f: any) => f.path === a.path)?.saved
                        : a.path}
                    </code>
                    <small>
                      {g.binPath && a.disposition === 'remove'
                        ? t('originalLocation') + ' ' + a.path + ' · '
                        : ''}
                      {t(a.disposition === 'remove' ? modeKey(q.mode) : 'trash_' + a.disposition)}
                      {a.bytes ? ' · ' + size(a.bytes) : ''}
                      {a.sharedWith?.length
                        ? ' · ' + a.sharedWith.map((r: any) => r.title).join(' / ')
                        : ''}
                    </small>
                  </div>
                ))}
              </details>
            </section>
          ))}
          {plan.cloud && !done('cloud') && (
            <section className="removal-section">
              <h3>
                {t('currentSpace')} · {plan.bucket}
              </h3>
              <code>{plan.space}</code>
              {!previous && <p>{t('chooseVersionsHint')}</p>}
              <p>
                {t('cloudFreeEstimate')} <b>{size(plan.cloud.freeBytes)}</b>
                {q.mode === 'trash' ? ' · ' + t('binUsesSpace') : ''}
              </p>
              {plan.cloud.items.map((r: any) => (
                <div className="removal-version-group" key={r.id}>
                  <h3>{r.title}</h3>
                  <small>{r.project ?? ''}</small>
                  {r.versions.map((v: any) => (
                    <div className="removal-version" key={v.id}>
                      <label className="check">
                        <input
                          type="checkbox"
                          checked={(
                            versions[r.id] ??
                            r.versions.filter((a: any) => a.selected).map((a: any) => a.id)
                          ).includes(v.id)}
                          disabled={pending || !!previous}
                          onChange={(e) => toggleVersion(r, v.id, e.target.checked)}
                        />
                        <span>
                          <b>{dateLabel(v.at, locale)}</b> · {v.device || '—'} · {size(v.bytes)}{' '}
                          {v.current && <b>{t('currentVersion')}</b>}{' '}
                          <code>{v.id.slice(0, 12)}</code>
                          {v.legacy && <small>{t('legacyVersion')}</small>}
                        </span>
                      </label>
                      <details>
                        <summary>
                          {tn('countConversations', v.files.length)} ·{' '}
                          {tn(
                            'countAttachments',
                            v.files.reduce((n: number, f: any) => n + f.assets.length, 0),
                          )}
                        </summary>
                        {v.files.map((f: any) => (
                          <div className="removal-resource" key={f.id}>
                            <b>{f.title}</b>{' '}
                            {f.kind &&
                              ' · ' +
                                t(f.kind === 'background' ? 'backgroundChats' : 'mainChats')}{' '}
                            · {f.project ?? ''}
                            {f.assets.map((a: any, i: number) => (
                              <div key={i}>
                                <code>{a.path}</code>
                                <small>
                                  {t('assetDecision_' + a.disposition)} · {size(a.bytes)}
                                  {a.sharedWith?.length
                                    ? ' · ' +
                                      [...new Set(a.sharedWith.map((ref: any) => ref.title))].join(
                                        ' / ',
                                      )
                                    : ''}
                                </small>
                              </div>
                            ))}
                          </div>
                        ))}
                      </details>
                    </div>
                  ))}
                  {!changed && (
                    <p className="cloud-next">
                      <b>{t('availableAfter')}</b>{' '}
                      {r.nextTips.length
                        ? r.nextTips
                            .map(
                              (v: any) =>
                                dateLabel(v.at, locale) +
                                ' · ' +
                                (v.device ?? '') +
                                ' · ' +
                                v.id.slice(0, 8),
                            )
                            .join(' / ')
                        : t('noActiveVersion')}
                      {r.nextTips.length > 1 && <small>{t('branchesRemain')}</small>}
                    </p>
                  )}
                </div>
              ))}
            </section>
          )}
          <CopyList items={plan.retained} t={t} locale={locale} />
          {q.scope === 'local' && !plan.cloudChecked && (
            <p className="muted">{t('uninspectedCloud')}</p>
          )}
          {q.scope === 'cloud' && <p>{t('localCopiesRetained')}</p>}
          {needUpgrade && (
            <label className="check warning-box">
              <input
                type="checkbox"
                checked={upgrade}
                onChange={(e) => setUpgrade(e.target.checked)}
              />
              {t('upgradeSpaceConsent')}
            </label>
          )}
          {needPermanent && (
            <label className="check warning-box">
              <input
                type="checkbox"
                checked={permanent}
                onChange={(e) => setPermanent(e.target.checked)}
              />
              {t('permanentConsent')}
            </label>
          )}
        </>
      )}
      {pending && (
        <div className="flow-activity" role="status">
          <progress />
          {t('readingRemoval')}
        </div>
      )}
      {changed && !pending && (
        <p className="warning-box" role="status">
          {t('versionSelectionChanged')}
        </p>
      )}
      {noWork && <p role="status">{t('nothing_to_remove')}</p>}
      {!pending &&
        !changed &&
        plan &&
        !noWork &&
        !blocked &&
        ((needPermanent && !permanent) || (needUpgrade && !upgrade)) && (
          <p>{t('reviewConsentHint')}</p>
        )}
      {error && (
        <ErrorNotice
          error={error}
          severity={errorRule(error.code).severity}
          note={error.targets && <MissingTargets targets={error.targets} />}
          action={
            remainingTargets.length > 0 ? (
              <button
                disabled={pending}
                onClick={() =>
                  refresh({
                    ...q,
                    ids: remainingTargets,
                    versions: Object.fromEntries(
                      Object.entries(q.versions ?? {}).filter(([k]) =>
                        remainingTargets.includes(k),
                      ),
                    ),
                  })
                }
              >
                {tn('reviseRemainingTargets', remainingTargets.length)}
              </button>
            ) : (
              repair &&
              repair !== 'discardRemoval' && (
                <button
                  disabled={pending}
                  onClick={() =>
                    repair === 'refreshRetry' || repair === 'retry'
                      ? previous && wrongVersion
                        ? onRevise(plan.token)
                        : refresh(q, repair === 'refreshRetry')
                      : onRepair(REPAIR_PLACE[repair])
                  }
                >
                  {t(fixLabel(error.code)!)}
                </button>
              )
            )
          }
        />
      )}
    </Modal>
  );
}

export function RemovalResult({
  job,
  t,
  onRetry,
  onReview,
  onBackups,
  onDismiss,
  onDiscard,
  busy,
}: any) {
  const { tn } = useI18n();
  if (!job) return null;
  const running = busy && ['checking', 'running'].includes(job.status),
    interrupted =
      job.status === 'interrupted' || (!busy && ['checking', 'running'].includes(job.status));
  // Stopped before either side started: nothing was deleted or restored, and an
  // out-of-date list is reviewed again from the same request.
  const notStarted = !running && removalNotStarted(job);
  const reviewAgain =
    notStarted &&
    onReview &&
    ['stale_plan', 'space_changed', 'invalid_selection'].includes(job.error?.code);
  const label = interrupted
    ? 'removeInterrupted'
    : notStarted
      ? job.mode === 'restore'
        ? 'restoreNotStarted'
        : 'removalNotStarted'
      : (
          {
            checking: 'checkingRemoval',
            running: 'removingNow',
            partial: 'removePartial',
            attention: 'removeAttention',
            completed: 'removeComplete',
            replaced: 'replacedReview',
          } as any
        )[job.status];
  return (
    <section
      className={
        'task-feedback ' +
        (running ? 'active' : job.status === 'completed' ? 'success' : 'attention')
      }
      aria-label={t('removeChats')}
    >
      <div className="task-heading">
        <strong role="status">
          {t(label)} · {t(modeKey(job.mode))}
        </strong>
        {!running && onDismiss && (
          <button className="icon-button" onClick={onDismiss} aria-label={t('close')}>
            <Icon name="close" />
          </button>
        )}
      </div>
      {running && <progress />}
      <small>{job.titles?.join(' · ')}</small>
      {(job.sides ?? []).map((s: any) => (
        <p key={s.home ?? s.side}>
          <b>
            {t(s.side === 'local' ? 'thisDevice' : 'currentSpace')} ·{' '}
            {t(
              (
                {
                  done: 'sideDone',
                  failed: 'sideFailed',
                  cleanup: 'sideCleanup',
                  localCleanup: 'sideLocalCleanup',
                  running: interrupted ? 'removeInterrupted' : 'sideRunning',
                  waiting: 'sideWaiting',
                } as any
              )[s.status],
            )}
          </b>{' '}
          · {tn(s.side === 'local' ? 'countConversations' : 'countBackupVersions', s.count)}
          {s.progress && s.status === 'running' && (
            <small> · {tn('objectProgress', s.progress[1], { done: s.progress[0] })}</small>
          )}
          {s.home && <small> {s.home}</small>}
          {s.error && (
            <small className="reason">
              {t(s.error.code)} {s.error.detail}
            </small>
          )}
        </p>
      ))}
      {job.error && !(job.sides ?? []).some((s: any) => s.error) && <p>{t(job.error.code)}</p>}
      {notStarted && <p className="error-note">{t('nothingRemoved')}</p>}
      <div className="actions">
        {reviewAgain ? (
          <button className="primary" disabled={busy} onClick={() => onReview(job.id)}>
            {t('reviewRemovalAgain')}
          </button>
        ) : (
          !running &&
          ['attention', 'partial', 'checking', 'running', 'interrupted'].includes(job.status) && (
            <button className="primary" disabled={busy} onClick={() => onRetry(job.id)}>
              {t('reviewRemaining')}
            </button>
          )
        )}
        {!running && onDiscard && job.clearance?.clearable && job.status !== 'completed' && (
          <button disabled={busy} onClick={() => onDiscard(job.id)}>
            {t('discardRemovalJob')}
          </button>
        )}
        {onBackups && (
          <button disabled={busy} onClick={onBackups}>
            {t('backups')}
          </button>
        )}
      </div>
    </section>
  );
}

// One recycle bin, local or cloud. Restoring or deleting opens the removal review.
export function BinList({ side, items, connected, t, date, busy, open }: any) {
  const { tn } = useI18n();
  const local = side === 'local';
  return (
    <>
      {items.map((b: any) => {
        const label = local ? b.rows.map((r: any) => r.title).join(' · ') : b.title,
          base = { binId: b.id, ids: local ? b.ids : [b.logicalId], scope: side, titles: [label] };
        return (
          <div className="backup-row" key={b.id + (b.logicalId ?? '')}>
            <div>
              <b>{label}</b>
              <small>
                {date(b.at ?? b.createdAt)} · {local ? b.home : tn('countBackupVersions', b.count)}
              </small>
              {local && <small>{t('trashStatus_' + b.status)}</small>}
            </div>
            {(!local || !['restored', 'purging'].includes(b.status)) && (
              <button
                disabled={busy || (!local && !connected)}
                onClick={() => open({ ...base, mode: 'restore' })}
              >
                {t('restoreCopy')}…
              </button>
            )}
            {(!local || ['removed', 'restored', 'purging'].includes(b.status)) && (
              <button
                className="danger-button"
                disabled={busy || (!local && !connected)}
                onClick={() => open({ ...base, mode: 'purge' })}
              >
                {t('permanentDelete')}…
              </button>
            )}
          </div>
        );
      })}
    </>
  );
}
