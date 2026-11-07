/* global document, getComputedStyle */
// Regenerates the six guide screenshots in docs/images (en and zh-CN × upload,
// scope and import) from the app in test mode with synthetic data and the
// loopback S3 server. Marks are amber numbered circles with an outline in the
// theme's warning color. Safe to run repeatedly.
// Usage: node scripts/screenshots.mjs [--out=docs/images]
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openSession } from './lib/ui-session.mjs';
import { invoke } from './lib/test-app.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.resolve(
  process.argv.find((a) => a.startsWith('--out='))?.slice(6) ?? path.join(repo, 'docs/images'),
);
await fs.mkdir(out, { recursive: true });

// Test-only notices are hidden so the pictures show what users see.
const DOC_CSS = `
  .top-right > .badge.tone-warning, .content > .banner.warning, .toasts { display: none !important; }
`;

for (const language of ['en', 'zh-CN']) {
  const session = await openSession({
    language,
    size: [1320, 860],
    args: ['--force-device-scale-factor=2'],
  });
  const { page } = session;
  try {
    const config = (await invoke(page, 'init')).data.config;
    await invoke(page, 'saveConfig', { ...config, onboardingDismissed: true });
    // One chat goes to the cloud and leaves this computer, so the list has a
    // local chat to upload and a cloud chat to import.
    const rows = (await invoke(page, 'refresh')).data.rows;
    const cloudOnly = rows.find((r) => r.title === 'Review the settings panel') ?? rows[0];
    const plan = await invoke(page, 'preview', {
      ids: [cloudOnly.id],
      direction: 'upload',
      targets: [],
    });
    const job = await invoke(page, 'execute', { token: plan.data.token });
    if (job.data.status !== 'completed') throw Error('upload failed: ' + JSON.stringify(job));
    const removal = await invoke(page, 'reviewRemoval', {
      ids: [cloudOnly.id],
      scope: 'local',
      mode: 'trash',
      kind: 'live',
      includeDependents: false,
    });
    const removed = await invoke(page, 'executeRemoval', {
      token: removal.data.token,
      permanent: false,
      upgrade: false,
    });
    if (removed.data.status !== 'completed') throw Error('removal failed');
    await page.reload();
    await page.waitForSelector('.shell');
    await page.addStyleTag({ content: DOC_CSS });
    await page.locator('.refresh-group button').click();
    await page.waitForSelector('tr.conversation-row');
    await page.waitForSelector('.refresh-group button:not([disabled])');
    const local = page.locator('tr.conversation-row', { hasNotText: cloudOnly.title }).first();
    const cloud = page.locator('tr.conversation-row', { hasText: cloudOnly.title }).first();

    // 1. Upload: tick a local chat, then Upload to cloud in the action bar.
    await local.click();
    await local.locator('input[type=checkbox]').check();
    await page.waitForSelector('.selection-bar');
    await page.mouse.move(0, 0);
    await shot(page, `${language}-upload.png`, '.list-pane', [
      'tr.conversation-row.focused .check-cell',
      '.selection-bar button.primary',
    ]);

    // 2. Scope: the review list and its confirm button.
    await page.locator('.selection-bar button.primary').click();
    await page.waitForSelector('dialog[open]');
    await page.locator('dialog[open] .modal-actions button.primary').click();
    await page.waitForSelector('dialog[open].sync-plan .scope-item');
    await page.mouse.move(0, 0);
    await shot(page, `${language}-scope.png`, 'dialog[open]', [
      'dialog[open] .scope-item .card-title',
      'dialog[open] .modal-actions button.primary',
    ]);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('dialog[open]'));
    await page.locator('.selection-bar .text-button').last().click();

    // 3. Import: a cloud chat and Import to this computer in its details.
    await cloud.click();
    await page.waitForSelector('.detail-actions button.primary');
    await page.mouse.move(0, 0);
    await shot(page, `${language}-import.png`, '.workspace', [
      'tr.conversation-row.focused .title-cell',
      '.detail-actions button.primary',
    ]);
    console.log('saved ' + language);
  } finally {
    await session.close();
  }
}

// Marks each target with an outline and a numbered circle, then captures `area`.
async function shot(page, file, area, targets) {
  // Dialogs fade and scale in; positions are measured after the motion ends.
  await page.waitForTimeout(500);
  await page.evaluate((selectors) => {
    const warning = getComputedStyle(document.documentElement).getPropertyValue('--warning');
    const ink = getComputedStyle(document.documentElement).getPropertyValue('--on-accent');
    const layer = document.createElement('div');
    layer.id = 'doc-marks';
    layer.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647';
    selectors.forEach((selector, i) => {
      const el = document.querySelector(selector);
      if (!el) throw Error('missing ' + selector);
      const r = el.getBoundingClientRect();
      const box = document.createElement('div');
      box.style.cssText = `position:fixed;left:${r.left - 4}px;top:${r.top - 4}px;width:${r.width + 8}px;height:${r.height + 8}px;border:2px solid ${warning};border-radius:7px;box-sizing:border-box`;
      const mark = document.createElement('div');
      mark.textContent = String(i + 1);
      mark.style.cssText = `position:fixed;left:${r.left - 13}px;top:${r.top - 15}px;width:22px;height:22px;border-radius:50%;background:${warning};color:${ink};font:700 13px/22px 'Comic Neue',sans-serif;text-align:center;box-shadow:0 0 0 2px ${ink}`;
      layer.append(box, mark);
    });
    // Inside an open dialog the layer must join the top layer to stay visible.
    (document.querySelector('dialog[open]') ?? document.body).append(layer);
  }, targets);
  const box = await page.locator(area).first().boundingBox();
  const pad = 14;
  await page.screenshot({
    path: path.join(out, file),
    clip: {
      x: Math.max(0, box.x - pad),
      y: Math.max(0, box.y - pad),
      width: box.width + pad * 2,
      height: box.height + pad * 2,
    },
  });
  await page.evaluate(() => document.getElementById('doc-marks')?.remove());
}
