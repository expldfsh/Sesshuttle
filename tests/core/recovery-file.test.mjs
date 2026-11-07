import test from 'node:test';
import assert from 'node:assert/strict';
import { newKey } from '../../core/crypto.mjs';
import { id } from '../../core/util.mjs';
import { readRecovery, writeRecovery } from '../../core/recovery-file.mjs';

const connection = {
  endpoint: 'https://test.r2.cloudflarestorage.com',
  bucket: 'fixture',
  space: id(),
};
const credentials = { accessKeyId: 'example-id', secretAccessKey: 'never-export' };
const key = newKey();
test('recovery files transport the ID and space key, and exclude the R2 secret', () => {
  const text = writeRecovery({ ...connection, unknown: 'ignored' }, { key, credentials });
  assert.deepEqual(readRecovery(text), { ...connection, key, accessKeyId: 'example-id' });
  assert.deepEqual(Object.keys(JSON.parse(text)).sort(), [
    'accessKeyId',
    'bucket',
    'endpoint',
    'format',
    'key',
    'space',
  ]);
  assert.ok(!text.includes(credentials.secretAccessKey));
  assert.throws(() => writeRecovery(connection, { credentials: {}, key }), {
    code: 'export_id_missing',
  });
});
test('legacy files reuse an ID only for the same endpoint, bucket and space', () => {
  const text = JSON.stringify({ format: 1, ...connection, key });
  const known = { ...connection, accessKeyId: 'prior' };
  assert.equal(readRecovery(text, known).accessKeyId, 'prior');
  for (const changed of [
    { endpoint: 'https://other.invalid' },
    { bucket: 'other' },
    { space: id() },
  ])
    assert.equal(readRecovery(text, { ...known, ...changed }).accessKeyId, '');
  assert.throws(() => readRecovery('null'), { code: 'invalid_recovery_file' });
});
