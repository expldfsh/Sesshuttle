import { useState } from 'react';
import { Select } from './Select';
import { useI18n } from './i18n/I18n';
import { EmptyState } from './components/EmptyState';
import { Icon } from './components/Icon';

// Whole Codex data folder backups, created only when the user asks.
// `changed` reads saved local state again after an action, whatever its outcome;
// `historyChanged` marks the conversation list out of date after a restore.
export function ManualBackups({
  data,
  cfg,
  busy,
  ask,
  work,
  call,
  changed,
  historyChanged,
  notify,
}: any) {
  const { t, tn, date, size } = useI18n();
  const homes = Array.from(
    new Set<string>(
      [...cfg.sourceHomes, ...Object.values(cfg.targets).map((v: any) => v.home)].filter(Boolean),
    ),
  );
  const [chosen, setChosen] = useState('');
  const home = homes.includes(chosen) ? chosen : homes[0];
  async function create() {
    const ok = await ask({
      title: t('createBackup'),
      message: t('createBackupConfirm'),
      detail: <code className="question-path">{home}</code>,
      confirm: t('createBackup'),
    });
    if (!ok) return;
    try {
      await call('createBackup', { home });
      notify(t('backupCreated'));
    } finally {
      await changed();
    }
  }
  async function restore(b: any) {
    const review = await call('reviewRestore', { id: b.id });
    const ok = await ask({
      title: t('restoreBackupTitle'),
      message: t('restoreConfirm'),
      detail: (
        <div className="question-summary">
          <dl>
            <dt>{t('backupCreatedAt')}</dt>
            <dd>{date(b.createdAt)}</dd>
            <dt>{t('dataHome')}</dt>
            <dd>
              <code>{review.home}</code>
            </dd>
            <dt>{t('restoreFiles')}</dt>
            <dd>{tn('countFiles', review.count)}</dd>
            <dt>{t('removeFiles')}</dt>
            <dd>{tn('countFiles', review.remove.length)}</dd>
          </dl>
          {review.remove.length > 0 && (
            <details className="question-list">
              <summary>{t('removeFiles')}</summary>
              {review.remove.map((f: string) => (
                <code key={f}>{f}</code>
              ))}
            </details>
          )}
        </div>
      ),
      danger: true,
      confirm: t('restoreThisBackup'),
    });
    if (!ok) return;
    try {
      await call('restore', { id: b.id, token: review.token });
      notify(t('restoreDone'));
    } finally {
      historyChanged();
      await changed();
    }
  }
  async function discard(b: any) {
    const ok = await ask({
      title: t('deleteBackup'),
      message: t('deleteBackupConfirm'),
      detail: (
        <dl className="question-summary">
          <dt>{t('backupCreatedAt')}</dt>
          <dd>{date(b.createdAt)}</dd>
          <dt>{t('dataHome')}</dt>
          <dd>
            <code>{b.home}</code>
          </dd>
          <dt>{t('diskUsed')}</dt>
          <dd>{size(b.diskBytes)}</dd>
        </dl>
      ),
      danger: true,
      confirm: t('deleteThisBackup'),
    });
    if (!ok) return;
    try {
      await call('deleteBackup', { id: b.id });
      notify(t('backupDeleted'));
    } finally {
      await changed();
    }
  }
  return (
    <section className="card">
      <p className="muted">{t('manualBackupHint')}</p>
      <div className="actions">
        {homes.length > 0 && (
          <Select
            label={t('dataHome')}
            value={home}
            options={homes.map((p) => ({ value: p, label: p }))}
            onChange={setChosen}
          />
        )}
        <button
          className="primary"
          disabled={busy || !home}
          onClick={() => work(create, 'creatingBackup', 'backups')}
        >
          <Icon name="backup" /> {t('createBackup')}
        </button>
      </div>
      {data.imports
        .filter((x: any) => x.status === 'needs_recovery')
        .map((x: any, i: number) => (
          <p className="warning-box" key={i}>
            {t('import_needs_recovery')} · {x.home} · {x.backup}
          </p>
        ))}
      {!data.backups.length && <EmptyState icon="backup" title={t('noBackups')} />}
      {data.backups
        .slice()
        .sort((a: any, b: any) => b.createdAt.localeCompare(a.createdAt))
        .map((b: any) => (
          <div className="backup-row" key={b.id}>
            <div>
              <strong>
                {date(b.createdAt)} · {t(b.reason === 'manual' ? 'manualReason' : 'legacyReason')}
              </strong>
              <small>{b.home}</small>
              {b.restorePending && <p className="warning-box">{t('restore_pending')}</p>}
              <small>
                {tn('countFiles', b.count)} · {t('diskUsed')} {size(b.diskBytes)}
              </small>
            </div>
            <button
              disabled={busy}
              onClick={() => work(() => restore(b), 'restoreActive', 'backups')}
            >
              {t('restore')}…
            </button>
            <button
              disabled={busy}
              className="danger-button"
              onClick={() => work(() => discard(b), 'deletingBackup', 'backups')}
            >
              <Icon name="trash" /> {t('deleteBackup')}…
            </button>
          </div>
        ))}
    </section>
  );
}
