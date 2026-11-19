// Inventory the test account outside the ZIP and selected data folder. Windows
// owns files such as Explorer caches; keep every difference for review.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

assert.equal(process.platform, 'win32');
assert.equal(os.hostname().toUpperCase(), 'SESSHUTTLE-QA');
const [action, target, after] = process.argv.slice(2);
if (action === 'device') {
  const db = new DatabaseSync(target, { readOnly: true });
  try {
    console.log(JSON.parse(db.prepare("SELECT value FROM kv WHERE key='device'").get().value).id);
  } finally {
    db.close();
  }
} else if (action === 'snapshot') {
  const files = {},
    unreadable = [];
  async function scan(dir, prefix) {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (e) {
      unreadable.push([prefix, e.code]);
      return;
    }
    for (const entry of entries) {
      const name = prefix + '/' + entry.name,
        file = path.join(dir, entry.name);
      try {
        const stat = await fs.lstat(file);
        files[name] = stat.isDirectory() ? 'dir' : [stat.size, stat.mtimeMs].join(':');
        if (stat.isDirectory() && !stat.isSymbolicLink()) await scan(file, name);
      } catch (e) {
        if (e.code !== 'ENOENT') unreadable.push([name, e.code]);
      }
    }
  }
  await scan(process.env.APPDATA, 'Roaming');
  await scan(process.env.LOCALAPPDATA, 'Local');
  await fs.writeFile(target, JSON.stringify({ files, unreadable }));
} else {
  assert.equal(action, 'compare');
  const a = JSON.parse(await fs.readFile(target)),
    b = JSON.parse(await fs.readFile(after));
  const added = Object.keys(b.files).filter((k) => !(k in a.files));
  const changed = Object.keys(b.files).filter((k) => k in a.files && a.files[k] !== b.files[k]);
  const candidates = [...added, ...changed].filter((k) => /sesshuttle|electron|crashpad/i.test(k));
  console.log(
    JSON.stringify({
      added,
      changed,
      candidates,
      unreadable: b.unreadable,
      before: Object.keys(a.files).length,
      after: Object.keys(b.files).length,
    }),
  );
}
