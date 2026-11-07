// User-initiated proof. Both Codex homes, the project, SQLite state, bundle chunks
// and the provider are private fixtures. No cloud store or device configuration is used.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { setTimeout as pause } from 'node:timers/promises';
import { NativeClient } from './native.mjs';
import { runtimeInfo, rememberRuntime } from './runtime.mjs';
import { State } from './state.mjs';
import { Importer } from './importer.mjs';
import { scan } from './codex.mjs';
import { captureBundle } from './bundle.mjs';
import { Fault, id, requireThat } from './util.mjs';
import { FIXTURE_REPLY, setupHome, startFixtureProvider } from './fixture-provider.mjs';

export async function verifyRuntime(
  binary,
  state,
  { signal, onStage = () => {}, timeoutMs = 30000 } = {},
) {
  const info = await runtimeInfo(binary, state);
  if (info.status !== 'untested') return { ...info, reused: true };
  requireThat(!info.script, 'runtime_launcher');
  const lifetime = new AbortController();
  const abort = () => lifetime.abort(new Fault('runtime_cancelled'));
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  const timer = setTimeout(() => lifetime.abort(new Fault('runtime_timeout')), timeoutMs);
  const first = 'Sesshuttle first ' + id(),
    second = 'Sesshuttle next ' + id();
  let root,
    service,
    tempState,
    stage = 'runtimeSample';
  const step = (key) => {
    lifetime.signal.throwIfAborted();
    stage = key;
    onStage(key);
  };
  try {
    step('runtimeSample');
    root = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'sesshuttle-runtime-'));
    service = await startFixtureProvider();
    // Whether a request after the import carried both turns: the history continued.
    const carried = () =>
      service.requests.some((r) => {
        const inputs = JSON.stringify(r.input);
        return inputs?.includes(first) && inputs.includes(second);
      });
    const source = await setupHome(root, 'source', service.port),
      target = await setupHome(root, 'target', service.port);
    const project = path.join(root, 'working-folder');
    await fs.mkdir(project, { mode: 0o700 });
    const fixture = { port: service.port, signal: lifetime.signal };
    async function client(home, fn) {
      const native = new NativeClient(info.file, home, project, { fixture });
      try {
        await native.init(home);
        const { config } = await native.rpc('config/read', { includeLayers: false });
        requireThat(
          config.model_provider === 'sesshuttle_fixture' &&
            config.model_providers?.sesshuttle_fixture?.base_url ===
              'http://127.0.0.1:' + service.port + '/v1' &&
            Object.values(config.mcp_servers ?? {}).every((s) => s.enabled === false) &&
            Object.values(config.hooks ?? {}).every(
              (items) => Array.isArray(items) && !items.length,
            ),
          'runtime_isolation',
        );
        return await fn(native);
      } finally {
        await native.close();
      }
    }
    const turns = (c, tid) =>
      c.rpc('thread/turns/list', {
        threadId: tid,
        sortDirection: 'asc',
        limit: 10,
        itemsView: 'full',
      });
    const opts = { cwd: project, sandbox: 'read-only', approvalPolicy: 'on-request' };
    async function turn(c, tid, text) {
      let completed;
      fixture.notify = (m) => {
        if (m.method === 'turn/completed' && (!m.params?.threadId || m.params.threadId === tid))
          completed = m.params.turn;
      };
      try {
        const started = await c.rpc('turn/start', {
          threadId: tid,
          input: [{ type: 'text', text }],
        });
        while (!completed) {
          lifetime.signal.throwIfAborted();
          requireThat(!c.closed, 'native_unavailable');
          await pause(30, undefined, { signal: lifetime.signal });
        }
        requireThat(
          completed.id === started.turn?.id && completed.status === 'completed',
          'runtime_reply_unavailable',
        );
        return completed.id;
      } finally {
        delete fixture.notify;
      }
    }
    let original;
    const tid = await client(source, async (c) => {
      const start = await c.rpc('thread/start', { ...opts, historyMode: 'paginated' });
      const tid = start.thread.id;
      original = await turn(c, tid, first);
      return tid;
    });
    step('runtimeImport');
    const scanned = await scan([source]),
      row = scanned.rows.find((r) => r.id === tid);
    requireThat(row?.file, 'runtime_history_mismatch');
    const chunks = new Map(),
      vault = {
        stageChunk: async (k, b) => chunks.set(k, b),
        readChunk: async (k) => chunks.get(k),
      };
    const bundle = await captureBundle(row, scanned.rows, vault, 'sample');
    tempState = new State(path.join(root, 'app'));
    const importer = new Importer(tempState, {
      testRoot: root,
      processGuard: async () => {},
      fixture,
      authorize: async (selected) => {
        lifetime.signal.throwIfAborted();
        requireThat(selected === info.file, 'unsafe_path');
        return info;
      },
    });
    await importer.import(bundle, { binary: info.file, home: target, project }, { vault });
    step('runtimeContinue');
    let next;
    await client(target, async (c) => {
      const resumed = await c.rpc('thread/resume', { ...opts, threadId: tid, excludeTurns: true });
      requireThat(resumed.thread?.id === tid, 'runtime_history_mismatch');
      next = await turn(c, tid, second);
    });
    let projects = false;
    await client(target, async (c) => {
      const read = await c.rpc('thread/read', { threadId: tid, includeTurns: false });
      const { data } = await turns(c, tid);
      const messages = (entry, role) => entry?.items?.filter((item) => item.type === role) ?? [];
      function contains(entry, marker) {
        return (
          messages(entry, 'userMessage').some((m) =>
            m.content?.some((part) => part.text === marker),
          ) && messages(entry, 'agentMessage').some((m) => m.text === FIXTURE_REPLY)
        );
      }
      const before = data.findIndex((t) => t.id === original),
        after = data.findIndex((t) => t.id === next);
      requireThat(
        read.thread?.id === tid &&
          before >= 0 &&
          after > before &&
          contains(data[before], first) &&
          contains(data[after], second) &&
          carried(),
        'runtime_history_mismatch',
      );
      step('runtimeProjects');
      // Optional. A missing project API must never revoke proof of continuation.
      const optional = setTimeout(() => c.process.kill('SIGKILL'), 2200);
      try {
        const p = await c.rpc('project/create', {
          name: 'Sesshuttle sample',
          roots: [{ path: project }],
          idempotencyKey: id(),
        });
        await c.rpc('thread/metadata/update', { threadId: tid, projectId: p.project.id });
        const actual = await c.rpc('thread/read', { threadId: tid, includeTurns: false });
        projects = actual.thread?.projectId === p.project.id;
      } catch {
      } finally {
        clearTimeout(optional);
      }
    });
    lifetime.signal.throwIfAborted();
    // Some runtimes insist that the original provider is installed even when
    // resume explicitly selects a different provider. Observe this independently.
    const configPath = path.join(target, 'config.toml');
    const alt = 'sesshuttle_other_fixture';
    await fs.writeFile(
      configPath,
      (await fs.readFile(configPath, 'utf8')).replaceAll('sesshuttle_fixture', alt),
    );
    let requiresSourceProvider = false;
    const changed = new NativeClient(info.file, target, project, { fixture });
    const optional = setTimeout(() => changed.process.kill('SIGKILL'), 1500);
    try {
      await changed.init(target);
      await changed.rpc('thread/resume', {
        ...opts,
        threadId: tid,
        modelProvider: alt,
        excludeTurns: true,
      });
    } catch (e) {
      requiresSourceProvider =
        e.code === 'native_provider_missing' && e.detail === 'sesshuttle_fixture';
    } finally {
      clearTimeout(optional);
      await changed.close();
    }
    lifetime.signal.throwIfAborted();
    return await rememberRuntime(
      binary,
      state,
      info,
      { projects, requiresSourceProvider },
      lifetime.signal,
    );
  } catch (error) {
    if (lifetime.signal.aborted) throw lifetime.signal.reason;
    const detail = [stage, error.code ?? error.message, error.detail]
      .filter(Boolean)
      .join(' · ')
      .slice(0, 400);
    const cause =
      {
        runtime_history_mismatch: 'runtime_history_mismatch',
        native_verification_failed: 'runtime_history_mismatch',
        database_schema: 'runtime_schema',
        native_method_missing: 'runtime_protocol',
        runtime_changed: 'runtime_changed',
        runtime_isolation: 'runtime_isolation',
        unsafe_native_config: 'runtime_isolation',
        native_timeout: 'runtime_timeout',
        native_unavailable: 'runtime_start_failed',
        runtime_reply_unavailable: 'runtime_reply_unavailable',
        ENOSPC: 'disk_space',
        EACCES: 'runtime_temp_denied',
        EPERM: 'runtime_temp_denied',
      }[error.code] ?? 'runtime_unfinished';
    throw new Fault(cause, detail);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
    tempState?.close();
    if (service) await service.close();
    if (root) await fs.rm(root, { recursive: true, force: true });
  }
}
