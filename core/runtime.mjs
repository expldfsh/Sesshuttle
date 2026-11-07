import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { KNOWN_VERSIONS } from './codex.mjs';
import { Fault, hash, requireThat } from './util.mjs';

const exec = promisify(execFile);
const rule = 2;
const versions = new Map();

// Official npm installations may keep the JS launcher across native package upgrades.
async function executable(binary) {
  requireThat(typeof binary === 'string' && path.isAbsolute(binary), 'binary_required');
  const file = await fs.realpath(binary);
  if (path.basename(file) !== 'codex.js') return file;
  const root = path.dirname(path.dirname(file));
  const pkg = await fs
    .readFile(path.join(root, 'package.json'), 'utf8')
    .then(JSON.parse)
    .catch(() => null);
  if (pkg?.name !== '@openai/codex') return file;
  const platform = process.platform,
    arch = process.arch;
  const triplet = {
    linux: { x64: 'x86_64-unknown-linux-musl', arm64: 'aarch64-unknown-linux-musl' },
    darwin: { arm64: 'aarch64-apple-darwin', x64: 'x86_64-apple-darwin' },
  }[platform]?.[arch];
  if (triplet) {
    let optional;
    try {
      optional = path.dirname(
        createRequire(file).resolve('@openai/codex-' + platform + '-' + arch + '/package.json'),
      );
    } catch {}
    for (const base of [optional, root].filter(Boolean))
      for (const folder of ['bin', 'codex']) {
        const candidate = path.join(base, 'vendor', triplet, folder, 'codex');
        if ((await fs.stat(candidate).catch(() => null))?.isFile()) return fs.realpath(candidate);
      }
  }
  return file;
}
async function identity(binary) {
  try {
    const file = await executable(binary),
      stat = await fs.stat(file, { bigint: true });
    requireThat(stat.isFile(), 'binary_unavailable');
    const stamp = [file, stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].join('|');
    if (versions.has(stamp)) return versions.get(stamp);
    const { stdout } = await exec(file, ['--version'], {
      timeout: 5000,
      maxBuffer: 8192,
      env: { PATH: process.env.PATH, LANG: 'C' },
    });
    const version = stdout
      .trim()
      .match(/^(?:codex-cli\s+)?(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.+-]+)?)$/m)?.[1];
    requireThat(version, 'binary_not_codex');
    const fd = await fs.open(file, 'r');
    let script;
    try {
      const buf = Buffer.alloc(2);
      await fd.read(buf, 0, 2, 0);
      script = buf.toString() === '#!';
    } finally {
      await fd.close();
    }
    const result = {
      file,
      version,
      script,
      key:
        'runtime-proof/' + hash([rule, process.platform, process.arch, version, stamp].join('\0')),
    };
    if (versions.size > 100) versions.clear();
    versions.set(stamp, result);
    return result;
  } catch (e) {
    if (e instanceof Fault) throw e;
    throw new Fault('binary_unavailable');
  }
}
export async function readVersion(binary) {
  return (await identity(binary)).version;
}
export async function runtimeInfo(binary, state) {
  const info = await identity(binary);
  const builtin = KNOWN_VERSIONS.includes(info.version),
    saved = state?.get(info.key);
  return {
    ...info,
    status: builtin ? 'builtin' : saved?.passed ? 'verified' : 'untested',
    projects: builtin ? info.version.startsWith('0.166.0') : !!saved?.projects,
    requiresSourceProvider: !!saved?.requiresSourceProvider,
    checkedAt: saved?.checkedAt,
  };
}
export async function requireRuntime(binary, state) {
  const info = await runtimeInfo(binary, state);
  requireThat(info.status !== 'untested', 'runtime_check_needed', info.version);
  return info;
}
export function receiptMatchesRuntime(receipt, identity) {
  if (receipt?.runtime !== identity.version) return false;
  return receipt.runtimeKey ? receipt.runtimeKey === identity.key : identity.status === 'builtin';
}
export async function rememberRuntime(
  binary,
  state,
  expected,
  { projects, requiresSourceProvider },
  signal,
) {
  const fresh = await runtimeInfo(binary, state);
  requireThat(fresh.key === expected.key, 'runtime_changed');
  requireThat(!fresh.script, 'runtime_launcher');
  signal?.throwIfAborted();
  state.set(fresh.key, {
    passed: true,
    projects,
    requiresSourceProvider,
    checkedAt: new Date().toISOString(),
  });
  return runtimeInfo(binary, state);
}
