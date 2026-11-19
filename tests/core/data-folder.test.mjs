import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { State } from '../../core/state.mjs';
import {
  createDataFolder,
  openDataFolder,
  migrateData,
  verifyPreparedMove,
  cleanMigration,
  migrationReview,
} from '../../core/data-folder.mjs';
import { readMarker, runtimePaths, markerName } from '../../core/profile-paths.mjs';
import {
  sealCredentials,
  openCredentials,
  protectLegacySecrets,
  retrieveConnection,
} from '../../core/portable-credentials.mjs';

async function fixture(t) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'sesshuttle-folder-')));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const source = path.join(root, 'legacy');
  const state = new State(source);
  const device = state.get('device');
  state.set('config', { language: 'en', sourceHomes: [] });
  state.set('baseline/saved', { version: 'published' });
  state.close();
  await fs.mkdir(path.join(source, 'backups'));
  await fs.writeFile(path.join(source, 'backups', 'evidence'), 'backup');
  const target = await createDataFolder(root);
  return { source, target, device, root };
}

test('choosing a parent creates a dedicated folder without adopting unrelated files', async (t) => {
  const { target, root } = await fixture(t);
  assert.equal(await openDataFolder(target), target);
  await assert.rejects(openDataFolder(root));
  await assert.rejects(createDataFolder(root));
});

test('verified migration preserves identity and only cleans reviewed data on request', async (t) => {
  const { source, target, device } = await fixture(t);
  await fs.writeFile(path.join(source, 'personal.txt'), 'keep');
  await fs.mkdir(path.join(source, 'launchers'));
  await fs.writeFile(path.join(source, 'launchers', 'resume.command'), '#!/bin/sh\n', {
    mode: 0o700,
  });
  await migrateData(source, target);
  const state = new State(path.join(target, 'data'));
  t.after(() => state.close());
  assert.deepEqual(state.get('device'), device);
  assert.ok(
    (await fs.stat(path.join(state.root, 'launchers', 'resume.command'))).mode & 0o100,
    'a copied CLI launcher stays executable',
  );
  assert.deepEqual(state.get('baseline/saved'), { version: 'published' });
  assert.equal(await fs.readFile(path.join(source, 'backups', 'evidence'), 'utf8'), 'backup');
  const review = await migrationReview(state, source);
  await cleanMigration(state, source, review.token);
  assert.deepEqual(await fs.readdir(source), ['personal.txt']);
  assert.equal(await fs.readFile(path.join(state.root, 'backups', 'evidence'), 'utf8'), 'backup');
});

test('a changed source, damaged copy, or linked file prevents cleanup', async (t) => {
  const { source, target, root } = await fixture(t);
  await migrateData(source, target);
  const state = new State(path.join(target, 'data'));
  t.after(() => state.close());
  const review = await migrationReview(state, source);
  const oldFile = path.join(source, 'backups/evidence');
  await fs.writeFile(oldFile, 'changed');
  await assert.rejects(cleanMigration(state, source, review.token));
  assert.equal(await fs.readFile(oldFile, 'utf8'), 'changed');
  await fs.writeFile(oldFile, 'backup');
  await fs.writeFile(path.join(state.root, 'backups/evidence'), 'damaged');
  await assert.rejects(migrationReview(state, source));
  const freshParent = await fs.mkdtemp(path.join(root, 'new-'));
  const fresh = await createDataFolder(freshParent);
  await fs.symlink(path.join(root, 'anywhere'), path.join(source, 'backups/link'));
  await assert.rejects(migrateData(source, fresh));
  await assert.rejects(fs.access(path.join(fresh, 'data')));
});

test('old credentials must be converted before source cleanup', async (t) => {
  const { source, target } = await fixture(t);
  const old = new State(source);
  old.set('connection', { space: 'test' });
  old.set('credentialMethod', 'mac-keychain');
  old.close();
  await migrateData(source, target);
  const state = new State(path.join(target, 'data'));
  t.after(() => state.close());
  await assert.rejects(migrationReview(state, source), { code: 'migration_credentials' });
});

test('portable credentials require the password, reject damage and use a fresh salt', async () => {
  const value = { key: 'private-space-key', credentials: { secretAccessKey: 'private-secret' } };
  const sealed = await sealCredentials(value, 'one long passphrase');
  assert.ok(!sealed.includes('private-secret'));
  assert.notDeepEqual(sealed, await sealCredentials(value, 'one long passphrase'));
  assert.deepEqual(await openCredentials(sealed, 'one long passphrase'), value);
  await assert.rejects(openCredentials(sealed, 'incorrect password'), {
    code: 'folder_password_wrong',
  });
  const broken = Buffer.from(sealed);
  broken[broken.length - 1] ^= 1;
  await assert.rejects(openCredentials(broken, 'one long passphrase'));
});

test('snapshot includes uncheckpointed WAL rows and refuses a live source lock', async (t) => {
  const { source, target } = await fixture(t);
  const active = new State(source);
  t.after(() => active.close());
  active.db.exec('PRAGMA wal_autocheckpoint=0');
  active.set('wal-only', { retained: true });
  const lock = path.join(source, 'SingletonLock');
  await fs.symlink(os.hostname() + '-' + process.pid, lock);
  await assert.rejects(migrateData(source, target), { code: 'folder_in_use' });
  await fs.unlink(lock);
  await migrateData(source, target);
  const copy = new State(path.join(target, 'data'));
  t.after(() => copy.close());
  assert.deepEqual(copy.get('wal-only'), { retained: true });
});

test('copying then cleaning a moved profile removes its reviewed runtime and keeps personal files', async (t) => {
  const { source: legacy, target: first, root } = await fixture(t);
  const active = new State(path.join(first, 'data'));
  const runtime = runtimePaths(first);
  await fs.writeFile(path.join(runtime.logs, 'app.log'), 'old log');
  await fs.writeFile(path.join(first, 'notes.txt'), 'mine');
  const parent = await fs.mkdtemp(path.join(root, 'moved-'));
  const target = await createDataFolder(parent);
  await migrateData(active.root, target, { portable: true, ownedState: active });
  await verifyPreparedMove(active, target);
  active.set('second-writing-session', true);
  await assert.rejects(verifyPreparedMove(active, target), { code: 'migration_changed' });
  active.remove('second-writing-session');
  active.close();
  await fs.writeFile(
    path.join(first, markerName),
    JSON.stringify({ ...readMarker(first), movedTo: target, movedId: readMarker(target).id }),
  );
  const state = new State(path.join(target, 'data'));
  t.after(() => state.close());
  const r = await migrationReview(state, legacy);
  assert.ok(r.names.includes('runtime'));
  await cleanMigration(state, legacy, r.token);
  assert.deepEqual(await fs.readdir(first), ['notes.txt']);
});

test('credentials survive a cancelled prompt, verified conversion and interrupted cleanup', async (t) => {
  const { source, target } = await fixture(t);
  const old = new State(source);
  const connection = { space: 'saved-space' };
  const value = {
    connection,
    credentials: { accessKeyId: 'fixture-id', secretAccessKey: 'fixture-only-secret' },
    key: 'fixture-space-key',
  };
  old.set('connection', connection);
  old.set('credentialMethod', 'mac-keychain');
  old.close();
  await migrateData(source, target);
  const state = new State(path.join(target, 'data'));
  t.after(() => state.close());
  const cancelled = () => {
    throw Object.assign(Error('cancelled'), { code: 'credential_cancelled' });
  };
  await assert.rejects(protectLegacySecrets(state, 'fixture-password', cancelled), {
    code: 'credential_cancelled',
  });
  assert.equal(state.get('folderMigration').credentialsReady, false);
  await assert.rejects(
    protectLegacySecrets(state, 'fixture-password', () => 'unreadable'),
    {
      code: 'credential_legacy_unreadable',
    },
  );
  assert.ok(await fs.stat(path.join(source, 'sesshuttle.sqlite')));
  await assert.rejects(
    protectLegacySecrets(state, 'fixture-password', () =>
      JSON.stringify({ ...value, connection: { space: 'different' } }),
    ),
    { code: 'credential_changed' },
  );
  await protectLegacySecrets(state, 'fixture-password', () => JSON.stringify(value));
  const restored = await retrieveConnection(state, 'fixture-password');
  assert.deepEqual(restored, { key: value.key, credentials: value.credentials });
  await assert.rejects(retrieveConnection(state, 'mistyped-password'), {
    code: 'folder_password_wrong',
  });
  const r = await migrationReview(state, source);
  await assert.rejects(cleanMigration(state, source, r.token, cancelled), {
    code: 'credential_cancelled',
  });
  assert.ok(await fs.stat(path.join(source, 'sesshuttle.sqlite')));
  await cleanMigration(state, source, r.token);
  await assert.rejects(fs.access(source));
  assert.deepEqual(await retrieveConnection(state, 'fixture-password'), restored);
});
