// Round trip of a conversation whose local image is missing on the source
// computer. After the user confirms the omission, B receives the history with
// the image replaced by a placeholder text, continues, and A continues again.
// Real Codex programs, synthetic data, a temporary lab and an in-memory store.
// Usage: node scripts/missing-image-roundtrip.mjs <source codex> <target codex> [--compressed]
import { omittedImageText } from '../core/attachment-policy.mjs';
import fs from 'node:fs/promises';
import { zstdCompressSync } from 'node:zlib';
import { walk } from '../core/util.mjs';
import { scan } from '../core/codex.mjs';
import assert from 'node:assert/strict';
import path from 'node:path';
import { State } from '../core/state.mjs';
import { Engine } from '../core/engine.mjs';
import { Importer } from '../core/importer.mjs';
import { Vault } from '../core/vault.mjs';
import { MemoryStore } from '../tests/helpers/memory-store.mjs';
import { newKey } from '../core/crypto.mjs';
import { id } from '../core/util.mjs';
import { startFixtureProvider, writeFixtureConfig } from '../core/fixture-provider.mjs';
import {
  IMAGE,
  Lab,
  comparableHistory,
  marker,
  proveDirectory,
  startThread,
  turn,
  turnWith,
  turns,
  withClient,
} from './lib/native-lab.mjs';
const [source, target, mode] = process.argv.slice(2);
assert.ok(source && target);
const lab = await Lab.create();
const fixture = await startFixtureProvider();
const options = { localPort: fixture.port };
const states = [];
try {
  const homeA = await lab.directory('a/codex'),
    homeB = await lab.directory('b/codex');
  const pa = await lab.directory('a/project 中文'),
    pb = await lab.directory('b/project with spaces');
  await lab.write('a/project 中文/proof.txt', 'A-LOCAL-PROOF');
  await lab.write('b/project with spaces/proof.txt', 'B-LOCAL-PROOF');
  for (const home of [homeA, homeB]) await writeFixtureConfig(home, fixture.port);
  const early = marker('MISSING-IMAGE-EARLY');
  await lab.directory('a/codex/uploads');
  const image = await lab.write(
    'a/codex/uploads/test.png',
    Buffer.from(IMAGE.split(',')[1], 'base64'),
  );
  let tid, expected;
  await withClient(lab, source, homeA, pa, options, async (client) => {
    tid = await startThread(client, pa);
    await turn(client, tid, early);
    await turnWith(client, tid, [
      { type: 'text', text: 'Keep this image message text exactly. 中文保留。' },
      { type: 'localImage', path: image },
    ]);
    await proveDirectory(client, tid, pa, 'A-LOCAL-PROOF');
    expected = await turns(client, tid);
  });
  // The image disappears from the source computer before the transfer.
  await fs.rename(image, image.replace(/\.png$/, '.preserved'));
  const info = { root: lab.root, a: homeA, b: homeB, pa, pb, tid };
  // Only the explicit local-image input may change on B; every other field and
  // item, including all user text and tool results, stays the same.
  const continueOn = (side, placeholder) => {
    const [home, project, binary] = side === 'B' ? [homeB, pb, target] : [homeA, pa, source];
    return withClient(lab, binary, home, project, options, async (client) => {
      await client.rpc('thread/resume', {
        threadId: tid,
        cwd: project,
        sandbox: 'read-only',
        approvalPolicy: 'on-request',
        excludeTurns: true,
      });
      const before = comparableHistory(expected),
        after = comparableHistory(await turns(client, tid));
      let replaced = 0;
      const replaceImages = (value) => {
        if (Array.isArray(value)) value.forEach(replaceImages);
        else if (value && typeof value === 'object') {
          if (['localImage', 'local_image'].includes(value.type) && value.path === image) {
            for (const key of Object.keys(value)) delete value[key];
            Object.assign(value, { type: 'text', text: placeholder, text_elements: [] });
            replaced++;
          } else Object.values(value).forEach(replaceImages);
        }
      };
      if (side === 'B') replaceImages(before);
      assert.deepStrictEqual(
        after,
        before,
        'Native history differs beyond the confirmed image replacement',
      );
      if (side === 'B') assert.ok(replaced > 0);
      await proveDirectory(client, tid, project, side + '-LOCAL-PROOF');
      await turn(
        client,
        tid,
        'Continue without needing the omitted image; do not repeat the early marker.',
      );
      const body = JSON.stringify(fixture.requests.at(-1));
      assert.ok(body.includes(early) && !body.includes('sesshuttle environment mapping'));
      expected = await turns(client, tid);
      return {
        ok: true,
        side,
        turns: expected.length,
        cwd: true,
        earlyContext: true,
        textAndToolHistoryPreserved: true,
        imageReplaced: replaced,
      };
    });
  };
  if (mode === '--compressed') {
    for (const file of await walk(path.join(info.a, 'sessions'))) {
      if (!file.endsWith('.jsonl')) continue;
      const raw = await fs.readFile(file);
      await fs.writeFile(file + '.zst', zstdCompressSync(raw));
      const kept = path.join(info.root, 'source-originals', path.basename(file));
      await fs.mkdir(path.dirname(kept), { recursive: true });
      await fs.rename(file, kept);
    }
  }
  const original = (await scan([info.a])).rows.find((r) => r.id === info.tid).hash;
  const store = new MemoryStore(),
    space = id(),
    key = newKey(),
    va = new Vault(store, space, key),
    vb = new Vault(store, space, key);
  await va.create();
  const sa = new State(path.join(info.root, 'state-a')),
    sb = new State(path.join(info.root, 'state-b'));
  states.push(sa, sb);
  sa.set('config', {
    sourceHomes: [info.a],
    targets: { desktop: { home: info.a, binary: source } },
    bindings: {},
  });
  sb.set('config', {
    sourceHomes: [info.b],
    targets: { cli: { home: info.b, binary: target } },
    bindings: {},
  });
  const a = new Engine(sa, {
      vault: va,
      importer: new Importer(sa, { testRoot: info.root, processGuard: async () => {} }),
    }),
    b = new Engine(sb, {
      vault: vb,
      importer: new Importer(sb, { testRoot: info.root, processGuard: async () => {} }),
    });
  let placeholder;
  const sync = async (engine, direction, targets = []) => {
    await engine.refresh();
    let plan = await engine.preview({ ids: [info.tid], direction, targets });
    if (direction === 'download' && plan.items.some((i) => i.attachmentReview.optional.length)) {
      const before = await fs.readdir(info.b);
      const denied = await engine.execute(plan.token);
      assert.equal(denied.items[0].error.code, 'attachment_confirmation_required');
      assert.deepEqual(await fs.readdir(info.b), before);
      plan = await engine.preview({ ids: [info.tid], direction, targets });
    }
    const optional = plan.items.flatMap((i) => i.attachmentReview.optional);
    if (optional.length) {
      assert.equal(optional.length, 1);
      placeholder = omittedImageText(optional[0]);
    }
    const job = await engine.execute(plan.token, {
      acceptedMissingAttachments: optional.map((a) => a.key),
    });
    assert.equal(job.status, 'completed', JSON.stringify(job));
    return job;
  };
  await a.refresh();
  const projectId = a.rows[0].projectId;
  sa.set('config', { ...sa.get('config'), bindings: { [projectId]: info.pa } });
  sb.set('config', { ...sb.get('config'), bindings: { [projectId]: info.pb } });
  await sync(a, 'upload');
  const imported = await sync(b, 'download', ['cli']);
  assert.equal(imported.items[0].targets.cli.omittedAttachments.length, 1);
  const continuedB = await continueOn('B', placeholder);
  assert.equal(
    (await scan([info.a])).rows.find((r) => r.id === info.tid).hash,
    original,
    'Source changed during transfer',
  );
  await sync(b, 'upload');
  await a.refresh();
  assert.equal(a.rows[0].status, 'remote_changes');
  const returned = await sync(a, 'download', ['desktop']);
  assert.equal(returned.items[0].targets.desktop.omittedAttachments.length, 1);
  const continuedA = await continueOn('A', placeholder);
  console.log(
    JSON.stringify(
      {
        root: info.root,
        compressed: mode === '--compressed',
        sourceUnchanged: true,
        continuedB,
        continuedA,
        result:
          'PASS confirmed missing image: encrypted A → B continuation → A continuation, warning retained',
      },
      null,
      2,
    ),
  );
} finally {
  await fixture.close();
  for (const state of states) state.close();
}
