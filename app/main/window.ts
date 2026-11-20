import { app, BrowserWindow, session } from 'electron';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { fileUrlNames } from '../../core/util.mjs';
import { getTheme } from '../shared/themes';
import type { Context } from './context';

// The bundled page is loaded by this address: unlike a bare path, it escapes every
// character of the application folder's name that a URL gives another meaning.
export const rendererUrl = (ctx: Context) => pathToFileURL(ctx.rendererFile).href;
// Whether an address the window reports is the bundled page.
export const isRenderer = (ctx: Context, url: string) => fileUrlNames(url, ctx.rendererFile);

// One sandboxed window: no Node in the page, no navigation away from the bundled
// renderer, no new windows and no permission grants.
export function createWindow(ctx: Context) {
  session.defaultSession.setPermissionRequestHandler((_w, _p, callback) => callback(false));
  const window = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 780,
    minHeight: 600,
    title: 'sesshuttle',
    backgroundColor: getTheme(ctx.state.get('config')?.theme).colors.bg,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });
  if (process.platform === 'win32' && app.isPackaged) {
    const launcher = path.join(path.dirname(process.execPath), 'Sesshuttle.exe');
    window.setAppDetails({
      appId: 'com.expldfsh.sesshuttle',
      appIconPath: launcher,
      appIconIndex: 0,
      relaunchCommand: '"' + launcher + '"',
      relaunchDisplayName: 'Sesshuttle',
    });
  }
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => {
    if (!isRenderer(ctx, url)) event.preventDefault();
  });
  // A runtime check is cancelled before closing. A transfer pauses after its current
  // item; a removal always finishes its current step first.
  window.on('close', (event) => {
    const proof = ctx.activeProof;
    if (proof) {
      event.preventDefault();
      proof.controller.abort();
      void proof.done
        .catch(() => {})
        .then(() => {
          if (!window.isDestroyed()) window.close();
        });
      return;
    }
    if (ctx.engine.running) {
      event.preventDefault();
      if (!ctx.deletionActive) ctx.engine.cancel();
      window.webContents.send('sesshuttle:closePending', ctx.deletionActive);
    }
  });
  return window;
}
