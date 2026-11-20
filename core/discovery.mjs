import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { binaryVersion } from './native.mjs';
import { knownRuntimeVersion } from './codex.mjs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { isScript, resolveLauncher, runtimeProgram } from './runtime.mjs';

const entries = ['desktop', 'cli', 'ide'];
const directories = async (name) => await fs.readdir(name, { withFileTypes: true }).catch(() => []);
const directory = async (name) =>
  !!name && !!(await fs.stat(name).catch(() => null))?.isDirectory();
async function executable(file) {
  try {
    await fs.access(file, constants.X_OK);
    return (await fs.stat(file)).isFile();
  } catch {
    return false;
  }
}
async function parents(proc, pid) {
  const result = [],
    seen = new Set();
  while (/^\d+$/.test(pid) && !seen.has(pid) && result.length < 12) {
    seen.add(pid);
    const status = await fs.readFile(path.join(proc, pid, 'status'), 'utf8').catch(() => '');
    pid = status.match(/^PPid:\s+(\d+)/m)?.[1] ?? '';
    if (!pid || pid === '0') break;
    const exe = await fs.readlink(path.join(proc, pid, 'exe')).catch(() => '');
    if (exe) result.push(exe);
  }
  return result;
}
async function nativeHomes(procDir) {
  const handles = (await directories(path.join(procDir, 'fd'))).slice(0, 4096);
  const roots = new Set();
  for (let i = 0; i < handles.length; i += 32) {
    const links = await Promise.all(
      handles
        .slice(i, i + 32)
        .map((h) => fs.readlink(path.join(procDir, 'fd', h.name)).catch(() => '')),
    );
    for (const link of links) {
      if (/\/(?:state|thread_history)_\d+\.sqlite(?:-wal|-shm)?$/.test(link))
        roots.add(path.dirname(link));
    }
  }
  // Retain only CODEX_HOME; never return or log the process environment.
  const env = await fs.readFile(path.join(procDir, 'environ'), 'utf8').catch(() => '');
  const explicit = env
    .split('\0')
    .find((s) => s.startsWith('CODEX_HOME='))
    ?.slice(11);
  const result = [...roots].map((home) => ({ home, evidence: 'liveDatabase' }));
  if (explicit && path.isAbsolute(explicit) && !roots.has(explicit))
    result.push({ home: explicit, evidence: 'liveEnvironment' });
  return result;
}
export async function liveLinuxTargets(proc = '/proc', uid = process.getuid?.()) {
  const found = [];
  const processes = (await directories(proc)).filter((p) => /^\d+$/.test(p.name));
  for (let i = 0; i < processes.length; i += 24) {
    await Promise.all(
      processes.slice(i, i + 24).map(async (p) => {
        const dir = path.join(proc, p.name);
        const stat = await fs.stat(dir).catch(() => null);
        if (!stat || stat.uid !== uid) return;
        const binary = await fs.readlink(path.join(dir, 'exe')).catch(() => '');
        if (!/^codex(?:-app-server)?$/.test(path.basename(binary))) return;
        const argv = await fs.readFile(path.join(dir, 'cmdline'), 'utf8').catch(() => '');
        if (!argv.split('\0').includes('app-server')) return;
        const chain = await parents(proc, p.name);
        const app = chain.find((file) => /\/(?:ChatGPT|Codex)$/.test(file));
        const ide = /\/(?:extensions\/openai\.chatgpt-|\.vscode[^/]*\/)/i.test(binary);
        const entry = ide ? 'ide' : app ? 'desktop' : 'cli';
        const homes = await nativeHomes(dir);
        if (!homes.length) homes.push({ home: '', evidence: 'liveBinary' });
        for (const h of homes) found.push({ entry, binary, app: app ?? '', ...h });
      }),
    );
  }
  return found;
}

// Where to open the file chooser for the desktop app when no path is set: the
// resources of an installed app bundle, found with a stat at the moment of choosing.
export async function installedAppResources({ platform = process.platform, testRoot = null } = {}) {
  if (platform === 'win32' && !testRoot) {
    const roots = await windowsAppRoots(process.env);
    for (const root of roots) if (await directory(root)) return root;
    return undefined;
  }
  if (platform !== 'darwin') return undefined;
  const base = testRoot ? path.join(testRoot, 'Applications') : '/Applications';
  for (const name of ['ChatGPT.app', 'Codex.app']) {
    const resources = path.join(base, name, 'Contents/Resources');
    if (await directory(resources)) return resources;
  }
  return undefined;
}

// Ask the OS for per-user Store installations. WindowsApps is not enumerable by ordinary users.
async function windowsAppRoots(env) {
  const roots = [];
  for (const base of [
    env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'Programs'),
    env.ProgramFiles,
  ].filter(Boolean))
    for (const name of ['Codex', 'ChatGPT']) roots.push(path.join(base, name, 'resources'));
  if (!env.SystemRoot) return roots;
  const powershell = path.join(
    env.SystemRoot,
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe',
  );
  const script =
    "[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); Get-AppxPackage -Name 'OpenAI.*' | Where-Object { $_.Name -match '^OpenAI\\.(Codex|ChatGPT)(-|$)' } | ForEach-Object { $_.InstallLocation }";
  try {
    const { stdout } = await promisify(execFile)(
      powershell,
      ['-NoProfile', '-NonInteractive', '-Command', script],
      // A cold Appx module on Windows 11 can take tens of seconds to load.
      { windowsHide: true, timeout: 90000, maxBuffer: 65536 },
    );
    for (const base of stdout.split(/\r?\n/).filter((p) => path.isAbsolute(p))) {
      roots.push(path.join(base, 'app', 'resources'), path.join(base, 'resources'));
    }
  } catch {
    /* Saved and manually selected paths remain available. */
  }
  return roots;
}

export async function detectEnvironment({
  config = {},
  testRoot = null,
  platform = process.platform,
  proc = '/proc',
  userHome = os.homedir(),
  env = process.env,
  version = binaryVersion,
  appRoots = platform === 'darwin'
    ? ['/Applications/ChatGPT.app/Contents/Resources', '/Applications/Codex.app/Contents/Resources']
    : platform === 'win32'
      ? []
      : ['/usr/lib/chatgpt', '/opt/ChatGPT', '/opt/chatgpt', '/usr/lib/codex'],
} = {}) {
  const defaultHome = testRoot ? path.join(testRoot, 'codex') : path.join(userHome, '.codex');
  const candidates = testRoot || platform !== 'linux' ? [] : await liveLinuxTargets(proc);
  const add = (entry, binary, home, evidence, app = '') =>
    candidates.push({ entry, binary, home, evidence, app });
  const launchers = [...new Set(candidates.map((c) => c.app).filter(Boolean))];
  if (!testRoot) {
    const home = path.isAbsolute(env.CODEX_HOME ?? '') ? env.CODEX_HOME : defaultHome;
    const windows = platform === 'win32';
    if (windows && !appRoots.length) appRoots = await windowsAppRoots(env);
    for (const dir of [
      ...(env.PATH ?? '').split(path.delimiter),
      ...(windows
        ? env.APPDATA
          ? [path.join(env.APPDATA, 'npm')]
          : []
        : ['/opt/homebrew/bin', '/usr/local/bin', path.join(userHome, '.local/bin')]),
    ].filter((p) => path.isAbsolute(p))) {
      add(
        'cli',
        path.join(dir, platform === 'win32' ? 'codex.exe' : 'codex'),
        home,
        'installedBinary',
      );
      if (windows) add('cli', path.join(dir, 'codex.cmd'), home, 'installedBinary');
    }
    for (const root of appRoots) {
      const names =
        platform === 'darwin'
          ? ['../MacOS/ChatGPT', '../MacOS/Codex']
          : windows
            ? ['../Codex.exe', '../ChatGPT.exe']
            : ['ChatGPT', 'Codex'];
      let launcher = '';
      for (const name of names) {
        const file = path.resolve(root, name);
        if (await executable(file)) {
          launcher = file;
          if (!launchers.includes(file)) launchers.push(file);
          break;
        }
      }
      for (const suffix of windows
        ? [
            'codex.exe',
            'codex-cli/bin/codex.exe',
            'codex-cli/vendor/x86_64-pc-windows-msvc/bin/codex.exe',
            'app.asar.unpacked/codex-cli/bin/codex.exe',
          ]
        : [
            'codex-cli/bin/codex',
            'codex',
            'resources/codex-cli/bin/codex',
            'resources/codex',
            'resources/app.asar.unpacked/codex-cli/bin/codex',
          ])
        add('desktop', path.join(root, suffix), home, 'installedBinary', launcher);
    }
    for (const editor of ['.vscode', '.vscode-insiders', '.vscode-oss', '.cursor']) {
      const root = path.join(userHome, editor, 'extensions');
      for (const e of await directories(root))
        if (e.name.startsWith('openai.chatgpt-')) {
          const arch =
            platform === 'darwin'
              ? 'macos-aarch64'
              : platform === 'win32'
                ? 'windows-x86_64'
                : 'linux-x86_64';
          add(
            'ide',
            path.join(root, e.name, 'bin', arch, platform === 'win32' ? 'codex.exe' : 'codex'),
            home,
            'installedBinary',
          );
        }
    }
  }
  for (const entry of entries) {
    const saved = config.targets?.[entry];
    if (saved?.binary) add(entry, saved.binary, saved.home, 'savedPath');
  }
  const versions = new Map(),
    unique = new Map();
  for (const c of candidates) {
    if (!(await executable(c.binary))) continue;
    // A launcher in a verified layout is shown as the program it starts; two
    // candidates for one program then collapse below.
    const resolved = await resolveLauncher(c.binary);
    if (resolved) {
      c.resolvedFrom = c.binary;
      c.binary = resolved;
    }
    const bin = await fs.realpath(c.binary);
    const live = c.evidence.startsWith('live');
    // An installation fallback must not obscure a running instance of the same executable.
    if (
      !live &&
      [...unique.values()].some(
        (x) => x.entry === c.entry && x.canonicalBinary === bin && x.evidence.startsWith('live'),
      )
    )
      continue;
    if (!versions.has(bin))
      versions.set(
        bin,
        await version(c.binary)
          .then(async (runtime) =>
            // A script is only trusted with a supported version: a quick check refuses it.
            !knownRuntimeVersion(runtime, platform) && (await isScript(await runtimeProgram(bin)))
              ? { error: 'runtime_launcher' }
              : { runtime },
          )
          .catch((e) => ({ error: e.code ?? 'binary_unavailable' })),
      );
    const home = c.home || defaultHome;
    const canonicalHome = await fs.realpath(home).catch(() => home);
    const key = JSON.stringify([c.entry, bin, canonicalHome]);
    if (!unique.has(key))
      unique.set(key, {
        ...c,
        home,
        canonicalBinary: bin,
        ...versions.get(bin),
        homeAvailable: await directory(home),
        assumedHome: !c.home || c.evidence === 'installedBinary',
      });
  }
  const homes = [
    ...new Set([
      defaultHome,
      ...(config.sourceHomes ?? []),
      ...[...unique.values()].map((x) => x.home),
    ]),
  ];
  return {
    launchers,
    candidates: [...unique.values()],
    sourceHomes: await Promise.all(
      homes.map(async (home) => ({ path: home, available: await directory(home) })),
    ),
  };
}
