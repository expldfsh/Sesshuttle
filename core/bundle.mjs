import {
  referencesFor,
  inspectAttachment,
  attachmentIssue,
  attachmentUnchanged,
} from './attachments.mjs';
// v2 manifests reference authenticated, bounded chunks. History is never truncated.
import path from 'node:path';
import { createHash } from 'node:crypto';
import { hash, requireThat } from './util.mjs';
import { readBlocks, rolloutBlocks, CHUNK, writeStream } from './stream.mjs';
import { openCatalog, databaseRecords, encodeRecord } from './catalog.mjs';
export function relatedRows(row, rows, { includeDescendants = false } = {}) {
  const picked = new Map(),
    byId = new Map(rows.map((r) => [r.id, r]));
  const addAncestors = (r, trail = new Set()) => {
    requireThat(!trail.has(r.id), 'invalid_history');
    if (picked.has(r.id)) return;
    trail.add(r.id);
    for (const dep of r.dependencies ?? [r.parent].filter(Boolean))
      if (byId.has(dep)) addAncestors(byId.get(dep), new Set(trail));
    picked.set(r.id, r);
  };
  addAncestors(row);
  if (includeDescendants) {
    const queue = [row],
      visited = new Set();
    while (queue.length) {
      const r = queue.shift();
      if (visited.has(r.id)) continue;
      visited.add(r.id);
      for (const c of rows)
        if (c.parent === r.id) {
          addAncestors(c);
          queue.push(c);
        }
    }
  }
  return [...picked.values()];
}
export function validateBundle(p) {
  requireThat(
    p?.format === 2 && Array.isArray(p.files) && p.files.length > 0 && p.files.length <= 5000,
    'corrupt_data',
  );
  const ids = new Set();
  for (const f of p.files) {
    requireThat(
      /^[0-9a-f-]{36}$/i.test(f.id) && !ids.has(f.id) && Array.isArray(f.artifacts),
      'corrupt_data',
    );
    ids.add(f.id);
    const kinds = new Set();
    for (const a of f.artifacts) {
      requireThat(
        ['rollout', 'database', 'asset'].includes(a.kind) &&
          /^[0-9a-f]{64}$/.test(a.hash) &&
          Number.isSafeInteger(a.bytes) &&
          a.bytes >= 0 &&
          Array.isArray(a.chunks) &&
          a.chunks.length <= 100000,
        'corrupt_data',
      );
      if (a.kind !== 'asset') {
        requireThat(!kinds.has(a.kind), 'corrupt_data');
        kinds.add(a.kind);
      }
      let total = 0;
      for (const c of a.chunks) {
        requireThat(
          /^[0-9a-f]{64}$/.test(c.hash) &&
            Number.isInteger(c.bytes) &&
            c.bytes > 0 &&
            c.bytes <= CHUNK,
          'corrupt_data',
        );
        total += c.bytes;
      }
      requireThat(total === a.bytes, 'corrupt_data');
    }
    requireThat(kinds.has('rollout') || kinds.has('database'), 'corrupt_data');
  }
  requireThat(ids.has(p.logicalId), 'corrupt_data');
  requireThat(Buffer.byteLength(JSON.stringify(p)) <= 32 * 1024 * 1024, 'space_too_large');
  return p;
}
export function bundleBytes(p) {
  return p.files.reduce((n, f) => n + f.artifacts.reduce((n, a) => n + a.bytes, 0), 0);
}
export function bundleIdentity(p) {
  return hash(
    JSON.stringify({
      title: p.title,
      archived: p.archived,
      originProject: p.originProject,
      files: p.files
        .map((f) => ({
          id: f.id,
          title: f.title,
          archived: f.archived,
          issues: f.issues ?? [],
          attachmentStatus: (f.attachmentReport ?? [])
            .map((a) => [a.path, a.status])
            .sort((a, b) => a[0].localeCompare(b[0])),
          artifacts: f.artifacts.map((a) => [a.kind, a.hash, a.path ?? null]),
        }))
        .sort((a, b) => a.id.localeCompare(b.id)),
    }),
  );
}
export async function packStream(source, kind, vault, stage, extra = {}) {
  const digest = createHash('sha256');
  const chunks = [];
  let total = 0,
    pending = Buffer.alloc(0);
  async function put(b) {
    digest.update(b);
    total += b.length;
    const c = { hash: hash(b), bytes: b.length };
    chunks.push(c);
    await vault.stageChunk(c.hash, b, stage);
  }
  for await (const b of source) {
    let offset = 0;
    if (pending.length) {
      const n = Math.min(CHUNK - pending.length, b.length);
      pending = Buffer.concat([pending, b.subarray(0, n)]);
      offset = n;
      if (pending.length === CHUNK) {
        await put(pending);
        pending = Buffer.alloc(0);
      }
    }
    while (offset + CHUNK <= b.length) {
      await put(b.subarray(offset, offset + CHUNK));
      offset += CHUNK;
    }
    if (offset < b.length) pending = Buffer.from(b.subarray(offset));
  }
  if (pending.length) await put(pending);
  return { kind, ...extra, bytes: total, hash: digest.digest('hex'), chunks };
}
export async function captureBundle(row, rows, vault, stage, options = {}) {
  const selected = relatedRows(row, rows, options),
    catalogs = new Map(),
    files = [];
  try {
    for (const r of selected) {
      requireThat(!r.busy, 'busy');
      requireThat(!r.issues.includes('duplicate_identity'), 'duplicate_identity', r.id);
      requireThat(
        !r.issues.some((x) => ['invalid_history', 'history_unavailable'].includes(x)),
        'incomplete_history',
      );
      const artifacts = [];
      if (r.file) {
        const a = await packStream(rolloutBlocks(r.file), 'rollout', vault, stage);
        requireThat(a.hash === r.rawHash || a.hash === r.hash, 'stale_plan');
        artifacts.push(a);
      }
      if (r.database) {
        if (!catalogs.has(r.home)) catalogs.set(r.home, await openCatalog(r.home));
        const catalog = catalogs.get(r.home);
        async function* data() {
          for (const record of databaseRecords(catalog, r.id)) yield encodeRecord(record);
        }
        const a = await packStream(data(), 'database', vault, stage);
        requireThat(a.hash === r.dbHash, 'stale_plan');
        artifacts.push(a);
      }
      // Read only explicit attachment fields, never arbitrary paths in message text.
      const found = await referencesFor(r, catalogs.get(r.home));
      const issues = [...r.issues, ...found.issues],
        attachmentReport = [];
      if (
        (r.dependencies ?? [r.parent].filter(Boolean)).some(
          (dep) => !rows.some((x) => x.id === dep && x.file),
        )
      )
        issues.push('missing_dependency');
      for (const resource of found.resources) {
        const replacement = options.replacements?.[hash(r.id + '\0' + resource)];
        const report = await inspectAttachment(
          r,
          resource,
          options.approvedAttachments ?? [],
          replacement,
        );
        if (replacement) requireThat(report.status === 'included', 'replacement_invalid');
        attachmentReport.push(report);
        if (report.status === 'included') {
          requireThat(await attachmentUnchanged(report), 'stale_plan');
          const a = await packStream(readBlocks(report.resolved), 'asset', vault, stage, {
            path: resource,
          });
          requireThat(await attachmentUnchanged(report), 'stale_plan');
          artifacts.push(a);
          report.hash = a.hash;
        } else issues.push(attachmentIssue(report.status));
      }
      files.push({
        id: r.id,
        title: r.title,
        source: r.source,
        kind: r.kind,
        parent: r.parent,
        historyBase: r.historyBase,
        dependencies: r.dependencies,
        agent: r.agent,
        continuation: !!r.file,
        turnCount: r.turnCount,
        version: r.version,
        archived: r.archived,
        fingerprint: r.hash,
        project: r.project,
        originProject: r.originProject,
        attachmentReport,
        omittedAttachments: found.omittedAttachments,
        artifacts,
        issues: [...new Set(issues)],
      });
    }
    return validateBundle({
      format: 2,
      logicalId: row.id,
      title: row.title,
      source: row.source,
      kind: row.kind,
      parent: row.parent,
      agent: row.agent,
      continuation: !!row.file,
      messages: row.messages,
      project: row.project,
      originProject: row.originProject,
      updatedAt: row.updatedAt,
      archived: row.archived,
      files,
      issues: [...new Set(files.flatMap((f) => f.issues))],
    });
  } finally {
    for (const c of catalogs.values()) c.close();
  }
}
// Up to four chunks are fetched ahead while earlier ones are written, in order.
const PREFETCH = 4;
async function* artifactData(a, vault) {
  const digest = createHash('sha256');
  const pending = [];
  let bytes = 0,
    next = 0;
  const fetchNext = () => {
    const chunk = a.chunks[next++];
    const read = vault.readChunk(chunk.hash).then((data) => ({ chunk, data }));
    // Handled when awaited below; this keeps an early failure from going unobserved.
    read.catch(() => {});
    pending.push(read);
  };
  while (pending.length < PREFETCH && next < a.chunks.length) fetchNext();
  try {
    while (pending.length) {
      const { chunk, data } = await pending.shift();
      if (next < a.chunks.length) fetchNext();
      requireThat(data.length === chunk.bytes, 'corrupt_data');
      digest.update(data);
      bytes += data.length;
      yield data;
    }
  } finally {
    // A consumer that stops early still lets chunks already requested settle.
    await Promise.allSettled(pending);
  }
  requireThat(bytes === a.bytes && digest.digest('hex') === a.hash, 'corrupt_data');
}
export async function materialize(p, vault, root) {
  validateBundle(p);
  const files = [];
  for (const f of p.files) {
    const artifacts = [];
    for (const a of f.artifacts) {
      const file = path.join(root, f.id, a.kind + '-' + a.hash);
      await writeStream(file, artifactData(a, vault));
      artifacts.push({ ...a, file });
    }
    files.push({ ...f, artifacts });
  }
  return { ...p, files };
}
