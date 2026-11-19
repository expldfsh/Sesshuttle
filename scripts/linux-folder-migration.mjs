// Run only in a disposable offline Linux desktop with its own Secret Service and X display.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { _electron } from 'playwright-core';
import { State } from '../core/state.mjs';
import { createDataFolder, legacyFolder, markerName } from '../core/data-folder.mjs';
import { locationFile, readFolderLocation } from '../core/folder-location.mjs';
import { retrieveConnection } from '../core/portable-credentials.mjs';
import { invoke } from './lib/test-app.mjs';

const marker = '/run/sesshuttle-isolated-vm';
assert.equal(process.platform, 'linux');
assert.equal((await fs.stat(marker)).uid, 0);
assert.equal((await fs.readFile(marker, 'utf8')).trim(), 'loopback-only-fixture');
const [binary, previousBinary, sampleMode] = process.argv.slice(2);
const unreadable = sampleMode === '--unreadable';
const home = os.homedir();
assert.equal(home, '/home/node');
assert.equal(await readFolderLocation(home), null);
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
const old = legacyFolder(home, 'linux', env.XDG_CONFIG_HOME);
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
      await delay(150);
      return id;
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
async function pick(title, folder) {
  const window = await focus(title);
  xdo('key', 'ctrl+l');
  await delay(150);
  xdo('type', '--', folder);
  xdo('key', 'Return');
  // In a populated folder GTK may accept a path completion before accepting the dialog.
  await delay(700);
  const stillOpen = spawnSync('xdotool', ['search', '--onlyvisible', '--name', title], {
    encoding: 'utf8',
  });
  if (stillOpen.stdout.trim().split('\n').includes(window)) xdo('key', 'Return');
}
let app;
try {
  const cancel = spawn(binary, [], { env, stdio: 'ignore' });
  const exited = once(cancel, 'exit');
  await focus('Choose where to save');
  xdo('key', 'Escape');
  assert.equal((await exited)[0], 0);
  assert.equal(await fs.stat(old).catch(() => null), null);
  assert.equal(await readFolderLocation(home), null);

  // Establish the same keyring contents for the old reader and the new reader.
  const secretItem = JSON.stringify(
    previousBinary ? { ...record, key: 'earlier-fixture' } : record,
  );
  assert.equal(item(reference, secretItem).status, 0);
  assert.equal(item(unrelated, 'keep-me').status, 0);

  if (previousBinary) {
    // Model an existing installation. The OS key provider has already been initialized
    // in an earlier process before the old app stores the connection.
    const warm = await _electron.launch({ executablePath: previousBinary, env });
    try {
      await (await warm.firstWindow()).waitForSelector('.shell');
      await warm.evaluate(async ({ safeStorage }) => {
        await safeStorage.isAsyncEncryptionAvailable();
        safeStorage.getSelectedStorageBackend();
        await safeStorage.encryptStringAsync('throwaway fixture');
      });
    } finally {
      await warm.close();
    }
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
    const file = path.join(old, 'connection-secret.bin');
    let ciphertext = await fs.readFile(file);
    if (unreadable) {
      ciphertext = ciphertext.subarray(0, 7);
      await fs.writeFile(file, ciphertext);
    }
    const beforeUpgrade = await _electron.launch({ executablePath: previousBinary, env });
    try {
      await (await beforeUpgrade.firstWindow()).waitForSelector('.shell');
      const raw = await beforeUpgrade.evaluate(async ({ safeStorage }, value) => {
        try {
          return (await safeStorage.decryptStringAsync(Buffer.from(value, 'base64'))).result;
        } catch {
          return null;
        }
      }, ciphertext.toString('base64'));
      assert.equal(
        raw,
        unreadable ? null : JSON.stringify(record),
        'the source version confirms whether this fixture is recoverable',
      );
    } finally {
      await beforeUpgrade.close();
    }
  }
  const state = new State(old);
  state.set('credentialMethod', previousBinary ? 'system' : 'secret-service');
  state.set('credentialReference', reference);
  state.set('connection', connection);
  state.close();
  const launch = _electron.launch({ executablePath: binary, env, timeout: 60000 });
  launch.catch(() => {});
  await pick('Choose where to save', parent);
  await focus('^Sesshuttle$');
  xdo('key', 'Return');
  app = await launch;
  // Chromium's native upgrade dialog defaults to the safe copy action.
  await focus('^Sesshuttle$');
  xdo('key', 'Return');
  const page = await app.firstWindow({ timeout: 30000 });
  await page.waitForSelector('.shell');
  const init = (await invoke(page, 'init')).data;
  assert.equal(init.dataFolder, selected);
  const saved = await readFolderLocation(home);
  assert.equal(saved.folder, selected);
  assert.equal(init.migration.credentialsReady, false);
  const protectedResult = await invoke(page, 'protectMigration', {
    password: 'fixture-passphrase',
  });
  if (unreadable) {
    assert.equal(protectedResult.error?.code, 'credential_legacy_unreadable');
    assert.equal((await invoke(page, 'cleanupDataFolder')).error?.code, 'migration_credentials');
    await fs.access(path.join(old, 'sesshuttle.sqlite'));
    await fs.access(path.join(old, 'connection-secret.bin'));
    assert.equal(item(reference).stdout, secretItem);
    console.log(
      'PASS unreadable credential confirmed by 0.7.3, originals preserved and cleanup blocked',
    );
  } else {
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
    assert.equal(
      await fs.stat(path.join(env.XDG_CACHE_HOME, 'sesshuttle')).catch(() => null),
      null,
    );
    let current = selected;
    if (!previousBinary) {
      console.log('PASS native selection, verified credentials and scoped cleanup');
      // Simulate another disk at exactly the same mount point.
      current = path.join(root, 'reconnected');
      await fs.rename(selected, current);
      await createDataFolder(parent);
      const recovery = _electron.launch({ executablePath: binary, env, timeout: 60000 });
      recovery.catch(() => {});
      await focus('^Sesshuttle$');
      xdo('key', 'Return');
      await focus('Select your original');
      assert.deepEqual(await fs.readdir(selected), [markerName]);
      assert.deepEqual(await readFolderLocation(home), saved);
      console.log('PASS wrong disk rejected and location retained');

      // Find the same identity at a new mount point using the existing picker.
      await pick('Select your original', current);
      app = await recovery;
      await (await app.firstWindow()).waitForSelector('.shell');
      assert.deepEqual(await readFolderLocation(home), { folder: current, id: saved.id });
      console.log('PASS original folder selected at its new mount point');
      await app.close();
      app = null;

      // A drive reconnected before dismissing the alert opens without a chooser.
      await fs.rename(current, current + '-offline');
      const retry = _electron.launch({ executablePath: binary, env, timeout: 60000 });
      retry.catch(() => {});
      await focus('^Sesshuttle$');
      await fs.rename(current + '-offline', current);
      xdo('key', 'Return');
      app = await retry;
      await (await app.firstWindow()).waitForSelector('.shell');
      await app.close();
      app = null;
    }
    app = await _electron.launch({ executablePath: binary, env, timeout: 30000 });
    const fromIcon = await app.firstWindow();
    await fromIcon.waitForSelector('.shell');
    const again = (await invoke(fromIcon, 'init')).data;
    assert.equal(again.dataFolder, current);
    assert.deepEqual(again.device, init.device);
    assert.equal(await fs.stat(old).catch(() => null), null);
    console.log(
      previousBinary
        ? 'PASS verified 0.7.3 system ciphertext migration, scoped credential deletion and profile cleanup'
        : 'PASS native Linux picker, Secret Service migration, icon reopen, wrong drive, moved folder and reconnect',
    );
  }
} finally {
  if (app) await app.close().catch(() => {});
  const saved = await readFolderLocation(home);
  if (saved?.folder.startsWith(root + path.sep)) await fs.unlink(locationFile(home));
  await fs.rm(root, { recursive: true, force: true });
}
