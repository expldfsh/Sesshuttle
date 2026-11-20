import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
export const LIMIT = 64 * 1024 * 1024;
// Items by a field; like Array.find, the first item with a value wins.
// Items grouped by a field, in their original order.
export function groupBy(items, field, value = (item) => item) {
  const groups = new Map();
  for (const item of items) {
    const list = groups.get(item[field]);
    if (list) list.push(value(item));
    else groups.set(item[field], [value(item)]);
  }
  return groups;
}
export function indexBy(items, field) {
  const index = new Map();
  for (const item of items) if (!index.has(item[field])) index.set(item[field], item);
  return index;
}
export const id = () => randomUUID();
export const hash = (x) => createHash('sha256').update(x).digest('hex');
export class Fault extends Error {
  constructor(code, detail = '') {
    super(code);
    this.code = code;
    this.detail = detail;
  }
}
export const requireThat = (condition, code, detail = '') => {
  if (!condition) throw new Fault(code, detail);
};
export const exists = async (p) => {
  try {
    await fs.lstat(p);
    return true;
  } catch (e) {
    if (e.code === 'ENOENT') return false;
    throw e;
  }
};
export function absoluteLocalPath(value, paths = path) {
  if (typeof value !== 'string' || !paths.isAbsolute(value)) return false;
  if (paths.sep !== '\\') return true;
  // A drive-relative path or device namespace is not a filesystem location to adopt.
  return /^[a-z]:[\\/]/i.test(value) || /^\\\\(?![?.]\\)[^\\]+\\[^\\]+(?:\\|$)/.test(value);
}

export function childPath(root, candidate, paths = path) {
  const relative = paths.relative(root, candidate);
  requireThat(
    relative &&
      relative !== '..' &&
      !relative.startsWith('..' + paths.sep) &&
      !paths.isAbsolute(relative),
    'unsafe_path',
  );
  if (paths.sep === '\\') {
    for (const name of relative.split('\\')) {
      requireThat(
        !/[<>:"|?*]|[. ]$/.test(name) &&
          !Array.from(name).some((c) => c.charCodeAt(0) < 32) &&
          !/^(?:con|prn|aux|nul|conin\$|conout\$|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(name),
        'unsafe_path',
      );
    }
  }
  return relative;
}

export function portableBasename(value) {
  return (/^(?:[a-z]:[\\/]|\\\\)/i.test(value) ? path.win32 : path.posix).basename(value);
}

export function ordinaryWindowsPath(p) {
  // Native programs can return the extended spelling of a drive or UNC path.
  if (typeof p !== 'string') return p;
  if (/^\\\\\?\\[a-z]:\\/i.test(p)) return p.slice(4);
  if (/^\\\\\?\\UNC\\/i.test(p)) return '\\\\' + p.slice(8);
  return p;
}

// Whether a file: URL names this local file. Chromium and Node spell one path
// differently (which characters are escaped, the case of a drive letter or share),
// so the decoded paths are compared instead of the two spellings.
export function fileUrlNames(url, file, windows = process.platform === 'win32') {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'file:' || parsed.search || parsed.hash) return false;
    const named = fileURLToPath(parsed, { windows });
    return windows ? named.toLowerCase() === file.toLowerCase() : named === file;
  } catch {
    return false;
  }
}

export async function canonical(p) {
  if (process.platform === 'win32') p = ordinaryWindowsPath(p);
  requireThat(absoluteLocalPath(p), 'invalid_path');
  return fs.realpath(p);
}
export async function inside(root, p) {
  const base = await canonical(root);
  const target = path.resolve(p);
  const relative = childPath(base, target);
  let current = base;
  for (const part of relative.split(path.sep)) {
    current = path.join(current, part);
    try {
      const s = await fs.lstat(current);
      requireThat(!s.isSymbolicLink() && (!s.isFile() || s.nlink === 1), 'unsafe_path');
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }
  }
  return current;
}
export async function stableRead(file, limit = LIMIT) {
  const handle = await fs.open(
    file,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const before = await handle.stat();
    requireThat(before.isFile() && before.size <= limit, 'file_too_large');
    const data = await handle.readFile();
    const after = await handle.stat();
    requireThat(before.size === after.size && before.mtimeMs === after.mtimeMs, 'busy');
    return data;
  } finally {
    await handle.close();
  }
}
// The value of a promise, or `fallback` when it has not settled after `ms`. The work
// behind the promise goes on.
export function within(promise, ms, fallback) {
  let timer;
  return Promise.race([
    promise,
    new Promise((resolve) => {
      timer = setTimeout(() => resolve(fallback), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}
// On Windows a scanner or indexer can hold a file for a moment after it was written.
// Renaming that file, or a folder that contains it, is refused meanwhile, so the
// rename is tried again for about two seconds. Elsewhere these errors are final.
export async function rename(from, to, tries = process.platform === 'win32' ? 6 : 1) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fs.rename(from, to);
    } catch (e) {
      if (attempt >= tries || !['EPERM', 'EBUSY', 'EACCES'].includes(e.code)) throw e;
      await new Promise((resolve) => setTimeout(resolve, 100 * attempt));
    }
  }
}
// Removes a folder as a step of an operation, which fails if the folder stays. A file
// that is busy for a moment is waited for.
export const removeFolder = (dir) =>
  fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
// Discards a private working folder that is no longer needed. One that cannot be
// removed now is left to the cleanup at the next start (or to the next attempt that
// reuses its place) instead of turning work that already finished into a failure.
export const discardFolder = (dir) => removeFolder(dir).catch(() => {});
export async function atomic(file, data) {
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = file + '.tmp-' + id();
  const h = await fs.open(tmp, 'wx', 0o600);
  try {
    await h.writeFile(data);
    await h.sync();
  } finally {
    await h.close();
  }
  await rename(tmp, file);
}
export async function walk(root) {
  const files = [];
  async function visit(dir) {
    for (const e of await fs.readdir(dir, { withFileTypes: true })) {
      requireThat(!e.isSymbolicLink(), 'unsafe_path');
      const p = path.join(dir, e.name);
      if (e.isDirectory()) await visit(p);
      else if (e.isFile()) files.push(p);
      else throw new Fault('unsafe_path');
    }
  }
  if (await exists(root)) await visit(root);
  return files;
}
// Marks an error raised after an operation began to change data, so that the
// interface does not report that nothing ran.
export function afterStart(e) {
  if (e && typeof e === 'object') e.started = true;
  return e;
}
export function publicError(e) {
  const localCodes = {
    EACCES: 'local_permission_denied',
    EPERM: 'local_permission_denied',
    EROFS: 'read_only_disk',
    ENOSPC: 'disk_space',
    ENOENT: 'local_path_missing',
    EBUSY: 'local_in_use',
    SQLITE_BUSY: 'local_in_use',
  };
  return {
    code:
      localCodes[e?.code] ?? (e?.code && /^[a-z_]+$/.test(e.code) ? e.code : 'operation_failed'),
    detail: e instanceof Fault ? e.detail : localCodes[e?.code] ? String(e.path ?? '') : '',
    ...(e?.started === true ? { started: true } : {}),
    ...(e?.targets ? { targets: e.targets } : {}),
  };
}
