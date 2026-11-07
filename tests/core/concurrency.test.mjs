import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { mapLimit } from '../../core/concurrency.mjs';

test('mapLimit keeps input order and never exceeds its limit', async () => {
  let active = 0,
    peak = 0;
  const result = await mapLimit([30, 5, 20, 1, 10, 2, 15], 3, async (ms, i) => {
    active++;
    peak = Math.max(peak, active);
    await delay(ms);
    active--;
    return i * 10;
  });
  assert.deepEqual(result, [0, 10, 20, 30, 40, 50, 60]);
  assert.equal(peak, 3);
  assert.deepEqual(await mapLimit([], 4, async () => 1), []);
});

test('mapLimit stops starting work after a failure and rethrows the first error', async () => {
  const started = [];
  await assert.rejects(
    mapLimit([1, 2, 3, 4, 5, 6], 2, async (n) => {
      started.push(n);
      await delay(n === 2 ? 1 : 20);
      if (n === 2) throw Object.assign(Error('first'), { code: 'first' });
      if (n === 1) throw Object.assign(Error('later'), { code: 'later' });
    }),
    { code: 'first' },
  );
  assert.deepEqual(started, [1, 2]);
});
