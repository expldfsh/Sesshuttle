import React from 'react';

export const emptyConnection = {
  mode: 'join',
  endpoint: '',
  bucket: '',
  space: '',
  key: '',
  accessKeyId: '',
  secretAccessKey: '',
  recoveryToken: '',
  remember: true,
};

export function ConnectionForm({ value, change, busy, t, onLoad, onConnect, onTest }: any) {
  const loaded = !!value.recoveryToken;
  function update(name: string, text: string) {
    const next = { ...value, [name]: text };
    if (['endpoint', 'bucket', 'accessKeyId', 'space'].includes(name)) next.secretAccessKey = '';
    change(next);
  }
  function field(name: string, label: string, password = false, readOnly = false) {
    return (
      <label className="field">
        <span>{t(label)}</span>
        <input
          name={name}
          autoComplete="off"
          type={password ? 'password' : 'text'}
          value={value[name] ?? ''}
          readOnly={readOnly}
          onChange={(e) => update(name, e.target.value)}
        />
      </label>
    );
  }
  const missing = [
    !value.endpoint && 'endpoint',
    !value.bucket && 'bucket',
    !value.accessKeyId && 'accessKey',
    !value.secretAccessKey && 'secretKey',
    value.mode === 'join' && !value.space && 'space',
    value.mode === 'join' && !loaded && !value.key && 'recoveryKey',
  ].filter(Boolean);
  return (
    <fieldset className="flow-fields" disabled={busy}>
      <button type="button" className="primary" onClick={onLoad}>
        {t(loaded ? 'replaceRecovery' : 'importConnectionFile')}
      </button>
      {loaded ? (
        <p className="notice" role="status">
          {t(value.accessKeyId ? 'fileFieldsReady' : 'legacyIdMissing')}
        </p>
      ) : (
        <div className="segmented">
          {['join', 'create'].map((mode) => (
            <button
              className={value.mode === mode ? 'active' : ''}
              key={mode}
              onClick={() => change({ ...value, mode })}
            >
              {t(mode)}
            </button>
          ))}
        </div>
      )}
      {field('endpoint', 'endpoint', false, loaded)}
      {field('bucket', 'bucket', false, loaded)}
      {value.mode === 'join' && field('space', 'space', false, loaded)}
      {value.mode === 'join' && !loaded && field('key', 'recoveryKey', true)}
      <div className="two-fields">
        {field('accessKeyId', 'accessKey')}
        {field('secretAccessKey', 'secretKey', true)}
      </div>
      {loaded && (
        <button
          className="text-button"
          onClick={() => change({ ...emptyConnection, remember: value.remember })}
        >
          {t('manualConnection')}
        </button>
      )}
      <label className="check">
        <input
          type="checkbox"
          checked={value.remember}
          onChange={(e) => change({ ...value, remember: e.target.checked })}
        />
        {t('rememberDevice')}
      </label>
      {missing.length > 0 && (
        <small>
          {t('stillNeeded')} {missing.map(t).join(' · ')}
        </small>
      )}
      <div className="actions">
        <button className="primary" disabled={!!missing.length} onClick={onConnect}>
          {t(value.mode === 'create' ? 'connectCreate' : 'connectJoin')}
        </button>
        <button
          disabled={
            !value.accessKeyId || !value.secretAccessKey || !value.bucket || !value.endpoint
          }
          onClick={onTest}
        >
          {t('test')}
        </button>
      </div>
    </fieldset>
  );
}
