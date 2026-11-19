// Run only in a disposable offline Linux desktop with its own Secret Service and X display.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { _electron } from 'playwright-core';
import { State } from '../core/state.mjs';
import { legacyFolder } from '../core/data-folder.mjs';
import { retrieveConnection } from '../core/portable-credentials.mjs';
import { invoke } from './lib/test-app.mjs';

const marker = '/run/sesshuttle-isolated-vm';
assert.equal(process.platform, 'linux');
assert.equal((await fs.stat(marker)).uid, 0);
assert.equal((await fs.readFile(marker, 'utf8')).trim(), 'loopback-only-fixture');
const [binary, previousBinary] = process.argv.slice(2);
const root = await fs.mkdtemp('/tmp/sesshuttle-native-');
const parent = path.join(root, 'chosen');
await fs.mkdir(parent);
const env = {
  ...process.env,
  LANG: 'C.UTF-8',
  LC_ALL: 'C.UTF-8',
  GSETTINGS_BACKEND: 'memory',
  XDG_CURRENT_DESKTOP: 'GNOME',
  XDG_CONFIG_HOME: path.join(root, 'config'),
  XDG_CACHE_HOME: path.join(root, 'cache'),
};
const old = legacyFolder('/home/node', 'linux', env.XDG_CONFIG_HOME);
const selected = path.join(parent, 'Sesshuttle Data');
const reference = randomUUID(),
  unrelated = randomUUID();
const connection = {
  space: 'offline-fixture',
  bucket: 'example',
  endpoint: 'https://unit.invalid',
};
const record = {
  connection,
  key: 'only-a-fixture',
  credentials: { accessKeyId: 'fixture-id', secretAccessKey: 'fixture-secret' },
};
const xdo = (...args) => execFileSync('xdotool', args, { encoding: 'utf8' });
async function focus(name) {
  for (let i = 0; i < 200; i++) {
    const windows = spawnSync('xdotool', ['search', '--onlyvisible', '--name', name], {
      encoding: 'utf8',
    });
    if (windows.status === 0) {
      const id = windows.stdout.trim().split('\n').at(-1);
      xdo('windowfocus', '--sync', id);
      return;
    }
    await delay(100);
  }
  throw Error('Window missing: ' + name);
}
function item(ref, value) {
  const args = value ? ['store', '--label=Sesshuttle test'] : ['lookup'];
  return spawnSync('secret-tool', [...args, 'application', 'sesshuttle', 'profile', ref], {
    input: value,
    encoding: 'utf8',
    timeout: 12000,
  });
}
let app;
try {
  const cancel = spawn(binary, [], { env, stdio: 'ignore' });
  const exited = once(cancel, 'exit');
  await focus('Choose where to save');
  xdo('key', 'Escape');
  assert.equal((await exited)[0], 0);
  assert.equal(await fs.stat(old).catch(() => null), null);

  if (previousBinary) {
    const previous = await _electron.launch({ executablePath: previousBinary, env });
    try {
      await (await previous.firstWindow()).waitForSelector('.shell');
      const sealed = await previous.evaluate(async ({ safeStorage }, raw) => {
        if (
          !(await safeStorage.isAsyncEncryptionAvailable()) ||
          safeStorage.getSelectedStorageBackend() === 'basic_text'
        )
          throw Error('An encrypted system backend is required');
        return (await safeStorage.encryptStringAsync(raw)).toString('base64');
      }, JSON.stringify(record));
      await fs.writeFile(path.join(old, 'connection-secret.bin'), Buffer.from(sealed, 'base64'), {
        mode: 0o600,
      });
    } finally {
      await previous.close();
    }
  }
  const state = new State(old);
  state.set('credentialMethod', previousBinary ? 'system' : 'secret-service');
  state.set('credentialReference', reference);
  state.set('connection', connection);
  state.close();
  const secretItem = JSON.stringify(
    previousBinary ? { ...record, key: 'earlier-fixture' } : record,
  );
  assert.equal(item(reference, secretItem).status, 0);
  assert.equal(item(unrelated, 'keep-me').status, 0);
  const launch = _electron.launch({ executablePath: binary, env, timeout: 60000 });
  launch.catch(() => {});
  await focus('Choose where to save');
  xdo('key', 'ctrl+l');
  await delay(150);
  xdo('type', '--', parent);
  xdo('key', 'Return');
  await focus('^Sesshuttle$');
  await delay(150);
  xdo('key', 'Return');
  app = await launch;
  // Chromium's native upgrade dialog defaults to the safe copy action.
  await focus('^Sesshuttle$');
  await delay(150);
  xdo('key', 'Return');
  const page = await app.firstWindow({ timeout: 30000 });
  await page.waitForSelector('.shell');
  const init = (await invoke(page, 'init')).data;
  assert.equal(init.dataFolder, selected);
  assert.equal(init.migration.credentialsReady, false);
  const protectedResult = await invoke(page, 'protectMigration', {
    password: 'fixture-passphrase',
  });
  assert.ok(protectedResult.ok, JSON.stringify(protectedResult.error));
  assert.equal(item(reference).stdout, secretItem);
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBox = async () => ({ response: 1 });
  });
  const cleaned = await invoke(page, 'cleanupDataFolder');
  assert.ok(cleaned.ok, JSON.stringify(cleaned.error));
  assert.equal(item(reference).status, 1);
  assert.equal(item(unrelated).stdout, 'keep-me');
  await app.close();
  app = null;
  const reopened = new State(path.join(selected, 'data'));
  assert.deepEqual(await retrieveConnection(reopened, 'fixture-passphrase'), {
    credentials: record.credentials,
    key: record.key,
  });
  reopened.close();
  assert.deepEqual(await fs.readdir(old).catch(() => []), []);
  assert.equal(await fs.stat(old).catch(() => null), null);
  assert.equal(await fs.stat(path.join(env.XDG_CACHE_HOME, 'sesshuttle')).catch(() => null), null);
  console.log(
    'PASS native Linux picker cancel/create, verified Secret Service migration, scoped credential deletion and profile cleanup',
  );
} finally {
  if (app) await app.close().catch(() => {});
  await fs.rm(root, { recursive: true, force: true });
}
