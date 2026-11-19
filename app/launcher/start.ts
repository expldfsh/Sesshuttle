// This entry runs in plain Node mode, before Chromium starts or resolves a profile.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkedTestRoot, readMarker, runtimePaths } from '../../core/profile-paths.mjs';
import { locationFile, readFolderLocation } from '../../core/folder-location.mjs';
import { spawnSync } from 'node:child_process';
import { messages } from '../renderer/i18n/messages';
import {
  createDataFolder,
  folderName,
  markerName,
  legacyFolder,
  disjoint,
  checkDatabasePaths,
} from '../../core/data-folder.mjs';
const testRoot = checkedTestRoot(process.env.SESSHUTTLE_TEST_ROOT);
const home = testRoot || fs.realpathSync(os.homedir());
const mac = process.platform === 'darwin';
const windows = process.platform === 'win32';
const lang = process.env.LC_ALL || process.env.LC_MESSAGES || process.env.LANG;
const preferred = mac
  ? spawnSync('/usr/bin/defaults', ['read', '-g', 'AppleLanguages'], {
      encoding: 'utf8',
    }).stdout?.match(/["(\s]([a-z]{2})[-_",\s]/i)?.[1]
  : windows
    ? Intl.DateTimeFormat().resolvedOptions().locale
    : null;
const locale = (preferred || lang || 'en').startsWith('zh') ? 0 : 1;
function t(key: keyof typeof messages) {
  return String(messages[key][locale]);
}
const args = process.argv.slice(2);
const option = (key: string) => args.find((a) => a.startsWith(key + '='))?.slice(key.length + 1);
const explicit = option('--sesshuttle-folder');
const dev = process.env.SESSHUTTLE_DEV_ENTRY;
const runtime = dev ? (require('electron') as string) : process.execPath;
const wrapper = windows
  ? path.join(dev ? path.join(dev, 'dist') : path.dirname(runtime), 'Sesshuttle.exe')
  : dev
    ? runtime
    : path.join(path.dirname(runtime), 'sesshuttle');
function run(command: string, argv: string[]) {
  return spawnSync(command, argv, { encoding: 'utf8', maxBuffer: 65536 });
}
const kde = (process.env.XDG_CURRENT_DESKTOP ?? '').toLowerCase().includes('kde');
function native(kind: 'choose' | 'confirm' | 'error', message: string): string | null {
  if (windows) {
    const r = run(wrapper, ['--folder-dialog', kind, message, home]);
    if (r.status === 1) return null;
    if (r.status !== 0) throw r.error || Error(message);
    return kind === 'choose' ? r.stdout : 'ok';
  }
  if (mac) {
    const body =
      kind === 'choose'
        ? 'return POSIX path of (choose folder with prompt msg default location (path to home folder))'
        : kind === 'confirm'
          ? 'display dialog msg with title "Sesshuttle" buttons {item 2 of argv, item 3 of argv} default button 2 cancel button 1'
          : 'display alert "Sesshuttle" message msg as critical';
    const script =
      'on run argv\nset msg to item 1 of argv\ntry\n' +
      body +
      '\nreturn "ok"\non error number -128\nreturn ""\nend try\nend run';
    const r = run('/usr/bin/osascript', ['-e', script, '--', message, t('cancel'), t('folderUse')]);
    if (r.status !== 0) throw Error(r.stderr || message);
    return r.stdout.replace(/\n$/, '') || null;
  }
  for (const command of kde ? ['kdialog', 'zenity'] : ['zenity', 'kdialog']) {
    const flags =
      command === 'zenity'
        ? kind === 'choose'
          ? ['--file-selection', '--directory', '--title=' + message, '--filename=' + home + '/']
          : [
              kind === 'error' ? '--error' : '--question',
              '--title=Sesshuttle',
              '--no-markup',
              '--text=' + message,
            ]
        : kind === 'choose'
          ? ['--title', message, '--getexistingdirectory', home]
          : ['--title', 'Sesshuttle', kind === 'error' ? '--error' : '--yesno', message];
    const r = run(command, flags);
    if ((r.error as NodeJS.ErrnoException)?.code === 'ENOENT') continue;
    if (r.status === 1) return null;
    if (r.status !== 0) throw Error(r.stderr || message);
    return r.stdout.replace(/\n$/, '') || 'ok';
  }
  throw Error(t('folderLinuxPicker'));
}
async function launch() {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const pass = args.filter(
    (a) => !['--sesshuttle-folder=', '--user-data-dir='].some((k) => a.startsWith(k)),
  );
  const execute = (extra: string[]) => {
    const argv = [runtime, ...(dev ? [dev] : []), ...pass, ...extra];
    if (!windows && process.execve) process.execve(runtime, argv, env as Record<string, string>);
    const r = spawnSync(runtime, argv.slice(1), { env, stdio: 'inherit' });
    process.exit(r.status ?? 1);
  };
  if (testRoot && !env.SESSHUTTLE_TEST_LAUNCHER)
    return execute(['--user-data-dir=' + path.join(testRoot, 'runtime', 'profile')]);
  const standard = path.join(home, folderName);
  const hasMarker = (p: string) => fs.existsSync(path.join(p, markerName));
  function allowed(folder: string) {
    if (testRoot && !folder.startsWith(testRoot + path.sep)) throw Error(t('unsafe_path'));
    disjoint(folder, testRoot ? path.join(testRoot, 'legacy') : legacyFolder());
    disjoint(folder, path.join(home, testRoot ? 'codex' : '.codex'));
    if (!testRoot && env.CODEX_HOME && path.isAbsolute(env.CODEX_HOME))
      disjoint(folder, path.resolve(env.CODEX_HOME));
  }
  async function ready(folder: string, expectedId?: string) {
    const visited = new Set<string>();
    let current = folder;
    for (;;) {
      allowed(current);
      if (visited.has(current) || visited.size > 32) throw Error(t('folder_relocated'));
      visited.add(current);
      const marker = readMarker(current, expectedId);
      if (!marker.movedTo) {
        fs.accessSync(current, fs.constants.W_OK | fs.constants.X_OK);
        const data = path.join(current, 'data');
        if (marker.initialized || fs.existsSync(data)) {
          if (fs.realpathSync(data) !== data) throw Error(t('folder_invalid'));
          await checkDatabasePaths(data);
          fs.accessSync(
            path.join(data, 'sesshuttle.sqlite'),
            fs.constants.R_OK | fs.constants.W_OK,
          );
        }
        for (const dir of Object.values(runtimePaths(current)))
          fs.accessSync(dir, fs.constants.W_OK | fs.constants.X_OK);
        return current;
      }
      if (typeof marker.movedId !== 'string') throw Error(t('folder_relocated'));
      expectedId = marker.movedId;
      current = marker.movedTo;
    }
  }
  let root: string | undefined;
  let invalidLocation = false;
  const saved = explicit
    ? null
    : await readFolderLocation(home).catch(() => {
        invalidLocation = true;
        native('error', t('folder_location_invalid') + '\n' + locationFile(home));
        return null;
      });
  const initial =
    (explicit && path.resolve(explicit)) ||
    saved?.folder ||
    (!invalidLocation && hasMarker(standard) ? standard : undefined);
  if (initial) {
    try {
      root = await ready(initial, saved?.id);
    } catch {
      native('error', t('folderRelocate') + '\n' + initial);
      // Reconnecting a drive while the message is open needs no new selection.
      root = await ready(initial, saved?.id).catch(() => undefined);
    }
  }
  while (!root) {
    const picked = native('choose', t(initial ? 'folderChooseExisting' : 'folderChooseParent'));
    if (!picked) return;
    try {
      const parent = fs.realpathSync(picked);
      const target = hasMarker(parent) ? parent : path.join(parent, folderName);
      allowed(target);
      if (hasMarker(target)) root = await ready(target, saved?.id);
      else if (initial) throw Error(t('folderChooseExisting'));
      else {
        const message = [t('folderCreateAt'), target, '', t('folderOpenFromIcon')];
        if (target !== standard) message.push(t('folderLocationNote'), locationFile(home));
        if (native('confirm', message.join('\n')))
          root = await ready(await createDataFolder(parent));
      }
    } catch {
      native('error', t(initial ? 'folder_location_mismatch' : 'folderChooseAgain'));
    }
  }
  const profile = path.join(root, 'runtime', 'profile');
  env.SESSHUTTLE_LAUNCHER = wrapper;
  execute(['--sesshuttle-folder=' + root, '--user-data-dir=' + profile]);
}
launch().catch((error) => {
  try {
    native('error', String(error.message));
  } catch {
    process.stderr.write(String(error.message) + '\n');
  }
  process.exitCode = 1;
});
