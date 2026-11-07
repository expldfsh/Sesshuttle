import { test } from 'node:test';
import assert from 'node:assert/strict';
import { messageFromEvent, messageFromItem, visitLocalImages } from '../../core/history-items.mjs';

test('history items yield bounded messages from either source and ignore unknown types', () => {
  assert.deepEqual(
    messageFromItem({ type: 'userMessage', content: [{ text: 'a' }, { text: 'b' }] }),
    {
      role: 'user',
      text: 'a\nb',
    },
  );
  assert.deepEqual(messageFromItem({ type: 'commandExecution', aggregatedOutput: 'ok' }), {
    role: 'tool',
    text: 'ok',
  });
  assert.equal(
    messageFromItem({ type: 'agentMessage', text: 'x'.repeat(20000) }).text.length,
    12000,
  );
  for (const type of ['constructor', '__proto__', 'reasoning', 42, undefined])
    assert.equal(messageFromItem({ type }), null);
  assert.deepEqual(messageFromEvent({ type: 'agent_message', message: 'hi' }), {
    role: 'assistant',
    text: 'hi',
  });
  assert.equal(messageFromEvent({ type: 'task_started' }), null);
});

test('local image visits reach nested references and report rewrites', () => {
  const value = {
    content: [
      { type: 'localImage', path: '/a.png' },
      { nested: [{ type: 'local_image', path: '/b.png' }, null, 'text'] },
      { type: 'text', text: '/c.png' },
    ],
  };
  const seen = [];
  assert.equal(
    visitLocalImages(value, (image) => {
      seen.push(image.path);
    }),
    false,
  );
  assert.deepEqual(seen, ['/a.png', '/b.png']);
  assert.equal(
    visitLocalImages(value, (image) => {
      image.path = image.path.replace('.png', '.jpg');
      return image.path === '/a.jpg';
    }),
    true,
  );
  assert.equal(value.content[1].nested[0].path, '/b.jpg');
});
