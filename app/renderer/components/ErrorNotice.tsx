import { useEffect, useRef, type ReactNode } from 'react';
import { useI18n } from '../i18n/I18n';
import { Icon } from './Icon';

export type ErrorInfo = { code?: string; detail?: string; stage?: string };

// A translated explanation, the affected object if any, an optional fix and the
// technical details (code, detail, stage) folded away with a copy button.
export function ErrorNotice({
  error,
  subject,
  action,
  severity = 'error',
  onDismiss,
}: {
  error: ErrorInfo;
  subject?: string;
  action?: ReactNode;
  severity?: 'error' | 'warning' | 'info';
  onDismiss?: () => void;
}) {
  const { t } = useI18n();
  const box = useRef<HTMLDivElement>(null);
  // A notice that appears out of view (a scrolled page or dialog) is brought into view.
  // The effect returns nothing: scrollIntoView returns a promise in current
  // Chromium, and React would call it as the cleanup when the notice closes.
  useEffect(() => {
    void box.current?.scrollIntoView({ block: 'nearest' });
  }, []);
  const code = error.code ?? 'operation_failed';
  const technical = [code, error.detail, error.stage && t(error.stage)].filter(Boolean).join('\n');
  return (
    <div
      ref={box}
      className={`error-notice ${severity}`}
      role={severity === 'info' ? 'status' : 'alert'}
    >
      <Icon name={severity === 'info' ? 'info' : 'alert'} />
      <div className="error-body">
        <strong>{t(code)}</strong>
        {subject && <code className="error-subject">{subject}</code>}
        {action && <div className="actions">{action}</div>}
        <details className="technical">
          <summary>{t('technicalDetails')}</summary>
          <pre>{technical}</pre>
          <button
            type="button"
            className="text-button"
            onClick={() => void window.sesshuttle.invoke('copyText', { text: technical })}
          >
            <Icon name="copy" /> {t('copy')}
          </button>
        </details>
      </div>
      {onDismiss && (
        <button type="button" className="icon-button" aria-label={t('close')} onClick={onDismiss}>
          <Icon name="close" />
        </button>
      )}
    </div>
  );
}
