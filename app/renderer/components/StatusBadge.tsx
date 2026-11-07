import { useI18n } from '../i18n/I18n';

// Status is always shown as a dot and words; the color only repeats the meaning.
const TONES: Record<string, 'success' | 'accent' | 'warning' | 'danger'> = {
  // Done: synced, verified, uploaded, completed, imported.
  synced: 'success',
  verified: 'success',
  uploaded: 'success',
  completed: 'success',
  downloaded: 'success',
  connected: 'success',
  appReady: 'success',
  // In progress or one side has news.
  running: 'accent',
  checking: 'accent',
  local_changes: 'accent',
  remote_changes: 'accent',
  // Needs a look: partial, attention, in use, pending, missing attachments.
  partial: 'warning',
  attention: 'warning',
  busy: 'warning',
  interrupted: 'warning',
  paused: 'warning',
  imported: 'warning',
  imported_missing_attachments: 'warning',
  conflict_preserved: 'warning',
  replaced: 'warning',
  restored_needs_validation: 'warning',
  locally_removed: 'warning',
  excluded: 'warning',
  needsCheck: 'warning',
  // Failed, conflicting or blocked.
  failed: 'danger',
  conflict: 'danger',
  blocked: 'danger',
  not_configured: 'danger',
  missingRuntime: 'danger',
  missingFolder: 'danger',
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
