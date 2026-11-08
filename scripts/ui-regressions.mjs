/* global document */
// Test-mode regression checks for the 0.7.1 and 0.7.2 fixes, with synthetic data and
// the loopback S3 server only. Each check prints PASS or FAIL; the exit code is 1 when
// any check fails.
//   Task failures (requirements §9.3): a transfer or removal that cannot start
//   keeps a visible record with what happened, that nothing ran, and a recovery
//   button; opening a native app that fails shows why; refreshing or switching
//   pages does not lose the record.
//   Saved state after an action (§10.3): the recycle bins and Sync activity show
//   the result of an action without leaving the page, and a cloud list is only
//   marked out of date, never read again by itself.
//   Codex runtime paths (0.7.2 §11): a launcher in a verified layout shows the real
//   program; any other launcher is reported where the path is and repaired in place,
//   only changing the unsaved path; the file chooser can enter app bundles.
// Usage: node scripts/ui-regressions.mjs [--lang=zh-CN|en] [--only=transfer,removal,native,bins,activity,paths,sweep]
//   [--app=<packaged executable>]   by default the development build runs
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { State } from '../core/state.mjs';
import { openSession } from './lib/ui-session.mjs';
import { invoke } from './lib/test-app.mjs';
import { canCompile, compileStandIn, fakeBundle } from '../tests/helpers/stand-in.mjs';

const option = (name, fallback) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const language = option('lang', 'zh-CN');
const only = option('only', 'transfer,removal,native,bins,activity,paths,sweep').split(',');
const executablePath = option('app', undefined);

// Interface text in both languages, so the checks do not depend on the language.
const TEXT = {
  uploadNotStarted: /上传未开始|Upload not started/,
  importNotStarted: /导入未开始|Import not started/,
  nothingTransferred: /没有上传或导入任何内容|Nothing was uploaded or imported/,
  refreshAndPreview: /刷新并重新预览|Refresh and preview again/,
  nothingRemoved: /没有删除或恢复任何内容|Nothing was deleted or restored/,
  reviewRemovalAgain: /重新查看删除清单|Review the removal list again/,
  appNotOpened: /应用没有打开|The app did not open/,
  upload: /上传到云端|Upload to cloud/,
  importHere: /导入到此应用|Import into this app/,
  historyOnly: /仅导入历史（不指定原生项目）|Import history only \(no native project\)/,
  createFolder: /创建并使用专用项目文件夹|Create a dedicated project folder/,
  continueApp: /继续 · |Continue · /,
  continue: /^\s*(继续|Continue)\s*$/,
  restoreCopy: /恢复副本…|Restore copy…/,
  permanent: /彻底删除…|Delete permanently…/,
  restored: /已恢复|Restored/,
  outOfDate: /可能已过期|may be out of date/,
  actualRuntime: /实际使用|Actually uses/,
  needsProgram: /需要选择 Codex 程序|Choose a Codex runtime/,
  chooseProgram: /选择 Codex 程序…|Choose Codex runtime…/,
  startCheck: /开始快速验证|Start quick check/,
  retryCheck: /重新快速验证|Retry quick check/,
  checkStorage: /检查凭据存储|Check credential storage/,
};

const results = [];
// Screenshots of failed checks go to a temporary folder outside the repository.
const shots = await fs.mkdtemp(path.join(os.tmpdir(), 'sesshuttle-regressions-'));
let current = null;
// Renderer exceptions, such as an effect cleanup that is not a function, fail the check.
const pageErrors = [];
async function check(name, fn) {
  const seen = pageErrors.length;
  try {
    await fn();
    if (pageErrors.length > seen) throw Error('renderer error: ' + pageErrors.at(-1));
    results.push({ name, ok: true });
    console.log('PASS ' + name);
  } catch (e) {
    results.push({ name, ok: false, error: e.message.split('\n')[0] });
    console.log('FAIL ' + name + ' — ' + e.message.split('\n')[0]);
    const file = path.join(shots, name.replace(/[^\w]+/g, '-') + '.png');
    await current?.screenshot({ path: file }).catch(() => {});
  }
}
// A check that depends on an earlier one in the same session is reported as failed
// with the reason instead of being run.
function skip(name, reason) {
  results.push({ name, ok: false, error: 'not run: ' + reason });
  console.log('FAIL ' + name + ' — not run: ' + reason);
}

// Every renderer request with its outcome and, for previews, the plan token.
async function recordCalls(app) {
  await app.evaluate(({ ipcMain }) => {
    if (globalThis.regressionLog) return;
    const handlers = ipcMain._invokeHandlers;
    const original = handlers.get('sesshuttle:request');
    globalThis.regressionLog = [];
    handlers.set('sesshuttle:request', async (event, method, args) => {
      const result = await original(event, method, args);
      globalThis.regressionLog.push({
        method,
        ok: result?.ok,
        code: result?.error?.code,
        token: result?.data?.token,
      });
      return result;
    });
  });
  return { take: () => app.evaluate(() => globalThis.regressionLog.splice(0)) };
}

const dialog = (page) => page.locator('dialog[open]').last();
const primary = (page) => dialog(page).locator('.modal-actions button.primary').last();
const nav = (page, name) =>
  page
    .locator('nav button')
    .nth(['conversations', 'projects', 'activity', 'backups', 'settings'].indexOf(name))
    .click();
const panel = (page) => page.locator('#task-panel');
async function idle(page, timeout = 60000) {
  await page.waitForFunction(
    () => !document.querySelector('.task-indicator.running') && !document.querySelector('.working'),
    null,
    { timeout },
  );
}
async function refreshList(page) {
  await nav(page, 'conversations');
  await page.locator('.refresh-group button').click();
  await page.waitForSelector('tr.conversation-row');
  await page.waitForSelector('.refresh-group button:not([disabled])');
}
async function openPanel(page) {
  if (await panel(page).count()) return;
  await page.locator('.task-indicator').click();
  await panel(page).waitFor();
}
// Any change to the saved settings makes previews and removal lists out of date.
async function invalidate(page) {
  const config = (await invoke(page, 'init')).data.config;
  const r = await invoke(page, 'saveConfig', {
    ...config,
    skipNativeConfirm: !config.skipNativeConfirm,
  });
  assert.ok(r.ok, JSON.stringify(r.error));
}
async function uploadById(page, id) {
  const plan = await invoke(page, 'preview', { ids: [id], direction: 'upload', targets: [] });
  assert.ok(plan.ok, JSON.stringify(plan.error));
  const job = await invoke(page, 'execute', { token: plan.data.token });
  assert.equal(job.data?.status, 'completed', JSON.stringify(job));
}
async function removeById(page, id, scope) {
  const review = await invoke(page, 'reviewRemoval', {
    ids: [id],
    scope,
    mode: 'trash',
    kind: 'live',
    includeDependents: false,
  });
  assert.ok(review.ok, JSON.stringify(review.error));
  const job = await invoke(page, 'executeRemoval', {
    token: review.data.token,
    permanent: false,
    // A new space takes its first cloud removal with the format upgrade.
    upgrade: scope !== 'local',
  });
  assert.equal(job.data?.status, 'completed', JSON.stringify(job));
}
// Closes the task panel and any open dialog before the next step.
async function settle(page) {
  for (let i = 0; i < 4 && (await page.locator('dialog[open], #task-panel').count()); i++) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(250);
  }
}
async function rows(page) {
  const r = await invoke(page, 'refresh');
  assert.ok(r.ok, JSON.stringify(r.error));
  return r.data.rows;
}
// The confirmation dialog asked before opening a native app.
async function confirmQuestion(page) {
  await page.waitForSelector('dialog[open] .question');
  await primary(page).click();
}

// §9.3 checks 1, 2, 5 and 6: transfers whose preview went out of date.
async function transferChecks(session) {
  const { page, app } = session;
  const calls = await recordCalls(app);
  await refreshList(page);
  const first = (await rows(page)).find((r) => r.local && !r.remote);
  await page.locator('tr.conversation-row', { hasText: first.title }).first().click();
  await page.locator('.detail-actions button', { hasText: TEXT.upload }).first().click();
  await dialog(page).waitFor();
  await primary(page).click();
  await page.waitForSelector('dialog[open].sync-plan');
  const before = (await calls.take()).filter((c) => c.method === 'preview').at(-1)?.token;
  await invalidate(page);
  await primary(page).click();
  let visible = false;
  await check('upload that cannot start shows why, that nothing ran and a recovery', async () => {
    await page.waitForFunction(() => !document.querySelector('dialog[open]'));
    await panel(page).locator('.task-failure .error-notice').waitFor({ timeout: 10000 });
    const text = await panel(page).innerText();
    assert.match(text, TEXT.nothingTransferred);
    const indicator = page.locator('.task-indicator.failed');
    await indicator.waitFor({ timeout: 2000 });
    assert.match(await indicator.innerText(), TEXT.uploadNotStarted);
    await panel(page)
      .locator('button', { hasText: TEXT.refreshAndPreview })
      .waitFor({ timeout: 2000 });
    visible = true;
  });
  if (visible) {
    await check('refreshing the list keeps the failed task', async () => {
      await page.locator('.refresh-group button').click();
      await page.waitForSelector('.refresh-group button:not([disabled])');
      await openPanel(page);
      await panel(page).locator('.task-failure').waitFor({ timeout: 2000 });
      assert.match(await panel(page).innerText(), TEXT.nothingTransferred);
    });
    await check('switching pages keeps the failed task in the top bar', async () => {
      await nav(page, 'projects');
      await page.waitForTimeout(300);
      await nav(page, 'conversations');
      await page.locator('.task-indicator.failed').waitFor({ timeout: 2000 });
      await openPanel(page);
      await panel(page).locator('.task-failure').waitFor({ timeout: 2000 });
    });
    await check('refresh and preview again reaches a new review list and uploads', async () => {
      await openPanel(page);
      await calls.take();
      await panel(page).locator('button', { hasText: TEXT.refreshAndPreview }).click();
      await page.waitForSelector('dialog[open].sync-plan', { timeout: 30000 });
      const log = await calls.take();
      assert.ok(
        log.some((c) => c.method === 'refresh'),
        'the list was refreshed',
      );
      const after = log.filter((c) => c.method === 'preview' && c.ok).at(-1)?.token;
      assert.ok(after && after !== before, 'a new preview was generated');
      assert.equal(await page.locator('.task-failure').count(), 0, 'failure cleared');
      await primary(page).click();
      await page.waitForFunction(() => !document.querySelector('dialog[open]'));
      await idle(page);
      const job = (await invoke(page, 'init')).data.jobs[0];
      assert.equal(job?.status, 'completed', 'the upload finished');
    });
  } else {
    for (const name of [
      'refreshing the list keeps the failed task',
      'switching pages keeps the failed task in the top bar',
      'refresh and preview again reaches a new review list and uploads',
    ])
      skip(name, 'the failed upload was not shown');
  }

  // Import an uploaded chat into the desktop app, with an out-of-date preview.
  await settle(page);
  if (!(await rows(page)).some((r) => r.status === 'synced')) await uploadById(page, first.id);
  await refreshList(page);
  await page.locator('tr.conversation-row:has(.badge.tone-success)').first().click();
  await page.locator('.entry-state button', { hasText: TEXT.importHere }).first().click();
  await dialog(page).waitFor();
  await primary(page).click();
  await dialog(page).locator('button', { hasText: TEXT.createFolder }).first().waitFor();
  const historyOnly = dialog(page).locator('button', { hasText: TEXT.historyOnly });
  if (await historyOnly.count()) await historyOnly.first().click();
  await dialog(page).locator('button', { hasText: TEXT.createFolder }).first().click();
  await page.waitForFunction(
    () => !document.querySelector('dialog[open] .modal-actions button.primary[disabled]'),
  );
  await primary(page).click();
  await page.waitForSelector('dialog[open].sync-plan', { timeout: 30000 });
  const importBefore = (await calls.take()).filter((c) => c.method === 'preview').at(-1)?.token;
  await invalidate(page);
  await primary(page).click();
  await check('import that cannot start shows why and previews again', async () => {
    await page.waitForFunction(() => !document.querySelector('dialog[open]'));
    await panel(page).locator('.task-failure .error-notice').waitFor({ timeout: 10000 });
    assert.match(await panel(page).innerText(), TEXT.nothingTransferred);
    assert.match(await page.locator('.task-indicator.failed').innerText(), TEXT.importNotStarted);
    await calls.take();
    await panel(page).locator('button', { hasText: TEXT.refreshAndPreview }).click();
    await page.waitForSelector('dialog[open].sync-plan', { timeout: 30000 });
    const after = (await calls.take()).filter((c) => c.method === 'preview' && c.ok).at(-1)?.token;
    assert.ok(after && after !== importBefore, 'a new import preview was generated');
  });
  await page.keyboard.press('Escape');
}

// §9.3 check 3: a removal list that went out of date, and one rejected outright.
async function removalChecks(session) {
  const { page } = session;
  await refreshList(page);
  const list = await rows(page);
  const [local, other] = list.filter((r) => r.local);
  await page.locator('tr.conversation-row', { hasText: local.title }).first().click();
  await page.locator('.detail .more-menu summary').click();
  await page.locator('.detail .more-menu .menu button.danger-text').click();
  await dialog(page).waitFor();
  await primary(page).click();
  await page.waitForSelector('dialog[open] .removal-section');
  await invalidate(page);
  await primary(page).click();
  await check(
    'removal whose list went out of date says nothing ran and reviews again',
    async () => {
      await page.waitForFunction(() => !document.querySelector('dialog[open]'));
      await idle(page, 20000);
      await openPanel(page);
      const text = await panel(page).innerText();
      assert.match(text, TEXT.nothingRemoved);
      await panel(page).locator('button', { hasText: TEXT.reviewRemovalAgain }).click();
      await page.waitForSelector('dialog[open] .removal-section', { timeout: 20000 });
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => !document.querySelector('dialog[open]'));
    },
  );
  // The space changes between the review and the confirmation: the removal is
  // rejected before anything is written.
  await settle(page);
  await uploadById(page, other.id);
  await refreshList(page);
  await page.locator('tr.conversation-row', { hasText: other.title }).first().click();
  await page.locator('.detail .more-menu summary').click();
  await page.locator('.detail .more-menu .menu button.danger-text').click();
  await dialog(page).waitFor();
  await dialog(page)
    .locator('.choice-card', { hasText: /仅云端|Cloud only/ })
    .click();
  await primary(page).click();
  await page.waitForSelector('dialog[open] .removal-section');
  // A new space asks to upgrade its format with the first cloud removal.
  for (const box of await dialog(page).locator('label.check.warning-box input').all())
    await box.check();
  const r = await invoke(page, 'disconnect');
  assert.ok(r.ok, JSON.stringify(r.error));
  await primary(page).click();
  await check('removal rejected before it starts keeps a record with a recovery', async () => {
    await page.waitForFunction(() => !document.querySelector('dialog[open]'));
    await panel(page).locator('.task-failure .error-notice').waitFor({ timeout: 10000 });
    assert.match(await panel(page).innerText(), TEXT.nothingRemoved);
    await panel(page).locator('button', { hasText: TEXT.reviewRemovalAgain }).click();
    await dialog(page).waitFor({ timeout: 10000 });
    await page.keyboard.press('Escape');
  });
}

// §9.3 check 4: opening a native app fails in test mode. The saved import record
// points at a project folder that is not bound, so the app refuses before any
// launcher or URL is used.
async function nativeChecks(session) {
  const { page, app, root } = session;
  const init = (await invoke(page, 'init')).data;
  const row = (await rows(page)).find((r) => r.local);
  const state = new State(path.join(root, 'app-data'));
  state.set('entries/' + init.connection.space + '/' + row.id, {
    desktop: {
      status: 'verified',
      home: init.config.targets.desktop.home,
      binary: init.config.targets.desktop.binary,
      project: path.join(root, 'destination'),
      version: row.version,
    },
  });
  state.close();
  await refreshList(page);
  await page.locator('tr.conversation-row', { hasText: row.title }).first().click();
  await check('a native app that does not open from the details panel says so', async () => {
    await page
      .locator('.entry-state', { hasText: /GPT/ })
      .locator('button', { hasText: TEXT.continue })
      .click();
    await confirmQuestion(page);
    const notice = page.locator('.detail .error-notice', { hasText: TEXT.appNotOpened });
    await notice.waitFor({ timeout: 10000 });
    await notice.locator('.icon-button').click();
    await page.waitForTimeout(200);
    assert.equal(await page.locator('.detail .error-notice').count(), 0, 'dismissed');
    assert.equal(await page.locator('.shell').count(), 1, 'the window still shows the app');
  });
  // A finished import with a verified app, as the task panel shows it.
  await settle(page);
  await app.evaluate(
    ({ BrowserWindow }, job) =>
      BrowserWindow.getAllWindows()[0].webContents.send('sesshuttle:progress', job),
    {
      id: 'regression-import',
      status: 'completed',
      total: 1,
      startedAt: new Date().toISOString(),
      items: [
        {
          id: row.id,
          title: row.title,
          status: 'downloaded',
          historyReady: true,
          targets: { desktop: { status: 'verified' } },
        },
      ],
    },
  );
  await check('a native app that does not open from the task panel says so', async () => {
    await openPanel(page);
    await panel(page).locator('button', { hasText: TEXT.continueApp }).click();
    await confirmQuestion(page);
    const notice = panel(page).locator('.error-notice', { hasText: TEXT.appNotOpened });
    await notice.waitFor({ timeout: 10000 });
    await notice.locator('.icon-button').first().click();
    await page.waitForTimeout(200);
    assert.equal(await panel(page).locator('.task-failure').count(), 0, 'dismissed');
  });
}

// §10.3 checks 1–3: the recycle bins after restoring and deleting permanently.
async function binChecks(session) {
  const { page, app, storage } = session;
  const calls = await recordCalls(app);
  const list = (await rows(page)).filter((r) => r.local);
  await removeById(page, list[0].id, 'local');
  await nav(page, 'backups');
  await page.locator('[role=tab]').nth(1).click();
  const localRow = page.locator('[role=tabpanel] .backup-row').first();
  await localRow.waitFor();
  let restored = false;
  await check('restoring from the local trash shows the restored state at once', async () => {
    await localRow.locator('button', { hasText: TEXT.restoreCopy }).click();
    await dialog(page).waitFor();
    await primary(page).click();
    await page.waitForSelector('dialog[open] .removal-section');
    await primary(page).click();
    await page.waitForFunction(() => !document.querySelector('dialog[open]'));
    await idle(page, 20000);
    await page.waitForFunction(
      (pattern) => {
        const row = document.querySelector('[role=tabpanel] .backup-row');
        return row && new RegExp(pattern).test(row.textContent);
      },
      TEXT.restored.source,
      { timeout: 3000 },
    );
    assert.equal(
      await localRow.locator('button', { hasText: TEXT.restoreCopy }).count(),
      0,
      'no restore button',
    );
    restored = true;
  });
  if (restored)
    await check('deleting a restored copy permanently removes it at once', async () => {
      const before = await page.locator('[role=tabpanel] .backup-row').count();
      await localRow.locator('button', { hasText: TEXT.permanent }).click();
      await dialog(page).waitFor();
      await primary(page).click();
      await page.waitForSelector('dialog[open] .warning-box input[type=checkbox]');
      await dialog(page).locator('.warning-box input[type=checkbox]').check();
      await dialog(page).locator('.modal-actions button.danger-action').click();
      await page.waitForFunction(() => !document.querySelector('dialog[open]'));
      await idle(page, 20000);
      await page.waitForFunction(
        (n) => document.querySelectorAll('[role=tabpanel] .backup-row').length < n,
        before,
        { timeout: 3000 },
      );
    });
  else skip('deleting a restored copy permanently removes it at once', 'restore not shown');

  // A cloud recycle bin entry, shown once, then restored.
  await uploadById(page, list[1].id);
  await rows(page);
  await removeById(page, list[1].id, 'cloud');
  await page.locator('[role=tab]').nth(2).click();
  await page.locator('[role=tabpanel] .refresh-group button').click();
  const cloudRow = page.locator('[role=tabpanel] .backup-row').first();
  await cloudRow.waitFor({ timeout: 20000 });
  await check(
    'restoring from the cloud bin marks the list out of date without reading it',
    async () => {
      await cloudRow.locator('button', { hasText: TEXT.restoreCopy }).click();
      await dialog(page).waitFor();
      await primary(page).click();
      await page.waitForSelector('dialog[open] .removal-section', { timeout: 20000 });
      await calls.take();
      await primary(page).click();
      await page.waitForFunction(() => !document.querySelector('dialog[open]'));
      await idle(page, 30000);
      const settled = storage.requests.length;
      await page.waitForTimeout(1500);
      assert.equal(storage.requests.length, settled, 'no storage request after the restore');
      const log = await calls.take();
      assert.ok(!log.some((c) => c.method === 'backupBins'), 'the cloud bin was not read again');
      await page.locator('[role=tabpanel]', { hasText: TEXT.outOfDate }).waitFor({ timeout: 2000 });
      const buttons = page.locator('[role=tabpanel] .backup-row button');
      for (let i = 0; i < (await buttons.count()); i++)
        assert.ok(await buttons.nth(i).isDisabled(), 'actions wait for a refresh');
      await page.locator('[role=tabpanel] .refresh-group button').click();
      await page.waitForFunction(
        (pattern) =>
          !new RegExp(pattern).test(document.querySelector('[role=tabpanel]').textContent),
        TEXT.outOfDate.source,
        { timeout: 20000 },
      );
      assert.equal(
        await page.locator('[role=tabpanel] .backup-row').count(),
        0,
        'the restored version left the cloud bin',
      );
    },
  );
}

// §10.3 check 4: a transfer that finishes while Sync activity is open.
async function activityChecks(session) {
  const { page } = session;
  const row = (await rows(page)).find((r) => r.local);
  await nav(page, 'activity');
  await page.waitForTimeout(300);
  const before = await page.locator('.timeline > li').count();
  await check('a transfer that finishes on Sync activity appears at once', async () => {
    await uploadById(page, row.id);
    await page.waitForFunction(
      (n) => document.querySelectorAll('.timeline > li').length > n,
      before,
      { timeout: 3000 },
    );
    await page.waitForTimeout(500);
    const first = await page.locator('.timeline > li').first().innerText();
    assert.doesNotMatch(first, /正在|running/i, 'shows the finished state');
  });
}

// 0.7.2 §11: launcher scripts, repair buttons and the file chooser. The bundle layout,
// the launcher and the stand-in program all live in the test root.
async function pathChecks(session) {
  const { page, app, root } = session;
  if (!canCompile()) return skip('codex runtime path checks', 'no C compiler for the stand-in');
  const { launcher, program } = await fakeBundle(
    path.join(root, 'Applications'),
    'ChatGPT.app',
    '9.9.1',
  );
  const script = path.join(root, 'tools', 'codex');
  const stand = path.join(root, 'tools', 'real', 'codex');
  await fs.mkdir(path.dirname(script), { recursive: true });
  await fs.writeFile(script, '#!/bin/sh\necho "codex-cli 9.9.8"\n', { mode: 0o755 });
  await compileStandIn(stand, '9.9.7');
  const calls = await recordCalls(app);
  await app.evaluate(({ dialog: chooser }, file) => {
    globalThis.pickOptions = [];
    chooser.showOpenDialog = async (...args) => {
      globalThis.pickOptions.push(args.at(-1));
      return { canceled: false, filePaths: [file] };
    };
  }, stand);
  const pickOptions = () => app.evaluate(() => globalThis.pickOptions.splice(0));
  async function configure(binaries) {
    const config = (await invoke(page, 'init')).data.config;
    const targets = structuredClone(config.targets);
    for (const [entry, binary] of Object.entries(binaries)) targets[entry].binary = binary;
    const r = await invoke(page, 'saveConfig', { ...config, targets });
    assert.ok(r.ok, JSON.stringify(r.error));
    await page.reload();
    await page.waitForSelector('.shell');
  }
  const card = (i) => page.locator('.app-card').nth(i);
  const methods = async () => (await calls.take()).map((c) => c.method);

  await configure({ desktop: launcher, cli: script, ide: script });
  await calls.take();
  await nav(page, 'projects');
  await card(0).locator('.badge').waitFor();
  await page.waitForTimeout(300);

  await check('opening the apps page does not inspect or check a program', async () => {
    const seen = await methods();
    assert.ok(!seen.includes('inspectBinary'), 'inspectBinary on open');
    assert.ok(!seen.includes('verifyRuntime'), 'verifyRuntime on open');
  });
  await check('a launcher in a verified layout shows the program actually used', async () => {
    const text = await card(0).innerText();
    assert.match(text, TEXT.actualRuntime);
    assert.ok(text.includes(program), 'shows the real program');
    assert.doesNotMatch(await card(0).locator('.badge').innerText(), TEXT.needsProgram);
  });
  let reported = false;
  await check('a launcher that cannot be resolved is reported at the path', async () => {
    assert.match(await card(1).locator('.badge').innerText(), TEXT.needsProgram);
    await card(1).locator('.binary-problem').waitFor({ timeout: 2000 });
    reported = true;
  });
  let failed = false;
  await check('a failed quick check shows the path and a repair, not a retry', async () => {
    assert.ok(reported, 'the launcher was not reported');
    await card(1).locator('.runtime-check button.primary').click();
    const notice = card(1).locator('.runtime-check .error-notice');
    await notice.waitFor({ timeout: 10000 });
    const text = await notice.innerText();
    assert.ok(text.includes(script), 'shows the checked path');
    await notice.locator('button', { hasText: TEXT.chooseProgram }).waitFor({ timeout: 1000 });
    assert.equal(
      await card(1).locator('.runtime-check button.primary', { hasText: TEXT.retryCheck }).count(),
      0,
      'no retry as the main button',
    );
    failed = true;
  });
  await check('the repair writes the unsaved path and only checks the file', async () => {
    assert.ok(failed, 'the quick check did not fail as expected');
    await calls.take();
    await card(1)
      .locator('.runtime-check .error-notice button', { hasText: TEXT.chooseProgram })
      .click();
    await page.waitForFunction(
      ([i, value]) =>
        document.querySelectorAll('.app-card')[i].querySelector('input').value === value,
      [1, stand],
      { timeout: 3000 },
    );
    await card(1).locator('.runtime-check button.primary', { hasText: TEXT.startCheck }).waitFor({
      timeout: 3000,
    });
    assert.equal(await card(1).locator('.binary-problem').count(), 0, 'the problem is gone');
    assert.equal(await card(1).locator('.runtime-check .error-notice').count(), 0);
    await page.locator('.unsaved-bar').waitFor({ timeout: 2000 });
    await page.waitForTimeout(300);
    const seen = await methods();
    assert.ok(seen.includes('inspectBinary'), 'the chosen file is checked');
    assert.ok(!seen.includes('verifyRuntime'), 'no quick check runs by itself');
    assert.ok(!seen.includes('saveConfig'), 'nothing is saved by itself');
    const [options] = await pickOptions();
    assert.equal(options.defaultPath, path.dirname(script));
    if (process.platform === 'darwin')
      assert.ok(options.properties.includes('treatPackageAsDirectory'), 'can enter bundles');
  });
  await check('the file chooser starts in the detected app when no path is set', async () => {
    await configure({ desktop: '', cli: '' });
    await nav(page, 'projects');
    await card(0).locator('.entry-field button').first().click();
    await page.waitForFunction(
      (value) => document.querySelector('.app-card input').value === value,
      stand,
      { timeout: 3000 },
    );
    await card(1).locator('.entry-field button').first().click();
    await page.waitForFunction(
      (value) => document.querySelectorAll('.app-card')[1].querySelector('input').value === value,
      stand,
      { timeout: 3000 },
    );
    const [desktop, cli] = await pickOptions();
    if (process.platform === 'darwin')
      assert.equal(
        desktop.defaultPath,
        path.join(root, 'Applications/ChatGPT.app/Contents/Resources'),
      );
    assert.equal(cli.defaultPath, undefined);
  });

  await configure({ desktop: script, cli: script, ide: script });
  const row = (await rows(page)).find((r) => r.local);
  await uploadById(page, row.id);
  await refreshList(page);
  await page.locator('tr.conversation-row:has(.badge.tone-success)').first().click();
  await page.locator('.entry-state button', { hasText: TEXT.importHere }).first().click();
  await dialog(page).waitFor();
  await check('the transfer dialog repairs the path in its own editor', async () => {
    await primary(page).click();
    const check = dialog(page).locator('.runtime-check button.primary');
    await check.first().waitFor({ timeout: 10000 });
    // A message that names a button quotes its current label.
    await page.waitForFunction(
      (label) => document.querySelector('.next-reason')?.textContent.includes(label),
      language === 'en' ? '“Start quick check”' : '「开始快速验证」',
      { timeout: 2000 },
    );
    await check.first().click();
    const notice = dialog(page).locator('.runtime-check .error-notice');
    await notice.waitFor({ timeout: 10000 });
    await notice.locator('button', { hasText: TEXT.chooseProgram }).click();
    const input = dialog(page).locator('.setup-repair .entry-field input').first();
    await input.waitFor({ timeout: 3000 });
    await page.waitForFunction(
      (value) => document.querySelector('dialog[open] .setup-repair input')?.value === value,
      stand,
      { timeout: 3000 },
    );
    assert.equal(await dialog(page).locator('.binary-problem').count(), 0, 'the problem is gone');
  });
  await page.keyboard.press('Escape');
}

// 0.7.2 §10.6: other notices that had only text or named buttons that are not there.
async function sweepChecks(session) {
  const { page, root } = session;
  const script = path.join(root, 'tools', 'codex');
  await fs.mkdir(path.dirname(script), { recursive: true });
  await fs.writeFile(script, '#!/bin/sh\necho "codex-cli 9.9.8"\n', { mode: 0o755 });
  const config = (await invoke(page, 'init')).data.config;
  const targets = structuredClone(config.targets);
  targets.desktop.binary = script;
  await invoke(page, 'saveConfig', { ...config, targets });
  await page.reload();
  await page.waitForSelector('.shell');
  await nav(page, 'projects');
  await page.locator('.page-head button.primary').click();
  await dialog(page).waitFor();
  await check('a detection candidate that cannot be used offers a way to fix it', async () => {
    const group = dialog(page).locator('.candidate-group').first();
    await group.locator('.candidate-repair').waitFor({ timeout: 3000 });
    await group.locator('.candidate-repair').click();
    await page.waitForFunction(() => !document.querySelector('dialog[open]'));
  });
  await settle(page);

  targets.desktop.binary = '';
  await invoke(page, 'saveConfig', { ...config, targets });
  // The interface reads the saved settings when it loads.
  await page.reload();
  await page.waitForSelector('.shell');
  const row = (await rows(page)).find((r) => r.local);
  await uploadById(page, row.id);
  await refreshList(page);
  await page.locator('tr.conversation-row:has(.badge.tone-success)').first().click();
  await page.locator('.entry-state button', { hasText: TEXT.importHere }).first().click();
  await dialog(page).waitFor();
  await primary(page).click();
  await check('an app without a Codex runtime is explained in the dialog', async () => {
    await dialog(page).locator('.setup-repair').first().waitFor({ timeout: 5000 });
    await page.waitForFunction(
      () =>
        !document.querySelector('dialog[open] .flow-activity') &&
        document.querySelector('dialog[open] .setup-repair strong'),
    );
    await page.waitForTimeout(500);
    assert.doesNotMatch(await dialog(page).innerText(), /entry_binary_missing/);
  });
  await settle(page);

  if (process.platform !== 'darwin') return;
  await invoke(page, 'disconnect');
  const state = new State(path.join(root, 'app-data'));
  state.set('credentialError', 'credential_write_failed');
  state.close();
  await page.reload();
  await page.waitForSelector('.shell');
  await nav(page, 'settings');
  await page.waitForSelector('.storage-state');
  await check('the credential check names only buttons on the screen', async () => {
    await page.locator('.storage-state button', { hasText: TEXT.checkStorage }).click();
    const details = page.locator('.storage-state .repair-details');
    await details.waitFor({ timeout: 3000 });
    const text = await details.innerText();
    assert.doesNotMatch(text, /记住连接…|解锁并连接…|Remember connection…|Unlock and connect…/);
    assert.match(text, /在这台电脑记住连接|Remember this connection on this computer/);
  });
}

const groups = { transfer: transferChecks, removal: removalChecks, native: nativeChecks };
Object.assign(groups, { bins: binChecks, activity: activityChecks, paths: pathChecks });
groups.sweep = sweepChecks;
// Each group runs in its own test-mode session; a failed step outside a check is
// reported as a failed setup with a screenshot.
for (const name of only) {
  const session = await openSession({ language, executablePath });
  current = session.page;
  session.page.on('pageerror', (e) => pageErrors.push(e.message));
  try {
    await groups[name](session);
  } catch (e) {
    results.push({ name: name + ' setup', ok: false, error: e.message.split('\n')[0] });
    console.log('FAIL ' + name + ' setup — ' + e.message.split('\n')[0]);
    await current.screenshot({ path: path.join(shots, name + '-setup.png') }).catch(() => {});
  } finally {
    await session.close();
  }
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) console.log('Screenshots of failed checks: ' + shots);
if (failed.length) process.exitCode = 1;
