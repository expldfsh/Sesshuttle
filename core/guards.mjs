import fs from 'node:fs/promises';
import { requireThat } from './util.mjs';

// Every write keeps this much free space on the destination volume.
const RESERVE = 256 * 1024 * 1024;

export async function ensureFreeSpace(dir, bytes) {
  const disk = await fs.statfs(dir);
  requireThat(disk.bavail * disk.bsize > bytes + RESERVE, 'disk_space');
}

// An import that wrote files but was not verified must be resolved first.
const PENDING_IMPORT = ['prepared', 'validating', 'needs_recovery'];

export function pendingImports(state) {
  return state
    .keys('import/')
    .map((key) => [key, state.get(key)])
    .filter(([, task]) => PENDING_IMPORT.includes(task?.status));
}

export function hasPendingImport(state, home) {
  return pendingImports(state).some(([, task]) => task.home === home);
}
