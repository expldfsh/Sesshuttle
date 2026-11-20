import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { app, dialog, shell } from 'electron';
import { State } from '../../core/state.mjs';
import { atomic, exists, inside, requireThat } from '../../core/util.mjs';
import {
  cleanMigration,
  createDataFolder,
  disjoint,
  folderName,
  shortcutName,
  legacyFolder,
  markerName,
  migrateData,
  verifyPreparedMove,
  migrationReview,
  checkDatabasePaths,
  reserveSource,
} from '../../core/data-folder.mjs';
import { readMarker } from '../../core/profile-paths.mjs';
import { messages, type Message } from '../renderer/i18n/messages';
import { forgetMigratedCredentials, protectMigratedCredentials } from './credentials';
import type { Context } from './context';

export function label(key: string, language?: string) {
  return String(
    (messages as Record<string, Message>)[key]?.[
      (language ?? app.getLocale()).startsWith('zh') ? 0 : 1
    ] ?? key,
  );
}
// What the user opens to start the packaged app: the application on macOS, elsewhere
// the program beside the runtime that chooses the data folder before starting it.
export function launcherFile() {
  const folder = path.dirname(process.execPath);
  if (process.platform === 'darwin') return path.dirname(path.dirname(folder));
  return path.join(folder, process.platform === 'win32' ? 'Sesshuttle.exe' : 'sesshuttle');
}
const oldFolder = (ctx: Context) =>
  ctx.testRoot ? path.join(ctx.testRoot, 'legacy') : legacyFolder();
const quote = (s: string) => "'" + s.replaceAll("'", "'\\''") + "'";
export async function writeShortcut(folder: string) {
  const mac = process.platform === 'darwin';
  const windows = process.platform === 'win32';
  const file = path.join(folder, shortcutName);
  const binary = app.isPackaged
    ? path.join(path.dirname(process.execPath), windows ? 'Sesshuttle.exe' : 'sesshuttle')
    : process.execPath;
  // The shortcut locates its own folder even after that folder is renamed.
  let exec = quote(binary);
  if (!app.isPackaged)
    exec = '/usr/bin/env node ' + quote(path.join(app.getAppPath(), 'scripts', 'start.mjs'));
  if (mac && app.isPackaged) {
    const bundle = path.dirname(path.dirname(path.dirname(binary)));
    exec = '/usr/bin/open -n -a ' + quote(bundle) + ' --args';
  }
  const header = windows
    ? '@echo off\r\nrem Sesshuttle data folder launcher\r\n'
    : '#!/bin/sh\n# Sesshuttle data folder launcher\n';
  const windowsCommand = app.isPackaged
    ? '"' + binary.replaceAll('%', '%%') + '"'
    : 'node "' + path.join(app.getAppPath(), 'scripts', 'start.mjs').replaceAll('%', '%%') + '"';
  const content = windows
    ? header +
      'setlocal DisableDelayedExpansion\r\nchcp 65001 >nul\r\nstart "" ' +
      windowsCommand +
      ' "--sesshuttle-folder=%~dp0."\r\n'
    : header +
      'folder=$(CDPATH= cd -P -- "$(dirname -- "$0")" && pwd -P) || exit 1\nexec ' +
      exec +
      ' "--sesshuttle-folder=$folder"\n';
  if (await exists(file)) {
    await inside(folder, file);
    const old = await fs.readFile(file, 'utf8');
    if (old === content) return;
    requireThat(old.startsWith(header), 'folder_not_empty');
  }
  await atomic(file, content);
  if (!windows) await fs.chmod(file, 0o700);
}
export async function initializeFolder(ctx: Context) {
  const folder = ctx.dataFolder!;
  const marker = readMarker(folder),
    root = path.join(folder, 'data');
  await inside(folder, root);
  if (marker.movingFrom) {
    const previous = readMarker(marker.movingFrom.path);
    requireThat(
      previous.id === marker.movingFrom.id &&
        previous.movedTo === folder &&
        previous.movedId === marker.id,
      'folder_move_unfinished',
    );
    delete marker.movingFrom;
  }
  if (await exists(root)) await checkDatabasePaths(root);
  const existing = await exists(path.join(root, 'sesshuttle.sqlite'));
  if (marker.initialized || existing) {
    requireThat(existing && !marker.movedTo, 'folder_invalid');
  } else {
    const old = oldFolder(ctx);
    if (
      (process.platform !== 'win32' || ctx.testRoot) &&
      (await exists(path.join(old, 'sesshuttle.sqlite')))
    ) {
      const r =
        ctx.testRoot && process.env.SESSHUTTLE_TEST_COPY === '1'
          ? { response: 0 }
          : await dialog.showMessageBox({
              type: 'question',
              title: 'Sesshuttle',
              message: label('folderOldFound'),
              detail: old + '\n→ ' + folder + '\n\n' + label('folderMigrationHint'),
              buttons: [label('folderCopyOld'), label('folderStartFresh'), label('cancel')],
              defaultId: 0,
              cancelId: 2,
            });
      if (r.response === 2) return null;
      if (r.response === 0) await migrateData(old, folder);
    }
  }
  const state = new State(root);
  try {
    const pending = state.get('folderMigration');
    if (
      pending &&
      !pending.portable &&
      !pending.progress?.retiredFiles &&
      pending.source === oldFolder(ctx) &&
      (await exists(pending.source))
    ) {
      // Keep an older binary from reopening this identity while the new one is active.
      ctx.releaseLegacy = await reserveSource(pending.source, false);
    }
    await writeShortcut(folder);
    if (!marker.initialized)
      await atomic(path.join(folder, markerName), JSON.stringify({ ...marker, initialized: true }));
    return state;
  } catch (e) {
    state.close();
    throw e;
  }
}
export function folderHandlers(ctx: Context) {
  const language = () => ctx.state.get('config')?.language;
  const t = (key: string) => label(key, language());
  function available() {
    requireThat(
      ctx.dataFolder && !ctx.engine.running && !ctx.activeProof && !ctx.relocating,
      'task_running',
    );
    return ctx.dataFolder!;
  }
  return {
    openDataFolder: async () => {
      requireThat(ctx.dataFolder, 'folder_invalid');
      requireThat(!(await shell.openPath(ctx.dataFolder!)), 'open_failed');
      return true;
    },
    moveDataFolder: async () => {
      const source = available();
      requireThat(!ctx.state.get('folderMigration'), 'migration_pending');
      const picked = await dialog.showOpenDialog(ctx.window!, {
        title: t('folderChooseParent'),
        properties: ['openDirectory', 'createDirectory'],
      });
      if (picked.canceled) return false;
      const parent = await fs.realpath(picked.filePaths[0]);
      if (ctx.testRoot) await inside(ctx.testRoot, path.join(parent, 'check'));
      const proposed = path.join(parent, folderName);
      disjoint(source, proposed);
      disjoint(oldFolder(ctx), proposed);
      const homes = ctx.state.get('config')?.sourceHomes ?? [];
      for (const home of [
        ...homes,
        ctx.testRoot ? path.join(ctx.testRoot, 'codex') : path.join(os.homedir(), '.codex'),
      ])
        disjoint(path.resolve(home), proposed);
      const sourceId = readMarker(source).id;
      const resuming = await exists(proposed);
      if (resuming) {
        let candidate;
        try {
          candidate = readMarker(proposed);
        } catch {
          /* Unrelated directory. */
        }
        requireThat(
          !candidate?.initialized &&
            candidate?.movingFrom?.path === source &&
            candidate.movingFrom.id === sourceId,
          'folder_not_empty',
        );
      }
      const answer = await dialog.showMessageBox(ctx.window!, {
        type: 'question',
        message: t('folderMove'),
        detail: source + '\n→ ' + proposed + '\n\n' + t('folderMigrationHint'),
        buttons: [t('cancel'), t('folderCopyRestart')],
        defaultId: 1,
        cancelId: 0,
      });
      if (answer.response !== 1) return false;
      available();
      ctx.relocating = true;
      try {
        const dest = resuming
          ? proposed
          : await createDataFolder(parent, { path: source, id: sourceId } as any);
        if (await exists(path.join(dest, 'data'))) await verifyPreparedMove(ctx.state, dest);
        else
          await migrateData(ctx.state.root, dest, { portable: true, ownedState: ctx.state } as any);
        await writeShortcut(dest);
        await atomic(
          path.join(source, markerName),
          JSON.stringify({ ...readMarker(source), movedTo: dest, movedId: readMarker(dest).id }),
        );
        const execPath = app.isPackaged
          ? path.join(
              path.dirname(process.execPath),
              process.platform === 'win32' ? 'Sesshuttle.exe' : 'sesshuttle',
            )
          : process.execPath;
        app.relaunch({
          execPath,
          args: [
            ...(app.isPackaged
              ? []
              : [app.getAppPath(), '--user-data-dir=' + path.join(dest, 'runtime', 'profile')]),
            '--sesshuttle-folder=' + dest,
          ],
        });
        app.quit();
        return true;
      } catch (e) {
        ctx.relocating = false;
        throw e;
      }
    },
    protectMigration: async (args: any) => {
      available();
      await protectMigratedCredentials(ctx.state, args.password, ctx.testRoot);
      return true;
    },
    cleanupDataFolder: async () => {
      available();
      const old = oldFolder(ctx);
      const review = await migrationReview(ctx.state, old);
      const m = ctx.state.get('folderMigration');
      const remaining = m.portable ? path.dirname(m.source) : m.source;
      const r = await dialog.showMessageBox(ctx.window!, {
        type: 'warning',
        message: t('folderCleanup'),
        detail:
          review.source +
          '\n' +
          review.names.join(', ') +
          (Object.keys(m.fingerprints ?? {}).some((k) => k !== 'system')
            ? '\n' + t('folderCleanupKey')
            : '') +
          '\n\n' +
          t('folderCleanupHint') +
          '\n' +
          review.target,
        buttons: [t('cancel'), t('folderCleanup')],
        defaultId: 0,
        cancelId: 0,
      });
      if (r.response !== 1) return null;
      available();
      ctx.releaseLegacy?.();
      ctx.releaseLegacy = undefined;
      await cleanMigration(ctx.state, old, review.token, (record: any) =>
        forgetMigratedCredentials(ctx.state, record, ctx.testRoot),
      );
      return { remaining: (await exists(remaining)) ? remaining : null };
    },
  };
}
