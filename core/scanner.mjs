import { messageFromEvent, messageFromItem } from './history-items.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { hash, walk, requireThat, exists, inside, indexBy, groupBy } from './util.mjs';
import { digestRollout, records } from './stream.mjs';
import {
  openCatalog,
  databaseSummary,
  indexNames,
  nativeMeta,
  displayName,
  projectFor,
} from './catalog.mjs';
// Facts derived only from a rollout's bytes are cached by path, size, mtime and
// ctime. The stat comes first, so a file changed while it is read is read again
// on the next scan. Failures are never cached.
const digestCache = new Map(),
  headerCache = new Map(),
  rolloutCache = new Map();
async function statKey(file) {
  const s = await fs.stat(file);
  return file + '\0' + s.size + '\0' + s.mtimeMs + '\0' + s.ctimeMs;
}
async function cached(cache, key, compute) {
  if (cache.has(key)) return cache.get(key);
  const value = await compute();
  if (cache.size > 5000) cache.clear();
  cache.set(key, value);
  return value;
}
const fileDigest = (file, key) => cached(digestCache, key, () => digestRollout(file));
// Only the first record; an unfinished tail does not matter here.
const readHeader = (file, key) =>
  cached(headerCache, key, async () => {
    for await (const record of records(file)) return record;
    return null;
  });
// The header, the last 30 conversation turns and whether a turn is still running.
// A failure carries the header read before it.
const readRollout = (file, key) =>
  cached(rolloutCache, key, async () => {
    let header,
      first = true,
      busy = false;
    const messages = [];
    try {
      for await (const record of records(file)) {
        if (first) {
          requireThat(record.type === 'session_meta', 'invalid_history');
          header = record.payload;
          first = false;
        }
        const p = record.payload;
        if (record.type === 'event_msg') {
          if (['task_started', 'turn_started'].includes(p?.type)) busy = true;
          if (['task_complete', 'turn_complete', 'turn_aborted'].includes(p?.type)) busy = false;
          // Rollout previews list conversation turns only, not command output.
          const message = messageFromEvent(p) ?? (p?.item ? messageFromItem(p.item) : null);
          if (message && message.role !== 'tool') messages.push(message);
        }
        if (messages.length > 30) messages.shift();
      }
    } catch (e) {
      throw Object.assign(e, { header });
    }
    return { header, messages, busy };
  });
export async function scanHistory(homes, { sourceOf }) {
  const rows = [],
    errors = [],
    seen = new Map();
  let previewBudget = 32 * 1024 * 1024;
  for (const configured of homes) {
    let catalog;
    try {
      const home = await fs.realpath(configured);
      catalog = await openCatalog(home);
      let names = new Map();
      try {
        names = await indexNames(home);
      } catch (e) {
        errors.push({ home, code: e.code ?? 'invalid_history' });
      }
      const indexed = new Map(catalog.threads.map((t) => [t.id, t])),
        files = new Set();
      for (const dir of ['sessions', 'archived_sessions'])
        try {
          for (const f of await walk(path.join(home, dir)))
            if (/\.jsonl(?:\.zst)?$/.test(f)) files.add(f);
        } catch (e) {
          errors.push({ home, code: e.code ?? 'scan_failed' });
        }
      for (const thread of indexed.values())
        if (thread.rollout_path && (await exists(thread.rollout_path))) {
          try {
            await inside(home, thread.rollout_path);
            files.add(thread.rollout_path);
          } catch (e) {
            errors.push({ home, code: e.code });
          }
        }
      const found = new Set();
      // Spawn edges by child, in table order.
      const edgeParents = groupBy(
        catalog.edges ?? [],
        'child_thread_id',
        (e) => e.parent_thread_id,
      );
      async function add(thread, file) {
        let meta = thread ? nativeMeta(thread) : null,
          summary = thread ? databaseSummary(catalog, thread.id) : null,
          raw = null,
          parsed = null,
          issue = null,
          verifiedId = null;
        try {
          if (file) {
            const key = await statKey(file);
            raw = await fileDigest(file, key);
            const first = meta ? await readHeader(file, key) : null;
            if (first) {
              requireThat(
                first.type === 'session_meta' && first.payload?.id === meta.id,
                'invalid_history',
              );
              const header = first.payload;
              verifiedId = header.id;
              meta = {
                ...header,
                ...meta,
                originator: meta.originator ?? header.originator,
                parent_thread_id:
                  meta.parent_thread_id ??
                  header.parent_thread_id ??
                  header.source?.subagent?.thread_spawn?.parent_thread_id,
              };
            }
            if (!meta) {
              let rollout;
              try {
                rollout = await readRollout(file, key);
              } catch (e) {
                // Keep the header read before a failure: it still names the conversation.
                meta = e.header;
                verifiedId = meta?.id;
                throw e;
              }
              meta = rollout.header;
              verifiedId = meta?.id;
              requireThat(meta, 'invalid_history');
              parsed = { messages: rollout.messages, busy: rollout.busy };
            }
          }
        } catch (e) {
          issue = e.code ?? 'invalid_history';
          errors.push({ file, home, code: issue, id: verifiedId });
        }
        if (!meta) return;
        requireThat(/^[0-9a-f-]{36}$/i.test(meta.id), 'invalid_history');
        found.add(meta.id);
        const source = sourceOf(meta),
          parent =
            meta.parent_thread_id ??
            meta.source?.subagent?.thread_spawn?.parent_thread_id ??
            edgeParents.get(meta.id)?.[0] ??
            null,
          historyBase = meta.history_base?.thread_id ?? meta.forked_from_id ?? null;
        const messages = summary?.messages.length ? summary.messages : (parsed?.messages ?? []);
        let previewBytes = 0;
        const filtered = messages.filter((m) => {
          const bytes = Buffer.byteLength(m.text);
          previewBytes += bytes;
          if (previewBytes > 128 * 1024 || previewBudget < bytes) return false;
          previewBudget -= bytes;
          return true;
        });
        const row = {
          indexedFile: thread?.rollout_path ?? null,
          id: meta.id,
          key: hash(home + '\0' + meta.id),
          home,
          homes: [home],
          file: file ?? null,
          physicalFiles: file ? [file] : [],
          hash: hash(JSON.stringify([raw?.hash ?? null, summary?.hash ?? null])),
          rawHash: raw?.hash ?? null,
          dbHash: summary?.hash ?? null,
          database: !!thread,
          continuation: !!file,
          source,
          kind: source === 'subagent' ? 'background' : 'main',
          parent,
          historyBase,
          dependencies: [
            ...new Set([parent, historyBase, ...(edgeParents.get(meta.id) ?? [])].filter(Boolean)),
          ],
          agent:
            thread?.agent_nickname ??
            meta.source?.subagent?.other ??
            meta.source?.subagent?.thread_spawn?.agent_nickname ??
            '',
          title:
            displayName(thread, names.get(meta.id)) ||
            messages.find((x) => x.role === 'user')?.text.slice(0, 140) ||
            meta.id,
          project: meta.cwd ?? '',
          originProject: projectFor(catalog, thread, meta.cwd),
          version: meta.cli_version ?? 'unknown',
          updatedAt: thread
            ? new Date(thread.updated_at_ms ?? thread.updated_at * 1000).toISOString()
            : (await fs.stat(file)).mtime.toISOString(),
          bytes: (raw?.bytes ?? 0) + (summary?.bytes ?? 0),
          fileBytes: raw?.bytes ?? 0,
          historyBytes: raw?.historyBytes ?? 0,
          compressed: file?.endsWith('.zst') ?? false,
          databaseBytes: summary?.bytes ?? 0,
          archived: thread ? !!thread.archived : (file?.includes('/archived_sessions/') ?? false),
          issues: [
            ...(issue ? [issue] : []),
            ...(!file && !summary?.count ? ['history_unavailable'] : []),
          ],
          busy: summary?.busy ?? parsed?.busy ?? false,
          messages: filtered,
          turnCount: summary?.turnCount ?? null,
          totalMessages: summary?.count ?? messages.length,
        };
        // Legacy callers use the raw fingerprint; v2 includes both physical and database data.
        if (!thread && raw) row.hash = raw.hash;
        const old = seen.get(row.id);
        if (old) {
          if (old.hash === row.hash && old.physicalFiles?.includes(file)) return;
          if (old.hash === row.hash) {
            if (!old.homes.includes(home)) old.homes.push(home);
            old.physicalFiles = [
              ...new Set([
                ...(old.physicalFiles ?? [old.file].filter(Boolean)),
                ...(row.physicalFiles ?? [row.file].filter(Boolean)),
              ]),
            ];
            old.fileBytes += row.fileBytes;
            old.bytes += row.fileBytes;
            return;
          }
          old.issues.push('duplicate_identity');
          row.issues.push('duplicate_identity');
          errors.push({
            home,
            id: row.id,
            code: 'duplicate_identity',
            file: row.file,
            otherFile: old.file,
          });
        }
        rows.push(row);
        seen.set(row.id, row);
        requireThat(rows.length <= 20000, 'space_too_large');
      }
      for (const file of [...files].sort(
        (a, b) => Number(a.endsWith('.zst')) - Number(b.endsWith('.zst')),
      )) {
        try {
          let tid;
          const match = path.basename(file).match(/([0-9a-f-]{36})\.jsonl(?:\.zst)?$/i);
          if (match) tid = match[1];
          if (!tid) {
            for await (const r of records(file)) {
              tid = r.payload?.id;
              break;
            }
          }
          await add(indexed.get(tid), file);
        } catch (e) {
          errors.push({ file, code: e.code ?? 'invalid_history' });
        }
      }
      for (const thread of indexed.values()) if (!found.has(thread.id)) await add(thread, null);
    } catch (e) {
      errors.push({ home: configured, code: e.code ?? 'scan_failed' });
    } finally {
      catalog?.close();
    }
  }
  const byId = indexBy(rows, 'id');
  for (const row of rows) {
    row.parentTitle = byId.get(row.parent)?.title ?? null;
    if (row.kind === 'background')
      row.title = [row.agent || 'Agent', row.parentTitle || row.parent || row.id].join(' · ');
  }
  return { rows, errors, checkedAt: new Date().toISOString() };
}
