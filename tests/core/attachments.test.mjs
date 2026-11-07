import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { scan } from '../../core/codex.mjs';
import { id, hash } from '../../core/util.mjs';
import { captureBundle, materialize } from '../../core/bundle.mjs';
import { remapHistory } from '../../core/remap-history.mjs';
import { Vault } from '../../core/vault.mjs';
import { newKey } from '../../core/crypto.mjs';
import { MemoryStore } from '../helpers/memory-store.mjs';
test('image attachments are hashed and only explicit resource fields are mapped', async () => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'sesshuttle-asset-')));
  try {
    await fs.mkdir(path.join(root, 'sessions'));
    const asset = path.join(root, '图 image.png');
    const data = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64',
    );
    await fs.writeFile(asset, data);
    const tid = id();
    const records = [
      {
        type: 'session_meta',
        payload: {
          id: tid,
          cli_version: '0.164.0',
          cwd: root,
          timestamp: '2026-11-01T12:00:00Z',
          source: 'cli',
        },
      },
      { type: 'event_msg', payload: { type: 'user_message', message: 'Historical text ' + asset } },
      {
        type: 'response_item',
        payload: { type: 'message', role: 'user', content: [{ type: 'localImage', path: asset }] },
      },
    ];
    const file = path.join(root, 'sessions', 'fixture.jsonl');
    await fs.writeFile(file, records.map((x) => JSON.stringify(x)).join('\n') + '\n');
    const rows = (await scan([root])).rows,
      vault = new Vault(new MemoryStore(), id(), newKey());
    await vault.create();
    const stage = path.join(root, 'stage');
    await fs.mkdir(stage);
    const p = await captureBundle(rows[0], rows, vault, stage);
    const assets = p.files[0].artifacts.filter((a) => a.kind === 'asset');
    assert.equal(assets.length, 1);
    assert.equal(assets[0].hash, hash(data));
    assert.equal(assets[0].path, asset);
    assert.deepEqual(p.issues, []);
    const published = await vault.publish(p, { id: 'test' }),
      target = path.join(root, 'target');
    const staged = await materialize(
      await vault.version(published.version),
      vault,
      path.join(root, 'download'),
    );
    const [mapped] = await remapHistory(staged.files, target);
    const lines = (
      await fs.readFile(mapped.artifacts.find((a) => a.kind === 'rollout').file, 'utf8')
    )
      .trim()
      .split('\n')
      .map(JSON.parse);
    assert.equal(lines[1].payload.message, 'Historical text ' + asset);
    assert.equal(
      lines[2].payload.content[0].path,
      path.join(target, 'sesshuttle_assets', hash(data)),
    );
    assert.deepEqual(
      await fs.readFile(file, 'utf8'),
      records.map((x) => JSON.stringify(x)).join('\n') + '\n',
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
