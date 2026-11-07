// Startup: test-mode isolation, single instance, local state recovery, window and IPC.
import { app, dialog } from 'electron';
import fs from 'node:fs/promises';
import { realpathSync, readFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { State } from '../../core/state.mjs';
import { Engine } from '../../core/engine.mjs';
import { Importer } from '../../core/importer.mjs';
import { Trash } from '../../core/trash.mjs';
import { Removals } from '../../core/removals.mjs';
import { requireThat, publicError, exists, canonical } from '../../core/util.mjs';
import { DEFAULT_THEME_ID } from '../shared/themes';
import { applyAppearance } from './menu';
import { createWindow } from './window';
import { createHandlers, registerIpc } from './ipc-handlers';
import type { Context } from './context';

const testRoot = process.env.SESSHUTTLE_TEST_ROOT;
// Test mode only runs inside a marked, private directory below the system temp folder.
if (testRoot) {
  const canonicalRoot = realpathSync(testRoot);
  const tempRoots = [realpathSync(os.tmpdir()), realpathSync('/tmp')];
  requireThat(
    canonicalRoot === testRoot &&
      path.basename(testRoot).startsWith('sesshuttle-') &&
      tempRoots.some((p) => testRoot.startsWith(p + path.sep)) &&
      JSON.parse(readFileSync(path.join(testRoot, '.sesshuttle-test.json'), 'utf8')).format === 1,
    'unsafe_path',
  );
  app.setPath('userData', path.join(testRoot, 'app-data'));
}

const ctx: Context = {
  testRoot,
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
  for (const name of ['staging', 'downloads']) {
    const root = path.join(state.root, name);
    if (await exists(root))
      for (const entry of await fs.readdir(root))
        if (/^[0-9a-f-]{36}$/.test(entry))
          await fs.rm(path.join(root, entry), { recursive: true, force: true });
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

async function start() {
  if (testRoot) {
    await fs.mkdir(testRoot, { recursive: true });
    requireThat((await canonical(testRoot)) === testRoot, 'unsafe_path');
    await fs.mkdir(path.join(testRoot, 'codex'), { recursive: true });
  }
  const state = (ctx.state = new State(app.getPath('userData')));
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
      dialog.showErrorBox('sesshuttle', publicError(error).code);
      app.quit();
    });
app.on('window-all-closed', () => app.quit());
app.on('will-quit', () => {
  try {
    ctx.state?.close();
  } catch {}
});
