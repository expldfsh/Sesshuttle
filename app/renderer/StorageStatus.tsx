import { useState } from 'react';
import { Modal } from './components/Modal';
import { useI18n } from './i18n/I18n';
export function StorageStatus({ init, t, viewCloud, busy, restore, remember }: any) {
  const saved = init.credentialMethod === 'password';
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
      {init.connected && <p>{t(saved ? 'credentialsRemembered' : 'credential_session_only')}</p>}
      {init.credentialError && init.credentialError !== 'credential_session_only' && (
        <p role="alert">{t(init.credentialError)}</p>
      )}
      {init.connected && !saved && (
        <button disabled={busy} onClick={remember}>
          {t('rememberAndAuthorize')}
        </button>
      )}
      {!init.connected && init.canRestore && (
        <button className="primary" disabled={busy} onClick={restore}>
          {t('authorizeAndConnect')}
        </button>
      )}
    </section>
  );
}

export function FolderPassword({
  mode,
  close,
  submit,
}: {
  mode: 'save' | 'unlock' | 'migrate';
  close: () => void;
  submit: (password: string) => Promise<void>;
}) {
  const { t } = useI18n();
  const [password, setPassword] = useState(''),
    [repeat, setRepeat] = useState('');
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const saving = mode !== 'unlock';
  const title = t(
    mode === 'migrate' ? 'folderProtect' : saving ? 'rememberAndAuthorize' : 'authorizeAndConnect',
  );
  return (
    <Modal size="small" title={title} busy={busy} onClose={close}>
      <form
        className="flow-fields"
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy) return;
          if (!password || (saving && password !== repeat)) {
            setError('folderPasswordMismatch');
            return;
          }
          setBusy(true);
          setError('');
          try {
            await submit(password);
          } catch (failure: any) {
            setError(failure.code ?? 'operation_failed');
          } finally {
            setBusy(false);
          }
        }}
      >
        <p>
          {t(
            mode === 'migrate'
              ? 'folderProtectHint'
              : saving
                ? 'folderPasswordHint'
                : 'folderUnlockHint',
          )}
        </p>
        <label className="field">
          {t('folderPassword')}
          <input
            type="password"
            required
            maxLength={256}
            autoComplete={saving ? 'new-password' : 'current-password'}
            value={password}
            disabled={busy}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {saving && (
          <label className="field">
            {t('folderPasswordRepeat')}
            <input
              type="password"
              required
              maxLength={256}
              autoComplete="new-password"
              value={repeat}
              disabled={busy}
              onChange={(e) => setRepeat(e.target.value)}
            />
          </label>
        )}
        {error && <p role="alert">{t(error)}</p>}
        <div className="actions">
          <button type="button" onClick={close} disabled={busy}>
            {t('cancel')}
          </button>
          <button className="primary" type="submit" disabled={busy}>
            {busy ? t('working') : title}
          </button>
        </div>
      </form>
    </Modal>
  );
}
