// Synthetic format 2 bundles for tests. Every Codex data folder is private to a
// temporary root; chunks are staged in the vault that will publish the bundle.
import fs from 'node:fs/promises';
import { rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scan } from '../../core/codex.mjs';
import { captureBundle } from '../../core/bundle.mjs';

const roots = [];
process.once('exit', () => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

export async function tempRoot(prefix = 'sesshuttle-test-') {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), prefix)));
  roots.push(root);
  return root;
}

export function rolloutText(tid, { texts = ['Synthetic'], cwd = '/synthetic/project', version = '0.166.0', source = 'cli', extra = [] } = {}) {
  const records = [
    { type: 'session_meta', payload: { id: tid, cli_version: version, timestamp: '2026-11-01T12:00:00Z', cwd, source } },
    ...texts.map((message) => ({ type: 'event_msg', payload: { type: 'user_message', message } })),
    ...extra,
  ];
  return records.map((r) => JSON.stringify(r)).join('\n') + '\n';
}

export async function writeRollout(home, tid, options = {}) {
  const dir = path.join(home, 'sessions', '2026', '11', '01');
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, `rollout-2026-11-01T12-00-00-${tid}.jsonl`);
  await fs.writeFile(file, options.raw ?? rolloutText(tid, options));
  return file;
}

let counter = 0;
// A one-conversation bundle whose title is the first message.
export async function bundleOf(vault, tid, text, options = {}) {
  const root = options.root ?? (await tempRoot());
  const home = path.join(root, 'bundle-source-' + counter++);
  await writeRollout(home, tid, { texts: [text], ...options });
  const rows = (await scan([home])).rows;
  const stage = path.join(home, 'stage');
  await fs.mkdir(stage);
  return captureBundle(rows.find((r) => r.id === tid), rows, vault, stage);
}
