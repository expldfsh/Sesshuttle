// Checks app/renderer/i18n/messages.ts, the single table of interface messages.
// Fails when a Chinese or English message is empty, English contains Han characters,
// placeholders differ between languages, a key is defined twice, the interface
// uses an undefined key, a key is never used, or an error code that core or the
// main process can report has no message.
import fs from 'node:fs/promises';
import path from 'node:path';
import { transform } from 'esbuild';
import { errorCodes } from './lib/error-codes.mjs';

const repo = path.resolve(import.meta.dirname, '..');
const table = path.join(repo, 'app/renderer/i18n/messages.ts');

// Keys built at runtime from a prefix and a value (`t('attachment_' + status)`).
const DYNAMIC_PREFIXES = [
  'attachment_',
  'projectMatch_',
  'trashStatus_',
  'assetDecision_',
  'trash_',
];
// Values that core produces and the interface shows with t(value): conversation and
// task states, transfer and runtime-check stages, plan reasons, removal places,
// detection evidence and issue codes recorded on conversations.
const DATA_VALUES = `locally_removed paused restored_needs_validation unchecked
  stageUpload stageVerify stageWrite runtimeContinue runtimeImport runtimeProjects
  noLocalForUpload noBackupToImport preserveLocal requiredParent selectedChat selectedDescendant backupMember
  cloudActive localBin unlistedVersion
  liveDatabase liveEnvironment liveBinary savedPath installedBinary
  history_unavailable external_image remote_resource unknown_version runtime_unfinished runtimeCatalogUnavailable`.split(
  /\s+/,
);
// Issue codes that cloud heads written by early test releases can still carry.
const LEGACY = ['external_attachment'];
// Statuses used inside attachment inspection only; they never reach the interface.
const INTERNAL_CODES = ['unsupported', 'unsafe', 'unreadable'];

const failures = [];
const fail = (message) => failures.push(message);

const source = await fs.readFile(table, 'utf8');
const definitions = new Map();
for (const m of source.matchAll(/^ {2}(?:([A-Za-z_$][\w$]*)|"([^"]+)"): \[/gm)) {
  const key = m[1] ?? m[2];
  definitions.set(key, (definitions.get(key) ?? 0) + 1);
}
for (const [key, n] of definitions) if (n > 1) fail(`defined ${n} times: ${key}`);

const js = await transform(source, { loader: 'ts', format: 'esm' });
const { messages } = await import(
  'data:text/javascript;base64,' + Buffer.from(js.code).toString('base64')
);
const placeholders = (text) =>
  [...text.matchAll(/\{(\w+)\}/g)]
    .map((m) => m[1])
    .sort()
    .join(',');
for (const [key, [zh, en]] of Object.entries(messages)) {
  const forms = typeof en === 'string' ? [en] : [en.one, en.other];
  if (typeof zh !== 'string' || !zh.trim()) fail(`empty Chinese: ${key}`);
  for (const form of forms) {
    if (typeof form !== 'string' || !form.trim()) fail(`empty English: ${key}`);
    else if (/\p{Script=Han}/u.test(form)) fail(`English contains Chinese: ${key}`);
    else if (placeholders(form) !== placeholders(zh)) fail(`placeholders differ: ${key}`);
  }
}

async function files(dir) {
  const out = [];
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await files(p)));
    else if (/\.tsx?$/.test(e.name) && p !== table) out.push(p);
  }
  return out;
}
const ui = (
  await Promise.all(
    (await files(path.join(repo, 'app/renderer'))).map((f) => fs.readFile(f, 'utf8')),
  )
).join('\n');
const defined = (key) => Object.hasOwn(messages, key);
for (const m of ui.matchAll(/\b(?:t|tn|has)\(\s*'([^']+)'\s*[,)]/g))
  if (!defined(m[1])) fail(`used but not defined: ${m[1]}`);
for (const m of ui.matchAll(/\btranslate\(\s*[^,]+,\s*'([^']+)'/g))
  if (!defined(m[1])) fail(`used but not defined: ${m[1]}`);

const codes = await errorCodes(repo);
for (const code of codes)
  if (!defined(code) && !INTERNAL_CODES.includes(code))
    fail(`error code without a message: ${code}`);

const literals = new Set([...ui.matchAll(/['"`]([A-Za-z_][\w]*)['"`]/g)].map((m) => m[1]));
const prefixed = (key) =>
  DYNAMIC_PREFIXES.some((p) => key.startsWith(p) && new RegExp(`['"\`]${p}`).test(ui));
for (const key of Object.keys(messages))
  if (
    !literals.has(key) &&
    !codes.has(key) &&
    !prefixed(key) &&
    !DATA_VALUES.includes(key) &&
    !LEGACY.includes(key)
  )
    fail(`defined but never used: ${key}`);
for (const key of [...DATA_VALUES, ...LEGACY])
  if (!defined(key)) fail(`declared value without a message: ${key}`);

if (failures.length) {
  console.error(failures.map((f) => '  ' + f).join('\n'));
  console.error(`FAIL ${failures.length} problem(s) in ${path.relative(repo, table)}`);
  process.exit(1);
}
console.log(
  `PASS ${Object.keys(messages).length} bilingual interface messages, ${codes.size} error codes covered`,
);
