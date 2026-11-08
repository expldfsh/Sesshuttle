// A small compiled program that only prints one line. Tests that need a "real"
// executable (not a script) use it instead of any installed Codex.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

export function canCompile() {
  try {
    execFileSync('cc', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

export async function compileStandIn(file, version) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  execFileSync('cc', ['-x', 'c', '-o', file, '-'], {
    input: `#include <stdio.h>\nint main(void){puts("codex-cli ${version}");return 0;}\n`,
  });
}

// A launcher script followed by the program it starts, as in an installed app bundle.
export const LAUNCHER = 'Contents/Resources/codex-cli/bin/codex';
export const PROGRAM = 'Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex';
export async function fakeBundle(root, name, version, { compile = true } = {}) {
  const bundle = path.join(root, name),
    launcher = path.join(bundle, LAUNCHER),
    program = path.join(bundle, PROGRAM);
  await fs.mkdir(path.dirname(launcher), { recursive: true });
  await fs.writeFile(
    launcher,
    `#!/bin/sh\nset -eu\nbin_dir=$(CDPATH= cd -P -- "$(dirname -- "$0")" && pwd)\nexec "$bin_dir/../CodexCLI.app/Contents/MacOS/codex" "$@"\n`,
    { mode: 0o755 },
  );
  if (compile) await compileStandIn(program, version);
  else await fs.mkdir(path.dirname(program), { recursive: true });
  return { bundle, launcher, program };
}
