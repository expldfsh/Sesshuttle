import fs from 'node:fs/promises';
import path from 'node:path';
import { constants } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { KNOWN_VERSIONS } from './codex.mjs';
import { Fault, hash, requireThat } from './util.mjs';

const exec = promisify(execFile);
const rule = 2;
const versions = new Map();

const BUNDLE_LAUNCHER = /^(.+\/([^/]+\.app))\/Contents\/Resources\/codex-cli\/bin\/codex$/;
const BUNDLE_PROGRAM = 'Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex';
// Verified app bundles. The script at bin/codex only starts the program next to it.
const VERIFIED_BUNDLES = ['ChatGPT.app', 'Codex.app'];

const canRun = (file) =>
  fs.access(file, constants.X_OK).then(
    () => true,
    () => false,
  );
export async function isScript(file) {
  const fd = await fs.open(file, 'r');
  try {
    const buf = Buffer.alloc(2);
    await fd.read(buf, 0, 2, 0);
    return buf.toString() === '#!';
  } finally {
    await fd.close();
  }
}
// The program behind an app bundle's launcher script: a regular non-script file that
// stays inside the same bundle after links are followed; otherwise null.
async function bundleProgram(launcher) {
  try {
    const [, bundle, name] = launcher.match(BUNDLE_LAUNCHER) ?? [];
    if (!bundle || !(await isScript(launcher))) return null;
    const file = await fs.realpath(path.join(bundle, BUNDLE_PROGRAM));
    if (!file.startsWith(bundle + path.sep)) return null;
    if (!(await fs.stat(file)).isFile() || (await isScript(file))) return null;
    return { file, verified: VERIFIED_BUNDLES.includes(name) };
  } catch {
    return null;
  }
}
// The real program for a launcher in a verified layout, or null. Reads files only.
export async function resolveLauncher(binary) {
  try {
    const found = await bundleProgram(await fs.realpath(binary));
    return found?.verified ? found.file : null;
  } catch {
    return null;
  }
}

// A verified app bundle starts its program through a script, and official npm
// installations may keep the JS launcher across native package upgrades. Both are
// followed to the file that actually runs; the configured path stays as the user set it.
async function executable(binary) {
  requireThat(typeof binary === 'string' && path.isAbsolute(binary), 'binary_required');
  const file = await fs.realpath(binary);
  const bundled = await bundleProgram(file);
  if (bundled?.verified) return bundled.file;
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
// The file that actually runs for a path: its launcher followed to the real program.
export const runtimeProgram = executable;
async function identity(binary) {
  try {
    const file = await executable(binary),
      stat = await fs.stat(file, { bigint: true });
    requireThat(stat.isFile(), 'binary_unavailable');
    requireThat(await canRun(file), 'binary_not_executable');
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
    const result = {
      file,
      stamp,
      version,
      script: await isScript(file),
      key: proofKey(version, stamp),
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
const proofKey = (version, stamp) =>
  'runtime-proof/' + hash([rule, process.platform, process.arch, version, stamp].join('\0'));
const seenKey = (file) => 'runtime-seen/' + hash(file);
export async function runtimeInfo(binary, state) {
  const info = await identity(binary);
  // Remember the version of this exact file so its status can be shown later
  // without running it again (see savedRuntimeStatus).
  if (state && state.get(seenKey(info.file))?.stamp !== info.stamp)
    state.set(seenKey(info.file), { stamp: info.stamp, version: info.version });
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

// What the interface shows for a path the user just chose or typed. Reads the file
// header and asks the program for its version, the same as the detection; the only
// thing kept is the remembered version of this exact file (runtimeInfo).
export async function inspectRuntime(binary, state) {
  const report = {
    path: binary,
    exists: false,
    executable: false,
    script: false,
    resolved: null,
    version: null,
    status: null,
    error: null,
    candidate: null,
  };
  let file;
  try {
    file = await executable(binary);
  } catch (e) {
    return { ...report, error: e.code === 'binary_required' ? e.code : 'binary_missing' };
  }
  const stat = await fs.stat(file).catch(() => null);
  if (!stat?.isFile()) return { ...report, error: 'binary_missing' };
  report.exists = true;
  report.resolved = file === binary ? null : file;
  report.executable = await canRun(file);
  if (!report.executable) return { ...report, error: 'binary_not_executable' };
  report.script = await isScript(file);
  try {
    const info = await runtimeInfo(binary, state);
    report.version = info.version;
    report.status = info.status;
  } catch (e) {
    report.error = e.code === 'binary_unavailable' && report.script ? 'runtime_launcher' : e.code;
  }
  if (report.script && report.status === 'untested') report.error = 'runtime_launcher';
  if (report.error === 'runtime_launcher')
    report.candidate = (await bundleProgram(file))?.file ?? null;
  return report;
}

// What the interface shows for a configured path without running it: the saved status,
// 'launcher' for a script that has not shown a usable version, the program actually
// used when it differs from the path, and a bundle program worth offering by hand.
export async function savedRuntimeDetail(binary, state) {
  const status = await savedRuntimeStatus(binary, state);
  if (status === 'missing') return { status };
  try {
    const file = await executable(binary);
    const launcher = ['unchecked', 'untested'].includes(status) && (await isScript(file));
    return {
      status: launcher ? 'launcher' : status,
      resolved: file === binary ? null : file,
      candidate: launcher ? ((await bundleProgram(file))?.file ?? null) : null,
    };
  } catch {
    return { status: 'missing' };
  }
}

// The status of a configured runtime from saved state only: the file is resolved
// and stat'ed, never executed. 'unchecked' means this exact file has not been
// checked on this computer yet.
export async function savedRuntimeStatus(binary, state) {
  try {
    const file = await executable(binary),
      stat = await fs.stat(file, { bigint: true });
    if (!stat.isFile()) return 'missing';
    const stamp = [file, stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].join('|');
    const seen = state.get(seenKey(file));
    if (seen?.stamp !== stamp) return 'unchecked';
    if (KNOWN_VERSIONS.includes(seen.version)) return 'builtin';
    return state.get(proofKey(seen.version, stamp))?.passed ? 'verified' : 'untested';
  } catch {
    return 'missing';
  }
}
