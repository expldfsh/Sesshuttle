// Deterministic performance benchmark on synthetic data in a private temp root.
// Usage: node scripts/bench.mjs [--only=scan,refresh,removal,upload,package] [--json]
// Never touches ~/.codex, real projects or a real bucket: every store is in memory
// and every Codex data folder is generated below os.tmpdir().
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { scan } from '../core/codex.mjs';
import { State } from '../core/state.mjs';
import { Engine } from '../core/engine.mjs';
import { Vault } from '../core/vault.mjs';
import { seal } from '../core/crypto.mjs';
import { hash } from '../core/util.mjs';
import { cloudRemovalPlan } from '../core/cloud-trash.mjs';
import { MemoryStore } from '../tests/helpers/memory-store.mjs';

const args = new Map(
  process.argv.slice(2).map((a) => {
    const [k, v = 'true'] = a.replace(/^--/, '').split('=');
    return [k, v];
  }),
);
const only = args.has('only') ? new Set(args.get('only').split(',')) : null;
const wanted = (name) => !only || only.has(name);
const LATENCY = 40;
const KEY = 'A'.repeat(43);

// Fixed identifiers keep every run byte-identical.
function uuid(seed) {
  const h = createHash('sha256').update(String(seed)).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
function* prng(seed) {
  let block = createHash('sha256').update('bench' + seed).digest();
  for (;;) {
    yield block;
    block = createHash('sha256').update(block).digest();
  }
}
function pseudoRandom(bytes, seed) {
  const out = Buffer.alloc(bytes);
  const source = prng(seed);
  for (let offset = 0; offset < bytes; offset += 32) source.next().value.copy(out, offset);
  return out;
}

// Wraps the in-memory store with a fixed per-request delay.
class DelayStore {
  constructor(inner, ms) {
    this.inner = inner;
    this.ms = ms;
    this.requests = 0;
  }
  async wait() {
    this.requests++;
    await new Promise((resolve) => setTimeout(resolve, this.ms));
  }
  async get(k) {
    await this.wait();
    return this.inner.get(k);
  }
  async put(k, b, e) {
    await this.wait();
    return this.inner.put(k, b, e);
  }
  async remove(k) {
    await this.wait();
    return this.inner.remove(k);
  }
  async list(p) {
    await this.wait();
    return this.inner.list(p);
  }
  async inventory(p) {
    await this.wait();
    return this.inner.inventory(p);
  }
}

async function timed(fn) {
  const start = performance.now();
  const value = await fn();
  return { ms: Math.round(performance.now() - start), value };
}

async function makeRoot() {
  return fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'sesshuttle-bench-')));
}

function rollout(tid, project, turns, index) {
  const lines = [
    {
      type: 'session_meta',
      payload: {
        id: tid,
        cli_version: '0.166.0',
        timestamp: '2026-11-01T12:00:00Z',
        cwd: project,
        originator: 'codex_cli_rs',
        source: 'cli',
      },
    },
  ];
  for (let t = 0; t < turns; t++) {
    lines.push({ type: 'event_msg', payload: { type: 'user_message', message: `Synthetic question ${index}.${t}` } });
    lines.push({ type: 'event_msg', payload: { type: 'agent_message', message: `Synthetic answer ${index}.${t} `.repeat(8) } });
  }
  return lines.map((x) => JSON.stringify(x)).join('\n') + '\n';
}

async function benchScan() {
  const root = await makeRoot();
  try {
    const home = path.join(root, 'codex');
    const day = path.join(home, 'sessions', '2026', '11', '01');
    const project = path.join(root, 'project');
    await fs.mkdir(day, { recursive: true });
    await fs.mkdir(project);
    const state = new DatabaseSync(path.join(home, 'state_5.sqlite'));
    state.exec(
      'CREATE TABLE threads(id TEXT PRIMARY KEY, name TEXT, title TEXT, source TEXT, originator TEXT, cwd TEXT, cli_version TEXT, created_at INTEGER, updated_at INTEGER, archived INTEGER, rollout_path TEXT)',
    );
    const history = new DatabaseSync(path.join(home, 'thread_history_1.sqlite'));
    history.exec(
      'CREATE TABLE thread_turns(thread_id TEXT, turn_id TEXT, status TEXT, PRIMARY KEY(thread_id, turn_id)); CREATE TABLE thread_items(thread_id TEXT, item_id TEXT, item_json TEXT, PRIMARY KEY(thread_id, item_id))',
    );
    const thread = state.prepare('INSERT INTO threads VALUES(?,?,?,?,?,?,?,?,?,?,?)');
    const turn = history.prepare('INSERT INTO thread_turns VALUES(?,?,?)');
    const item = history.prepare('INSERT INTO thread_items VALUES(?,?,?)');
    state.exec('BEGIN');
    history.exec('BEGIN');
    for (let i = 0; i < 2000; i++) {
      const tid = uuid('scan' + i);
      const file = path.join(day, `rollout-2026-11-01T12-00-00-${tid}.jsonl`);
      await fs.writeFile(file, rollout(tid, project, 4, i));
      if (i < 200) {
        thread.run(tid, `Indexed ${i}`, `Indexed ${i}`, 'cli', 'codex_cli_rs', project, '0.166.0', 1, 2, 0, file);
        for (let t = 0; t < 4; t++) {
          turn.run(tid, 'turn' + t, 'completed');
          item.run(tid, 'u' + t, JSON.stringify({ type: 'userMessage', content: [{ text: `Q ${i}.${t}` }] }));
          item.run(tid, 'a' + t, JSON.stringify({ type: 'agentMessage', text: `A ${i}.${t}` }));
        }
      }
    }
    state.exec('COMMIT');
    history.exec('COMMIT');
    state.close();
    history.close();
    const first = await timed(() => scan([home]));
    const second = await timed(() => scan([home]));
    if (first.value.rows.length !== 2000 || first.value.errors.length) throw Error('scan fixture mismatch');
    return { first: first.ms, second: second.ms, rows: first.value.rows.length };
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

function sealedHead(space, logical, index, versions) {
  return {
    format: 1,
    logicalId: logical,
    title: 'Cloud ' + index,
    source: 'cli',
    project: '/synthetic/project',
    updatedAt: '2026-11-01T12:00:00.000Z',
    device: { id: 'bench', name: 'Bench' },
    tips: [versions.at(-1).id],
    versions,
    bytes: 1024,
    continuation: true,
    messages: [{ role: 'user', text: 'Synthetic ' + index }],
    kind: 'main',
    archived: false,
    issues: [],
  };
}

async function seedSpace(inner, vault, heads, versionsPerHead) {
  await vault.create();
  for (let i = 0; i < heads; i++) {
    const logical = uuid('head' + i);
    const versions = [];
    for (let v = 0; v < versionsPerHead; v++) {
      const chunk = hash('chunk' + i + '.' + v);
      const payload = {
        format: 2,
        logicalId: logical,
        title: 'Cloud ' + i,
        source: 'cli',
        kind: 'main',
        continuation: true,
        messages: [],
        project: '/synthetic/project',
        updatedAt: '2026-11-01T12:00:00.000Z',
        archived: false,
        issues: [],
        files: [
          {
            id: logical,
            title: 'Cloud ' + i,
            source: 'cli',
            kind: 'main',
            archived: false,
            issues: [],
            attachmentReport: [],
            artifacts: [{ kind: 'rollout', hash: chunk, bytes: 1024, chunks: [{ hash: chunk, bytes: 1024 }] }],
          },
        ],
        parents: versions.length ? [versions.at(-1).id] : [],
        device: { id: 'bench', name: 'Bench' },
        uploadedAt: '2026-11-01T12:00:00.000Z',
      };
      const version = hash(JSON.stringify(payload));
      await inner.put(vault.prefix + 'versions/' + version, seal(payload, KEY, vault.space, 'versions/' + version), null);
      versions.push({ id: version, parents: payload.parents, device: payload.device, at: payload.uploadedAt });
    }
    const name = 'heads/' + logical;
    await inner.put(vault.prefix + name, seal(sealedHead(vault.space, logical, i, versions), KEY, vault.space, name), null);
  }
}

async function benchRefresh() {
  const root = await makeRoot();
  const state = new State(path.join(root, 'app'));
  try {
    await fs.mkdir(path.join(root, 'codex'));
    state.set('config', { language: 'en', sourceHomes: [path.join(root, 'codex')], targets: {}, bindings: {} });
    const inner = new MemoryStore();
    const space = uuid('refresh-space');
    await seedSpace(inner, new Vault(inner, space, KEY), 300, 1);
    const delayed = new DelayStore(inner, LATENCY);
    const engine = new Engine(state, { vault: new Vault(delayed, space, KEY) });
    const result = await timed(() => engine.refresh());
    if (result.value.rows.length !== 300 || result.value.cloudError) throw Error('refresh fixture mismatch');
    return { ms: result.ms, heads: 300, requests: delayed.requests };
  } finally {
    state.close();
    await fs.rm(root, { recursive: true, force: true });
  }
}

async function benchRemoval() {
  const root = await makeRoot();
  const state = new State(path.join(root, 'app'));
  try {
    const inner = new MemoryStore();
    const space = uuid('removal-space');
    await seedSpace(inner, new Vault(inner, space, KEY), 100, 3);
    const delayed = new DelayStore(inner, LATENCY);
    const vault = new Vault(delayed, space, KEY);
    const request = { action: 'trash', ids: [uuid('head0')] };
    const first = await timed(() => cloudRemovalPlan(vault, request));
    const second = await timed(() => cloudRemovalPlan(vault, request));
    if (first.value.preview.count !== 3) throw Error('removal fixture mismatch');
    return { first: first.ms, second: second.ms, versions: 300 };
  } finally {
    state.close();
    await fs.rm(root, { recursive: true, force: true });
  }
}

async function benchUpload() {
  const root = await makeRoot();
  const state = new State(path.join(root, 'app'));
  try {
    const home = path.join(root, 'codex');
    const day = path.join(home, 'sessions', '2026', '11', '01');
    await fs.mkdir(day, { recursive: true });
    const tid = uuid('upload');
    const meta = JSON.stringify({
      type: 'session_meta',
      payload: { id: tid, cli_version: '0.166.0', timestamp: '2026-11-01T12:00:00Z', cwd: root, source: 'cli' },
    });
    const lines = [meta];
    // Fifty 1 MiB records of incompressible text: 50 MiB of history in thirteen chunks.
    for (let i = 0; i < 50; i++) {
      const message = pseudoRandom(786432, 'upload' + i).toString('base64');
      lines.push(JSON.stringify({ type: 'event_msg', payload: { type: 'user_message', message } }));
    }
    await fs.writeFile(path.join(day, `rollout-2026-11-01T12-00-00-${tid}.jsonl`), lines.join('\n') + '\n');
    state.set('config', { language: 'en', sourceHomes: [home], targets: {}, bindings: {} });
    const inner = new MemoryStore();
    const space = uuid('upload-space');
    const delayed = new DelayStore(inner, LATENCY);
    const vault = new Vault(delayed, space, KEY);
    await vault.create();
    const engine = new Engine(state, { vault });
    await engine.refresh();
    const plan = await engine.preview({ ids: [tid], direction: 'upload', targets: [], uploadLimitMiB: 200 });
    const run = await timed(() => engine.execute(plan.token, { confirmLarge: true }));
    if (run.value.status !== 'completed') throw Error('upload failed: ' + JSON.stringify(run.value.items));
    const bytes = (await fs.stat(path.join(day, `rollout-2026-11-01T12-00-00-${tid}.jsonl`))).size;
    return { ms: run.ms, bytes, requests: delayed.requests };
  } finally {
    state.close();
    await fs.rm(root, { recursive: true, force: true });
  }
}

async function size(file) {
  return (await fs.stat(file).catch(() => null))?.size ?? null;
}
async function benchPackage() {
  const pkg = JSON.parse(await fs.readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const version = args.get('version') ?? pkg.version;
  const release = new URL('../release/', import.meta.url).pathname;
  const tar = path.join(release, `sesshuttle-${version}-linux-x64.tar.gz`);
  let asar = await size(path.join(release, 'mac-arm64', 'sesshuttle.app', 'Contents', 'Resources', 'app.asar'));
  if (asar === null && (await size(tar)) !== null) {
    const listing = execFileSync('tar', ['-tvzf', tar], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
    const line = listing.split('\n').find((l) => l.endsWith('/resources/app.asar'));
    asar = line ? Number(line.trim().split(/\s+/)[4]) : null;
  }
  return {
    version,
    asar,
    dmg: await size(path.join(release, `sesshuttle-${version}-mac-arm64.dmg`)),
    tar: await size(tar),
    deb: await size(path.join(release, `sesshuttle-${version}-linux-amd64.deb`)),
  };
}

const results = {};
if (wanted('scan')) results.scan = await benchScan();
if (wanted('refresh')) results.refresh = await benchRefresh();
if (wanted('removal')) results.removal = await benchRemoval();
if (wanted('upload')) results.upload = await benchUpload();
if (wanted('package')) results.package = await benchPackage();

const mb = (n) => (n === null || n === undefined ? '—' : (n / 1e6).toFixed(1) + ' MB');
if (args.has('json')) console.log(JSON.stringify(results, null, 2));
else {
  if (results.scan) console.log(`scan 2000 rollouts (200 indexed): first ${results.scan.first} ms, second ${results.scan.second} ms`);
  if (results.refresh) console.log(`cloud refresh 300 heads @${LATENCY}ms: ${results.refresh.ms} ms (${results.refresh.requests} requests)`);
  if (results.removal) console.log(`removal preview 300 versions @${LATENCY}ms: first ${results.removal.first} ms, second ${results.removal.second} ms`);
  if (results.upload) console.log(`upload ${(results.upload.bytes / 1048576).toFixed(1)} MiB @${LATENCY}ms: ${results.upload.ms} ms (${results.upload.requests} requests)`);
  if (results.package) {
    const p = results.package;
    console.log(`package ${p.version}: app.asar ${mb(p.asar)}, dmg ${mb(p.dmg)}, tar.gz ${mb(p.tar)}, deb ${mb(p.deb)}`);
  }
}
