// Checks every relative link and image in the repository's Markdown files: the
// target file must exist and a #fragment must match a heading there (GitHub's
// heading anchors). External links are not fetched.
// Usage: node scripts/check-links.mjs
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKIP = new Set(['node_modules', 'release', 'dist', '.git']);

async function markdown(dir) {
  const out = [];
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await markdown(p)));
    else if (e.name.endsWith('.md')) out.push(p);
  }
  return out;
}

// GitHub's anchor for a heading: lower case, punctuation removed, spaces to
// hyphens, and -1, -2 … for repeated headings.
function anchors(text) {
  const seen = new Map(),
    out = new Set();
  let fenced = false;
  for (const line of text.split('\n')) {
    if (/^\s*```/.test(line)) fenced = !fenced;
    const m = !fenced && line.match(/^#{1,6}\s+(.*?)\s*#*\s*$/);
    if (!m) continue;
    const base = m[1]
      .replace(/`([^`]*)`/g, '$1')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s_-]/gu, '')
      .replace(/\s/g, '-');
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    out.add(n ? `${base}-${n}` : base);
  }
  return out;
}

const failures = [];
let checked = 0;
const cache = new Map();
const headingsOf = async (file) => {
  if (!cache.has(file)) cache.set(file, anchors(await fs.readFile(file, 'utf8')));
  return cache.get(file);
};
for (const file of await markdown(repo)) {
  const text = (await fs.readFile(file, 'utf8')).replace(/```[\s\S]*?```/g, '');
  for (const m of text.matchAll(/!?\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
    const link = m[1];
    if (/^[a-z][a-z0-9+.-]*:/i.test(link)) continue;
    checked++;
    const [target, fragment] = link.split('#');
    const resolved = target ? path.resolve(path.dirname(file), decodeURI(target)) : file;
    const where = path.relative(repo, file);
    const stat = await fs.stat(resolved).catch(() => null);
    if (!stat) {
      failures.push(`${where}: missing ${link}`);
      continue;
    }
    if (fragment && stat.isFile() && resolved.endsWith('.md')) {
      if (!(await headingsOf(resolved)).has(decodeURIComponent(fragment).toLowerCase()))
        failures.push(`${where}: no heading for #${fragment} in ${path.relative(repo, resolved)}`);
    }
  }
}
if (failures.length) {
  console.error(failures.map((f) => '  ' + f).join('\n'));
  console.error(`FAIL ${failures.length} broken relative link(s)`);
  process.exitCode = 1;
} else console.log(`PASS ${checked} relative links`);
