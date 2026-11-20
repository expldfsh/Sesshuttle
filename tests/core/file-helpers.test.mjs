import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { discardFolder, removeFolder, rename, within } from '../../core/util.mjs';

async function folder(t) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'sesshuttle-files-')));
  // A test may replace fs.rm; the cleanup uses the real one.
  const remove = fs.rm;
  t.after(() => remove(root, { recursive: true, force: true }));
  return root;
}
const busy = (code) => Object.assign(new Error('held by another program'), { code });

test('a rename that is refused for a moment is tried again', async (t) => {
  const root = await folder(t);
  const from = path.join(root, 'new'),
    to = path.join(root, 'saved');
  await fs.writeFile(from, 'first');
  const original = fs.rename;
  let refusals = 2;
  t.mock.method(fs, 'rename', async (...args) => {
    if (refusals-- > 0) throw busy('EPERM');
    return original(...args);
  });
  await rename(from, to, 6);
  assert.equal(await fs.readFile(to, 'utf8'), 'first');

  // Where such an error is final, it is reported at once.
  await fs.writeFile(from, 'second');
  refusals = 1;
  await assert.rejects(rename(from, to, 1), { code: 'EPERM' });
  assert.equal(await fs.readFile(to, 'utf8'), 'first');
  // It is given up after the last try, and another kind of failure is never retried.
  refusals = 9;
  await assert.rejects(rename(from, to, 3), { code: 'EPERM' });
  refusals = 0;
  await assert.rejects(rename(path.join(root, 'missing'), to, 6), { code: 'ENOENT' });
});

test('a working folder that cannot be removed does not fail finished work', async (t) => {
  const root = await folder(t);
  const work = path.join(root, 'work');
  await fs.mkdir(path.join(work, 'inner'), { recursive: true });
  await fs.writeFile(path.join(work, 'inner', 'file'), 'x');
  await removeFolder(work);
  await assert.rejects(fs.access(work), { code: 'ENOENT' });
  await removeFolder(work);
  await discardFolder(work);

  const calls = [];
  t.mock.method(fs, 'rm', async (...args) => {
    calls.push(args);
    throw busy('EBUSY');
  });
  await assert.rejects(removeFolder(work), { code: 'EBUSY' });
  assert.equal(await discardFolder(work), undefined);
  // A file that is busy for a moment is waited for.
  assert.deepEqual(calls[0], [
    work,
    { recursive: true, force: true, maxRetries: 5, retryDelay: 100 },
  ]);
});

test('a slow answer is replaced without waiting for it', async () => {
  const slow = new Promise((resolve) => setTimeout(() => resolve('late'), 300));
  assert.equal(await within(slow, 20, 'meanwhile'), 'meanwhile');
  assert.equal(await within(Promise.resolve('ready'), 1000, 'meanwhile'), 'ready');
  assert.equal(await slow, 'late');
});
