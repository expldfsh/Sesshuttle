/* global window */
// Launches the app in test mode against synthetic data: a fixture root from
// scripts/ui-fixture.mjs and, optionally, the loopback S3 server from
// scripts/ui-storage.mjs. Never touches ~/.codex, real projects or R2.
import { execFileSync, spawn } from 'node:child_process';
import readline from 'node:readline';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright-core';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export function makeFixture(args = []) {
  const out = execFileSync(process.execPath, [path.join(repo, 'scripts/ui-fixture.mjs'), ...args], {
    encoding: 'utf8',
  });
  return out.trim().split('\n').at(-1);
}

export async function startStorage(root) {
  const child = spawn(process.execPath, [path.join(repo, 'scripts/ui-storage.mjs'), root], {
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  const lines = readline.createInterface({ input: child.stdout });
  const line = await new Promise((resolve, reject) => {
    child.once('error', reject);
    lines.once('line', resolve);
  });
  // Every request the app sends to the loopback server, for checks that a step
  // reaches the cloud only after the user asks.
  const requests = [];
  lines.on('line', (l) => requests.push(JSON.parse(l)));
  return { ...JSON.parse(line), requests, stop: () => child.kill() };
}

// `executablePath` selects a packaged app; by default the development build runs.
export async function launchApp(root, { executablePath, env = {} } = {}) {
  const app = await electron.launch({
    ...(executablePath ? { executablePath, args: [] } : { args: [repo] }),
    cwd: repo,
    env: { ...process.env, SESSHUTTLE_TEST_ROOT: root, ...env },
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  return { app, page };
}

// Records every renderer request to the main process from now on: the method names.
export async function recordIpc(app) {
  await app.evaluate(({ ipcMain }) => {
    const handlers = ipcMain._invokeHandlers;
    const original = handlers.get('sesshuttle:request');
    if (globalThis.sesshuttleIpcLog) return;
    globalThis.sesshuttleIpcLog = [];
    handlers.set('sesshuttle:request', (event, method, args) => {
      globalThis.sesshuttleIpcLog.push(method);
      return original(event, method, args);
    });
  });
  return {
    take: () =>
      app.evaluate(() => globalThis.sesshuttleIpcLog.splice(0, globalThis.sesshuttleIpcLog.length)),
  };
}

export const invoke = (page, method, args = {}) =>
  page.evaluate(([m, a]) => window.sesshuttle.invoke(m, a), [method, args]);
