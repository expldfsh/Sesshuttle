// Which data folder the app opens, decided before Electron starts: the folder named on
// the command line, the remembered or the standard one, or one the user picks now.
// `ask(kind, message, accept)` shows a native dialog. 'choose' returns a folder or
// null, 'confirm' returns something truthy when accepted (`accept` names that button
// where the platform lets a dialog name it), 'error' only informs. `t` gives a message.
import fs from 'node:fs';
import path from 'node:path';
import { readMarker, runtimePaths } from './profile-paths.mjs';
import { locationFile, readFolderLocation } from './folder-location.mjs';
import {
  createDataFolder,
  folderName,
  markerName,
  legacyFolder,
  disjoint,
  checkDatabasePaths,
} from './data-folder.mjs';
import { Fault, requireThat } from './util.mjs';

// Returns the folder to open, or undefined when the user decided not to open one.
export async function chooseDataFolder({ home, explicit, testRoot, codexHome, ask, t }) {
  const standard = path.join(home, folderName);
  const hasMarker = (p) => fs.existsSync(path.join(p, markerName));
  function allowed(folder) {
    requireThat(!testRoot || folder.startsWith(testRoot + path.sep), 'unsafe_path');
    disjoint(folder, testRoot ? path.join(testRoot, 'legacy') : legacyFolder());
    disjoint(folder, path.join(home, testRoot ? 'codex' : '.codex'));
    if (!testRoot && codexHome && path.isAbsolute(codexHome))
      disjoint(folder, path.resolve(codexHome));
  }
  async function ready(folder, expectedId) {
    const visited = new Set();
    let current = folder;
    for (;;) {
      allowed(current);
      requireThat(!visited.has(current) && visited.size <= 32, 'folder_relocated');
      visited.add(current);
      const marker = readMarker(current, expectedId);
      if (!marker.movedTo) {
        fs.accessSync(current, fs.constants.W_OK | fs.constants.X_OK);
        const data = path.join(current, 'data');
        if (marker.initialized || fs.existsSync(data)) {
          requireThat(fs.realpathSync(data) === data, 'folder_invalid');
          await checkDatabasePaths(data);
          fs.accessSync(
            path.join(data, 'sesshuttle.sqlite'),
            fs.constants.R_OK | fs.constants.W_OK,
          );
        }
        for (const dir of Object.values(runtimePaths(current)))
          fs.accessSync(dir, fs.constants.W_OK | fs.constants.X_OK);
        return current;
      }
      requireThat(typeof marker.movedId === 'string', 'folder_relocated');
      expectedId = marker.movedId;
      current = marker.movedTo;
    }
  }
  let invalidLocation = false;
  let saved = explicit
    ? null
    : await readFolderLocation(home).catch(() => {
        invalidLocation = true;
        ask('error', t('folder_location_invalid') + '\n' + locationFile(home));
        return null;
      });
  let initial =
    (explicit && path.resolve(explicit)) ||
    saved?.folder ||
    (!invalidLocation && hasMarker(standard) ? standard : undefined);
  let root;
  if (initial) {
    try {
      root = await ready(initial, saved?.id);
    } catch {
      ask('error', t('folderRelocate') + '\n' + initial);
      // Reconnecting a drive while the message is open needs no new selection.
      root = await ready(initial, saved?.id).catch(() => undefined);
    }
  }
  while (!root) {
    const picked = ask('choose', t(initial ? 'folderChooseExisting' : 'folderChooseParent'));
    if (!picked) {
      // The original folder may be gone for good. Leaving it behind is offered once it
      // was not selected, and only happens when the user says so.
      if (!initial || !ask('confirm', t('folderStartFreshAsk'), t('folderStartFresh')))
        return undefined;
      initial = undefined;
      saved = null;
      continue;
    }
    try {
      const parent = fs.realpathSync(picked);
      const target = hasMarker(parent) ? parent : path.join(parent, folderName);
      allowed(target);
      if (hasMarker(target)) root = await ready(target, saved?.id);
      else if (initial) throw new Fault('folder_location_mismatch');
      else {
        const message = [t('folderCreateAt'), target, '', t('folderOpenFromIcon')];
        if (target !== standard) message.push(t('folderLocationNote'), locationFile(home));
        if (ask('confirm', message.join('\n'), t('folderUse')))
          root = await ready(await createDataFolder(parent));
      }
    } catch {
      ask('error', t(initial ? 'folder_location_mismatch' : 'folderChooseAgain'));
    }
  }
  return root;
}
