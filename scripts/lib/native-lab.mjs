// Isolated native Codex lab for the validation scripts, replacing the former
// Python research tools. Every directory lives in a marked temporary lab under
// os.tmpdir(); every Codex app-server runs inside the macOS process sandbox (or,
// on Linux, bubblewrap in the disposable VM) with writes limited to the lab and
// the real ~/.codex unreadable. Model replies come from the loopback fixture.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { setTimeout as pause } from 'node:timers/promises';
import { isDeepStrictEqual } from 'node:util';
import { hash, id } from '../../core/util.mjs';

export const LAB_PREFIX = 'sesshuttle-lab-';
const MARKER = '.sesshuttle-lab.json';
const MARKER_TEXT = JSON.stringify({ format: 1, purpose: 'synthetic-tests-only' });
// A 1×1 PNG used as an embedded image input.
export const IMAGE =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';

export class SafetyError extends Error {}
const refuse = (message) => {
  throw new SafetyError(message);
};

export class Lab {
  constructor(root) {
    this.root = root;
  }

  static async create() {
    const tmp = fs.realpathSync(os.tmpdir());
    const root = fs.realpathSync(await fsp.mkdtemp(path.join(tmp, LAB_PREFIX)));
    await fsp.writeFile(path.join(root, MARKER), MARKER_TEXT, { mode: 0o600 });
    return Lab.open(root);
  }

  // Reopens a lab made by an earlier run (cross-device "return").
  static async open(root) {
    const absolute = path.resolve(root);
    let real;
    try {
      real = fs.realpathSync(absolute);
    } catch {
      refuse('Lab does not exist');
    }
    if (real !== absolute || fs.lstatSync(absolute).isSymbolicLink())
      refuse('Lab root must be canonical, without symbolic links');
    if (
      path.dirname(real) !== fs.realpathSync(os.tmpdir()) ||
      !path.basename(real).startsWith(LAB_PREFIX)
    )
      refuse('Writes are restricted to a dedicated temporary lab');
    const marker = path.join(real, MARKER);
    const stat = fs.lstatSync(marker, { throwIfNoEntry: false });
    if (!stat?.isFile()) refuse('Missing lab ownership marker');
    if (fs.readFileSync(marker, 'utf8') !== MARKER_TEXT) refuse('Invalid lab ownership marker');
    return new Lab(real);
  }

  // `p` inside the lab, with no symbolic link, traversal or hard link on the way.
  checked(p) {
    const absolute = path.resolve(p);
    const relative = path.relative(this.root, absolute);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative))
      refuse('Path is outside the lab');
    const real = path.join(os.homedir(), '.codex');
    if (absolute === real || absolute.startsWith(real + path.sep))
      refuse('The real Codex data folder is never used');
    let current = this.root;
    for (const part of relative.split(path.sep)) {
      current = path.join(current, part);
      const stat = fs.lstatSync(current, { throwIfNoEntry: false });
      if (!stat) break;
      if (stat.isSymbolicLink()) refuse('Symbolic links are not allowed');
      if (stat.isFile() && stat.nlink !== 1) refuse('Hard-linked files are not allowed in the lab');
    }
    return absolute;
  }

  async directory(relative) {
    const p = this.checked(path.join(this.root, relative));
    await fsp.mkdir(p, { recursive: true, mode: 0o700 });
    return p;
  }

  async write(relative, data) {
    const p = this.checked(path.join(this.root, relative));
    await fsp.writeFile(p, data, { mode: 0o600 });
    return p;
  }

  // Never inherits credentials, proxy settings or the user's CODEX_HOME.
  async environment(home) {
    this.checked(home);
    return {
      PATH: '/usr/bin:/bin:/usr/sbin:/sbin:/usr/local/bin:/opt/homebrew/bin',
      CODEX_HOME: home,
      TMPDIR: await this.directory('tmp'),
      XDG_CONFIG_HOME: await this.directory('xdg/config'),
      XDG_CACHE_HOME: await this.directory('xdg/cache'),
      XDG_DATA_HOME: await this.directory('xdg/data'),
      RUST_LOG: 'error',
    };
  }

  // The confined command line: writes only inside the lab, the real ~/.codex
  // unreadable, network only to the loopback fixture port.
  command(args, { localPort } = {}) {
    if (localPort !== undefined && !(Number.isInteger(localPort) && localPort >= 1024))
      refuse('Invalid fixture server port');
    if (process.platform === 'linux') {
      const marker = '/run/sesshuttle-isolated-vm';
      const stat = fs.statSync(marker, { throwIfNoEntry: false });
      if (
        !stat?.isFile() ||
        stat.uid !== 0 ||
        fs.readFileSync(marker, 'utf8').trim() !== 'loopback-only-fixture'
      )
        refuse('Linux native tests require the disposable VM with loopback-only outbound policy');
      return [
        '/usr/bin/bwrap',
        ['--die-with-parent', '--ro-bind', '/', '/', '--dev', '/dev', '--proc', '/proc'],
        ['--tmpfs', '/home', '--tmpfs', '/tmp', '--bind', this.root, this.root, '--'],
        args,
      ].flat();
    }
    if (process.platform !== 'darwin' || !fs.existsSync('/usr/bin/sandbox-exec'))
      refuse('The native lab requires the macOS process sandbox');
    const quote = JSON.stringify;
    let profile =
      '(version 1)(deny default)(allow process*)(allow sysctl-read)' +
      '(allow mach-lookup)(allow ipc-posix*)(allow file-read*)' +
      `(deny file-read* (subpath ${quote(fs.realpathSync(os.homedir()) + '/.codex')}))` +
      `(allow file-write* (subpath ${quote(this.root)}) (literal "/dev/null"))`;
    if (localPort !== undefined)
      profile += `(allow network-outbound (remote ip "localhost:${localPort}"))`;
    return ['/usr/bin/sandbox-exec', '-p', profile, ...args];
  }
}

const locked = new Set();

// A JSON-RPC session with `codex app-server` for one data folder in the lab.
// Approval, login and permission requests from the server are always denied.
export class LabClient {
  static async open(lab, binary, home, project, { localPort, localOpenAI = false } = {}) {
    home = lab.checked(home);
    project = lab.checked(project);
    if (!fs.statSync(home).isDirectory() || !fs.statSync(project).isDirectory())
      refuse('Home and project must exist inside the lab');
    if (fs.existsSync(path.join(home, 'auth.json')))
      refuse('Test homes must not contain authentication credentials');
    // One app-server per data folder: a lock file in the lab, created exclusively.
    const lock = lab.checked(path.join(await lab.directory('locks'), hash(home) + '.lock'));
    if (locked.has(lock)) refuse('Test home is in use; stop its app-server first');
    const handle = await fsp.open(lock, 'wx', 0o600).catch(() => {
      refuse('Test home is in use; stop its app-server first');
    });
    locked.add(lock);
    const client = new LabClient(lock, handle);
    try {
      const args = [
        fs.realpathSync(binary),
        'app-server',
        '-c',
        'cli_auth_credentials_store="file"',
        '-c',
        'analytics.enabled=false',
        '-c',
        'shell_snapshot=false',
      ];
      const env = await lab.environment(home);
      if (localOpenAI && localPort)
        Object.assign(env, {
          OPENAI_API_KEY: 'sesshuttle-local-fixture-only',
          CODEX_API_KEY: 'sesshuttle-local-fixture-only',
        });
      const log = fs.openSync(lab.checked(path.join(home, 'app-server.stderr.log')), 'a', 0o600);
      const [command, ...rest] = lab.command(args, { localPort });
      client.process = spawn(command, rest, { cwd: project, env, stdio: ['pipe', 'pipe', log] });
      fs.closeSync(log);
      client.start();
      const result = await client.rpc('initialize', {
        clientInfo: { name: 'sesshuttle_lab', version: '0.1.0' },
        capabilities: { experimentalApi: true },
      });
      if (fs.realpathSync(result.codexHome) !== home)
        refuse('Server did not honor the isolated data location');
      client.notify('initialized');
      return client;
    } catch (error) {
      await client.close();
      throw error;
    }
  }

  constructor(lock, handle) {
    this.lock = lock;
    this.handle = handle;
    this.counter = 0;
    this.waiting = new Map();
    this.events = [];
    this.listeners = new Set();
    this.exited = null;
  }

  start() {
    this.exited = new Promise((resolve) => this.process.once('close', resolve));
    this.process.stdin.on('error', () => {});
    let size = 0;
    this.reader = readline.createInterface({ input: this.process.stdout });
    this.reader.on('line', (line) => {
      size += line.length;
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        return;
      }
      if (message.id !== undefined && message.method) {
        // Never approve a tool, login or permission request during testing.
        this.send({ id: message.id, error: { code: -32603, message: 'Lab denies approval' } });
      } else if (message.method) {
        this.events.push(message);
        if (this.events.length > 10000) this.fail(new SafetyError('Too many notifications'));
        for (const listener of this.listeners) listener();
      } else {
        const waiter = this.waiting.get(message.id);
        if (!waiter) return;
        this.waiting.delete(message.id);
        clearTimeout(waiter.timer);
        if (message.error)
          waiter.reject(new Error(`${waiter.method}: ${JSON.stringify(message.error)}`));
        else waiter.resolve(message.result);
      }
      if (size > 256 * 1024 * 1024)
        this.fail(new SafetyError('RPC output exceeded the lab budget'));
    });
    this.process.once('close', () =>
      this.fail(new Error('App-server exited; inspect the isolated stderr log')),
    );
  }

  send(message) {
    if (this.process && !this.process.stdin.destroyed)
      this.process.stdin.write(JSON.stringify(message) + '\n');
  }

  fail(error) {
    for (const waiter of this.waiting.values()) {
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
    this.waiting.clear();
    for (const listener of this.listeners) listener(error);
  }

  notify(method, params) {
    this.send({ method, ...(params === undefined ? {} : { params }) });
  }

  rpc(method, params, timeoutMs = 20000) {
    const callId = ++this.counter;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiting.delete(callId);
        reject(new Error(`${method}: app-server response deadline exceeded`));
      }, timeoutMs);
      this.waiting.set(callId, { resolve, reject, timer, method });
      this.send({ id: callId, method, params });
    });
  }

  // The next notification named `method`, removed from the queue.
  waitEvent(method, timeoutMs = 30000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => done(new Error(`${method}: event deadline exceeded`)),
        timeoutMs,
      );
      const check = (error) => {
        if (error) return done(error);
        const index = this.events.findIndex((e) => e.method === method);
        if (index >= 0) done(null, this.events.splice(index, 1)[0].params);
      };
      const done = (error, value) => {
        clearTimeout(timer);
        this.listeners.delete(check);
        if (error) reject(error);
        else resolve(value);
      };
      this.listeners.add(check);
      check();
    });
  }

  async close() {
    try {
      if (this.process && this.process.exitCode === null && this.process.signalCode === null) {
        this.process.stdin.end();
        const stopped = (ms) => Promise.race([this.exited, pause(ms).then(() => false)]);
        if ((await stopped(5000)) === false) {
          this.process.kill('SIGTERM');
          if ((await stopped(3000)) === false) {
            this.process.kill('SIGKILL');
            await stopped(3000);
          }
        }
      }
    } finally {
      this.reader?.close();
      await this.handle.close();
      await fsp.rm(this.lock, { force: true });
      locked.delete(this.lock);
    }
  }
}

// Opens a client, runs `fn` with it and always closes it.
export async function withClient(lab, binary, home, project, options, fn) {
  const client = await LabClient.open(lab, binary, home, project, options);
  try {
    return await fn(client);
  } finally {
    await client.close();
  }
}

export async function startThread(client, cwd) {
  const result = await client.rpc('thread/start', {
    cwd,
    sandbox: 'read-only',
    approvalPolicy: 'on-request',
    historyMode: 'paginated',
  });
  return result.thread.id;
}

// One user turn, waiting until Codex reports it completed.
export async function turn(client, tid, text, { image = false } = {}) {
  const input = [{ type: 'text', text }];
  if (image) input.push({ type: 'image', url: IMAGE });
  return turnWith(client, tid, input);
}

export async function turnWith(client, tid, input) {
  const completed = client.waitEvent('turn/completed');
  completed.catch(() => {});
  await client.rpc('turn/start', { threadId: tid, input });
  const event = await completed;
  if (event.turn.status !== 'completed')
    throw new Error('Turn did not complete: ' + JSON.stringify(event));
  return event.turn;
}

// The whole history, one turn per page, oldest first.
export async function turns(client, tid) {
  const result = [],
    seen = new Set();
  let cursor = null;
  for (let i = 0; i < 100; i++) {
    const page = await client.rpc('thread/turns/list', {
      threadId: tid,
      limit: 1,
      sortDirection: 'asc',
      itemsView: 'full',
      cursor,
    });
    result.push(...page.data);
    cursor = page.nextCursor;
    if (!cursor) return result;
    if (seen.has(cursor)) throw new Error('History pagination repeated a cursor');
    seen.add(cursor);
  }
  throw new Error('History pagination exceeded the fixture budget');
}

// 0.166 reports item timings that 0.164 omits; the raw rollout keeps them anyway.
export function comparableHistory(history) {
  const copy = JSON.parse(JSON.stringify(history));
  for (const entry of copy)
    for (const item of entry.items) {
      delete item.startedAtMs;
      delete item.completedAtMs;
    }
  return copy;
}

export function historyEqual(left, right) {
  return isDeepStrictEqual(comparableHistory(left), comparableHistory(right));
}

// Codex runs `pwd` and reads proof.txt in the working folder through the user
// shell API (outside Codex's own sandbox, still inside the lab's process sandbox).
// This shows the working folder, not model reasoning.
export async function proveDirectory(client, tid, project, marker) {
  const completed = client.waitEvent('turn/completed');
  completed.catch(() => {});
  await client.rpc('thread/shellCommand', {
    threadId: tid,
    command: '/bin/pwd; /bin/cat proof.txt',
    timeoutMs: 5000,
  });
  if ((await completed).turn.status !== 'completed') throw new Error('Shell command failed');
  const commands = (await turns(client, tid))
    .flatMap((t) => t.items)
    .filter((item) => item.type === 'commandExecution');
  const command = commands.at(-1);
  if (!command) throw new Error('No persisted command result');
  if (command.exitCode !== 0) throw new Error('Command failed: ' + JSON.stringify(command));
  if (command.cwd !== project) throw new Error('Command ran in ' + command.cwd);
  if (!command.aggregatedOutput.includes(project) || !command.aggregatedOutput.includes(marker))
    throw new Error('Working folder proof missing: ' + command.aggregatedOutput);
}

// A random marker that must reach the provider again after a transfer.
export const marker = (label) => label + '-' + id().replaceAll('-', '');
