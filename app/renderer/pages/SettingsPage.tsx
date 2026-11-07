import { useState } from 'react';
import { PlaceError, useApp } from '../App';
import { useI18n } from '../i18n/I18n';
import { call } from '../hooks/useApi';
import { StorageStatus } from '../StorageStatus';
import { ConnectionForm, emptyConnection } from '../ConnectionForm';
import { StatusBadge } from '../components/StatusBadge';
import { UnsavedBar } from '../components/UnsavedBar';
import { Icon } from '../components/Icon';
import { Select } from '../Select';

export const SHORTCUTS = [
  ['⌘/Ctrl + R', 'shortcutRefresh'],
  ['⌘/Ctrl + F', 'shortcutSearch'],
  ['Esc', 'shortcutEscape'],
  ['↑ / ↓', 'shortcutMove'],
  ['Space', 'shortcutToggle'],
  ['⌘/Ctrl + A', 'shortcutSelectAll'],
];

// Local settings saved together from the bar at the bottom of the page.
export function useLocalSettings() {
  const app = useApp();
  const dirty =
    JSON.stringify(app.cfg) !== JSON.stringify(app.init?.config) ||
    app.deviceName !== app.init?.device?.name;
  return {
    dirty,
    discard: () => {
      app.setCfg(app.init.config);
      app.setDeviceName(app.init.device.name);
    },
    save: () =>
      app.work(
        async () => {
          await app.persist(app.cfg);
          app.notify({ text: app.i18n.t('saved') });
        },
        'applying',
        'settings',
      ),
  };
}

export function SettingsPage() {
  const app = useApp();
  const { t } = useI18n();
  const { init, cfg, busy, work, connection, setConnection } = app;
  const settings = useLocalSettings();
  const [testResult, setTestResult] = useState<any>(null);
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
      app.notify({
        error: true,
        code: next.credentialError ?? 'credentials_required',
        text: t(next.credentialError ?? 'credentials_required'),
      });
      return;
    }
    resetList();
    app.notify({ text: t('manualRefreshHint') });
  }
  return (
    <div className="settings">
      <section className="card" id="storage" aria-labelledby="storage-title">
        <div className="card-title">
          <h2 id="storage-title">{t('storage')}</h2>
          {init.connected && <StatusBadge status="connected" />}
        </div>
        <StorageStatus
          init={init}
          t={t}
          call={call}
          reload={app.reloadInit}
          viewCloud={app.viewCloud}
          busy={busy}
          restore={() => work(restoreSaved, 'waitingAuthorization', 'storage')}
        />
        {!init.connected && (
          <ConnectionForm
            value={connection}
            change={(next: any) => {
              setConnection(next);
              setTestResult(null);
            }}
            busy={busy}
            testMode={init.testMode}
            testResult={testResult}
            onDocs={() =>
              work(() => call('openDocs', { topic: 'r2Credentials' }), 'working', 'storage')
            }
            onLoad={async () => {
              const r = await work(() => call('importRecovery'), 'working', 'storage');
              if (r) setConnection({ ...emptyConnection, ...r, remember: connection.remember });
              return !!r;
            }}
            onTest={() =>
              work(async () => {
                try {
                  await call('connect', { ...connection, mode: 'test' });
                  setTestResult({ ok: true });
                } catch (e: any) {
                  setTestResult({ ok: false, code: e.code ?? 'operation_failed' });
                }
              }, 'checkingStorage')
            }
            onConnect={() =>
              work(
                async () => {
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
                },
                'joiningSpace',
                'storage',
              )
            }
          />
        )}
        {init.connected && init.exportReminder && (
          <div className="next-step-card" role="status">
            <Icon name="alert" size={20} />
            <div>
              <strong>{t('nextExportTitle')}</strong>
              <p>{t('nextExportHint')}</p>
            </div>
            <button
              className="primary"
              disabled={busy}
              onClick={() =>
                work(
                  async () => {
                    if (await call('exportRecovery')) {
                      app.notify({ text: t('recoverySaved') });
                      await app.reloadInit();
                    }
                  },
                  'working',
                  'storage',
                )
              }
            >
              {t('exportKey')}
            </button>
          </div>
        )}
        {init.connected && (
          <div className="recovery">
            <p>{t('keyHint')}</p>
            <div className="two-fields">
              <label className="field">
                <span>{t('space')}</span>
                <input value={init.connection?.space ?? ''} readOnly />
              </label>
              <label className="field">
                <span>{t('accessKey')}</span>
                <input value={init.connection?.accessKeyId ?? ''} readOnly />
              </label>
            </div>
            <div className="actions">
              <button
                onClick={() =>
                  work(
                    async () => {
                      if (await call('exportRecovery')) {
                        app.notify({ text: t('recoverySaved') });
                        await app.reloadInit();
                      }
                    },
                    'working',
                    'storage',
                  )
                }
              >
                {t('exportKey')}
              </button>
              <button className="text-button" onClick={app.viewCloud}>
                {t('viewCloud')}
              </button>
              <button
                className="text-button danger-text"
                onClick={() =>
                  work(
                    async () => {
                      await call('disconnect');
                      setConnection({ ...emptyConnection });
                      await app.reloadInit();
                      resetList();
                      app.notify({ text: t('credential_reset') });
                    },
                    'working',
                    'storage',
                  )
                }
              >
                {t('disconnect')}
              </button>
            </div>
            <small className="muted">{t('disconnectHint')}</small>
          </div>
        )}
        <PlaceError place="storage" />
      </section>
      <section className="card" aria-labelledby="local-title">
        <h2 id="local-title">{t('localSettings')}</h2>
        <label className="field">
          <span>{t('deviceName')}</span>
          <input
            value={app.deviceName ?? ''}
            onChange={(e) => app.setDeviceName(e.target.value)}
            autoComplete="off"
          />
        </label>
        <div className="field">
          <span>{t('language')}</span>
          <Select
            label={t('language')}
            value={cfg.language}
            options={[
              { value: 'zh-CN', label: '简体中文' },
              { value: 'en', label: 'English' },
            ]}
            onChange={(language) => update('language', language)}
          />
        </div>
        <label className="field">
          <span>{t('sourceHomes')}</span>
          <textarea
            rows={3}
            value={cfg.sourceHomes.join('\n')}
            onChange={(e) => update('sourceHomes', e.target.value.split('\n'))}
          />
        </label>
        <div className="actions">
          <button
            onClick={() =>
              work(async () => {
                const p = await call('pickDirectory');
                if (p) update('sourceHomes', [...new Set([...cfg.sourceHomes, p])]);
              })
            }
          >
            <Icon name="folder" /> {t('bind')}
          </button>
          <button
            disabled={busy}
            onClick={() =>
              work(async () => app.setDetection(await call('detectPaths')), 'checkingEntries')
            }
          >
            {t('detectEnvironment')}
          </button>
          <label className="check">
            <input
              type="checkbox"
              checked={!!cfg.skipNativeConfirm}
              onChange={(e) => update('skipNativeConfirm', e.target.checked)}
            />
            {t('skipNativeConfirmSetting')}
          </label>
        </div>
        <PlaceError place="settings" />
      </section>
      <section className="card" aria-labelledby="shortcuts-title">
        <h2 id="shortcuts-title">{t('keyboardShortcuts')}</h2>
        <dl className="shortcuts">
          {SHORTCUTS.map(([keys, label]) => (
            <div key={label}>
              <dt>
                <kbd>{keys}</kbd>
              </dt>
              <dd>{t(label)}</dd>
            </div>
          ))}
        </dl>
        <small className="muted">{t('shortcutsHint')}</small>
      </section>
      <section className="card" aria-labelledby="diagnostics-title">
        <h2 id="diagnostics-title">{t('diagnostics')}</h2>
        <p className="muted">{t('diagnosticHint')}</p>
        <button onClick={() => work(async () => app.setDiagnostic(await call('diagnostics')))}>
          {t('diagnosticsPreview')}
        </button>
      </section>
      {settings.dirty && (
        <UnsavedBar busy={busy} onDiscard={settings.discard} onSave={settings.save} />
      )}
    </div>
  );
}
