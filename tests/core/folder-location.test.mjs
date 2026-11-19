import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createDataFolder } from '../../core/data-folder.mjs';
import { readMarker } from '../../core/profile-paths.mjs';
import {
  locationFile,
  readFolderLocation,
  rememberFolderLocation,
} from '../../core/folder-location.mjs';

async function fixture(t) {
  const home = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'sesshuttle-location-')));
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  const parent = path.join(home, "外置 O'Brien");
  await fs.mkdir(parent);
  return { home, standard: await createDataFolder(home), custom: await createDataFolder(parent) };
}

test('the icon remembers a custom location and folder identity, even with a standard folder present', async (t) => {
  const { home, standard, custom } = await fixture(t);
  assert.equal(await readFolderLocation(home), null);
  await rememberFolderLocation(home, standard);
  await assert.rejects(fs.access(locationFile(home)), { code: 'ENOENT' });
  await rememberFolderLocation(home, custom);
  const location = await readFolderLocation(home);
  assert.equal(location.folder, custom);
  assert.equal(location.id, readMarker(custom).id);
  const first = await fs.stat(locationFile(home));
  assert.equal(first.mode & 0o777, 0o600);
  assert.deepEqual(Object.keys(JSON.parse(await fs.readFile(locationFile(home), 'utf8'))).sort(), [
    'folder',
    'format',
    'id',
  ]);
  await rememberFolderLocation(home, custom);
  assert.equal((await fs.stat(locationFile(home))).ino, first.ino);
  await fs.rename(custom, custom + '-offline');
  await createDataFolder(path.dirname(custom));
  assert.throws(() => readMarker(custom, location.id), { code: 'folder_location_mismatch' });
  assert.deepEqual(await readFolderLocation(home), location);
  await rememberFolderLocation(home, standard);
  assert.equal(await readFolderLocation(home), null);
});

test('unknown files and links at the location filename are never overwritten or removed', async (t) => {
  const { home, standard, custom } = await fixture(t);
  const file = locationFile(home),
    personal = path.join(home, 'personal.txt');
  await fs.writeFile(file, 'personal contents');
  await assert.rejects(rememberFolderLocation(home, custom), { code: 'folder_location_invalid' });
  await assert.rejects(rememberFolderLocation(home, standard), { code: 'folder_location_invalid' });
  assert.equal(await fs.readFile(file, 'utf8'), 'personal contents');
  await fs.rename(file, personal);
  await fs.symlink(personal, file);
  await assert.rejects(readFolderLocation(home), { code: 'folder_location_invalid' });
  await assert.rejects(rememberFolderLocation(home, custom), { code: 'folder_location_invalid' });
  assert.equal(await fs.readlink(file), personal);
  assert.equal(await fs.readFile(personal, 'utf8'), 'personal contents');
  await fs.unlink(file);
  await fs.link(personal, file);
  await assert.rejects(rememberFolderLocation(home, custom), { code: 'folder_location_invalid' });
  assert.equal((await fs.stat(personal)).nlink, 2);
});
