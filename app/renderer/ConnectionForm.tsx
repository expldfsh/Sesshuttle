import { useState } from 'react';
import { useI18n } from './i18n/I18n';
import { Field } from './components/Field';
import { Icon } from './components/Icon';
import { bucketProblem, endpointProblem } from '../../core/connection-rules.mjs';

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

// Creating a space or joining one by connection file comes first; typing every
// field is the fallback. Endpoint and bucket follow the same rules as R2Store and
// are checked when a field loses focus.
export function ConnectionForm({
  value,
  change,
  busy,
  testMode,
  onLoad,
  onConnect,
  onTest,
  onDocs,
  testResult,
}: any) {
  const { t } = useI18n();
  const loaded = !!value.recoveryToken;
  const [stage, setStage] = useState<'choose' | 'form'>(
    loaded || value.endpoint ? 'form' : 'choose',
  );
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const problems: Record<string, string | null> = {
    endpoint: value.endpoint
      ? endpointProblem(value.endpoint.trim(), { allowLocal: testMode })
      : null,
    bucket: value.bucket ? bucketProblem(value.bucket.trim()) : null,
  };
  function update(name: string, text: string) {
    const next = { ...value, [name]: text };
    if (['endpoint', 'bucket', 'accessKeyId', 'space'].includes(name)) next.secretAccessKey = '';
    change(next);
  }
  const field = (name: string, label: string, options: any = {}) => (
    <Field
      label={t(label)}
      name={name}
      value={value[name] ?? ''}
      type={options.password ? 'password' : 'text'}
      readOnly={options.readOnly}
      placeholder={options.placeholder}
      onChange={(text) => update(name, text)}
      onBlur={() => setTouched((old) => ({ ...old, [name]: true }))}
      error={touched[name] && problems[name] ? t(problems[name] as string) : undefined}
      hint={options.hint}
    />
  );
  const missing = [
    !value.endpoint && 'endpoint',
    !value.bucket && 'bucket',
    !value.accessKeyId && 'accessKey',
    !value.secretAccessKey && 'secretKey',
    value.mode === 'join' && !value.space && 'space',
    value.mode === 'join' && !loaded && !value.key && 'recoveryKey',
  ].filter(Boolean) as string[];
  const invalid = !!problems.endpoint || !!problems.bucket;
  if (stage === 'choose')
    return (
      <div className="choice-cards">
        <button
          type="button"
          className="choice-card"
          disabled={busy}
          onClick={() => {
            change({ ...value, mode: 'create', recoveryToken: '' });
            setStage('form');
          }}
        >
          <Icon name="cloud" size={20} />
          <strong>{t('firstComputer')}</strong>
          <small>{t('firstComputerHint')}</small>
        </button>
        <button
          type="button"
          className="choice-card"
          disabled={busy}
          onClick={async () => (await onLoad()) && setStage('form')}
        >
          <Icon name="download" size={20} />
          <strong>{t('existingSpace')}</strong>
          <small>{t('existingSpaceHint')}</small>
        </button>
        <button
          type="button"
          className="text-button choice-manual"
          onClick={() => {
            change({ ...value, mode: 'join', recoveryToken: '' });
            setStage('form');
          }}
        >
          {t('manualConnection')}
        </button>
      </div>
    );
  return (
    <fieldset className="flow-fields connection-form" disabled={busy}>
      <div className="form-head">
        <strong>
          {t(
            value.mode === 'create'
              ? 'firstComputer'
              : loaded
                ? 'existingSpace'
                : 'manualConnection',
          )}
        </strong>
        <button type="button" className="text-button" onClick={() => setStage('choose')}>
          {t('changeConnectionMethod')}
        </button>
      </div>
      {loaded && (
        <p className="inline-status" role="status">
          <Icon name="check" /> {t(value.accessKeyId ? 'fileFieldsReady' : 'legacyIdMissing')}
        </p>
      )}
      {field('endpoint', 'endpoint', {
        readOnly: loaded,
        placeholder: 'https://<ACCOUNT_ID>.r2.cloudflarestorage.com',
      })}
      {field('bucket', 'bucket', { readOnly: loaded, placeholder: 'my-sesshuttle' })}
      {value.mode === 'join' && field('space', 'space', { readOnly: loaded })}
      {value.mode === 'join' && !loaded && field('key', 'recoveryKey', { password: true })}
      <div className="two-fields">
        {field('accessKeyId', 'accessKey')}
        {field('secretAccessKey', 'secretKey', { password: true })}
      </div>
      <button type="button" className="text-button docs-link" onClick={onDocs}>
        <Icon name="info" /> {t('r2CredentialsDocs')}
      </button>
      <label className="check">
        <input
          type="checkbox"
          checked={value.remember}
          onChange={(e) => change({ ...value, remember: e.target.checked })}
        />
        {t('rememberDevice')}
      </label>
      {missing.length > 0 && (
        <small className="muted">
          {t('stillNeeded')} {missing.map((m) => t(m)).join(' · ')}
        </small>
      )}
      <div className="actions">
        <button className="primary" disabled={!!missing.length || invalid} onClick={onConnect}>
          {t(value.mode === 'create' ? 'connectCreate' : 'connectJoin')}
        </button>
        <button
          disabled={
            !value.accessKeyId ||
            !value.secretAccessKey ||
            !value.bucket ||
            !value.endpoint ||
            invalid
          }
          onClick={onTest}
        >
          {t('test')}
        </button>
        {testResult && (
          <span className={'inline-status ' + (testResult.ok ? '' : 'danger-text')} role="status">
            <Icon name={testResult.ok ? 'check' : 'alert'} />{' '}
            {testResult.ok ? t('bucketTestOk') : t(testResult.code)}
          </span>
        )}
      </div>
    </fieldset>
  );
}
