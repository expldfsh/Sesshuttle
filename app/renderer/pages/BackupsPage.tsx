import { useEffect, useRef, useState } from 'react';
import { PlaceError, useApp } from '../App';
import { useI18n } from '../i18n/I18n';
import { call } from '../hooks/useApi';
import { ManualBackups } from '../ManualBackups';
import { BinList } from '../RemovalFlow';
import { EmptyState } from '../components/EmptyState';
import { Icon } from '../components/Icon';

const TABS = ['localBackups', 'localTrash', 'cloudBin'] as const;
type Tab = (typeof TABS)[number];

export function BackupsPage() {
  const app = useApp();
  const { t, date } = useI18n();
  const { cfg, busy, work } = app;
  const [tab, setTab] = useState<Tab>('localBackups');
  const [backupData, setBackupData] = useState<any>({ backups: [], imports: [] });
  const [local, setLocal] = useState<any>(null);
  const [cloud, setCloud] = useState<any>(null);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  // Saved local state is shown on arrival and read again after each user action that
  // may have changed it (a restore, a deletion, a backup); nothing is scanned and the
  // cloud is not read.
  const loadLocal = () =>
    Promise.all([call('backups'), call('localBins')]).then(([backups, bins]) => {
      setBackupData(backups);
      setLocal(bins);
    });
  useEffect(() => {
    loadLocal().catch((e) =>
      app.notify({ error: true, code: e.code, text: t(e.code ?? 'operation_failed') }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [app.localRevision]);
  // The cloud recycle bin is read only when the user refreshes it. After an action
  // that changed the cloud, the shown list is out of date and its actions wait.
  async function refreshCloud() {
    const revision = app.cloudRevision;
    setCloud({ ...(await call('backupBins')), checkedAt: new Date().toISOString(), revision });
  }
  const cloudStale = !!cloud && cloud.revision !== app.cloudRevision;
  const select = (index: number) => {
    const next = TABS[(index + TABS.length) % TABS.length];
    setTab(next);
    tabs.current[TABS.indexOf(next)]?.focus();
  };
  const pending = (local?.local ?? []).filter((b: any) =>
    ['needs_recovery', 'prepared', 'removing', 'restoring'].includes(b.status),
  ).length;
  return (
    <div className="backups">
      <div className="tabs" role="tablist" aria-label={t('backups')}>
        {TABS.map((name, i) => (
          <button
            key={name}
            ref={(el) => {
              tabs.current[i] = el;
            }}
            role="tab"
            id={'tab-' + name}
            aria-selected={tab === name}
            aria-controls={'panel-' + name}
            tabIndex={tab === name ? 0 : -1}
            className={tab === name ? 'active' : ''}
            onClick={() => setTab(name)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowRight') select(i + 1);
              if (e.key === 'ArrowLeft') select(i - 1);
            }}
          >
            <Icon
              name={name === 'localBackups' ? 'backup' : name === 'localTrash' ? 'trash' : 'cloud'}
            />
            {t(name)}
            {name === 'localTrash' && pending > 0 && <span className="nav-count">{pending}</span>}
          </button>
        ))}
      </div>
      <PlaceError place="backups" />
      <div role="tabpanel" id={'panel-' + tab} aria-labelledby={'tab-' + tab}>
        {tab === 'localBackups' && (
          <ManualBackups
            data={backupData}
            cfg={cfg}
            busy={busy}
            ask={app.ask}
            work={work}
            call={call}
            changed={app.localChanged}
            historyChanged={() => app.setNeedsRefresh(true)}
            notify={(text: string) => app.notify({ text })}
          />
        )}
        {tab === 'localTrash' && (
          <section className="card">
            <p className="muted">{t('localBinHint')}</p>
            {local && !local.local.length && <EmptyState icon="trash" title={t('noBinItems')} />}
            {local && (
              <BinList
                side="local"
                items={local.local}
                connected={app.init.connected}
                t={t}
                date={date}
                busy={busy}
                open={app.setRemoval}
              />
            )}
          </section>
        )}
        {tab === 'cloudBin' && (
          <section className="card">
            <div className="card-title">
              <p className="muted">{t('cloudBinHint')}</p>
              <span className="refresh-group">
                <button
                  className={cloudStale ? 'primary' : ''}
                  disabled={busy || !app.init.connected}
                  onClick={() => work(refreshCloud, 'refreshing', 'backups')}
                >
                  <Icon name="refresh" /> {t('refreshBins')}
                </button>
                <small>
                  {cloud?.checkedAt
                    ? t('lastCheckAt', { time: date(cloud.checkedAt) })
                    : t('notCheckedYet')}
                </small>
              </span>
            </div>
            {!app.init.connected && (
              <EmptyState
                icon="cloud"
                title={t('offline')}
                action={
                  <button onClick={() => app.setPage('settings', 'storage')}>
                    {t('configureRemovalStorage')}
                  </button>
                }
              />
            )}
            {cloudStale && (
              <p className="warning-box stale-note" role="status">
                <Icon name="alert" /> {t('binOutOfDate')}
              </p>
            )}
            {cloud?.cloudError && (
              <p role="alert" className="warning-box">
                {t(cloud.cloudError.code)}
              </p>
            )}
            {cloud?.cloud.pending && (
              <div className="warning-box">
                <p>{t('cloud_cleanup_pending')}</p>
                <button
                  disabled={busy || cloudStale}
                  onClick={() =>
                    work(
                      async () => {
                        const ok = await app.ask({
                          title: t('finishConfirmedCloud'),
                          message: t('finishPendingHint'),
                          confirm: t('finishConfirmedCloud'),
                        });
                        if (!ok) return;
                        try {
                          await call('finishCloudRemoval', {
                            id: cloud.cloud.pending.id,
                            storageKey: cloud.storageKey,
                          });
                          app.notify({ text: t('cloudFinishDone') });
                        } finally {
                          await app.localChanged(true);
                        }
                      },
                      'removingNow',
                      'backups',
                    )
                  }
                >
                  {t('finishConfirmedCloud')}
                </button>
              </div>
            )}
            {cloud && !cloud.cloudError && !cloud.cloud.bins.length && (
              <EmptyState icon="cloud" title={t('noBinItems')} />
            )}
            {cloud && (
              <BinList
                side="cloud"
                items={cloud.cloud.bins}
                connected={app.init.connected}
                t={t}
                date={date}
                busy={busy || cloudStale}
                open={app.setRemoval}
              />
            )}
          </section>
        )}
      </div>
    </div>
  );
}
