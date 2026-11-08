import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { detectEnvironment, liveLinuxTargets } from '../../core/discovery.mjs';
import { fakeBundle } from '../helpers/stand-in.mjs';

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

test('detection recommends the program behind a known launcher, once', async () => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'sesshuttle-detect-')));
  try {
    const { bundle, launcher, program } = await fakeBundle(root, 'ChatGPT.app', '', {
      compile: false,
    });
    await fs.writeFile(program, 'not a script');
    await fs.chmod(program, 0o755);
    const resources = path.join(bundle, 'Contents/Resources');
    // Two candidates of the same app lead to one program.
    await fs.symlink(program, path.join(resources, 'codex'));
    const ran = [];
    const report = await detectEnvironment({
      platform: 'darwin',
      appRoots: [resources],
      env: { PATH: '' },
      userHome: path.join(root, 'home'),
      version: async (file) => {
        ran.push(file);
        return '9.9.5';
      },
    });
    const desktop = report.candidates.filter((c) => c.entry === 'desktop');
    assert.equal(desktop.length, 1);
    assert.equal(desktop[0].binary, program);
    assert.equal(desktop[0].resolvedFrom, launcher);
    assert.equal(desktop[0].runtime, '9.9.5');
    assert.deepEqual(
      ran.filter((file) => file.startsWith(root)),
      [program],
      'only the real program answers',
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('detection does not offer a launcher it cannot resolve', async () => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'sesshuttle-detect-')));
  try {
    const { launcher } = await fakeBundle(root, 'Other.app', '', { compile: false });
    const report = await detectEnvironment({
      platform: 'darwin',
      testRoot: root,
      config: { targets: { desktop: { binary: launcher, home: root } } },
      version: async () => '9.9.6',
    });
    const [candidate] = report.candidates;
    assert.equal(candidate.binary, launcher);
    assert.equal(candidate.error, 'runtime_launcher');
    assert.equal(candidate.runtime, undefined, 'a launcher cannot be applied');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('detection accepts an npm installation whose entry point is a Node script', async (t) => {
  const triplet = {
    linux: { x64: 'x86_64-unknown-linux-musl', arm64: 'aarch64-unknown-linux-musl' },
    darwin: { arm64: 'aarch64-apple-darwin', x64: 'x86_64-apple-darwin' },
  }[process.platform]?.[process.arch];
  if (!triplet) return t.skip('no npm layout for this platform');
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'sesshuttle-detect-')));
  try {
    const pkg = path.join(root, 'lib/node_modules/@openai/codex');
    const entry = path.join(pkg, 'bin/codex.js');
    const program = path.join(pkg, 'vendor', triplet, 'codex/codex');
    await fs.mkdir(path.dirname(entry), { recursive: true });
    await fs.mkdir(path.dirname(program), { recursive: true });
    await fs.writeFile(path.join(pkg, 'package.json'), '{"name":"@openai/codex"}');
    await fs.writeFile(entry, '#!/usr/bin/env node\n', { mode: 0o755 });
    await fs.writeFile(program, 'not a script', { mode: 0o755 });
    const report = await detectEnvironment({
      testRoot: root,
      config: { targets: { cli: { binary: entry, home: root } } },
      version: async () => '9.9.7',
    });
    const [candidate] = report.candidates;
    assert.equal(candidate.error, undefined, 'the program behind codex.js is not a script');
    assert.equal(candidate.runtime, '9.9.7');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
