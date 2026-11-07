/* global window, document */
// Test-mode smoke check: the window opens, IPC answers, and a refresh of the
// synthetic fixture succeeds. Usage: node scripts/smoke.mjs [packaged executable]
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { invoke, launchApp, makeFixture } from './lib/test-app.mjs';

const root = makeFixture();
const { app, page } = await launchApp(root, { executablePath: process.argv[2] });
try {
  const init = await invoke(page, 'init');
  assert.equal(init.ok, true, JSON.stringify(init));
  assert.equal(init.data.testMode, true);
  const unknown = await page.evaluate(() => {
    try {
      window.sesshuttle.invoke('notAMethod');
      return 'accepted';
    } catch {
      return 'rejected';
    }
  });
  assert.equal(unknown, 'rejected');
  const refresh = await invoke(page, 'refresh');
  assert.equal(refresh.ok, true, JSON.stringify(refresh));
  assert.equal(refresh.data.rows.length, 3);
  const fonts = await page.evaluate(async () => {
    await document.fonts.ready;
    return [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family);
  });
  console.log(
    JSON.stringify({ version: init.data.version, rows: refresh.data.rows.length, fonts }),
  );
} finally {
  await app.close();
  await fs.rm(root, { recursive: true, force: true });
}
