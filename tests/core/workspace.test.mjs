import { test } from 'node:test';
import assert from 'node:assert/strict';
import { workspaceFolderName } from '../../core/workspace.mjs';
test('working folder names keep letters and digits of every script and replace separators', () => {
  assert.equal(
    workspaceFolderName('My Project 中文', '0123456789abcdef'),
    'My Project 中文-01234567',
  );
  assert.equal(workspaceFolderName('a/b\\c:d*e', 'abcdef12-0000'), 'a_b_c_d_e-abcdef12');
  assert.equal(workspaceFolderName('', 'ffffffff-1'), 'Project-ffffffff');
  assert.equal(workspaceFolderName('x'.repeat(100), '12345678').length, 79);
  assert.equal(workspaceFolderName('Проект_2 ünï-cödé', '12345678'), 'Проект_2 ünï-cödé-12345678');
});
