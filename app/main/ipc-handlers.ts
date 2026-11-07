import { app, dialog, ipcMain } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { clearActivity } from '../../core/activity.mjs';
import { backupSummary, deleteBackup, restoreReview } from '../../core/manual-backups.mjs';
import { readRecovery, writeRecovery } from '../../core/recovery-file.mjs';
import { changeCloud } from '../../core/cloud-trash.mjs';
import { bundleBytes } from '../../core/bundle.mjs';
import { detectEnvironment } from '../../core/discovery.mjs';
import { localProjects } from '../../core/local-projects.mjs';
import { runtimeInfo } from '../../core/runtime.mjs';
import { verifyRuntime } from '../../core/runtime-check.mjs';
import { downloadCopy } from '../../core/download-copy.mjs';
import { keepLocalCopy, inspectTarget } from '../../core/local-copies.mjs';
import { workspaceFolderName } from '../../core/workspace.mjs';
import { R2Store } from '../../core/storage.mjs';
import { Vault } from '../../core/vault.mjs';
import { newKey, parseKey } from '../../core/crypto.mjs';
import {
  Fault,
  requireThat,
  publicError,
  id,
  atomic,
  exists,
  canonical,
  inside,
} from '../../core/util.mjs';
import { getTheme } from '../shared/themes';
import { isExclusive, isIpcMethod, type IpcMethod } from '../shared/ipc';
import { credentialHealth, persistConnection, retrieveConnection } from './credentials';
import { continueEntry, protocolHandler } from './continue';
import { applyAppearance } from './menu';
import { rendererUrl } from './window';
import type { Context } from './context';

const exec = promisify(execFile);
type Handlers = { [M in IpcMethod]: (args: any) => unknown };

// Settings can display the identifier of the credentials already unlocked on this device.
function connectionForSettings(connection: any, activeSecrets: any) {
  if (!connection) return null;
  return {
    ...connection,
    accessKeyId: activeSecrets?.credentials?.accessKeyId ?? connection.accessKeyId ?? '',
  };
}

function sortedJobs(state: any) {
  return state
    .keys('job/')
    .map((k: string) => state.get(k))
    .sort((a: any, b: any) => b.startedAt.localeCompare(a.startedAt));
}

// Backups, restores and backup deletion hold the engine like a transfer does.
async function holdEngine<T>(ctx: Context, work: () => Promise<T>) {
  requireThat(!ctx.engine.running, 'task_running');
  ctx.engine.running = true;
  try {
    return await work();
  } finally {
    ctx.engine.running = false;
  }
}

async function loadSecrets(ctx: Context) {
  const { state } = ctx;
  try {
    if (ctx.testRoot || state.get('credentialMethod') === 'session') return;
    const value = await retrieveConnection(state);
    if (!value) return;
    const cfg = state.get('connection');
    const vault = new Vault(new R2Store({ ...cfg, ...value.credentials }), cfg.space, value.key, {
      installation: state.get('device').id,
      deviceName: state.get('device').name,
    });
    await vault.open();
    ctx.secrets = value;
    ctx.engine.vault = vault;
    state.set('credentialError', null);
  } catch (e) {
    state.set('credentialError', e instanceof Fault ? e.code : 'credential_restore_failed');
  }
  return { warning: state.get('credentialError') };
}

async function saveCurrentCredentials(ctx: Context) {
  const { state } = ctx;
  requireThat(ctx.secrets && ctx.engine.vault, 'storage_not_connected');
  try {
    await persistConnection(state, ctx.secrets, ctx.testRoot);
    state.set('credentialError', null);
    return { warning: null };
  } catch (e: any) {
    const warning = e instanceof Fault ? e.code : 'credential_write_failed';
    state.set('credentialError', warning);
    return { warning };
  }
}

async function destinationInfo(ctx: Context, targets: any) {
  const output: any = {};
  for (const entry of ['desktop', 'cli', 'ide']) {
    const target = targets?.[entry] ?? {};
    const { home, binary } = target;
    const checked: any = { home, binary, projects: [], supported: false };
    if (!binary) checked.error = 'entry_binary_missing';
    else if (!home) checked.error = 'entry_home_missing';
    else
      try {
        if (ctx.testRoot) await inside(ctx.testRoot, path.join(home, 'probe'));
        requireThat((await fs.stat(home).catch(() => null))?.isDirectory(), 'entry_home_missing');
        checked.proof = await runtimeInfo(binary, ctx.state);
        checked.runtime = checked.proof.version;
        try {
          Object.assign(checked, await localProjects(await canonical(home)));
        } catch {
          checked.projectWarning = 'runtimeCatalogUnavailable';
        }
        checked.supported = checked.supported && checked.proof.projects;
        if (entry !== 'cli') {
          checked.manualOpen = (await canonical(home)) !== path.join(os.homedir(), '.codex');
          if (process.platform === 'linux')
            checked.manualOpen ||= !(await protocolHandler(entry, 2500));
        }
      } catch (e: any) {
        checked.error = e.code === 'ENOENT' ? 'entry_home_missing' : publicError(e).code;
      }
    output[entry] = checked;
  }
  return output;
}

async function saveConfig(ctx: Context, input: any) {
  const { state, engine, testRoot } = ctx;
  requireThat(!engine.running, 'task_running');
  requireThat(
    input &&
      ['zh-CN', 'en'].includes(input.language) &&
      Array.isArray(input.sourceHomes) &&
      input.sourceHomes.length <= 20,
    'invalid_settings',
  );
  const cfg: any = {
    theme: getTheme(input.theme).id,
    language: input.language,
    sourceHomes: [],
    targets: {},
    bindings: {},
    nativeBindings: {},
  };
  for (const p of input.sourceHomes.filter((x: any) => x !== '')) {
    requireThat(typeof p === 'string' && path.isAbsolute(p), 'invalid_path');
    cfg.sourceHomes.push(p);
  }
  for (const entry of ['desktop', 'cli', 'ide']) {
    const t = input.targets?.[entry] ?? {};
    for (const k of ['home', 'binary'])
      requireThat(
        typeof (t[k] ?? '') === 'string' && (!t[k] || path.isAbsolute(t[k])),
        'invalid_path',
      );
    cfg.targets[entry] = { home: t.home ?? '', binary: t.binary ?? '' };
  }
  for (const [k, v] of Object.entries(input.bindings ?? {})) {
    requireThat(
      /^[0-9a-f-]{36}$/i.test(k) && typeof v === 'string' && path.isAbsolute(v),
      'invalid_path',
    );
    cfg.bindings[k] = v;
  }
  for (const [source, homes] of Object.entries(input.nativeBindings ?? {}) as [string, any][]) {
    requireThat(
      /^[0-9a-f-]{36}$/i.test(source) && homes && typeof homes === 'object',
      'invalid_settings',
    );
    cfg.nativeBindings[source] = {};
    for (const [home, projectId] of Object.entries(homes)) {
      requireThat(
        path.isAbsolute(home) && typeof projectId === 'string' && projectId.length <= 256,
        'invalid_settings',
      );
      cfg.nativeBindings[source][home] = projectId;
    }
  }
  if (testRoot) {
    for (const p of cfg.sourceHomes) await inside(testRoot, path.join(p, 'check'));
    for (const t of Object.values(cfg.targets) as any[])
      if (t.home) await inside(testRoot, path.join(t.home, 'check'));
  }
  state.set('config', cfg);
  applyAppearance(ctx.window, cfg);
  if (input.deviceName) {
    requireThat(
      typeof input.deviceName === 'string' && input.deviceName.length <= 80,
      'invalid_settings',
    );
    state.set('device', { ...state.get('device'), name: input.deviceName });
  }
  return cfg;
}

async function connect(ctx: Context, input: any) {
  const { state, engine } = ctx;
  requireThat(!engine.running, 'task_running');
  const cfg = {
    endpoint: String(input.endpoint ?? '').trim(),
    bucket: String(input.bucket ?? '').trim(),
  };
  const credentials = {
    accessKeyId: String(input.accessKeyId ?? ''),
    secretAccessKey: String(input.secretAccessKey ?? ''),
  };
  requireThat(credentials.accessKeyId && credentials.secretAccessKey, 'credentials_required');
  const store = new R2Store({ ...cfg, ...credentials }, ctx.testRoot ? { allowLocal: true } : {});
  await store.test();
  if (input.mode === 'test') return { status: 'connected' };
  const loaded = input.mode === 'join' && input.recoveryToken ? ctx.recovery : null;
  if (input.recoveryToken && input.mode === 'join')
    requireThat(
      loaded?.token === input.recoveryToken &&
        loaded.endpoint === cfg.endpoint &&
        loaded.bucket === cfg.bucket &&
        loaded.space === input.space,
      'recovery_target_changed',
    );
  const space = input.mode === 'create' ? id() : String(input.space ?? '');
  const key = input.mode === 'create' ? newKey() : (loaded?.key ?? String(input.key ?? ''));
  parseKey(key);
  const vault = new Vault(store, space, key, {
    installation: state.get('device').id,
    deviceName: state.get('device').name,
  });
  if (input.mode === 'create') await vault.create();
  else await vault.open();
  // If secure persistence is unavailable, keep the successful connection in memory
  // and return an explicit warning; never write plaintext credentials.
  await engine.clearDownloads();
  ctx.secrets = { credentials, key };
  engine.vault = vault;
  state.set('connection', { ...cfg, space, accessKeyId: credentials.accessKeyId });
  ctx.recovery = null;
  state.set('credentialMethod', 'session');
  state.set(
    'credentialError',
    input.remember ? 'credential_save_pending' : 'credential_session_only',
  );
  return { status: 'connected', space };
}

async function projectInfo(project: string) {
  await canonical(project);
  try {
    const options = { cwd: project, timeout: 5000, maxBuffer: 65536 };
    const [branch, commit, dirty] = await Promise.all([
      exec('git', ['branch', '--show-current'], options),
      exec('git', ['rev-parse', 'HEAD'], options),
      exec('git', ['status', '--short'], options),
    ]);
    return {
      branch: branch.stdout.trim(),
      commit: commit.stdout.trim(),
      changes: dirty.stdout.trim().split('\n').filter(Boolean).length,
    };
  } catch {
    return { git: false };
  }
}

async function createWorkspace(ctx: Context, projectId: string) {
  const row = ctx.engine.rows?.find((r: any) => r.projectId === projectId);
  requireThat(row && /^[0-9a-f-]{36}$/i.test(projectId), 'invalid_selection');
  const base = ctx.testRoot ?? app.getPath('documents');
  if (!(await exists(base))) {
    await inside(os.homedir(), base);
    await fs.mkdir(base, { recursive: true, mode: 0o700 }).catch(() => {
      throw new Fault('workspace_create_failed');
    });
  }
  const documents = await canonical(base);
  const dest = await inside(
    documents,
    path.join(
      documents,
      'Sesshuttle Workspaces',
      workspaceFolderName(row.originProject?.name, projectId),
    ),
  );
  await fs.mkdir(dest, { recursive: true, mode: 0o700 }).catch(() => {
    throw new Fault('workspace_create_failed');
  });
  return canonical(dest);
}

function diagnostics(ctx: Context) {
  return {
    version: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    scanErrors: ctx.engine.local.errors.map((e: any) => ({ code: e.code })),
    jobs: sortedJobs(ctx.state)
      .slice(0, 10)
      .map((j: any) => ({
        startedAt: j.startedAt,
        status: j.status,
        items: j.items.map((i: any) => ({
          action: i.action,
          status: i.status,
          stage: i.stage,
          error: i.error?.code,
          targets: Object.fromEntries(
            Object.entries(i.targets ?? {}).map(([entry, r]: any) => [
              entry,
              { status: r.status, stage: r.stage, error: r.error?.code },
            ]),
          ),
        })),
      })),
  };
}

export function createHandlers(ctx: Context): Handlers {
  const { state } = ctx;
  const engine = () => ctx.engine;
  const pick = (options: Electron.OpenDialogOptions) => dialog.showOpenDialog(ctx.window!, options);
  return {
    init: () => ({
      config: engine().config(),
      device: state.get('device'),
      connection: connectionForSettings(state.get('connection'), ctx.secrets),
      connected: !!engine().vault,
      canRestore:
        !!state.get('connection') && !ctx.testRoot && state.get('credentialMethod') !== 'session',
      credentialMethod: state.get('credentialMethod'),
      credentialError: state.get('credentialError'),
      version: app.getVersion(),
      testMode: !!ctx.testRoot,
      removalJobs: ctx.removals.jobs(),
      jobs: sortedJobs(state),
    }),
    saveConfig: (args) => saveConfig(ctx, args),
    detectPaths: () =>
      detectEnvironment({ config: engine().config(), testRoot: ctx.testRoot } as any),
    destinationInfo: (args) => destinationInfo(ctx, args.targets ?? engine().config().targets),
    verifyRuntime: async (args) => {
      requireThat(!ctx.activeProof, 'runtime_busy');
      requireThat(
        typeof args.id === 'string' &&
          /^[a-f0-9-]{36}$/i.test(args.id) &&
          typeof args.binary === 'string' &&
          path.isAbsolute(args.binary),
        'invalid_selection',
      );
      const controller = new AbortController();
      const done = verifyRuntime(args.binary, state, {
        signal: controller.signal,
        onStage: (stage: string) => {
          if (ctx.window && !ctx.window.isDestroyed())
            ctx.window.webContents.send('sesshuttle:runtime', { id: args.id, stage });
        },
      } as any);
      ctx.activeProof = { id: args.id, controller, done };
      try {
        return await done;
      } finally {
        ctx.activeProof = null;
      }
    },
    cancelRuntimeCheck: (args) => {
      if (ctx.activeProof?.id === args.id) ctx.activeProof?.controller.abort();
      return true;
    },
    versionDetails: (args) => {
      const head = engine().remote.find((h: any) => h.logicalId === args.id);
      requireThat(engine().vault, 'storage_not_connected');
      requireThat(head, 'cloud_version_missing');
      return Promise.all(
        head.tips.map(async (v: string) => {
          const p = await engine().vault.version(v);
          return {
            id: v,
            title: p.title,
            device: p.device?.name,
            at: p.uploadedAt,
            bytes: bundleBytes(p),
            files: p.files.length,
            lastMessage: p.messages?.at(-1)?.text?.slice(0, 180),
          };
        }),
      );
    },
    validateFolders: async (args) => {
      for (const projectId of args.projectIds ?? []) {
        const folder = engine().config().bindings?.[projectId];
        requireThat(
          folder && (await fs.stat(folder).catch(() => null))?.isDirectory(),
          'working_folder_missing',
          folder ?? '',
        );
      }
      return true;
    },
    createWorkspace: (args) => createWorkspace(ctx, args.projectId),
    restoreConnection: () => {
      requireThat(!ctx.secrets, 'invalid_action');
      return loadSecrets(ctx);
    },
    credentialHealth: () => credentialHealth(),
    retryCredentialSave: () => saveCurrentCredentials(ctx),
    refresh: async () => {
      const result = await engine().refresh();
      if (ctx.testRoot)
        await atomic(
          path.join(ctx.testRoot, 'launch-check.json'),
          JSON.stringify({
            version: app.getVersion(),
            platform: process.platform,
            arch: process.arch,
            rendererReady: true,
            rows: result.rows.length,
            scanErrors: result.errors.length,
          }),
        );
      return result;
    },
    pickDirectory: async () => {
      const r = await pick({ properties: ['openDirectory', 'createDirectory'] });
      return r.canceled ? null : r.filePaths[0];
    },
    pickBinary: async () => {
      const r = await pick({ properties: ['openFile'] });
      return r.canceled ? null : r.filePaths[0];
    },
    pickImage: async () => {
      const r = await pick({
        properties: ['openFile'],
        filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] }],
      });
      if (r.canceled) return null;
      ctx.attachmentPicks.add(r.filePaths[0]);
      return r.filePaths[0];
    },
    connect: (args) => connect(ctx, args),
    disconnect: async () => {
      requireThat(!engine().running, 'task_running');
      await engine().clearDownloads();
      engine().vault = null;
      ctx.secrets = null;
      ctx.recovery = null;
      state.set('credentialError', null);
      state.set('connection', null);
      return { status: 'disconnected' };
    },
    importRecovery: async () => {
      const r = await pick({
        properties: ['openFile'],
        filters: [{ name: 'sesshuttle', extensions: ['json'] }],
      });
      if (r.canceled) return null;
      const stat = await fs.stat(r.filePaths[0]);
      requireThat(stat.size < 16384, 'invalid_recovery_file');
      const x = readRecovery(
        await fs.readFile(r.filePaths[0], 'utf8'),
        connectionForSettings(state.get('connection'), ctx.secrets),
      );
      // Validate the destination with the same endpoint policy as the connection before showing it.
      new R2Store(x, ctx.testRoot ? { allowLocal: true } : {});
      const token = id();
      ctx.recovery = { ...x, token };
      return {
        space: x.space,
        endpoint: x.endpoint,
        bucket: x.bucket,
        accessKeyId: x.accessKeyId,
        recoveryToken: token,
      };
    },
    exportRecovery: async () => {
      requireThat(ctx.secrets && engine().vault, 'storage_not_connected');
      const text = writeRecovery(state.get('connection'), ctx.secrets);
      const r = await dialog.showSaveDialog(ctx.window!, {
        defaultPath: 'sesshuttle-recovery.json',
      });
      if (r.canceled || !r.filePath) return null;
      await atomic(r.filePath, text);
      return { saved: true };
    },
    preview: (args) => {
      requireThat(
        Object.values(args.replacements ?? {}).every(
          (p) => typeof p === 'string' && ctx.attachmentPicks.has(p),
        ),
        'invalid_selection',
      );
      return engine().preview(args);
    },
    discardPlan: (args) => engine().discardPlan(args.token),
    execute: (args) =>
      engine().execute(args.token, {
        confirmLarge: args.confirmLarge === true,
        acceptedByItem: args.acceptedByItem ?? {},
        onlyEligible: args.onlyEligible === true,
      }),
    cancel: () => {
      engine().cancel();
      return { status: 'pausing' };
    },
    downloadCopy: async (args) => {
      requireThat(!engine().running, 'task_running');
      requireThat(engine().vault, 'storage_not_connected');
      const picked = await pick({ properties: ['openDirectory', 'createDirectory'] });
      if (picked.canceled || !picked.filePaths[0]) return null;
      return holdEngine(ctx, () =>
        downloadCopy(engine().vault, args.logical, args.version, picked.filePaths[0]),
      );
    },
    inspectTarget: (args) => inspectTarget(engine(), args.entry, args.logical),
    keepLocalCopy: (args) => keepLocalCopy(engine(), args),
    reviewRemoval: (args) => ctx.removals.preview(args),
    retryRemovalPlan: (args) => ctx.removals.retryPlan(args.id),
    reviseRemovalPlan: (args) => ctx.removals.revise(args.id),
    executeRemoval: async (args) => {
      ctx.deletionActive = true;
      try {
        await engine().clearDownloads();
        return await ctx.removals.execute(args.token, args);
      } finally {
        ctx.deletionActive = false;
      }
    },
    finishCloudRemoval: async (args) => {
      requireThat(engine().vault && args.storageKey === ctx.removals.storageKey(), 'space_changed');
      ctx.deletionActive = true;
      engine().running = true;
      try {
        await changeCloud(engine().vault, null, null, args.id);
        return true;
      } finally {
        engine().running = false;
        ctx.deletionActive = false;
      }
    },
    clearActivity: (args) => clearActivity(state, args.keys),
    backupBins: async () => ({
      ...(await ctx.removals.bins()),
      storageKey: ctx.removals.storageKey(),
    }),
    backups: async () => ({
      backups: await Promise.all(
        state.keys('backup/').map((k: string) => backupSummary(state, state.get(k))),
      ),
      imports: state.keys('import/').map((k: string) => state.get(k)),
    }),
    reviewRestore: (args) => {
      const info = state.get('backup/' + args.id);
      requireThat(info, 'backup_not_found');
      return restoreReview(info);
    },
    createBackup: (args) =>
      holdEngine(ctx, async () => {
        const cfg = engine().config();
        requireThat(
          [...cfg.sourceHomes, ...Object.values(cfg.targets).map((t: any) => t.home)].includes(
            args.home,
          ),
          'invalid_path',
        );
        return (await engine().importer.backup(args.home)).id;
      }),
    deleteBackup: (args) =>
      holdEngine(ctx, async () => {
        await deleteBackup(state, args.id);
        return true;
      }),
    restore: (args) => holdEngine(ctx, () => engine().importer.restore(args.id, args.token)),
    projectInfo: (args) => projectInfo(args.project),
    continue: (args) => {
      requireThat(!engine().running, 'task_running');
      return continueEntry(ctx, args);
    },
    diagnostics: () => diagnostics(ctx),
  };
}

// Only the bundled renderer's main frame may call, with a bounded argument size.
export function registerIpc(ctx: Context, handlers: Handlers) {
  let modifying = false;
  ipcMain.handle('sesshuttle:request', async (event, method, args) => {
    try {
      const window = ctx.window;
      requireThat(
        window &&
          event.sender === window.webContents &&
          event.senderFrame === window.webContents.mainFrame &&
          event.senderFrame.url === rendererUrl(ctx),
        'invalid_action',
      );
      requireThat(isIpcMethod(method) && JSON.stringify(args).length < 256000, 'invalid_action');
      const guarded = isExclusive(method);
      if (guarded) {
        requireThat(!modifying, 'task_running');
        modifying = true;
      }
      try {
        return { ok: true, data: await handlers[method as IpcMethod](args) };
      } finally {
        if (guarded) modifying = false;
      }
    } catch (e) {
      return { ok: false, error: publicError(e) };
    }
  });
}
