import { captureBundle } from '../core/bundle.mjs';
import { Vault } from '../core/vault.mjs';
import { MemoryStore } from '../tests/helpers/memory-store.mjs';
import { newKey } from '../core/crypto.mjs';
import { id } from '../core/util.mjs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { State } from '../core/state.mjs';
import { Importer } from '../core/importer.mjs';
import { scan } from '../core/codex.mjs';
import { prepareNative } from '../core/native.mjs';
import { exists } from '../core/util.mjs';
const [source, binary] = process.argv.slice(2);
const raw = await fs.readFile(source);
assert.equal(JSON.parse(raw.toString().split('\n')[0]).payload.originator, 'sesshuttle_lab');
const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'sesshuttle-config-'))),
  a = path.join(root, 'a'),
  b = path.join(root, 'b'),
  project = path.join(root, 'project');
await fs.mkdir(path.join(a, 'sessions'), { recursive: true });
await fs.mkdir(b);
await fs.mkdir(project);
await fs.writeFile(path.join(a, 'sessions', path.basename(source)), raw);
const sentinel = path.join(b, 'must-not-run'),
  script = path.join(b, 'synthetic-probe.sh');
await fs.writeFile(script, '#!/bin/sh\nprintf unexpected > ' + JSON.stringify(sentinel) + '\n', {
  mode: 0o700,
});
await fs.writeFile(
  path.join(b, 'config.toml'),
  `[mcp_servers.sesshuttle_probe]\ncommand = ${JSON.stringify(script)}\nenabled = true\n\n[[hooks.SessionStart]]\nhooks = [{type = "command", command = ${JSON.stringify(script)}}]\n\n[[hooks.SessionEnd]]\nhooks = [{type = "command", command = ${JSON.stringify(script)}}]\n`,
);
const state = new State(path.join(root, 'state'));
try {
  const tid = JSON.parse(raw.toString().split('\n')[0]).payload.id;
  await prepareNative({ binary, home: a, project, files: [{ id: tid, archived: false }] });
  const rows = (await scan([a])).rows,
    vault = new Vault(new MemoryStore(), id(), newKey());
  await vault.create();
  const stage = path.join(root, 'stage');
  await fs.mkdir(stage);
  const payload = await captureBundle(rows[0], rows, vault, stage);
  await vault.publish(payload, { id: 'test' });
  const importer = new Importer(state, {
    testRoot: root,
    processGuard: async () => {},
    native: async (args) => {
      try {
        return await prepareNative(args);
      } catch (e) {
        console.error({ root, code: e.code, detail: e.detail });
        throw e;
      }
    },
  });
  await importer.import(payload, { home: b, binary, project }, { vault });
  assert.equal(await exists(sentinel), false, 'Native tools or hooks ran during migration');
  console.log(
    JSON.stringify({ root, result: 'PASS configured MCP and hooks remain disabled during import' }),
  );
} finally {
  state.close();
}
