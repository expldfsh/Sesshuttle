// Desktop, CLI and VS Code must use their installed programs and registered
// handlers. No personal account is used in the isolated Windows test machine.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';
import { Lab, withClient } from './lib/native-lab.mjs';
import { invoke, launchApp } from './lib/test-app.mjs';
import { detectEnvironment } from '../core/discovery.mjs';
import { assertCodexClosed } from '../core/native.mjs';
import { startFixtureProvider, writeFixtureConfig } from '../core/fixture-provider.mjs';
import { State } from '../core/state.mjs';
import { id } from '../core/util.mjs';

assert.equal(process.platform, 'win32');
assert.equal(os.hostname().toUpperCase(), 'SESSHUTTLE-QA');
assert.equal(os.userInfo().username, 'SesshuttleQA');
const [exchange, port] = process.argv.slice(2);
const info = JSON.parse(await fs.readFile(exchange));
const cli = await fs.realpath(process.env.SESSHUTTLE_FIXTURE_CODEX);
const lab = await Lab.create();
const home = await lab.directory('codex'),
  project = await lab.directory('project');
const fixture = await startFixtureProvider();
const defaultHome = path.join(os.homedir(), '.codex');
const previousHome = path.join(lab.root, 'preinstalled-client-home');
let app,
  movedHome = false,
  link = false;
try {
  await writeFixtureConfig(home, fixture.port);
  const native = await withClient(
    lab,
    cli,
    home,
    project,
    { localPort: fixture.port },
    async (c) => {
      await assert.rejects(assertCodexClosed(home), { code: 'codex_running' });
      return (
        await c.rpc('project/create', {
          name: 'Windows entry acceptance',
          roots: [{ path: project }],
          idempotencyKey: id(),
        })
      ).project.id;
    },
  );
  const existing = await fs.lstat(defaultHome).catch((error) => {
    if (error.code !== 'ENOENT') throw error;
  });
  if (existing) {
    assert.ok(existing.isDirectory() && !existing.isSymbolicLink());
    const files = await fs.readdir(defaultHome);
    assert.ok(!files.includes('auth.json'), 'The disposable account must be signed out');
    const sessions = await fs.readdir(path.join(defaultHome, 'sessions')).catch((error) => {
      if (error.code !== 'ENOENT') throw error;
      return [];
    });
    assert.equal(
      sessions.length,
      0,
      'The disposable account must have no existing conversation history',
    );
    // The official Windows installer can initialize its default home at sign-in.
    // Preserve it while the registered clients open our synthetic conversation.
    await fs.rename(defaultHome, previousHome);
    movedHome = true;
  }
  await fs.symlink(home, defaultHome, 'junction');
  link = true;
  const detected = await detectEnvironment({
    env: { ...process.env, PATH: path.dirname(cli) + path.delimiter + process.env.PATH },
  });
  const targets = {};
  for (const key of ['cli', 'desktop', 'ide']) {
    const found = detected.candidates.find(
      (candidate) =>
        candidate.entry === key &&
        candidate.runtime &&
        (key !== 'cli' || candidate.canonicalBinary === cli),
    );
    assert.ok(
      found,
      'No installed native program detected for ' +
        key +
        ': ' +
        JSON.stringify(detected.candidates),
    );
    targets[key] = { binary: found.canonicalBinary, home };
    console.log('Detected', key, found.runtime, found.canonicalBinary);
  }
  await lab.write('.sesshuttle-test.json', JSON.stringify({ format: 1 }));
  const state = new State(path.join(lab.root, 'app-data'));
  state.set('config', {
    language: 'en',
    sourceHomes: [home],
    targets,
    bindings: { [info.sourceProject]: project },
    nativeBindings: { [info.sourceProject]: { [home]: native } },
  });
  state.close();
  const ui = await launchApp(lab.root, { executablePath: process.env.SESSHUTTLE_ACCEPTANCE_APP });
  app = ui.app;
  await ui.page.waitForSelector('.shell');
  async function call(method, args = {}) {
    const result = await invoke(ui.page, method, args);
    assert.ok(result.ok, method + ' ' + JSON.stringify(result.error));
    return result.data;
  }
  await call('connect', {
    mode: 'join',
    endpoint: 'http://127.0.0.1:' + port,
    bucket: 'sesshuttle-ui',
    accessKeyId: 'fixture',
    secretAccessKey: 'fixture',
    space: info.space,
    key: info.key,
  });
  const verified = [],
    problems = [];
  for (const [entry, target] of Object.entries(targets)) {
    try {
      await call('verifyRuntime', { id: id(), binary: target.binary });
      await call('refresh');
      const plan = await call('preview', {
        ids: [info.tid],
        direction: 'download',
        targets: [entry],
      });
      const job = await call('execute', { token: plan.token });
      assert.equal(job.status, 'completed', JSON.stringify(job));
      verified.push(entry);
      console.log('Native import verified', entry);
    } catch (error) {
      problems.push(entry + ': ' + error.message);
    }
  }
  for (const entry of verified) {
    try {
      if (entry !== 'cli') {
        const owner = await app.evaluate(
          ({ app }, scheme) =>
            app.getApplicationInfoForProtocol(scheme + '://').then((r) => r.path || r.name),
          entry === 'ide' ? 'vscode' : 'codex',
        );
        assert.ok(owner);
        console.log('Registered handler', entry, owner);
      }
      assert.equal((await call('continue', { entry, logicalId: info.tid })).status, 'opened');
      console.log('Opened', entry, info.tid);
    } catch (error) {
      problems.push(entry + ': ' + error.message);
    }
  }
  await pause(8000);
  assert.deepEqual(problems, []);
} finally {
  try {
    try {
      if (app) await app.close();
    } finally {
      await fixture.close();
    }
  } finally {
    if (link) {
      assert.ok((await fs.lstat(defaultHome)).isSymbolicLink());
      assert.equal(await fs.realpath(defaultHome), home);
      await fs.unlink(defaultHome);
    }
    if (movedHome) await fs.rename(previousHome, defaultHome);
  }
}
