import { assertAttachmentAcceptance, omittedImageText } from './attachment-policy.mjs';
import path from 'node:path';
import { records, recordLines, writeStream } from './stream.mjs';
import { requireThat } from './util.mjs';
// Original encrypted artifacts are immutable. Only target copies are remapped.
// Pagination stores byte offsets, so changing a path also requires translating
// offsets (including a fork's boundary in its source rollout).
export async function remapHistory(files, home, { acceptedMissingAttachments = [] } = {}) {
  const omissions = new Map();
  for (const f of files) {
    const optional = assertAttachmentAcceptance(
      { format: 2, files: [f], issues: f.issues ?? [] },
      acceptedMissingAttachments,
    );
    omissions.set(f.id, new Map(optional.map((a) => [a.path, a])));
  }
  const replacements = new Map(),
    byId = new Map(files.map((f) => [f.id, f])),
    headers = new Map(),
    maps = new Map();
  for (const f of files) {
    for (const a of f.artifacts.filter((a) => a.kind === 'asset')) {
      const dest = path.join(home, 'sesshuttle_assets', a.hash);
      requireThat(!replacements.has(a.path) || replacements.get(a.path) === dest, 'corrupt_data');
      replacements.set(a.path, dest);
    }
    const rollout = f.artifacts.find((a) => a.kind === 'rollout');
    if (rollout)
      for await (const r of records(rollout.file)) {
        requireThat(r.type === 'session_meta' && r.payload?.id === f.id, 'invalid_history');
        headers.set(f.id, r.payload);
        f.sourceProvider = r.payload.model_provider;
        break;
      }
    if (rollout) requireThat(headers.has(f.id), 'invalid_history');
  }
  function change(v, tid) {
    let changed = false;
    if (!v || typeof v !== 'object') return false;
    if (['localImage', 'local_image'].includes(v.type) && omissions.get(tid)?.has(v.path)) {
      const a = omissions.get(tid).get(v.path);
      for (const k of Object.keys(v)) delete v[k];
      Object.assign(v, { type: 'text', text: omittedImageText(a), text_elements: [] });
      return true;
    }
    if (['localImage', 'local_image'].includes(v.type))
      requireThat(replacements.has(v.path), 'incomplete_history');
    if (
      ['localImage', 'local_image'].includes(v.type) &&
      replacements.has(v.path) &&
      v.path !== replacements.get(v.path)
    ) {
      v.path = replacements.get(v.path);
      changed = true;
    }
    for (const x of Object.values(v))
      if (typeof x === 'object') changed = change(x, tid) || changed;
    return changed;
  }
  const ordered = [],
    done = new Set();
  function visit(f, trail = new Set()) {
    if (done.has(f.id)) return;
    requireThat(!trail.has(f.id), 'invalid_history');
    trail.add(f.id);
    const base = headers.get(f.id)?.history_base?.thread_id;
    if (base) {
      requireThat(byId.has(base) && headers.has(base), 'missing_dependency');
      visit(byId.get(base), new Set(trail));
    }
    done.add(f.id);
    ordered.push(f);
  }
  for (const f of files) visit(f);
  const mappedOffset = (tid, n) => {
    if (n === null || n === undefined) return n;
    const m = maps.get(tid);
    requireThat(m?.has(n), 'history_offsets');
    return m.get(n);
  };
  for (const f of ordered) {
    const rollout = f.artifacts.find((a) => a.kind === 'rollout');
    if (!rollout) continue;
    const offsets = new Map([[0, 0]]);
    maps.set(f.id, offsets);
    let written = 0,
      modified = false;
    async function* mapped() {
      for await (const line of recordLines(rollout.file)) {
        let raw = line.raw,
          changed = false;
        if (raw.length) {
          const r = JSON.parse(raw.toString('utf8'));
          changed = change(r, f.id);
          if (r.type === 'session_meta' && r.payload?.history_base?.end_byte_offset != null) {
            const b = r.payload.history_base,
              value = mappedOffset(b.thread_id, b.end_byte_offset);
            if (b.end_byte_offset !== value) {
              b.end_byte_offset = value;
              changed = true;
            }
          }
          if (changed) raw = Buffer.from(JSON.stringify(r));
        }
        modified ||= changed;
        offsets.set(line.start, written);
        written += raw.length + 1;
        offsets.set(line.end, written);
        yield raw;
        yield Buffer.from('\n');
      }
    }
    const output = rollout.file + '.mapped';
    await writeStream(output, mapped());
    if (modified) {
      rollout.file = output;
      rollout.remapped = true;
    }
  }
  for (const f of ordered) {
    const db = f.artifacts.find((a) => a.kind === 'database');
    if (!db) continue;
    async function* mapped() {
      for await (const r of records(db.file)) {
        if (r.table === 'threads' && typeof r.row?.model_provider === 'string')
          f.sourceProvider = r.row.model_provider;
        if (typeof r.row?.item_json === 'string') {
          const item = JSON.parse(r.row.item_json);
          if (change(item, f.id)) r.row.item_json = JSON.stringify(item);
        }
        if (maps.has(f.id)) {
          const keys =
            r.table === 'thread_turns'
              ? ['rollout_byte_offset', 'rollout_end_byte_offset']
              : r.table === 'thread_history_projection_state'
                ? ['next_rollout_byte_offset']
                : [];
          for (const k of keys) if (r.row[k] != null) r.row[k] = mappedOffset(f.id, r.row[k]);
        }
        yield Buffer.from(JSON.stringify(r) + '\n');
      }
    }
    const output = db.file + '.mapped';
    await writeStream(output, mapped());
    db.file = output;
  }
  return ordered;
}
