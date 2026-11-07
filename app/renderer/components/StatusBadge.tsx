import { useI18n } from '../i18n/I18n';

// Status is always shown as a dot and words; the color only repeats the meaning.
const TONES: Record<string, 'success' | 'accent' | 'warning' | 'danger'> = {
  synced: 'success',
  verified: 'success',
  uploaded: 'success',
  completed: 'success',
  downloaded: 'success',
  connected: 'success',
  running: 'accent',
  checking: 'accent',
  local_changes: 'accent',
  remote_changes: 'accent',
  partial: 'warning',
  attention: 'warning',
  busy: 'warning',
  pending: 'warning',
  interrupted: 'warning',
  paused: 'warning',
  imported: 'warning',
  imported_missing_attachments: 'warning',
  conflict_preserved: 'warning',
  restored_needs_validation: 'warning',
  locally_removed: 'warning',
  excluded: 'warning',
  failed: 'danger',
  conflict: 'danger',
  blocked: 'danger',
  not_configured: 'danger',
};

export const toneOf = (status: string) => TONES[status] ?? 'neutral';

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  const { t } = useI18n();
  return (
    <span className={`badge tone-${toneOf(status)}`}>
      <span className="badge-dot" aria-hidden="true" />
      {label ?? t(status)}
    </span>
  );
}
