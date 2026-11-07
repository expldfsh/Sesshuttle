// Only accepts a previously created private lab. Cannot remove live Codex data.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { State } from '../core/state.mjs';
import { Importer } from '../core/importer.mjs';
import { Trash } from '../core/trash.mjs';
import { scan } from '../core/codex.mjs';
import { prepareNative } from '../core/native.mjs';
const [root, tid, binary] = process.argv.slice(2);
assert.equal(await fs.realpath(root), root);
assert.equal(path.dirname(root), await fs.realpath(os.tmpdir()));
assert.ok(path.basename(root).startsWith('sesshuttle-lab-'));
assert.equal(JSON.parse(await fs.readFile(path.join(root, '.sesshuttle-lab.json'))).format, 1);
const home = path.join(root, 'target/codex'),
  project = path.join(root, 'target/project'),
  state = new State(path.join(root, 'trash-test'));
try {
  const importer = new Importer(state, { testRoot: root, processGuard: async () => {} }),
    trash = new Trash(state, importer),
    before = await scan([home]);
  assert.equal(before.errors.length, 0);
  const row = before.rows.find((r) => r.id === tid);
  assert.ok(row);
  const plan = await trash.preview([home], { ids: [tid], includeDependents: true });
  assert.equal(plan.blockers.length, 0);
  await trash.remove(plan.token);
  const removed = await scan([home]);
  assert.ok(!removed.rows.some((r) => r.id === tid));
  for (const r of before.rows.filter((r) => !plan.ids.includes(r.id)))
    assert.equal(removed.rows.find((n) => n.id === r.id)?.hash, r.hash);
  await trash.restore(plan.token);
  const after = await scan([home]);
  for (const r of before.rows) assert.equal(after.rows.find((n) => n.id === r.id)?.hash, r.hash);
  await prepareNative({
    binary,
    home,
    project,
    files: [{ id: tid, archived: row.archived, turnCount: row.turnCount }],
  });
  console.log(
    JSON.stringify({
      root,
      id: tid,
      result: 'PASS isolated real-copy removal, exact restoration and native pagination',
      historyFiles: plan.files.filter((f) => f.kind === 'history').length,
      removedAttachments: plan.files.filter((f) => f.kind === 'asset').length,
      deletedChats: plan.ids.length,
      otherChatsPreserved: before.rows.length - plan.ids.length,
    }),
  );
} finally {
  state.close();
}
