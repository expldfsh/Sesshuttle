// Packaged or development app, marked temporary profiles and loopback storage only.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createDataFolder } from '../core/data-folder.mjs';
import { locationFile, readFolderLocation } from '../core/folder-location.mjs';
import { State } from '../core/state.mjs';
import { launchApp, makeFixture, invoke, startStorage } from './lib/test-app.mjs';

const executablePath = process.argv[2];
const root = makeFixture(),
  source = path.join(root, 'legacy');
let app, page, storage;
async function launch(folder, fromIcon = false) {
  ({ app, page } = await launchApp(root, {
    executablePath,
    env: { SESSHUTTLE_TEST_LAUNCHER: '1', SESSHUTTLE_TEST_COPY: '1' },
    args:
      fromIcon && executablePath
        ? []
        : [
            '--sesshuttle-folder=' + folder,
            '--user-data-dir=' + path.join(folder, 'runtime', 'profile'),
          ],
  }));
  await page.waitForSelector('.shell');
}
async function call(method, args) {
  const r = await invoke(page, method, args);
  assert.ok(r.ok, JSON.stringify(r.error));
  return r.data;
}
async function confirmWith(response) {
  await app.evaluate(({ dialog }, answer) => {
    dialog.showMessageBox = async () => ({ response: answer });
  }, response);
}
try {
  await fs.rename(path.join(root, 'app-data'), source);
  const seed = new State(source);
  seed.set('config', { ...seed.get('config'), language: 'en' });
  const device = seed.get('device');
  seed.close();
  await fs.writeFile(path.join(source, 'keep.txt'), 'personal');
  await fs.mkdir(path.join(source, 'launchers'));
  await fs.writeFile(path.join(source, 'launchers/resume.sh'), '#!/bin/sh\n', { mode: 0o700 });
  await fs.mkdir(path.join(source, 'backups'));
  await fs.writeFile(path.join(source, 'backups', 'fixture'), 'verified');
  const parent = path.join(root, "中文 O'Brien");
  await fs.mkdir(parent);
  const folder = await createDataFolder(parent);
  await launch(folder);
  const init = await call('init');
  assert.equal(init.dataFolder, folder);
  assert.equal(init.folderLocation.file, locationFile(root));
  assert.equal((await readFolderLocation(root)).folder, folder);
  assert.deepEqual(init.device, device);
  assert.equal(init.migration.credentialsReady, true);
  const paths = await app.evaluate(({ app }) =>
    Object.fromEntries(
      ['userData', 'sessionData', 'userCache', 'logs', 'crashDumps', 'temp'].map((k) => [
        k,
        app.getPath(k),
      ]),
    ),
  );
  for (const [key, dir] of Object.entries(paths)) assert.ok(dir.startsWith(folder + path.sep), key);
  await page.getByRole('button', { name: 'Review migration', exact: true }).click();
  await page.getByText(folder, { exact: true }).waitFor();
  await page.getByText(locationFile(root), { exact: true }).waitFor();
  await confirmWith(0);
  assert.equal(await call('cleanupDataFolder'), null);
  await fs.access(path.join(source, 'sesshuttle.sqlite'));
  await confirmWith(1);
  await page.getByRole('button', { name: 'Review old files…' }).click();
  await page.getByText(/Other files remain/).waitFor();
  assert.deepEqual(await fs.readdir(source), ['keep.txt']);

  storage = await startStorage(root);
  await call('connect', {
    mode: 'create',
    endpoint: storage.endpoint,
    bucket: storage.bucket,
    accessKeyId: storage.accessKeyId,
    secretAccessKey: storage.secretAccessKey,
  });
  assert.equal((await call('init')).canRestore, false);
  await page.reload();
  await page.locator('nav button').last().click();
  await page.getByRole('button', { name: 'Remember connection…' }).click();
  const modal = page.locator('dialog[open]');
  await modal.getByLabel('Local unlock password').fill('only-a-fixture');
  await modal.getByLabel('Repeat password').fill('different');
  await modal.getByRole('button', { name: 'Remember connection…' }).click();
  await modal.locator('[role=alert]').waitFor();
  await modal.getByLabel('Repeat password').fill('only-a-fixture');
  await modal.getByRole('button', { name: 'Remember connection…' }).click();
  await modal.waitFor({ state: 'hidden' });
  await app.close();
  app = null;
  // With a packaged app there is no folder argument, just like a click on the app icon.
  const standard = await createDataFolder(root);
  await launch(folder, true);
  assert.equal((await call('init')).dataFolder, folder);
  assert.equal((await call('init')).connected, false);
  await page.locator('nav button').last().click();
  await page.getByRole('button', { name: 'Unlock and connect…' }).click();
  const unlock = page.locator('dialog[open]');
  await unlock.getByLabel('Local unlock password').fill('wrong');
  await unlock.getByRole('button', { name: 'Unlock and connect…' }).click();
  await unlock.locator('[role=alert]').waitFor();
  await unlock.getByLabel('Local unlock password').fill('only-a-fixture');
  await unlock.getByRole('button', { name: 'Unlock and connect…' }).click();
  await unlock.waitFor({ state: 'hidden' });
  assert.equal((await call('init')).connected, true);

  const nextParent = await fs.mkdtemp(path.join(root, 'move-'));
  await app.evaluate(({ app, dialog }, parent) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [parent] });
    dialog.showMessageBox = async () => ({ response: 1 });
    // The harness reopens the requested profile with the debugger attached.
    app.relaunch = () => {};
  }, nextParent);
  const closed = app.waitForEvent('close');
  await page.getByRole('button', { name: 'Move data folder…' }).click();
  await closed;
  app = null;
  const moved = path.join(nextParent, 'Sesshuttle Data');
  await launch(moved, true);
  assert.equal((await call('init')).dataFolder, moved);
  assert.equal((await readFolderLocation(root)).folder, moved);
  assert.ok(
    (await fs.stat(path.join(moved, 'data/launchers/resume.sh'))).mode & 0o100,
    'CLI launchers remain executable after both copies',
  );
  assert.equal((await call('restoreConnection', { password: 'only-a-fixture' })).warning, null);
  await confirmWith(1);
  assert.deepEqual(await call('cleanupDataFolder'), { remaining: null });
  await assert.rejects(fs.access(folder));
  assert.equal(await fs.readFile(path.join(moved, 'data/backups/fixture'), 'utf8'), 'verified');
  await app.close();
  app = null;
  await launch(moved, true);
  assert.equal((await call('init')).dataFolder, moved);
  assert.deepEqual((await call('init')).device, device);
  await app.close();
  app = null;
  await launch(standard);
  assert.equal((await call('init')).folderLocation, null);
  assert.equal(await readFolderLocation(root), null);
  await app.close();
  app = null;
  await launch(standard, true);
  assert.equal((await call('init')).dataFolder, standard);
  console.log(
    'PASS migration, passwords, app icon after moving and after cleanup, standard folder with no location file',
  );
} finally {
  if (app) await app.close().catch(() => {});
  storage?.stop();
  await fs.rm(root, { recursive: true, force: true });
}
