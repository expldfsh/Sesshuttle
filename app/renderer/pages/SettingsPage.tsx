import { useApp } from '../App';
import { useI18n } from '../i18n/I18n';
import { call } from '../hooks/useApi';
import { StorageStatus } from '../StorageStatus';
import { ConnectionForm, emptyConnection } from '../ConnectionForm';
import { StatusBadge } from '../components/StatusBadge';

export function SettingsPage() {
  const app = useApp();
  const { t } = useI18n();
  const { init, cfg, busy, work, connection, setConnection } = app;
  const update = (key: string, value: any) => app.setCfg({ ...cfg, [key]: value });
  const resetList = () => {
    app.setNeedsRefresh(true);
    app.setData({ rows: [], errors: [] });
  };
  async function restoreSaved() {
    app.setPhase('waitingAuthorization');
    await call('restoreConnection');
    const next = await app.reloadInit();
    if (!next.connected) {
      app.setPage('settings');
      app.notify({ error: true, text: t(next.credentialError ?? 'credentials_required') });
      return;
    }
    resetList();
    app.notify({ text: t('manualRefreshHint') });
  }
  return (
    <>
      <StorageStatus
        init={init}
        t={t}
        call={call}
        reload={app.reloadInit}
        viewCloud={app.viewCloud}
        busy={busy}
        restore={() => work(restoreSaved, 'waitingAuthorization')}
      />
      <div className="settings-grid">
        <section className="card">
          <h2>{t('localSettings')}</h2>
          <button
            className="primary"
            disabled={busy}
            onClick={() =>
              work(async () => app.setDetection(await call('detectPaths')), 'checkingEntries')
            }
          >
            {t('detectEnvironment')}
          </button>
          <label className="field">
            <span>{t('deviceName')}</span>
            <input
              value={app.deviceName ?? ''}
              onChange={(e) => app.setDeviceName(e.target.value)}
              autoComplete="off"
            />
          </label>
          <label className="field">
            <span>{t('sourceHomes')}</span>
            <textarea
              rows={3}
              value={cfg.sourceHomes.join('\n')}
              onChange={(e) => update('sourceHomes', e.target.value.split('\n'))}
            />
          </label>
          <button
            onClick={() =>
              work(async () => {
                const p = await call('pickDirectory');
                if (p) update('sourceHomes', [...new Set([...cfg.sourceHomes, p])]);
              })
            }
          >
            {t('bind')}
          </button>
          <div className="diagnostics-action">
            <button onClick={() => work(async () => app.setDiagnostic(await call('diagnostics')))}>
              {t('diagnostics')}
            </button>
          </div>
        </section>
        <section className="card storage-card">
          <div className="card-title">
            <h2>{t('storage')}</h2>
            {init.connected && <StatusBadge status="connected" />}
          </div>
          {!init.connected && (
            <ConnectionForm
              value={connection}
              change={setConnection}
              busy={busy}
              t={t}
              onLoad={() =>
                work(async () => {
                  const r = await call('importRecovery');
                  if (r) setConnection({ ...emptyConnection, ...r, remember: connection.remember });
                })
              }
              onTest={() =>
                work(async () => {
                  await call('connect', { ...connection, mode: 'test' });
                  app.notify({ text: t('bucketTestOk') });
                })
              }
              onConnect={() =>
                work(async () => {
                  await call('connect', connection);
                  setConnection({ ...emptyConnection });
                  await app.reloadInit();
                  if (connection.remember) {
                    app.setPhase('waitingAuthorization');
                    await call('retryCredentialSave');
                    await app.reloadInit();
                  }
                  resetList();
                  app.notify({ text: t('spaceJoined') + ' ' + t('manualRefreshHint') });
                  if (app.deferred) {
                    app.setDeferred(null);
                    app.setPage('conversations');
                  }
                }, 'joiningSpace')
              }
            />
          )}
          {init.connected && (
            <div className="recovery">
              <p>{t('keyHint')}</p>
              <label>
                {t('space')}
                <input value={init.connection?.space ?? ''} readOnly />
              </label>
              <label>
                {t('accessKey')}
                <input value={init.connection?.accessKeyId ?? ''} readOnly />
              </label>
              <button
                onClick={() =>
                  work(async () => {
                    if (await call('exportRecovery')) app.notify({ text: t('recoverySaved') });
                  })
                }
              >
                {t('exportKey')}
              </button>
              <button
                className="text-button"
                onClick={() =>
                  work(async () => {
                    await call('disconnect');
                    setConnection({ ...emptyConnection });
                    await app.reloadInit();
                    resetList();
                    app.notify({ text: t('credential_reset') });
                  })
                }
              >
                {t('disconnect')}
              </button>
              <small>{t('disconnectHint')}</small>
            </div>
          )}
        </section>
      </div>
    </>
  );
}
