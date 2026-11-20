import { canonical } from './util.mjs';

// Whether a verified import still describes how this app is set up, so that the
// conversation can be opened from here.
// - The Codex data folder is compared in the resolved form the import recorded: the
//   setting may spell the same folder another way.
// - The Codex runtime matters to the CLI only, which Sesshuttle starts itself. The
//   desktop app and the editor are handed a link, and an update of a Store app moves
//   its runtime to a new folder.
export async function importMatchesSettings(entry, record, target, project) {
  if (!record || !target?.home || !project || project !== record.project) return false;
  if (entry === 'cli' && target.binary !== record.binary) return false;
  return (await canonical(target.home).catch(() => null)) === record.home;
}
