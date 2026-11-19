import fs from 'node:fs/promises';
import { readlinkSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { DatabaseSync, backup } from 'node:sqlite';
import { Fault, atomic, exists, hash, id, inside, requireThat } from './util.mjs';
import { copyVerified, digestFile } from './stream.mjs';
import { State } from './state.mjs';
import { readMarker, markerName } from './profile-paths.mjs';
import { reserveWindowsInstance } from './windows-instance.mjs';
export { markerName };

export const folderName = 'Sesshuttle Data';
export const shortcutName =
  process.platform === 'win32'
    ? 'Open Sesshuttle.cmd'
    : process.platform === 'darwin'
      ? 'Open Sesshuttle.command'
      : 'Open Sesshuttle.sh';

const database = 'sesshuttle.sqlite';
const uuid = /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i;
const durable = ['backups', 'trash', 'recovered', 'launchers', 'connection-secret.bin'];
const temporary = ['downloads', 'staging', 'temp'];
// Only these Chromium products can be discarded after the user reviews the old location.
const chromium = [
  'Cache',
  'Code Cache',
  'GPUCache',
  'DawnGraphiteCache',
  'DawnWebGPUCache',
  'Dictionaries',
  'DIPS',
  'DIPS-wal',
  'DIPS-shm',
  'DevToolsActivePort',
  'Extension State',
  'GPUPersistentCache',
  'declarative_performance_observer.db',
  'declarative_performance_observer.db-journal',
  'SingletonCookie',
  'SingletonSocket',
  'Local Storage',
  'Session Storage',
  'Shared Dictionary',
  'blob_storage',
  'Crashpad',
  'Network',
  'Preferences',
  'Local State',
  'Cookies',
  'Cookies-journal',
  'Network Persistent State',
  'SharedStorage',
  'Trust Tokens',
  'Trust Tokens-journal',
  'TransportSecurity',
];
export function legacyFolder(
  home = os.homedir(),
  platform = process.platform,
  configHome = process.env.XDG_CONFIG_HOME,
) {
  return path.join(
    platform === 'win32'
      ? process.env.APPDATA || path.join(home, 'AppData', 'Roaming')
      : platform === 'darwin'
        ? path.join(home, 'Library', 'Application Support')
        : configHome && path.isAbsolute(configHome)
          ? configHome
          : path.join(home, '.config'),
    'sesshuttle',
  );
}
export async function openDataFolder(folder) {
  readMarker(folder);
  return folder;
}
export async function createDataFolder(parent, movingFrom = null) {
  const root = path.join(await fs.realpath(parent), folderName);
  await fs.mkdir(root, { mode: 0o700 }); // Never adopt a nonempty folder by name.
  try {
    await atomic(
      path.join(root, markerName),
      JSON.stringify({
        format: 1,
        product: 'sesshuttle',
        id: id(),
        ...(movingFrom ? { movingFrom } : {}),
      }),
    );
  } catch (error) {
    await fs.rmdir(root).catch(() => {});
    throw error;
  }
  return root;
}

function databaseSignature(db) {
  requireThat(db.prepare('PRAGMA quick_check').get().quick_check === 'ok', 'corrupt_backup');
  const digest = createHash('sha256');
  for (const row of db
    .prepare("SELECT key,value FROM kv WHERE key != 'folderMigration' ORDER BY key")
    .iterate())
    digest.update(JSON.stringify([row.key, row.value]) + '\n');
  return digest.digest('hex');
}
function sourceDb(source) {
  return new DatabaseSync(path.join(source, database), { readOnly: true });
}
async function rootIdentity(source) {
  const stat = await fs.lstat(source, { bigint: true });
  requireThat(stat.isDirectory() && (await fs.realpath(source)) === source, 'unsafe_path');
  return [String(stat.dev), String(stat.ino)];
}
const controlLinks = new Set([
  'SingletonCookie',
  'SingletonSocket',
  'runtime/profile/SingletonCookie',
  'runtime/profile/SingletonSocket',
]);
async function inventory(root, names, skip = new Set()) {
  const files = [],
    dirs = [];
  async function visit(name) {
    if (skip.has(name)) return;
    const candidate = path.join(root, name);
    if (controlLinks.has(name)) {
      if (path.dirname(candidate) !== root) await inside(root, path.dirname(candidate));
      if ((await fs.lstat(candidate)).isSymbolicLink()) {
        files.push({ name, link: await fs.readlink(candidate) });
        return;
      }
    }
    const file = await inside(root, candidate);
    const stat = await fs.lstat(file);
    if (stat.isDirectory()) {
      dirs.push(name);
      for (const child of (await fs.readdir(file)).sort()) await visit(path.join(name, child));
    } else {
      requireThat(stat.isFile(), 'unsafe_path');
      const executable = name.startsWith('launchers' + path.sep) && (stat.mode & 0o100) !== 0;
      files.push({
        name,
        ...(await digestFile(file)),
        ...(executable ? { executable: true } : {}),
      });
    }
  }
  for (const name of names) {
    if (
      await fs.lstat(path.join(root, name)).catch((e) => {
        if (e.code !== 'ENOENT') throw e;
      })
    )
      await visit(name);
  }
  return { files, dirs };
}
export async function checkDatabasePaths(source) {
  for (const suffix of ['', '-wal', '-shm', '-journal'])
    await inside(source, path.join(source, database + suffix));
}
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export function disjoint(a, b) {
  const outside = (root, file) => {
    const rel = path.relative(root, file);
    return rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel);
  };
  requireThat(outside(a, b) && outside(b, a), 'folder_overlap');
}
// Chromium encodes hostname and PID in this symlink. Never steal a live or remote lock.
const ownedLocks = new Map();
export async function reserveSource(source, portable) {
  const dir = portable
    ? await inside(path.dirname(source), path.join(path.dirname(source), 'runtime', 'profile'))
    : source;
  if (process.platform === 'win32') {
    const stat = await fs.stat(dir, { bigint: true });
    return reserveWindowsInstance('folder/' + stat.dev + '/' + stat.ino, 'folder_in_use');
  }
  const lock = path.join(dir, 'SingletonLock'),
    owner = os.hostname() + '-' + process.pid;
  let lease = ownedLocks.get(lock);
  if (!lease) {
    try {
      await fs.symlink(owner, lock);
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      const previous = await fs.readlink(lock).catch(() => '');
      const prefix = os.hostname() + '-';
      const pid = previous.startsWith(prefix) ? previous.slice(prefix.length) : '';
      let dead = false;
      if (/^[1-9]\d*$/.test(pid) && Number(pid) <= 2147483647) {
        try {
          process.kill(Number(pid), 0);
        } catch (error) {
          dead = error.code === 'ESRCH';
        }
      }
      requireThat(dead && (await fs.readlink(lock)) === previous, 'folder_in_use', dir);
      await fs.unlink(lock);
      try {
        await fs.symlink(owner, lock);
      } catch {
        throw new Fault('folder_in_use', dir);
      }
    }
    lease = { count: 0 };
    ownedLocks.set(lock, lease);
  }
  lease.count++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--lease.count) return;
    ownedLocks.delete(lock);
    try {
      if (readlinkSync(lock) === owner) unlinkSync(lock);
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }
  };
}
async function withSourceLock(source, portable, work) {
  const release = await reserveSource(source, portable);
  try {
    return await work();
  } finally {
    release();
  }
}
export async function migrateData(source, target, { portable = false, ownedState = null } = {}) {
  await openDataFolder(target);
  if (portable) await openDataFolder(path.dirname(source));
  disjoint(portable ? path.dirname(source) : source, target);
  requireThat(!(await exists(path.join(target, 'data'))), 'folder_not_empty');
  const identity = await rootIdentity(source);
  const sourceParent = portable ? await rootIdentity(path.dirname(source)) : null;
  const copy = async () => {
    await checkDatabasePaths(source);
    // A failed or killed copy can be retried in the same destination. The marker
    // is written first and identifies the only staging directory we own.
    const marker = readMarker(target);
    const stage = path.join(target, '.incoming-' + marker.id);
    if (marker.staging === marker.id) {
      await inside(target, stage);
      await fs.rm(stage, { recursive: true, force: true });
    } else {
      requireThat(!(await exists(stage)), 'folder_not_empty');
      await atomic(
        path.join(target, markerName),
        JSON.stringify({ ...marker, staging: marker.id }),
      );
    }
    await fs.mkdir(stage, { mode: 0o700 });
    let db, next;
    try {
      const before = await inventory(source, durable);
      db = sourceDb(source);
      const signature = databaseSignature(db);
      await backup(db, path.join(stage, database));
      for (const dir of before.dirs) await fs.mkdir(path.join(stage, dir), { mode: 0o700 });
      for (const f of before.files) {
        const destination = path.join(stage, f.name);
        await copyVerified(path.join(source, f.name), destination, f.hash);
        if (f.executable) await fs.chmod(destination, 0o700);
      }
      requireThat(
        equal(await inventory(stage, durable), before) &&
          equal(await inventory(source, durable), before),
        'stale_plan',
      );
      next = new State(stage);
      requireThat(
        databaseSignature(next.db) === signature &&
          databaseSignature(db) === signature &&
          uuid.test(next.get('device')?.id),
        'stale_plan',
      );
      requireThat(!next.get('folderMigration'), 'migration_pending');
      const method = next.get('credentialMethod');
      const methods = portable
        ? []
        : [
            ...new Set([
              ...((process.platform === 'darwin' && !!method) || method === 'mac-keychain'
                ? ['mac-keychain']
                : []),
              ...(next.get('credentialReference') || method === 'secret-service'
                ? ['secret-service']
                : []),
              ...(before.files.some((f) => f.name === 'connection-secret.bin') ||
              method === 'system'
                ? ['system']
                : []),
            ]),
          ];
      // Device, Codex homes and project paths are external identities. Only the
      // saved display path into our own trash changes.
      for (const key of next.keys('removal-plan/')) {
        const plan = next.get(key);
        if (!plan) continue;
        for (const g of plan.local ?? [])
          if (g.binPath?.startsWith(source + path.sep))
            g.binPath = path.join(target, 'data', path.relative(source, g.binPath));
        next.set(key, plan);
      }
      next.set('folderMigration', {
        source,
        target,
        portable,
        identity,
        sourceParent,
        device: next.get('device').id,
        signature,
        before,
        copiedSignature: portable ? databaseSignature(next.db) : null,
        methods,
        method,
        reference: next.get('credentialReference'),
        connection: next.get('connection'),
        credentialsReady: !methods.length,
        progress: null,
      });
      next.close();
      next = null;
      db.close();
      db = null;
      await fs.rename(stage, path.join(target, 'data'));
      const ready = readMarker(target);
      delete ready.staging;
      await atomic(path.join(target, markerName), JSON.stringify(ready));
    } finally {
      next?.close();
      db?.close();
      await fs.rm(stage, { recursive: true, force: true });
    }
  };
  if (ownedState) {
    requireThat(
      portable && ownedState.root === source && ownedState.db.isOpen,
      'migration_invalid',
    );
    return copy();
  }
  return withSourceLock(source, portable, copy);
}

// Resume a copy that finished just before an interruption publishing the two markers.
export async function verifyPreparedMove(active, target) {
  const root = await inside(target, path.join(target, 'data'));
  await checkDatabasePaths(root);
  const db = sourceDb(root);
  try {
    const m = JSON.parse(
      db.prepare('SELECT value FROM kv WHERE key=?').get('folderMigration')?.value ?? 'null',
    );
    requireThat(
      m?.portable &&
        m.source === active.root &&
        m.target === target &&
        m.device === active.get('device').id &&
        !m.progress,
      'migration_invalid',
    );
    requireThat(
      databaseSignature(active.db) === m.signature &&
        databaseSignature(db) === m.copiedSignature &&
        equal(await inventory(active.root, durable), m.before) &&
        equal(await inventory(root, durable), m.before),
      'migration_changed',
    );
  } finally {
    db.close();
  }
}

async function migrationSource(state, legacy) {
  const m = state.get('folderMigration');
  requireThat(
    m && m.target === path.dirname(state.root) && state.get('device')?.id === m.device,
    'migration_invalid',
  );
  if (m.portable) {
    const parent = path.dirname(m.source);
    requireThat(path.basename(m.source) === 'data', 'migration_invalid');
    if (await exists(parent)) {
      requireThat(equal(await rootIdentity(parent), m.sourceParent), 'migration_invalid');
      if (!m.progress?.retiredFiles) {
        const marker = readMarker(parent);
        requireThat(
          marker.movedTo === m.target && marker.movedId === readMarker(m.target).id,
          'migration_invalid',
        );
      }
    } else requireThat(m.progress?.retiredFiles, 'migration_invalid');
  } else requireThat(legacy === m.source, 'migration_invalid');
  disjoint(m.source, m.target);
  if (await exists(m.source))
    requireThat(equal(await rootIdentity(m.source), m.identity), 'migration_invalid');
  else requireThat(m.progress?.retiredFiles, 'migration_invalid');
  return m;
}
async function matchesCopy(file, expected) {
  return (
    (await digestFile(file)).hash === expected.hash &&
    (!expected.executable || ((await fs.stat(file)).mode & 0o100) !== 0)
  );
}
async function review(state, m) {
  requireThat(m.credentialsReady, 'migration_credentials');
  if (m.protectedHash)
    requireThat(
      hash(state.get('migratedSecrets') ?? '') === m.protectedHash,
      'migration_credentials',
    );
  await checkDatabasePaths(m.source);
  const db = sourceDb(m.source);
  try {
    requireThat(databaseSignature(db) === m.signature, 'migration_changed');
  } finally {
    db.close();
  }
  const originals = await inventory(m.source, durable);
  requireThat(equal(originals, m.before), 'migration_changed');
  for (const f of originals.files) {
    const dest = await inside(state.root, path.join(state.root, f.name));
    requireThat((await exists(dest)) && (await matchesCopy(dest, f)), 'migration_changed');
  }
  const disposable = await inventory(m.source, [...temporary, ...(m.portable ? [] : chromium)]);
  const names = [
    ...new Set(
      [...originals.files, ...disposable.files]
        .map((f) => f.name.split(path.sep)[0])
        .concat(originals.dirs, disposable.dirs)
        .map((n) => n.split(path.sep)[0]),
    ),
  ].sort();
  names.push(database);
  const extra = m.portable
    ? await inventory(
        path.dirname(m.source),
        [markerName, shortcutName, 'runtime'],
        new Set([path.join('runtime', 'profile', 'SingletonLock')]),
      )
    : { files: [], dirs: [] };
  const display = m.portable
    ? [
        ...names.map((n) => 'data/' + n),
        ...new Set(
          [...extra.files, ...extra.dirs.map((name) => ({ name }))].map(
            (f) => f.name.split(path.sep)[0],
          ),
        ),
      ]
    : names;
  const token = hash(JSON.stringify([m.signature, m.identity, originals, disposable, extra]));
  return {
    token,
    names: display,
    originals,
    disposable,
    extra,
    source: m.portable ? path.dirname(m.source) : m.source,
    target: m.target,
  };
}
export async function migrationReview(state, legacy) {
  const m = await migrationSource(state, legacy);
  if (m.progress)
    return {
      token: m.progress.token,
      names: m.progress.names,
      source: m.portable ? path.dirname(m.source) : m.source,
      target: m.target,
    };
  const r = await withSourceLock(m.source, m.portable, () => review(state, m));
  return { token: r.token, names: r.names, source: r.source, target: r.target };
}

async function removeReviewed(root, files, dirs, allowed, copyRoot) {
  for (const f of files) {
    const first = f.name.split(path.sep)[0];
    requireThat(allowed.includes(first), 'unsafe_path');
    if (Object.hasOwn(f, 'link')) {
      requireThat(controlLinks.has(f.name), 'unsafe_path');
      const entry = path.join(root, f.name);
      if (path.dirname(entry) !== root) await inside(root, path.dirname(entry));
      const link = await fs.readlink(entry).catch((e) => {
        if (e.code !== 'ENOENT') throw e;
        return null;
      });
      if (link !== null) {
        requireThat(link === f.link, 'migration_changed');
        await fs.unlink(entry);
      }
      continue;
    }
    const file = await inside(root, path.join(root, f.name));
    if (!(await exists(file))) continue;
    requireThat(await matchesCopy(file, f), 'migration_changed');
    if (copyRoot && durable.includes(first))
      requireThat(
        await matchesCopy(await inside(copyRoot, path.join(copyRoot, f.name)), f),
        'migration_changed',
      );
    await fs.unlink(file);
  }
  for (const name of [...dirs].reverse()) {
    requireThat(allowed.includes(name.split(path.sep)[0]), 'unsafe_path');
    await removeEmpty(await inside(root, path.join(root, name)));
  }
}
async function removeEmpty(dir) {
  await fs.rmdir(dir).catch((e) => {
    if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(e.code)) throw e;
  });
}
// Each removal has a verified copy or appears explicitly as disposable in the review.
// Journal completion before removing a directory that identified the old installation.
export async function cleanMigration(state, legacy, token, forget = async (_migration) => {}) {
  let m = await migrationSource(state, legacy);
  if (!m.progress?.retiredFiles)
    await withSourceLock(m.source, m.portable, async () => {
      const resuming = !!m.progress;
      if (!resuming) {
        const r = await review(state, m);
        requireThat(r.token === token, 'stale_plan');
        m = {
          ...m,
          progress: {
            token,
            names: r.names,
            files: [...r.originals.files, ...r.disposable.files],
            dirs: [...r.originals.dirs, ...r.disposable.dirs],
            extra: r.extra,
            retired: '.sesshuttle-retired-' + id(),
          },
        };
        state.set('folderMigration', m);
      }
      const p = m.progress;
      requireThat(
        token === p.token && /^\.sesshuttle-retired-[a-f\d-]{36}$/.test(p.retired),
        'stale_plan',
      );
      requireThat(
        m.credentialsReady &&
          (!m.protectedHash || hash(state.get('migratedSecrets') ?? '') === m.protectedHash),
        'migration_credentials',
      );
      await checkDatabasePaths(m.source);
      const original = path.join(m.source, database),
        retired = await inside(m.source, path.join(m.source, p.retired));
      if (await exists(original)) {
        requireThat(!(await exists(retired)), 'migration_changed');
        // A cancelled keyring prompt must leave the original database usable.
        if (resuming) requireThat((await review(state, m)).token === token, 'migration_changed');
        await forget(m);
        const db = new DatabaseSync(original);
        try {
          requireThat(
            !db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get().busy &&
              databaseSignature(db) === m.signature,
            'migration_changed',
          );
          requireThat(
            db.prepare('PRAGMA journal_mode=DELETE').get().journal_mode === 'delete',
            'folder_in_use',
          );
        } finally {
          db.close();
        }
        await fs.rename(original, retired);
      }
      await removeReviewed(
        m.source,
        p.files,
        p.dirs,
        [...durable, ...temporary, ...(m.portable ? [] : chromium)],
        state.root,
      );
      if (await exists(retired)) {
        const db = new DatabaseSync(retired, { readOnly: true });
        try {
          requireThat(databaseSignature(db) === m.signature, 'migration_changed');
        } finally {
          db.close();
        }
        await fs.unlink(retired);
      }
      p.retiredFiles = true;
      state.set('folderMigration', m);
    });
  requireThat(m.progress.token === token, 'stale_plan');
  await removeEmpty(m.source);
  if (m.portable && (await exists(path.dirname(m.source)))) {
    const parent = path.dirname(m.source),
      extra = m.progress.extra;
    await removeReviewed(
      parent,
      extra.files,
      extra.dirs,
      [
        markerName,
        'Open Sesshuttle.command',
        'Open Sesshuttle.sh',
        'Open Sesshuttle.cmd',
        'runtime',
      ],
      null,
    );
    await removeEmpty(parent);
  }
  state.remove('folderMigration');
}
