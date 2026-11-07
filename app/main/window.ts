import { BrowserWindow, session } from 'electron';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { getTheme } from '../shared/themes';
import type { Context } from './context';

export const rendererUrl = (ctx: Context) => pathToFileURL(ctx.rendererFile).href;

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
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => {
    if (url !== rendererUrl(ctx)) event.preventDefault();
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
