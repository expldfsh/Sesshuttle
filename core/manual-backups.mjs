import fs from 'node:fs/promises';
import path from 'node:path';
import { atomic, canonical, hash, id, inside, requireThat, walk } from './util.mjs';
import { copyVerified, digestFile } from './stream.mjs';

export async function inventory(home) {
  const files = [];
  for (const dir of ['sessions', 'archived_sessions', 'sesshuttle_assets']) {
    await inside(home, path.join(home, dir));
    files.push(...(await walk(path.join(home, dir))));
  }
  for (const e of await fs.readdir(home, { withFileTypes: true })) {
    if (/^((state|thread_history)_\d+\.sqlite(?:-wal|-shm)?|session_index\.jsonl)$/.test(e.name)) {
      requireThat(e.isFile(), 'unsafe_path');
      files.push(path.join(home, e.name));
    }
  }
  const result = [];
  for (const file of files.sort()) {
    await inside(home, file);
    const s = await fs.stat(file, { bigint: true });
    result.push({
      path: path.relative(home, file),
      stamp: [s.dev, s.ino, s.size, s.mtimeNs, s.ctimeNs].join('/'),
    });
  }
  return result;
}
export async function createBackup(importer, home) {
  home = await canonical(home);
  if (importer.testRoot) await inside(importer.testRoot, path.join(home, 'target-check'));
  const state = importer.state,
    backupId = id(),
    root = await inside(state.root, path.join(state.root, 'backups', backupId));
  const before = await inventory(home),
    files = [];
  await fs.mkdir(root, { recursive: true, mode: 0o700 });
  try {
    for (const item of before) {
      const source = await inside(home, path.join(home, item.path));
      const { bytes, hash: digest } = await digestFile(source);
      const disk = await fs.statfs(root);
      requireThat(disk.bavail * disk.bsize > bytes + 256 * 1024 * 1024, 'disk_space');
      await copyVerified(source, path.join(root, 'data', item.path), digest);
      files.push({ path: item.path, bytes, hash: digest });
    }
    requireThat(JSON.stringify(await inventory(home)) === JSON.stringify(before), 'backup_changed');
    const info = {
      id: backupId,
      home,
      createdAt: new Date().toISOString(),
      reason: 'manual',
      files,
      created: [],
      status: 'ready',
    };
    await atomic(path.join(root, 'manifest.json'), JSON.stringify(info));
    return state.set('backup/' + backupId, info);
  } catch (e) {
    await fs.rm(root, { recursive: true, force: true });
    throw e;
  }
}
export async function backupSummary(state, info) {
  const root = await inside(state.root, path.join(state.root, 'backups', info.id));
  let diskBytes = 0;
  for (const file of await walk(root)) {
    const s = await fs.stat(file);
    diskBytes += s.blocks * 512;
  }
  return {
    id: info.id,
    home: info.home,
    reason: info.reason,
    createdAt: info.createdAt,
    count: info.files.length,
    restorePending: state.get('restore/' + info.id)?.status === 'prepared',
    diskBytes,
  };
}
export async function deleteBackup(state, backupId) {
  const info = state.get('backup/' + backupId);
  requireThat(info && info.id === backupId, 'backup_not_found');
  const pending = state.keys('import/').some((k) => {
    const r = state.get(k);
    return r.backup === backupId && ['prepared', 'validating', 'needs_recovery'].includes(r.status);
  });
  requireThat(!pending && state.get('restore/' + backupId)?.status !== 'prepared', 'backup_in_use');
  const root = await inside(state.root, path.join(state.root, 'backups', backupId));
  await fs.rm(root, { recursive: true, force: true });
  state.remove('backup/' + backupId);
}
export async function restoreReview(info) {
  const current = await inventory(info.home),
    originals = new Set(info.files.map((f) => f.path));
  return {
    token: hash(JSON.stringify([info.id, current])),
    remove: current.map((f) => f.path).filter((p) => !originals.has(p)),
    count: info.files.length,
    home: info.home,
  };
}
