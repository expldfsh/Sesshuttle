import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bucketProblem, endpointProblem } from '../../core/connection-rules.mjs';
import { R2Store } from '../../core/storage.mjs';

test('connection rules accept only bare R2 endpoints and valid bucket names, as R2Store does', () => {
  const good = 'https://0123456789abcdef.r2.cloudflarestorage.com';
  assert.equal(endpointProblem(good), null);
  assert.equal(endpointProblem(good + '/'), null);
  assert.equal(endpointProblem('https://abc.eu.r2.cloudflarestorage.com'), null);
  for (const bad of [
    '',
    'not a url',
    'http://abc.r2.cloudflarestorage.com',
    'https://abc.r2.cloudflarestorage.com/bucket',
    'https://abc.r2.cloudflarestorage.com?x=1',
    'https://user:pw@abc.r2.cloudflarestorage.com',
    'https://example.com',
    'http://127.0.0.1:9000',
  ])
    assert.equal(endpointProblem(bad), 'invalid_endpoint', bad);
  assert.equal(endpointProblem('http://127.0.0.1:9000', { allowLocal: true }), null);
  assert.equal(bucketProblem('my-sesshuttle'), null);
  for (const bad of ['', 'a', 'My-Bucket', '-start', 'end-', 'x'.repeat(64)])
    assert.equal(bucketProblem(bad), 'invalid_bucket', bad);
  const credentials = { accessKeyId: 'a', secretAccessKey: 'b' };
  assert.throws(
    () => new R2Store({ endpoint: 'https://example.com', bucket: 'ok-bucket', ...credentials }),
    {
      code: 'invalid_endpoint',
    },
  );
  assert.throws(() => new R2Store({ endpoint: good, bucket: 'Bad', ...credentials }), {
    code: 'invalid_bucket',
  });
  assert.ok(new R2Store({ endpoint: good, bucket: 'my-sesshuttle', ...credentials }));
});
