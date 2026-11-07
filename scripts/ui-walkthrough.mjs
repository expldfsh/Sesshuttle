/* global document, getComputedStyle */
// Test-mode walkthrough of every main screen in Chinese and English at two window
// sizes, with synthetic data and the loopback S3 server only. Screenshots go to a
// temporary folder outside the repository. Each screen is checked for horizontal
// overflow, overlapping top bar items and raw message keys; keyboard steps check
// visible focus; and every renderer request and storage request is recorded to
// show that opening a page or dialog starts no scan and no cloud request.
// Usage: node scripts/ui-walkthrough.mjs [--out=<dir>] [--lang=zh-CN,en] [--size=1320x860,780x600]
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { openSession } from './lib/ui-session.mjs';
import { invoke, recordIpc } from './lib/test-app.mjs';
import { rawKeys } from './lib/raw-keys.mjs';

const option = (name, fallback) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const out = option(
  'out',
  path.join(
    os.tmpdir(),
    'sesshuttle-walkthrough-' + new Date().toISOString().slice(0, 19).replaceAll(':', ''),
  ),
);
const languages = option('lang', 'zh-CN,en').split(',');
const sizes = option('size', '1320x860,780x600')
  .split(',')
  .map((s) => s.split('x').map(Number));
// Requests that only read saved local state or stat a folder.
const SAVED_STATE = new Set([
  'init',
  'backups',
  'localBins',
  'appStatus',
  'folderStatus',
  'activityPage',
]);
const PAGES = ['conversations', 'projects', 'activity', 'backups', 'settings'];
await fs.mkdir(out, { recursive: true });
const report = { out, screens: 0, problems: [], quiet: [] };

function harness(session, tag) {
  const { page, app, storage } = session;
  let ipc,
    seen = 0;
  return {
    async start() {
      ipc = await recordIpc(app);
      await ipc.take();
      seen = storage?.requests.length ?? 0;
    },
    // After opening a page or dialog: only saved-state reads, no storage request.
    async quiet(label) {
      await page.waitForTimeout(400);
      const methods = (await ipc.take()).filter((m) => !SAVED_STATE.has(m));
      const requests = (storage?.requests.length ?? 0) - seen;
      seen = storage?.requests.length ?? 0;
      report.quiet.push({ tag, label, ok: !methods.length && !requests });
      if (methods.length || requests)
        report.problems.push(
          `${tag} ${label}: opening called ${methods.join(', ') || '-'}; ${requests} storage request(s)`,
        );
    },
    // Before and after a user action that is allowed to read or write data.
    async action(fn) {
      await fn();
      await ipc.take();
      seen = storage?.requests.length ?? 0;
    },
    async shot(name) {
      await page.waitForTimeout(250);
      await page.screenshot({ path: path.join(out, `${tag}-${name}.png`) });
      report.screens++;
      const keys = await rawKeys(page);
      const layout = await page.evaluate(() => {
        const found = [];
        const root = document.documentElement;
        if (root.scrollWidth > root.clientWidth + 1) found.push('page scrolls horizontally');
        for (const el of document.querySelectorAll(
          '.content, .topbar, .sidebar, .task-panel, dialog[open] .modal-body, dialog[open] .modal-actions',
        ))
          if (el.scrollWidth > el.clientWidth + 1)
            found.push(
              `${el.className || el.tagName} overflows by ${el.scrollWidth - el.clientWidth}px`,
            );
        const items = [...document.querySelectorAll('.topbar > h1, .top-right > *')].map((e) =>
          e.getBoundingClientRect(),
        );
        for (let i = 0; i < items.length; i++)
          for (let j = i + 1; j < items.length; j++) {
            const a = items[i],
              b = items[j];
            if (
              a.left < b.right - 1 &&
              b.left < a.right - 1 &&
              a.top < b.bottom - 1 &&
              b.top < a.bottom - 1
            )
              found.push('top bar items overlap');
          }
        return found;
      });
      for (const p of [...layout, ...keys.map((k) => 'raw key ' + k)])
        report.problems.push(`${tag} ${name}: ${p}`);
    },
    async focusVisible(label) {
      const ok = await page.evaluate(() => {
        const el = document.activeElement;
        if (!el || el === document.body) return false;
        const s = getComputedStyle(el);
        return (
          (s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0) || s.boxShadow !== 'none'
        );
      });
      if (!ok) report.problems.push(`${tag} ${label}: focus is not visible`);
    },
  };
}

const nav = (page, name) => page.locator('nav button').nth(PAGES.indexOf(name)).click();
const dialog = (page) => page.locator('dialog[open]').last();
const primary = (page) => dialog(page).locator('.modal-actions button.primary').last();
async function closeDialogs(page) {
  for (let i = 0; i < 4 && (await page.locator('dialog[open]').count()); i++) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(250);
  }
}

async function connected(language, size, tag) {
  const session = await openSession({ language, size });
  const { page } = session;
  const h = harness(session, tag);
  try {
    // Opening the app: saved state only.
    await page.reload();
    await page.waitForSelector('.shell');
    await h.start();
    await page.waitForTimeout(300);
    await h.quiet('app start');
    await h.shot('conversations-start');

    await h.action(async () => {
      await page.locator('.refresh-group button').click();
      await page.waitForSelector('tr.conversation-row');
    });
    await page.locator('tr.conversation-row').first().click();
    await h.quiet('details panel');
    // Leave and re-enter the list with the keyboard so focus is shown as for keyboard users.
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    await h.focusVisible('list');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Space');
    await page.waitForSelector('.selection-bar');
    await h.quiet('keyboard selection');
    await h.shot('conversations');

    // Upload: options, then the review list.
    await page.locator('.selection-bar button.primary').first().click();
    await dialog(page).waitFor();
    await h.quiet('upload dialog');
    await h.shot('upload-1');
    await h.action(async () => {
      await primary(page).click();
      await page.waitForSelector('dialog[open].sync-plan');
    });
    await h.shot('upload-2');
    // Settings change after the preview: the upload cannot start and stays in the
    // task panel with its recovery, which previews again.
    await h.action(async () => {
      const config = (await invoke(page, 'init')).data.config;
      await invoke(page, 'saveConfig', { ...config, skipNativeConfirm: !config.skipNativeConfirm });
      await primary(page).click();
      await page.waitForSelector('#task-panel .task-failure');
    });
    await h.shot('task-failure');
    await h.action(async () => {
      await page.locator('#task-panel .task-failure button.primary').click();
      await page.waitForSelector('dialog[open].sync-plan', { timeout: 30000 });
    });
    await h.action(async () => {
      await primary(page).click();
      await page.waitForFunction(() => !document.querySelector('dialog[open]'));
      await page.waitForFunction(
        () =>
          document.querySelector('.task-indicator') &&
          !document.querySelector('.task-indicator.running'),
        null,
        { timeout: 60000 },
      );
    });
    await h.shot('task-panel');
    await page.locator('.selection-bar .text-button').last().click();

    // Import from the details panel: apps, projects, review.
    await h.action(async () => {
      await page.locator('.refresh-group button').click();
      await page.waitForSelector('.status-cell .badge.tone-success');
      await page.waitForSelector('.refresh-group button:not([disabled])');
    });
    await page.locator('tr.conversation-row:has(.badge.tone-success)').first().click();
    await h.quiet('details panel after upload');
    await h.shot('details');
    const importButton = page.locator('.entry-state button', {
      hasText: /导入到此应用|Import into this app/,
    });
    if (await importButton.count()) {
      await importButton.first().click();
      await dialog(page).waitFor();
      await h.quiet('import dialog');
      await h.shot('import-1');
      for (const step of ['import-2', 'import-3']) {
        // The project step needs a folder: a dedicated one inside the test root.
        const create = dialog(page).locator('button', {
          hasText: /创建并使用专用项目文件夹|Create a dedicated project folder/,
        });
        const historyOnly = dialog(page).locator('button', {
          hasText: /仅导入历史（不指定原生项目）|Import history only \(no native project\)/,
        });
        if (step === 'import-3')
          await h.action(async () => {
            if (await historyOnly.count()) await historyOnly.first().click();
            if (await create.count()) await create.first().click();
            await page.waitForTimeout(500);
          });
        if (await primary(page).isDisabled()) {
          report.problems.push(`${tag} ${step}: next step unavailable`);
          break;
        }
        await h.action(async () => {
          await primary(page).click();
          await page.waitForTimeout(800);
        });
        await h.shot(step);
      }
      // Closing discards the previewed plan; that is the user's action, not the next page's.
      await h.action(() => closeDialogs(page));
    } else report.problems.push(`${tag}: no import button after upload`);

    // Removal: the options as cards, then the review list, then move to the recycle bin.
    await page.locator('tr.conversation-row').first().click();
    await page.locator('.detail .more-menu summary').click();
    await page.locator('.detail .more-menu .menu button.danger-text').click();
    await dialog(page).waitFor();
    await h.quiet('removal dialog');
    await h.shot('remove-1');
    await h.action(async () => {
      await primary(page).click();
      await page.waitForFunction(() => document.querySelector('dialog[open] .removal-section'));
    });
    await h.shot('remove-2');
    await h.action(async () => {
      await primary(page).click();
      await page.waitForFunction(() => !document.querySelector('dialog[open]'));
      await page.waitForTimeout(800);
    });

    for (const name of ['projects', 'activity']) {
      await nav(page, name);
      await page.waitForTimeout(300);
      await h.quiet(name + ' page');
      await h.shot(name);
    }

    await nav(page, 'backups');
    await page.waitForSelector('[role=tab]');
    await h.quiet('backups page');
    await h.shot('backups-local');
    await page.locator('[role=tab]').nth(0).focus();
    await page.keyboard.press('ArrowRight');
    await h.focusVisible('backup tabs');
    await h.quiet('local recycle bin');
    await h.shot('backups-trash');
    await page.keyboard.press('ArrowRight');
    await h.quiet('cloud recycle bin');
    await h.shot('backups-cloud');
    await h.action(async () => {
      await page.locator('[role=tabpanel] .refresh-group button').click();
      await page.waitForFunction(() => !document.querySelector('.working'));
    });
    await h.shot('backups-cloud-checked');
    await page.locator('[role=tab]').nth(0).click();

    await nav(page, 'settings');
    await page.waitForSelector('#storage');
    await h.quiet('settings page');
    await h.shot('settings-connected');
    await page.evaluate(() => document.querySelector('.content').scrollTo(0, 1e6));
    await h.shot('settings-connected-end');
    await h.action(async () => {
      await page
        .locator('.settings button', { hasText: /诊断|diagnostics/i })
        .last()
        .click();
      await dialog(page).waitFor();
    });
    await h.shot('diagnostics');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('dialog[open]'));

    // A page-level error: the cloud cannot be reached during a refresh.
    session.storage.stop();
    await nav(page, 'conversations');
    await h.action(async () => {
      await page.locator('.refresh-group button').click();
      await page.waitForSelector('.error-notice, .banner.danger', { timeout: 30000 });
    });
    await h.shot('error');
  } catch (e) {
    report.problems.push(`${tag} connected: ${e.message.split('\n')[0]}`);
    await page.screenshot({ path: path.join(out, `${tag}-failure.png`) }).catch(() => {});
  } finally {
    await session.close();
  }
}

async function unconnected(language, size, tag) {
  const session = await openSession({ language, size, connect: false });
  const { page } = session;
  const h = harness(session, tag);
  try {
    await page.reload();
    await page.waitForSelector('.shell');
    await h.start();
    await page.waitForTimeout(300);
    await h.quiet('first start');
    await h.shot('onboarding');
    await nav(page, 'settings');
    await page.waitForSelector('.choice-cards');
    await h.quiet('settings, not connected');
    await h.shot('settings-choose');
    await page.locator('.choice-manual').click();
    await page.waitForSelector('.connection-form');
    await h.shot('settings-form');
    const endpoint = page.locator('.connection-form input').first();
    await endpoint.fill('http://example.com');
    await endpoint.blur();
    await page.waitForSelector('.field.invalid');
    await h.quiet('connection field check');
    await h.shot('settings-invalid');
  } catch (e) {
    report.problems.push(`${tag} unconnected: ${e.message.split('\n')[0]}`);
    await page
      .screenshot({ path: path.join(out, `${tag}-failure-unconnected.png`) })
      .catch(() => {});
  } finally {
    await session.close();
  }
}

for (const language of languages)
  for (const size of sizes) {
    const tag = `${language}-${size.join('x')}`;
    await connected(language, size, tag);
    await unconnected(language, size, tag);
  }

console.log(JSON.stringify(report, null, 2));
if (report.problems.length) process.exitCode = 1;
