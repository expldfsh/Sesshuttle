// Startup: test-mode isolation, single instance, local state recovery, window and IPC.
import { app, dialog } from 'electron';
import fs from 'node:fs/promises';
import net from 'node:net';
import { checkedTestRoot, readMarker, runtimePaths } from '../../core/profile-paths.mjs';
import { initializeFolder, label } from './data-folder';
import path from 'node:path';
import os from 'node:os';
import { State } from '../../core/state.mjs';
import { Engine } from '../../core/engine.mjs';
import { Importer } from '../../core/importer.mjs';
import { Trash } from '../../core/trash.mjs';
import { Removals } from '../../core/removals.mjs';
import { requireThat, publicError, exists, canonical, inside, hash } from '../../core/util.mjs';
import { DEFAULT_THEME_ID } from '../shared/themes';
import { applyAppearance } from './menu';
import { createWindow } from './window';
import { createHandlers, registerIpc } from './ipc-handlers';
import type { Context } from './context';

const testRoot = checkedTestRoot(process.env.SESSHUTTLE_TEST_ROOT);
const dataFolder = process.argv
  .find((a) => a.startsWith('--sesshuttle-folder='))
  ?.slice('--sesshuttle-folder='.length);
const testFixture = testRoot && !dataFolder;
try {
  if (!testFixture) {
    requireThat(dataFolder, 'folder_invalid');
    if (testRoot) requireThat(dataFolder!.startsWith(testRoot + path.sep), 'unsafe_path');
    requireThat(!readMarker(dataFolder).movedTo, 'folder_relocated');
  }
  for (const [name, value] of Object.entries(runtimePaths(testFixture ? testRoot : dataFolder)))
    app.setPath(name, value);
} catch (e) {
  const code = publicError(e).code;
  dialog.showErrorBox(
    'Sesshuttle',
    label(code === 'folder_relocated' ? code : 'folderRelocate', process.env.LANG ?? 'en') +
      (dataFolder ? '\n' + dataFolder : ''),
  );
  process.exit(1);
}

const ctx: Context = {
  testRoot,
  dataFolder,
  rendererFile: path.join(__dirname, 'renderer', 'index.html'),
  state: null,
  engine: null,
  trash: null,
  removals: null,
  window: null,
  secrets: null,
  recovery: null,
  activeProof: null,
  deletionActive: false,
  attachmentPicks: new Set(),
};

function firstConfig() {
  const home = testRoot ? path.join(testRoot, 'codex') : path.join(os.homedir(), '.codex');
  return {
    theme: DEFAULT_THEME_ID,
    language: app.getLocale().startsWith('zh') ? 'zh-CN' : 'en',
    sourceHomes: [home],
    targets: Object.fromEntries(
      ['desktop', 'cli', 'ide'].map((entry) => [entry, { home, binary: '' }]),
    ),
    bindings: {},
    nativeBindings: {},
  };
}

// Discards private staging left by a previous run and marks interrupted work.
// Nothing is retried or resumed automatically.
async function recoverLocalState(state: any, trash: any) {
  for (const name of ['staging', 'downloads', 'temp']) {
    const root = path.join(state.root, name);
    if (await exists(root)) {
      await inside(state.root, root);
      for (const entry of await fs.readdir(root))
        if (
          (name === 'temp' ? /^sesshuttle-runtime-[A-Za-z0-9]{6}$/ : /^[0-9a-f-]{36}$/).test(entry)
        )
          await fs.rm(await inside(state.root, path.join(root, entry)), {
            recursive: true,
            force: true,
          });
    }
  }
  for (const k of state.keys('job/')) {
    const j = state.get(k);
    if (j.status === 'running') state.set(k, { ...j, status: 'interrupted' });
  }
  for (const k of state.keys('import/')) {
    const task = state.get(k);
    if (['prepared', 'validating'].includes(task.status))
      state.set(k, { ...task, status: task.backup ? 'needs_recovery' : 'interrupted' });
  }
  for (const info of trash.list())
    if (['prepared', 'removing', 'restoring'].includes(info.status))
      await trash.mark(info, 'needs_recovery');
}

async function reserveInstance() {
  const name =
    'com.expldfsh.sesshuttle.' +
    (process.getuid?.() ?? 0) +
    (testRoot ? '.' + hash(testRoot).slice(0, 16) : '');
  if (process.platform === 'darwin') {
    const addon = require(
      path.join(app.isPackaged ? process.resourcesPath : __dirname, 'macos-keychain.node'),
    );
    requireThat(addon.reserveInstance(name), 'folder_another_instance');
  } else {
    const server = net.createServer((socket) => socket.destroy());
    await new Promise<void>((resolve, reject) => {
      server.once('error', () => reject(new Error('folder_another_instance')));
      server.listen('\0' + name, resolve);
    }).catch(() => requireThat(false, 'folder_another_instance'));
    app.once('will-quit', () => server.close());
  }
}
async function start() {
  await reserveInstance();
  if (testRoot) {
    await fs.mkdir(testRoot, { recursive: true });
    requireThat((await canonical(testRoot)) === testRoot, 'unsafe_path');
    await fs.mkdir(path.join(testRoot, 'codex'), { recursive: true });
  }
  const state = testFixture
    ? new State(path.join(testRoot!, 'app-data'))
    : await initializeFolder(ctx);
  if (!state) {
    app.quit();
    return;
  }
  ctx.state = state;
  if (!state.get('config')) state.set('config', firstConfig());
  const importer = new Importer(
    state,
    (testRoot ? { testRoot, processGuard: async () => {} } : {}) as any,
  );
  ctx.trash = new Trash(state, importer);
  await recoverLocalState(state, ctx.trash);
  const send = (data: unknown) => ctx.window?.webContents.send('sesshuttle:progress', data);
  ctx.engine = new Engine(state, { importer, onProgress: send } as any);
  ctx.removals = new Removals(ctx.engine, ctx.trash, {
    onProgress: (job: any) => send({ kind: 'removal-progress', job }),
  } as any);
  applyAppearance(null, state.get('config'));
  ctx.window = createWindow(ctx);
  registerIpc(ctx, createHandlers(ctx));
  await ctx.window.loadFile(ctx.rendererFile);
}

const primaryInstance = app.requestSingleInstanceLock();
if (!primaryInstance) app.quit();
app.on('second-instance', () => {
  const window = ctx.window;
  if (!window) return;
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
});
if (primaryInstance)
  app
    .whenReady()
    .then(start)
    .catch((error) => {
      const problem = publicError(error);
      dialog.showErrorBox(
        'Sesshuttle',
        label(problem.code) + (problem.detail ? '\n' + problem.detail : ''),
      );
      app.quit();
    });
app.on('window-all-closed', () => app.quit());
app.on('will-quit', () => {
  try {
    ctx.state?.close();
    ctx.releaseLegacy?.();
  } catch {}
});
