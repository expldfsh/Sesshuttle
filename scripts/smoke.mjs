/* global window, document */
// Test-mode smoke check: the window opens, IPC answers, and a refresh of the
// synthetic fixture succeeds. With --ui it also connects to the loopback S3,
// checks that the bundled WOFF2 fonts are in use, refreshes from the top bar,
// opens the three-step import dialog for a cloud chat and closes it.
// Usage: node scripts/smoke.mjs [packaged executable] [--ui]
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { invoke, launchApp, makeFixture, startStorage } from './lib/test-app.mjs';

const args = process.argv.slice(2);
const ui = args.includes('--ui');
const executablePath = args.find((a) => !a.startsWith('--'));
const root = makeFixture();
const storage = ui ? await startStorage(root) : null;
const { app, page } = await launchApp(root, { executablePath });
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
  const result = { version: init.data.version, rows: refresh.data.rows.length };
  if (ui) Object.assign(result, await interfacePass(refresh.data.rows[0]));
  const fonts = await page.evaluate(async () => {
    await document.fonts.ready;
    return [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family);
  });
  console.log(JSON.stringify({ ...result, fonts }));
} finally {
  await app.close();
  storage?.stop();
  await fs.rm(root, { recursive: true, force: true });
}

async function interfacePass(row) {
  const connected = await invoke(page, 'connect', {
    mode: 'create',
    endpoint: storage.endpoint,
    bucket: storage.bucket,
    accessKeyId: storage.accessKeyId,
    secretAccessKey: storage.secretAccessKey,
  });
  assert.ok(connected.ok, JSON.stringify(connected.error));
  // One chat goes to the cloud and leaves this computer, so it can be imported.
  const plan = await invoke(page, 'preview', { ids: [row.id], direction: 'upload', targets: [] });
  assert.equal(
    (await invoke(page, 'execute', { token: plan.data.token })).data.status,
    'completed',
  );
  const removal = await invoke(page, 'reviewRemoval', {
    ids: [row.id],
    scope: 'local',
    mode: 'trash',
    kind: 'live',
    includeDependents: false,
  });
  await invoke(page, 'executeRemoval', {
    token: removal.data.token,
    permanent: false,
    upgrade: false,
  });
  await page.reload();
  await page.waitForSelector('.shell');
  await page.locator('.refresh-group button').click();
  await page.waitForSelector('tr.conversation-row');
  await page.waitForSelector('.refresh-group button:not([disabled])');
  // Every @font-face source is a bundled WOFF2 file and both families are loaded.
  const fonts = await page.evaluate(async () => {
    await document.fonts.ready;
    const sources = [...document.styleSheets]
      .flatMap((sheet) => [...sheet.cssRules])
      .filter((rule) => rule.constructor.name === 'CSSFontFaceRule')
      .map((rule) => rule.style.getPropertyValue('src'));
    const loaded = [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family);
    return { sources, loaded };
  });
  assert.ok(fonts.sources.length >= 4 && fonts.sources.every((s) => s.includes('.woff2')));
  for (const family of ['Comic Neue', 'LXGW WenKai'])
    assert.ok(
      fonts.loaded.some((f) => f.replaceAll('"', '') === family),
      family + ' loaded',
    );
  const woff2 = fonts.sources.map((s) => s.match(/([\w-]+\.woff2)/)?.[1]);
  await page.locator('tr.conversation-row', { hasText: row.title }).first().click();
  await page.locator('.detail-actions button.primary').click();
  await page.waitForSelector('dialog[open].flow .entry-choices');
  const steps = await page.locator('dialog[open] .stepper li').count();
  assert.equal(steps, 3, 'import has three steps');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('dialog[open]'));
  return { woff2, importSteps: steps, dialogClosed: true };
}
