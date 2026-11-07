// Opens a verified conversation in its native app. Nothing is submitted to the
// conversation and no historical command runs; the user continues it there.
import { shell } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { liveLinuxTargets } from '../../core/discovery.mjs';
import { Fault, requireThat, atomic, exists, canonical } from '../../core/util.mjs';
import type { Context } from './context';

const exec = promisify(execFile);

// The desktop app and VS Code register URL schemes; Linux needs a registered handler.
export function protocolHandler(entry: string, timeout: number) {
  const scheme = entry === 'desktop' ? 'codex' : 'vscode';
  return exec('xdg-mime', ['query', 'default', 'x-scheme-handler/' + scheme], { timeout }).then(
    (v) => v.stdout.trim(),
    () => '',
  );
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
        await new Promise<void>((resolve, reject) => {
          const child = spawn(bin, args, { detached: true, stdio: 'ignore' });
          child.once('error', reject);
          child.once('spawn', () => {
            child.unref();
            resolve();
          });
        });
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
    target?.home === record.home &&
      target.binary === record.binary &&
      cfg.bindings[state.get('association/' + logicalId)?.projectId] === record.project,
    'stale_plan',
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
      requireThat(!!(await protocolHandler(entry, 3000)), 'no_protocol_handler');
    } else
      requireThat(
        home === (await canonical(path.join(os.homedir(), '.codex'))),
        'custom_home_launcher',
      );
  }
  if (entry === 'desktop') {
    await shell.openExternal('codex://threads/' + encodeURIComponent(logicalId));
    return { status: 'opened' };
  }
  if (entry === 'ide') {
    await shell.openExternal('vscode://openai.chatgpt/local/' + encodeURIComponent(logicalId));
    return { status: 'opened' };
  }
  // A launcher script contains only individually quoted paths and a UUID. The user
  // starts the native CLI explicitly; there is no task prompt on the command line.
  requireThat(/^[0-9a-f-]{36}$/i.test(logicalId), 'invalid_selection');
  const quote = (s: string) => "'" + s.replaceAll("'", "'\\''") + "'";
  const file = path.join(
    state.root,
    'launchers',
    logicalId + (process.platform === 'win32' ? '.cmd' : '.command'),
  );
  if (process.platform === 'win32') throw new Fault('manual_cli_required');
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
