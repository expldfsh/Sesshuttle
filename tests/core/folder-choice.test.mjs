import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chooseDataFolder } from '../../core/folder-choice.mjs';
import { createDataFolder, folderName } from '../../core/data-folder.mjs';
import { locationFile, rememberFolderLocation } from '../../core/folder-location.mjs';
import { readMarker } from '../../core/profile-paths.mjs';

// A private home for one test. Dialogs are answered from a list; an unexpected
// question fails the test instead of waiting for someone.
async function fixture(t) {
  const home = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'sesshuttle-choice-')));
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  const drive = path.join(home, '外置 100% [盘]');
  await fs.mkdir(drive);
  function open(answers, explicit) {
    const asked = [];
    const ask = (kind, message, accept) => {
      asked.push({ kind, message, accept });
      if (kind === 'error') return 'ok';
      assert.ok(answers.length, 'unexpected ' + kind + ': ' + message);
      return answers.shift();
    };
    return chooseDataFolder({ home, explicit, testRoot: home, ask, t: (key) => key }).then(
      (folder) => ({
        folder,
        asked,
        kinds: asked.map((a) => a.kind + ':' + a.message.split('\n')[0]),
      }),
    );
  }
  return { home, drive, open };
}

test('the first start creates a folder only after its full path is confirmed', async (t) => {
  const { home, drive, open } = await fixture(t);
  const cancelled = await open([null]);
  assert.equal(cancelled.folder, undefined);
  assert.deepEqual(cancelled.kinds, ['choose:folderChooseParent']);
  assert.deepEqual(await fs.readdir(drive), []);

  const declined = await open([drive, null, null]);
  assert.equal(declined.folder, undefined);
  assert.deepEqual(await fs.readdir(drive), []);

  const created = await open([drive, 'ok']);
  assert.equal(created.folder, path.join(drive, folderName));
  const confirmation = created.asked[1];
  assert.equal(confirmation.kind, 'confirm');
  assert.equal(confirmation.accept, 'folderUse');
  assert.ok(confirmation.message.includes(created.folder), 'the full path is shown');
  // A location outside the home folder is remembered in a visible file.
  assert.ok(confirmation.message.includes(locationFile(home)));
  assert.ok(readMarker(created.folder).id);

  const standard = await open([home, 'ok'], undefined);
  assert.equal(standard.folder, path.join(home, folderName));
  assert.ok(!standard.asked[1].message.includes(locationFile(home)));
});

test('the standard, the remembered and the named folder open without a question', async (t) => {
  const { home, drive, open } = await fixture(t);
  const standard = await createDataFolder(home),
    custom = await createDataFolder(drive);
  assert.deepEqual(await open([]), { folder: standard, asked: [], kinds: [] });
  await rememberFolderLocation(home, custom);
  assert.equal((await open([])).folder, custom);
  // The shortcut inside a data folder names that folder.
  assert.equal((await open([], standard)).folder, standard);
});

test('a remembered folder that moved is found again by selecting it', async (t) => {
  const { home, drive, open } = await fixture(t);
  const custom = await createDataFolder(drive);
  await rememberFolderLocation(home, custom);
  const moved = path.join(home, 'moved');
  await fs.mkdir(moved);
  await fs.rename(custom, path.join(moved, folderName));
  const other = await createDataFolder(drive);

  // Another data folder is not accepted in its place; its parent works like the folder.
  const result = await open([other, moved]);
  assert.equal(result.folder, path.join(moved, folderName));
  assert.deepEqual(result.kinds, [
    'error:folderRelocate',
    'choose:folderChooseExisting',
    'error:folder_location_mismatch',
    'choose:folderChooseExisting',
  ]);
  assert.ok(result.asked[0].message.includes(custom), 'names the folder that is missing');
});

test('a deleted folder can be left behind, but only by an explicit choice', async (t) => {
  const { home, drive, open } = await fixture(t);
  const custom = await createDataFolder(drive);
  await rememberFolderLocation(home, custom);
  await fs.rm(custom, { recursive: true });

  // Cancelling the selection asks before anything new is created.
  const kept = await open([null, null]);
  assert.equal(kept.folder, undefined);
  assert.deepEqual(kept.kinds, [
    'error:folderRelocate',
    'choose:folderChooseExisting',
    'confirm:folderStartFreshAsk',
  ]);
  assert.equal(kept.asked[2].accept, 'folderStartFresh');
  assert.deepEqual(await fs.readdir(drive), []);

  // An ordinary folder is still not adopted while the original is expected.
  const refused = await open([drive, null, null]);
  assert.equal(refused.folder, undefined);
  assert.equal(refused.kinds[2], 'error:folder_location_mismatch');

  const fresh = await open([null, 'ok', drive, 'ok']);
  assert.equal(fresh.folder, path.join(drive, folderName));
  assert.deepEqual(fresh.kinds, [
    'error:folderRelocate',
    'choose:folderChooseExisting',
    'confirm:folderStartFreshAsk',
    'choose:folderChooseParent',
    'confirm:folderCreateAt',
  ]);
  // Opening the new folder replaces the record of the old one.
  await rememberFolderLocation(home, fresh.folder);
  assert.deepEqual(await open([]), { folder: fresh.folder, asked: [], kinds: [] });
});

test('after leaving a folder behind, another existing data folder can be opened', async (t) => {
  const { home, drive, open } = await fixture(t);
  const custom = await createDataFolder(drive);
  await rememberFolderLocation(home, custom);
  await fs.rm(custom, { recursive: true });
  const elsewhere = path.join(home, 'elsewhere');
  await fs.mkdir(elsewhere);
  const other = await createDataFolder(elsewhere);
  assert.equal((await open([null, 'ok', other])).folder, other);
});

test('an unreadable location record asks where the data is', async (t) => {
  const { home, drive, open } = await fixture(t);
  await fs.writeFile(locationFile(home), 'not a record');
  await createDataFolder(home);
  const result = await open([drive, 'ok']);
  assert.equal(result.folder, path.join(drive, folderName));
  assert.deepEqual(result.kinds, [
    'error:folder_location_invalid',
    'choose:folderChooseParent',
    'confirm:folderCreateAt',
  ]);
  assert.equal(await fs.readFile(locationFile(home), 'utf8'), 'not a record');
});

test('a folder inside the Codex data folder is refused', async (t) => {
  const { home, drive, open } = await fixture(t);
  const codex = path.join(home, 'codex');
  await fs.mkdir(codex);
  const result = await open([codex, drive, 'ok']);
  assert.equal(result.folder, path.join(drive, folderName));
  assert.equal(result.kinds[1], 'error:folderChooseAgain');
  assert.deepEqual(await fs.readdir(codex), []);
});
