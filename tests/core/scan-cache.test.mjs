import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { scan } from '../../core/codex.mjs';
import { summaryCacheStats } from '../../core/catalog.mjs';
import { id } from '../../core/util.mjs';
import { tempRoot, writeRollout } from '../helpers/bundles.mjs';

async function fixture() {
  const root = await tempRoot(),
    home = path.join(root, 'codex'),
    tid = id(),
    plain = id();
  const file = await writeRollout(home, tid, { texts: ['rollout text'] });
  const plainFile = await writeRollout(home, plain, { texts: ['first turn'] });
  const state = new DatabaseSync(path.join(home, 'state_5.sqlite'));
  state.exec(
    'PRAGMA journal_mode=WAL; CREATE TABLE threads(id TEXT PRIMARY KEY, title TEXT, source TEXT, cwd TEXT, cli_version TEXT, created_at INTEGER, updated_at INTEGER, archived INTEGER, rollout_path TEXT)',
  );
  state
    .prepare('INSERT INTO threads VALUES(?,?,?,?,?,?,?,?,?)')
    .run(tid, 'Indexed', 'cli', root, '0.166.0', 1, 2, 0, file);
  state.close();
  const history = new DatabaseSync(path.join(home, 'thread_history_1.sqlite'));
  history.exec(
    'PRAGMA journal_mode=WAL; CREATE TABLE thread_items(thread_id TEXT, item_id TEXT, item_json TEXT, PRIMARY KEY(thread_id,item_id))',
  );
  const item = (n, text) =>
    history
      .prepare('INSERT INTO thread_items VALUES(?,?,?)')
      .run(tid, n, JSON.stringify({ type: 'userMessage', content: [{ text }] }));
  item('1', 'stored item');
  return { home, tid, plain, plainFile, history, item };
}
const messages = async (home, tid) =>
  (await scan([home])).rows.find((r) => r.id === tid).messages.map((m) => m.text);

test('unchanged databases reuse summaries; any database or WAL change recomputes them', async () => {
  const x = await fixture();
  try {
    assert.deepEqual(await messages(x.home, x.tid), ['stored item']);
    const before = { ...summaryCacheStats };
    assert.deepEqual(await messages(x.home, x.tid), ['stored item']);
    assert.equal(
      summaryCacheStats.misses,
      before.misses,
      'unchanged files are not summarized again',
    );
    assert.ok(summaryCacheStats.hits > before.hits);
    // The writer stays open, so this change exists only in the write-ahead log.
    x.item('2', 'written to the log');
    assert.deepEqual(await messages(x.home, x.tid), ['stored item', 'written to the log']);
    x.history.close();
    x.history = null;
    assert.deepEqual(await messages(x.home, x.tid), ['stored item', 'written to the log']);
  } finally {
    x.history?.close();
  }
});

test('an appended rollout turn is visible on the next scan', async () => {
  const x = await fixture();
  try {
    assert.deepEqual(await messages(x.home, x.plain), ['first turn']);
    await fs.appendFile(
      x.plainFile,
      JSON.stringify({ type: 'event_msg', payload: { type: 'agent_message', message: 'reply' } }) +
        '\n',
    );
    assert.deepEqual(await messages(x.home, x.plain), ['first turn', 'reply']);
    // An unfinished last record is reported as busy; the conversation stays listed.
    await fs.appendFile(x.plainFile, '{"type":"event_msg"');
    const partial = await scan([x.home]);
    assert.equal(partial.errors.find((e) => e.id === x.plain)?.code, 'busy');
    assert.ok(partial.rows.some((r) => r.id === x.plain));
  } finally {
    x.history.close();
  }
});
