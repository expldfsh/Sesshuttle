import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { liveLinuxTargets } from '../../core/discovery.mjs';

test('Linux associates the worker with its desktop and reports conflicting homes separately', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sesshuttle-proc-'));
  try {
    for (const [pid, ppid, exe] of [
      ['10', '1', '/usr/lib/chatgpt/ChatGPT'],
      ['11', '10', '/usr/lib/chatgpt/resources/codex'],
    ]) {
      const dir = path.join(root, pid);
      await fs.mkdir(path.join(dir, 'fd'), { recursive: true });
      await fs.symlink(exe, path.join(dir, 'exe'));
      await fs.writeFile(path.join(dir, 'status'), 'PPid:\t' + ppid);
    }
    await fs.writeFile(path.join(root, '11', 'cmdline'), 'codex\0app-server\0');
    await fs.writeFile(
      path.join(root, '11', 'environ'),
      'SECRET=must-not-leave\0CODEX_HOME=/other\0',
    );
    await fs.symlink('/actual/state_5.sqlite-wal', path.join(root, '11', 'fd', '7'));
    const results = await liveLinuxTargets(root, (await fs.stat(root)).uid);
    assert.deepEqual(results.map((r) => r.home).sort(), ['/actual', '/other']);
    assert.ok(results.every((r) => r.entry === 'desktop' && r.app === '/usr/lib/chatgpt/ChatGPT'));
    assert.ok(!JSON.stringify(results).includes('must-not-leave'));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
