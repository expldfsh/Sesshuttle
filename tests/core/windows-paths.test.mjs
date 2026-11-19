import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { childPath, absoluteLocalPath, portableBasename } from '../../core/util.mjs';

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
