// This entry runs in plain Node mode, before Chromium starts or resolves a profile.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkedTestRoot } from '../../core/profile-paths.mjs';
import { chooseDataFolder } from '../../core/folder-choice.mjs';
import { spawnSync } from 'node:child_process';
import { messages } from '../renderer/i18n/messages';
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
    ? // The Windows launcher passes the display language; the regional format can differ.
      process.env.SESSHUTTLE_LANG || Intl.DateTimeFormat().resolvedOptions().locale
    : null;
const locale = (preferred || lang || 'en').startsWith('zh') ? 0 : 1;
function t(key: string) {
  return String((messages as Record<string, readonly unknown[]>)[key]?.[locale] ?? key);
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
function native(
  kind: 'choose' | 'confirm' | 'error',
  message: string,
  accept = t('folderUse'),
): string | null {
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
    const r = run('/usr/bin/osascript', ['-e', script, '--', message, t('cancel'), accept]);
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
  // A failure before the window opens is reported in the language chosen here.
  env.SESSHUTTLE_LANG = locale ? 'en' : 'zh-CN';
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
  const root = await chooseDataFolder({
    home,
    explicit,
    testRoot,
    codexHome: env.CODEX_HOME,
    ask: native,
    t,
  });
  if (!root) return;
  const profile = path.join(root, 'runtime', 'profile');
  env.SESSHUTTLE_LAUNCHER = wrapper;
  execute(['--sesshuttle-folder=' + root, '--user-data-dir=' + profile]);
}
launch().catch((error) => {
  // A failure with a known code is explained; anything else is shown as it is.
  const text = error?.code in messages ? t(error.code) : String(error?.message ?? error);
  try {
    native('error', text);
  } catch {
    process.stderr.write(text + '\n');
  }
  process.exitCode = 1;
});
