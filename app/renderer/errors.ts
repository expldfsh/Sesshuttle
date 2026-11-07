// How the interface treats each error code: how serious it is and which repair
// it offers. A repair only opens the place to fix the problem; it never retries
// a data operation by itself.
export type Severity = 'error' | 'warning' | 'info';
export type FixAction =
  | 'openSettings' // storage connection or credentials
  | 'openBackups' // interrupted import, restore or removal
  | 'showScanIssues' // the scan could not identify every history
  | 'inspectCopies' // two copies of one conversation
  | 'compareVersions' // diverged cloud versions
  | 'openApps' // an app's Codex runtime, data folder or project folder
  | 'refreshRetry' // the preview is out of date
  | 'retry'; // review the same operation again

export type ErrorRule = { severity: Severity; fix?: FixAction };

const rules = (fix: FixAction | undefined, severity: Severity, codes: string) =>
  Object.fromEntries(codes.split(/\s+/).map((code) => [code, { severity, fix }]));

const RULES: Record<string, ErrorRule> = {
  ...rules(
    'openSettings',
    'error',
    `storage_permission storage_write_permission storage_not_connected decrypt_failed
     credentials_required invalid_endpoint invalid_bucket invalid_key space_not_found
     credential_restore_failed credential_item_missing space_changed`,
  ),
  ...rules(
    'openBackups',
    'warning',
    `import_needs_recovery recovery_required trash_recovery_required trash_needs_recovery
     cloud_cleanup_pending restore_pending backup_in_use`,
  ),
  ...rules('showScanIssues', 'warning', 'scan_incomplete'),
  ...rules('inspectCopies', 'warning', 'duplicate_identity copies_indexed copies_multiple_homes'),
  ...rules('compareVersions', 'warning', 'conflict'),
  ...rules(
    'openApps',
    'error',
    `entry_home_missing binary_unavailable binary_not_codex binary_required
     runtime_check_needed working_folder_missing project_required destination_project_missing
     project_assignment_unsupported custom_home_launcher no_protocol_handler terminal_required`,
  ),
  ...rules(
    'refreshRetry',
    'warning',
    'stale_plan cloud_check_failed storage_unavailable concurrent_update cloud_writer_busy runtime_changed',
  ),
  ...rules(
    'retry',
    'warning',
    `busy codex_running native_provider_missing native_timeout native_unavailable
     upload_limit large_upload_confirmation attachment_confirmation_required partial_scope_confirmation`,
  ),
  ...rules(undefined, 'info', 'runtime_cancelled nothing_to_remove legacy_format_unsupported'),
};

export const errorRule = (code?: string): ErrorRule =>
  (code && RULES[code]) || { severity: 'error', fix: 'retry' };

// The button text for each repair.
export const FIX_LABELS: Record<FixAction, string> = {
  openSettings: 'manageConnection',
  openBackups: 'backups',
  showScanIssues: 'scanSummary',
  inspectCopies: 'inspectCopies',
  compareVersions: 'compareVersions',
  openApps: 'configureAndContinue',
  refreshRetry: 'refreshAndRetry',
  retry: 'reviewAndRetry',
};

export function fixLabel(code?: string) {
  if (code === 'native_provider_missing') return 'retryProviderImport';
  const fix = errorRule(code).fix;
  return fix ? FIX_LABELS[fix] : null;
}
