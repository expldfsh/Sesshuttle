import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { projectFor } from '../../core/catalog.mjs';
import { scan } from '../../core/codex.mjs';
import { pathToFileURL } from 'node:url';
import {
  childPath,
  absoluteLocalPath,
  fileUrlNames,
  id,
  portableBasename,
} from '../../core/util.mjs';

test('the bundled page is recognised by its file, however its address is spelled', () => {
  // Chromium leaves some characters as they are that Node escapes, and the reverse.
  const page = '/Applications/App 中文 100% [x] ~ #1 %41/dist/renderer/index.html';
  const url = pathToFileURL(page, { windows: false }).href;
  assert.equal(fileUrlNames(url, page, false), true);
  assert.equal(fileUrlNames(url.replaceAll('[', '%5B').replaceAll(']', '%5D'), page, false), true);
  assert.equal(fileUrlNames(url.replaceAll('~', '%7E'), page, false), true);
  for (const other of [
    url + '?x=1',
    url + '#top',
    url.replace('index.html', 'other.html'),
    url.replace('file:', 'https:'),
    url.replace('file:///', 'file://host/'),
    // A bare path used as an address: its percent signs are not escaped.
    'file://' + page.replaceAll(' ', '%20'),
    'not a url',
  ])
    assert.equal(fileUrlNames(other, page, false), false, other);

  // Windows: the window reports an upper-case drive and a lower-case share.
  const win = 'c:\\Tools\\App 100%\\resources\\app.asar\\dist\\renderer\\index.html';
  const reported = 'file:///C:/Tools/App%20100%25/resources/app.asar/dist/renderer/index.html';
  assert.equal(fileUrlNames(reported, win, true), true);
  assert.equal(fileUrlNames(pathToFileURL(win, { windows: true }).href, win, true), true);
  assert.equal(
    fileUrlNames('file://nas/apps/S/index.html', '\\\\NAS\\Apps\\S\\index.html', true),
    true,
  );
  assert.equal(fileUrlNames(reported.replace('C:', 'D:'), win, true), false);
  assert.equal(fileUrlNames(reported + '?x', win, true), false);
});

test('Windows filesystem operations require a qualified drive or share and ordinary filenames', () => {
  const win = path.win32;
  assert.equal(absoluteLocalPath('D:\\测试 folder', win), true);
  assert.equal(absoluteLocalPath('\\\\server\\share\\team', win), true);
  for (const name of [
    'D:relative',
    '\\rooted',
    '\\\\.\\PhysicalDrive0',
    '\\\\?\\GLOBALROOT\\Device',
  ]) {
    assert.equal(absoluteLocalPath(name, win), false, name);
  }
  const root = 'D:\\Data';
  assert.equal(childPath(root, 'd:\\data\\附件\\a.jpg', win), '附件\\a.jpg');
  for (const name of [
    'D:\\Database\\x',
    'E:\\Data\\x',
    'D:\\Data',
    'D:\\Data\\photo:secret',
    'D:\\Data\\CON.txt',
    'D:\\Data\\dir.\\x',
  ]) {
    assert.throws(() => childPath(root, name, win), { code: 'unsafe_path' }, name);
  }
});

test('a project label can be read from a foreign working directory', () => {
  assert.equal(portableBasename('D:\\项目\\One'), 'One');
  assert.equal(portableBasename('/Users/me/项目'), '项目');
  assert.equal(portableBasename('/home/me/back\\slash'), 'back\\slash');
});

test('native project roots match the host notation of the saved working directory', () => {
  const catalog = { projects: [{ id: 'p', name: 'project', roots: ['C:\\WORK\\One'] }] };
  assert.equal(projectFor(catalog, {}, 'c:\\work\\one\\src').nativeId, 'p');
  assert.equal(projectFor(catalog, {}, '\\\\?\\C:\\work\\one\\src').nativeId, 'p');
  assert.equal(projectFor(catalog, {}, 'C:\\Work\\OneOther').nativeId, undefined);
  const unix = { projects: [{ id: 'p', name: 'project', roots: ['/home/One'] }] };
  assert.equal(projectFor(unix, {}, '/home/one').nativeId, undefined);
});

test('a native indexed rollout resolves to one local file and stays inside its home', async (t) => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'sesshuttle-indexed-')));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const home = path.join(root, 'home'),
    tid = id(),
    file = path.join(home, 'sessions', 'rollout-' + tid + '.jsonl'),
    outside = path.join(root, 'outside.jsonl');
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify({ type: 'session_meta', payload: { id: tid } }) + '\n');
  await fs.copyFile(file, outside);
  const db = new DatabaseSync(path.join(home, 'state_5.sqlite'));
  try {
    db.exec('CREATE TABLE threads(id TEXT PRIMARY KEY, rollout_path TEXT, updated_at INTEGER)');
    const indexed = path.toNamespacedPath(file);
    db.prepare('INSERT INTO threads VALUES(?,?,?)').run(tid, indexed, 1);
    const result = await scan([home]);
    assert.deepEqual(result.errors, []);
    assert.equal(result.rows.length, 1);
    assert.deepEqual(result.rows[0].physicalFiles, [file]);
    assert.equal(result.rows[0].indexedFile, file);
    assert.equal(db.prepare('SELECT rollout_path FROM threads').get().rollout_path, indexed);
    db.prepare('UPDATE threads SET rollout_path=?').run(path.toNamespacedPath(outside));
    assert.ok((await scan([home])).errors.some((e) => e.code === 'unsafe_path'));
  } finally {
    db.close();
  }
});
