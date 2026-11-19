import path from 'node:path';
import { spawnSync } from 'node:child_process';
const repo = path.resolve(import.meta.dirname, '..');
const r = spawnSync(
  process.execPath,
  [path.join(repo, 'dist/sesshuttle-start.cjs'), ...process.argv.slice(2)],
  { stdio: 'inherit', env: { ...process.env, SESSHUTTLE_DEV_ENTRY: repo } },
);
process.exitCode = r.status ?? 1;
