import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { requireThat } from './util.mjs';
export const markerName = 'sesshuttle-data.json';
export function checkedTestRoot(root) {
  if (!root) return undefined;
  requireThat(
    fs.realpathSync(root) === root &&
      path.basename(root).startsWith('sesshuttle-') &&
      [fs.realpathSync(os.tmpdir()), fs.realpathSync('/tmp')].some((base) =>
        root.startsWith(base + path.sep),
      ) &&
      JSON.parse(fs.readFileSync(path.join(root, '.sesshuttle-test.json'), 'utf8')).format === 1,
    'unsafe_path',
  );
  return root;
}
export function readMarker(folder) {
  requireThat(path.isAbsolute(folder) && fs.realpathSync(folder) === folder, 'folder_invalid');
  const file = path.join(folder, markerName);
  const stat = fs.lstatSync(file);
  requireThat(stat.isFile() && stat.nlink === 1 && stat.size <= 32768, 'folder_invalid');
  const marker = JSON.parse(fs.readFileSync(file, 'utf8'));
  requireThat(
    marker.format === 1 &&
      marker.product === 'sesshuttle' &&
      /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(marker.id),
    'folder_invalid',
  );
  return marker;
}
export function privateDir(parent, name) {
  const dir = path.join(parent, name);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { mode: 0o700 });
  requireThat(fs.realpathSync(dir) === dir && fs.lstatSync(dir).isDirectory(), 'unsafe_path');
  return dir;
}
export function runtimePaths(folder) {
  const runtime = privateDir(folder, 'runtime');
  return {
    userData: privateDir(runtime, 'profile'),
    sessionData: privateDir(runtime, 'session'),
    userCache: privateDir(runtime, 'cache'),
    logs: privateDir(runtime, 'logs'),
    crashDumps: privateDir(runtime, 'crashes'),
    temp: privateDir(runtime, 'temp'),
  };
}
