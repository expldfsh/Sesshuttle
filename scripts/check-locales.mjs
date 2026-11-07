import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { transform } from 'esbuild';
const source = await fs.readFile(new URL('../app/renderer/locale.ts', import.meta.url), 'utf8');
const js = await transform(source, { loader: 'ts', format: 'esm' });
const { zh, en } = await import(
  'data:text/javascript;base64,' + Buffer.from(js.code).toString('base64')
);
assert.deepEqual(Object.keys(zh).sort(), Object.keys(en).sort());
for (const [key, value] of Object.entries(en))
  assert.ok(!/\p{Script=Han}/u.test(value), 'English translation missing: ' + key);
const dir = new URL('../app/renderer/', import.meta.url);
const ui = (
  await Promise.all(
    (await fs.readdir(dir))
      .filter((name) => name.endsWith('.tsx'))
      .map((name) => fs.readFile(new URL(name, dir), 'utf8')),
  )
).join('\n');
for (const match of ui.matchAll(/\bt\('([^']+)'\)/g))
  assert.ok(zh[match[1]], 'Missing interface key: ' + match[1]);
console.log(`PASS ${Object.keys(zh).length} bilingual interface messages`);
