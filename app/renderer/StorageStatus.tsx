import React, { useState } from 'react';
export function StorageStatus({ init, t, call, reload, viewCloud, busy, restore }: any) {
  const [health, setHealth] = useState<any>(null),
    [pending, setPending] = useState(''),
    [message, setMessage] = useState('');
  const warning = init.credentialError;
  const saving = init.connected && warning === 'credential_save_pending';
  async function action(method: string) {
    setPending(method);
    setMessage('');
    setHealth(null);
    try {
      if (method === 'credentialHealth') setHealth(await call(method));
      else {
        await call(method);
        await reload();
      }
    } catch (e: any) {
      setMessage(t(e.code ?? 'operation_failed'));
    } finally {
      setPending('');
    }
  }
  const waiting = busy || !!pending;
  return (
    <section
      className={'storage-state ' + (init.connected ? 'joined' : 'offline')}
      aria-live="polite"
    >
      <div className="card-title">
        <strong>{t(init.connected ? 'spaceJoined' : 'offline')}</strong>
        {init.connected && (
          <button className="primary" onClick={viewCloud}>
            {t('viewCloud')}
          </button>
        )}
      </div>
      {!init.connected && init.canRestore && !warning && (
        <button className="primary" disabled={waiting} onClick={restore}>
          {t('authorizeAndConnect')}
        </button>
      )}
      {init.connected && !warning && <p>{t('credentialsRemembered')}</p>}
      {saving && (
        <p role="status">
          <progress /> {t(warning)}
        </p>
      )}
      {warning && !saving && (
        <div className="credential-note">
          <b>
            {t(
              init.connected
                ? 'onlyThisSession'
                : init.canRestore
                  ? 'savedConnectionLocked'
                  : 'reconnectAfterSession',
            )}
          </b>
          {(init.connected || init.canRestore) && <p>{t(warning)}</p>}
          <div className="actions">
            {init.connected && (
              <button disabled={waiting} onClick={() => action('retryCredentialSave')}>
                {t('rememberAndAuthorize')}
              </button>
            )}
            {!init.connected && init.canRestore && (
              <button className="primary" disabled={waiting} onClick={restore}>
                {t('authorizeAndConnect')}
              </button>
            )}
            {warning.startsWith('credential_') && warning !== 'credential_session_only' && (
              <button disabled={waiting} onClick={() => action('credentialHealth')}>
                {t('checkStorage')}
              </button>
            )}
          </div>
        </div>
      )}
      {pending && (
        <p role="status">
          <progress />{' '}
          {t(pending === 'credentialHealth' ? 'checkingStorage' : 'waitingAuthorization')}
        </p>
      )}
      {health && (
        <div className="repair-details">
          <strong>{t('storageCheckResult')}</strong>
          <p>
            {t(
              !health.linux
                ? 'systemStoreHint'
                : health.service
                  ? health.locked
                    ? 'systemLocked'
                    : 'systemReachable'
                  : (health.reason ?? 'credential_service_unavailable'),
            )}
          </p>
          {health.linux && !health.service && (
            <details open>
              <summary>{t('linuxSetupHelp')}</summary>
              <p>{t('serviceSetup')}</p>
              <small>{t('archExample')}</small>
              <code>sudo pacman -S --needed gnome-keyring</code>
              <p>{t('afterServiceSetup')}</p>
            </details>
          )}
        </div>
      )}
      {message && <p role="alert">{message}</p>}
    </section>
  );
}
