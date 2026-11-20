import fs from 'node:fs/promises';
import path from 'node:path';
import { folderName } from './data-folder.mjs';
import { readMarker } from './profile-paths.mjs';
import { Fault, id, stableRead, requireThat, rename } from './util.mjs';

export const locationFile = (home) => path.join(home, 'Sesshuttle Location.json');
const format = 'sesshuttle-folder-location-v1';

export async function readFolderLocation(home) {
  const file = locationFile(home);
  try {
    const stat = await fs.lstat(file);
    requireThat(stat.isFile() && stat.nlink === 1, 'folder_location_invalid', file);
    const record = JSON.parse(await stableRead(file, 32768));
    requireThat(
      record?.format === format &&
        typeof record.folder === 'string' &&
        !record.folder.includes('\0') &&
        path.isAbsolute(record.folder) &&
        path.resolve(record.folder) === record.folder &&
        /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(record.id),
      'folder_location_invalid',
      file,
    );
    return { folder: record.folder, id: record.id };
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw new Fault('folder_location_invalid', file);
  }
}

// Only the primary instance publishes a location, after it has opened its data.
export async function rememberFolderLocation(home, folder) {
  const file = locationFile(home);
  const previous = await readFolderLocation(home);
  const marker = readMarker(folder);
  if (folder === path.join(await fs.realpath(home), folderName)) {
    if (previous) await fs.unlink(file);
    return null;
  }
  if (previous?.folder === folder && previous.id === marker.id) return file;

  const temporary = file + '.tmp-' + id();
  const handle = await fs.open(temporary, 'wx', 0o600);
  try {
    try {
      await handle.writeFile(JSON.stringify({ format, folder, id: marker.id }, null, 2) + '\n');
      await handle.sync();
    } finally {
      await handle.close();
    }
    if (previous) {
      const current = await readFolderLocation(home);
      requireThat(
        current?.folder === previous.folder && current.id === previous.id,
        'folder_location_invalid',
        file,
      );
      await rename(temporary, file);
    } else {
      // First publication must never replace an unrelated file with the same name.
      await fs.link(temporary, file);
    }
  } finally {
    await fs.rm(temporary, { force: true });
  }
  return file;
}
