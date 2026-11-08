// Error codes the core and main process can report, read from their sources:
// first arguments of Fault(...), second arguments of requireThat(...), and
// `code: '...'` / mapped error-code tables. Used by scripts/check-locales.mjs.
import fs from 'node:fs/promises';
import path from 'node:path';

async function sources(dir, ext) {
  const out = [];
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await sources(p, ext)));
    else if (ext.test(e.name)) out.push(p);
  }
  return out;
}

// Splits the argument list that starts after `(` at `start`; strings, template
// literals and nested brackets are skipped as units.
function argumentsAt(text, start) {
  const args = [];
  let depth = 0,
    current = '',
    i = start;
  for (; i < text.length; i++) {
    const c = text[i];
    if (c === "'" || c === '"' || c === '`') {
      let j = i + 1;
      while (j < text.length && text[j] !== c) j += text[j] === '\\' ? 2 : 1;
      current += text.slice(i, j + 1);
      i = j;
      continue;
    }
    if ('([{'.includes(c)) depth++;
    if (')]}'.includes(c)) {
      if (depth === 0) break;
      depth--;
    }
    if (c === ',' && depth === 0) {
      args.push(current);
      current = '';
      continue;
    }
    current += c;
  }
  args.push(current);
  return args.map((a) => a.trim());
}

const TYPE_NAMES = new Set(['string', 'number', 'object', 'function', 'boolean', 'undefined']);
// Code-like string literals of an expression. Operands of comparisons are
// conditions, not results (`x === 'a' ? 'code_a' : 'code_b'`).
const literals = (expression = '') =>
  [...expression.matchAll(/(===|!==|==|!=)?\s*'([a-z][A-Za-z0-9_]*)'/g)]
    .filter((m) => !m[1])
    .map((m) => m[2])
    .filter((x) => !TYPE_NAMES.has(x) && !x.endsWith('_'));

export async function errorCodes(repo) {
  const files = [
    ...(await sources(path.join(repo, 'core'), /\.mjs$/)),
    ...(await sources(path.join(repo, 'app/main'), /\.ts$/)),
  ];
  const codes = new Set();
  for (const file of files) {
    const text = await fs.readFile(file, 'utf8');
    for (const m of text.matchAll(/\bFault\(/g))
      literals(argumentsAt(text, m.index + m[0].length)[0]).forEach((c) => codes.add(c));
    for (const m of text.matchAll(/\brequireThat\(/g))
      literals(argumentsAt(text, m.index + m[0].length)[1]).forEach((c) => codes.add(c));
    for (const m of text.matchAll(/\bcode\s*:\s*'([a-z][a-z0-9_]*)'/g)) codes.add(m[1]);
    // Codes reported as a field of a result instead of thrown.
    for (const m of text.matchAll(/\berror\s*[:=]\s*'([a-z]+_[a-z0-9_]+)'/g)) codes.add(m[1]);
    // Tables that translate lower-level failures into public codes.
    for (const m of text.matchAll(/(?:localCodes|cause)\s*=\s*\{([^}]*)\}/g))
      literals(m[1]).forEach((c) => codes.add(c));
    for (const m of text.matchAll(/const cause = \{([\s\S]*?)\}\[/g))
      literals(m[1]).forEach((c) => codes.add(c));
  }
  return codes;
}
