import { test } from 'node:test';
import assert from 'node:assert/strict';
import { joinShown, unquoted } from '../../core/shown-paths.mjs';

test('a path arrives without the quotes it was copied in', () => {
  assert.equal(
    unquoted('"C:\\Program Files\\Codex\\codex.exe"'),
    'C:\\Program Files\\Codex\\codex.exe',
  );
  assert.equal(unquoted("'/Users/me/My Project'"), '/Users/me/My Project');
  for (const kept of [
    '',
    '"',
    '"C:\\unfinished',
    '/home/me/"quoted" name',
    'C:\\a "b" c',
    '"a" "b"',
  ])
    assert.equal(unquoted(kept), kept);
});

test('a path below a folder is shown in that folder’s notation', () => {
  assert.equal(joinShown('D:\\Data\\trash\\id', 'files/3'), 'D:\\Data\\trash\\id\\files\\3');
  assert.equal(joinShown('/home/me/data/trash/id', 'files/3'), '/home/me/data/trash/id/files/3');
  assert.equal(joinShown('D:\\', 'files/3'), 'D:\\files\\3');
});
