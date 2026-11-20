// Opens a verified conversation in its native app. Nothing is submitted to the
// conversation and no historical command runs; the user continues it there.
import { app, shell } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { liveLinuxTargets } from '../../core/discovery.mjs';
import { runtimeProgram } from '../../core/runtime.mjs';
import { importMatchesSettings } from '../../core/continue-rules.mjs';
import { Fault, requireThat, atomic, exists, canonical } from '../../core/util.mjs';
import type { Context } from './context';

const exec = promisify(execFile);

// Store apps can own a link without exposing an executable path to Electron.
export async function protocolHandler(
  entry: string,
  timeout: number,
): Promise<{ name: string; executable?: string } | null> {
  const scheme = entry === 'desktop' ? 'codex' : 'vscode';
  if (process.platform === 'win32') {
    const name = app.getApplicationNameForProtocol(scheme + '://');
    if (name) return { name };
    if (entry === 'ide') {
      const { LOCALAPPDATA, ProgramFiles } = process.env;
      for (const parent of [LOCALAPPDATA && path.join(LOCALAPPDATA, 'Programs'), ProgramFiles]) {
        if (!parent || !path.isAbsolute(parent)) continue;
        const executable = path.join(parent, 'Microsoft VS Code', 'Code.exe');
        if ((await fs.stat(executable).catch(() => null))?.isFile())
          return { name: 'Visual Studio Code', executable };
      }
    }
    return null;
  }
  const name = await exec('xdg-mime', ['query', 'default', 'x-scheme-handler/' + scheme], {
    timeout,
  }).then(
    (v) => v.stdout.trim(),
    () => '',
  );
  return name ? { name } : null;
}

function launchDetached(file: string, args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(file, args, { detached: true, stdio: 'ignore' });
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
}

async function launchInTerminal(file: string) {
  const choices = [
    ['x-terminal-emulator', ['-e', file]],
    ['gnome-terminal', ['--', file]],
    ['konsole', ['-e', file]],
    ['xfce4-terminal', ['--command', file]],
    ['xterm', ['-e', file]],
  ] as [string, string[]][];
  for (const [command, args] of choices) {
    const found = (process.env.PATH ?? '').split(path.delimiter).map((p) => path.join(p, command));
    for (const bin of found)
      if (await exists(bin)) {
        await launchDetached(bin, args);
        return;
      }
  }
  throw new Fault('terminal_required');
}

export async function continueEntry(ctx: Context, { logicalId, entry }: any) {
  const { state, engine } = ctx;
  requireThat(['desktop', 'cli', 'ide'].includes(entry), 'invalid_selection');
  const record = state.get('entries/' + engine.scope() + '/' + logicalId, {})[entry];
  requireThat(record && record.status === 'verified', 'not_verified');
  await canonical(record.project);
  const cfg = engine.config(),
    target = cfg.targets[entry];
  requireThat(
    await importMatchesSettings(
      entry,
      record,
      target,
      cfg.bindings[state.get('association/' + logicalId)?.projectId],
    ),
    'import_settings_changed',
  );
  if (entry === 'desktop' || entry === 'ide') {
    const home = await canonical(record.home);
    if (process.platform === 'linux') {
      const live = (await liveLinuxTargets()).filter(
        (c) => c.entry === entry && c.evidence === 'liveDatabase',
      );
      const matching = live.filter((c) => c.home === home);
      requireThat(
        live.length ? matching.length === live.length : home === path.join(os.homedir(), '.codex'),
        'custom_home_launcher',
      );
    } else
      requireThat(
        home === (await canonical(path.join(os.homedir(), '.codex'))),
        'custom_home_launcher',
      );
    const url =
      (entry === 'desktop' ? 'codex://threads/' : 'vscode://openai.chatgpt/local/') +
      encodeURIComponent(logicalId);
    let executable: string | undefined;
    if (process.platform === 'win32' || process.platform === 'linux') {
      const handler = await protocolHandler(entry, 3000);
      requireThat(handler, 'no_protocol_handler');
      executable = handler?.executable;
    }
    if (executable) await launchDetached(executable, ['--open-url', '--', url]);
    else await shell.openExternal(url);
    return { status: 'opened' };
  }
  // A launcher script contains only individually quoted paths and a UUID. The user
  // starts the native CLI explicitly; there is no task prompt on the command line.
  requireThat(/^[0-9a-f-]{36}$/i.test(logicalId), 'invalid_selection');
  if (process.platform === 'win32') {
    const launcher = app.isPackaged
      ? path.join(path.dirname(process.execPath), 'Sesshuttle.exe')
      : path.join(app.getAppPath(), 'dist', 'Sesshuttle.exe');
    try {
      await exec(
        launcher,
        [
          '--resume-cli',
          await runtimeProgram(target.binary),
          record.home,
          record.project,
          logicalId,
        ],
        { timeout: 8000, windowsHide: true },
      );
    } catch {
      throw new Fault('manual_cli_required');
    }
    return { status: 'opened' };
  }
  const quote = (s: string) => "'" + s.replaceAll("'", "'\\''") + "'";
  const file = path.join(state.root, 'launchers', logicalId + '.command');
  await atomic(
    file,
    `#!/bin/sh\nexport CODEX_HOME=${quote(record.home)}\nexec ${quote(target.binary)} --cd ${quote(record.project)} resume ${quote(logicalId)}\n`,
  );
  await fs.chmod(file, 0o700);
  if (process.platform === 'linux') {
    await launchInTerminal(file);
    return { status: 'opened' };
  }
  const error = await shell.openPath(file);
  requireThat(!error, 'open_failed');
  return { status: 'opened' };
}
