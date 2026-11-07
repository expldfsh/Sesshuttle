import { useI18n } from '../i18n/I18n';
import { Icon } from './Icon';

// Pinned to the bottom of the page while local settings differ from what is saved.
export function UnsavedBar({
  busy,
  onDiscard,
  onSave,
}: {
  busy: boolean;
  onDiscard: () => void;
  onSave: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="unsaved-bar" role="region" aria-label={t('unsavedChanges')}>
      <Icon name="info" />
      <span>{t('unsavedChanges')}</span>
      <button disabled={busy} onClick={onDiscard}>
        {t('discard')}
      </button>
      <button className="primary" disabled={busy} onClick={onSave}>
        {t('save')}
      </button>
    </div>
  );
}
