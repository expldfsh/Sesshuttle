import { requireThat } from './util.mjs';

// An unidentified or unreadable record can still own a target ID. Only narrow
// the guard when the scanner actually identified every conflicting copy.
export function checkScope(
  scan,
  ids,
  { allowDuplicateRemoval = false, allowUnrelatedFileErrors = false } = {},
) {
  const selected = new Set(ids);
  for (const error of scan.errors) {
    if (error.code === 'duplicate_identity' && error.id) {
      requireThat(!selected.has(error.id) || allowDuplicateRemoval, 'duplicate_identity', error.id);
      continue;
    }
    if (allowUnrelatedFileErrors && error.file && error.id && !selected.has(error.id)) continue;
    requireThat(false, 'scan_incomplete', error.file ?? error.home);
  }
}

export function checkUnchanged(before, after, ids) {
  checkScope(after, ids, { allowUnrelatedFileErrors: true });
  const selected = new Set(ids);
  const signature = (scan) =>
    JSON.stringify(
      scan.rows
        .filter((row) => selected.has(row.id))
        .map((row) => [row.id, row.hash, row.physicalFiles, row.archived]),
    );
  requireThat(signature(before) === signature(after), 'stale_plan');
}
