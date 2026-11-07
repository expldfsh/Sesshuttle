/* global window, document, requestAnimationFrame */
// Test-mode list performance check with 5,000 synthetic conversations:
// scrolling and searching stay responsive, only a window of rows is in the DOM,
// and transfer progress events do not re-render the conversation table.
// Usage: node scripts/ui-performance.mjs [--count=5000]
import assert from 'node:assert/strict';
import { openSession } from './lib/ui-session.mjs';
import { invoke } from './lib/test-app.mjs';

const count = Number(process.argv.find((a) => a.startsWith('--count='))?.slice(8) ?? 5000);
const session = await openSession({ fixtureArgs: [`--count=${count}`], size: [1320, 860] });
const { page } = session;
const result = {};
try {
  let start = Date.now();
  await page
    .locator('.topbar button')
    .filter({ hasText: /刷新|Refresh/ })
    .click();
  await page.waitForSelector('tr.conversation-row');
  result.refreshMs = Date.now() - start;
  result.rowsInDom = await page.locator('tr.conversation-row').count();
  result.total = Number(
    (await page.locator('.list-footer span').first().textContent()).match(/\d+/)[0],
  );
  assert.ok(result.total >= count, 'all rows are listed');
  assert.ok(result.rowsInDom < 60, 'only a window of rows is rendered');

  // Scroll through the whole list one viewport at a time and time every frame.
  result.scroll = await page.evaluate(async () => {
    const el = document.querySelector('.table-scroll');
    const frames = [];
    let last = performance.now();
    const frame = () => new Promise((r) => requestAnimationFrame(r));
    for (let y = 0; y <= el.scrollHeight; y += el.clientHeight / 2) {
      el.scrollTop = y;
      await frame();
      const now = performance.now();
      frames.push(now - last);
      last = now;
    }
    const lastRow = [...document.querySelectorAll('tr.conversation-row')]
      .at(-1)
      ?.getAttribute('aria-rowindex');
    frames.sort((a, b) => a - b);
    return {
      frames: frames.length,
      medianMs: +frames[frames.length >> 1].toFixed(1),
      p95Ms: +frames[Math.floor(frames.length * 0.95)].toFixed(1),
      lastRowIndex: Number(lastRow),
    };
  });
  assert.equal(result.scroll.lastRowIndex, result.total + 1, 'the last row is reachable');

  // Typing waits on no full-list re-render; filtering follows.
  const search = page.locator('#conversation-search');
  start = Date.now();
  await search.pressSequentially('#4999', { delay: 30 });
  await page.waitForFunction(() => document.querySelectorAll('tr.conversation-row').length <= 2);
  result.searchMs = Date.now() - start;
  await search.fill('');
  await page.waitForFunction(() => document.querySelectorAll('tr.conversation-row').length > 10);

  // Upload 20 conversations through the main process; only the task indicator may update.
  const rows = (await invoke(page, 'refresh')).data.rows.slice(0, 20).map((r) => r.id);
  const before = await page.evaluate(() => ({ ...window.sesshuttleRenderStats }));
  const plan = await invoke(page, 'preview', { ids: rows, direction: 'upload', targets: [] });
  assert.equal(plan.ok, true, JSON.stringify(plan.error));
  const job = await invoke(page, 'execute', { token: plan.data.token });
  assert.equal(job.data.status, 'completed', JSON.stringify(job.data));
  await page.waitForSelector('.task-indicator');
  const after = await page.evaluate(() => ({ ...window.sesshuttleRenderStats }));
  result.progress = {
    tableRenders: after.table - before.table,
    rowRenders: after.rows - before.rows,
    taskIndicator: await page.locator('.task-indicator').count(),
  };
  assert.equal(result.progress.tableRenders, 0, 'progress events do not re-render the table');
  console.log(JSON.stringify(result, null, 2));
} finally {
  await session.close();
}
