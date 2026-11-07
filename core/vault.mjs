import { mapLimit } from './concurrency.mjs';
import { ensureFreeSpace } from './guards.mjs';
import { readSpace, withSpaceWriter } from './space-writer.mjs';
import { attachmentReview, inheritedOmissions } from './attachment-policy.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { atomic, exists } from './util.mjs';
import { validateBundle, bundleIdentity, bundleBytes } from './bundle.mjs';
import { seal, unseal, parseKey } from './crypto.mjs';
import { hash, requireThat, Fault, id } from './util.mjs';
const HEAD_READS = 8;
const CHUNK_TRANSFERS = 4;
export class Vault {
  constructor(store, space, key, { installation = id(), deviceName = '' } = {}) {
    this.installation = installation;
    this.deviceName = deviceName;
    requireThat(/^[0-9a-f-]{36}$/i.test(space), 'invalid_space');
    parseKey(key);
    this.store = store;
    this.space = space;
    this.key = key;
    this.prefix = 'sesshuttle/v1/' + space + '/';
  }
  async put(key, body, etag) {
    if (this.writeBudget) {
      requireThat(body.length <= this.writeBudget.remaining, 'upload_limit');
      this.writeBudget.remaining -= body.length;
    }
    const result = await this.store.put(key, body, etag);
    this.onBytes?.(body.length);
    return result;
  }
  async stageChunk(digest, data, stage) {
    const object = 'blobs/' + digest;
    const file = path.join(stage, digest);
    this.staged ??= new Map();
    if (this.staged.has(digest) && (await exists(this.staged.get(digest)))) return;
    const sealed = seal({ data: data.toString('base64') }, this.key, this.space, object);
    await ensureFreeSpace(stage, sealed.length);
    await atomic(file, sealed);
    this.staged.set(digest, file);
  }
  async readForImport(digest, cacheDir) {
    const staged = this.staged?.get(digest);
    if (!staged) return this.readChunk(digest, cacheDir);
    const body = await fs.readFile(staged);
    const plain = Buffer.from(unseal(body, this.key, this.space, 'blobs/' + digest).data, 'base64');
    requireThat(hash(plain) === digest, 'corrupt_data');
    return plain;
  }
  async readChunk(digest, cacheDir) {
    requireThat(/^[0-9a-f]{64}$/.test(digest), 'corrupt_data');
    const object = 'blobs/' + digest,
      file = cacheDir && path.join(cacheDir, digest);
    const decode = (body) => {
      const value = unseal(body, this.key, this.space, object);
      requireThat(typeof value.data === 'string', 'corrupt_data');
      const bytes = Buffer.from(value.data, 'base64');
      requireThat(bytes.length <= 4 * 1024 * 1024 && hash(bytes) === digest, 'corrupt_data');
      return bytes;
    };
    if (file) {
      try {
        return decode(await fs.readFile(file));
      } catch (e) {
        if (!['ENOENT', 'corrupt_data', 'decrypt_failed'].includes(e.code)) throw e;
      }
    }
    const remote = await this.store.get(this.prefix + object);
    requireThat(remote, 'missing_remote_object');
    const bytes = decode(remote.body);
    if (file) {
      await ensureFreeSpace(cacheDir, remote.body.length);
      await atomic(file, remote.body);
    }
    return bytes;
  }
  async inventory() {
    const objects = await this.store.inventory(this.prefix);
    return {
      objects: new Map(objects.map((x) => [x.key, x.bytes])),
      bytes: objects.reduce((n, x) => n + x.bytes, 0),
    };
  }
  async estimate(payloads, inventory) {
    const unique = new Set();
    let bytes = 0;
    for (const p of payloads)
      for (const f of p.files)
        for (const a of f.artifacts)
          for (const c of a.chunks) {
            if (unique.has(c.hash) || inventory.objects.has(this.prefix + 'blobs/' + c.hash))
              continue;
            unique.add(c.hash);
            const file = this.staged?.get(c.hash);
            requireThat(file, 'stale_plan');
            bytes += (await fs.stat(file)).size;
          }
    return { bytes, objects: unique.size };
  }
  // A transfer job lists the space once and keeps that listing current as it
  // uploads. It lists again when another device finished a cloud removal in
  // between, since that removal may have deleted chunks the old listing shows.
  beginTransfer(uploadBytes) {
    this.writeBudget = { remaining: uploadBytes };
    this.transfer = { inventory: null, removals: null };
  }
  endTransfer() {
    this.writeBudget = null;
    this.onBytes = null;
    this.transfer = null;
  }
  async spaceInventory(marker) {
    if (!this.transfer) return this.inventory();
    const removals = JSON.stringify(marker?.completed ?? []);
    if (!this.transfer.inventory || this.transfer.removals !== removals) {
      this.transfer.inventory = await this.inventory();
      this.transfer.removals = removals;
    }
    return this.transfer.inventory;
  }
  // Chunks go up four at a time; the write budget and byte count are updated
  // synchronously around each request, so both stay exact.
  async uploadChunks(payload, marker) {
    const inventory = await this.spaceInventory(marker);
    const missing = new Map();
    for (const f of payload.files)
      for (const a of f.artifacts)
        for (const c of a.chunks) {
          const key = this.prefix + 'blobs/' + c.hash;
          if (!inventory.objects.has(key) && !missing.has(key)) missing.set(key, c);
        }
    await mapLimit(missing, CHUNK_TRANSFERS, async ([key, c]) => {
      const file = this.staged?.get(c.hash);
      requireThat(file, 'stale_plan');
      const body = await fs.readFile(file);
      const plain = Buffer.from(
        unseal(body, this.key, this.space, 'blobs/' + c.hash).data,
        'base64',
      );
      requireThat(hash(plain) === c.hash && plain.length === c.bytes, 'corrupt_data');
      try {
        await this.put(key, body, null);
      } catch (e) {
        if (e.code !== 'concurrent_update') throw e;
      }
      inventory.objects.set(key, body.length);
    });
  }
  async create() {
    await this.put(
      this.prefix + 'space',
      seal(
        { format: 1, space: this.space, createdAt: new Date().toISOString() },
        this.key,
        this.space,
        'space',
      ),
      null,
    );
    return this.open();
  }
  async open() {
    return (await readSpace(this)).value;
  }
  async allHeads({ allowPending = true } = {}) {
    const marker = await this.open();
    requireThat(allowPending || !marker.pending, 'cloud_cleanup_pending');
    const prefix = this.prefix + 'heads/';
    const keys = await this.store.list(prefix);
    // Heads are independent objects; read eight at a time and keep the listing order.
    const heads = await mapLimit(keys, HEAD_READS, (key) => this.rawHead(key.slice(prefix.length)));
    return heads.filter(Boolean);
  }
  async heads() {
    const all = await this.allHeads({ allowPending: false });
    this.removedIds = new Set(all.filter((h) => !h.tips.length).map((h) => h.logicalId));
    return all.filter((h) => h.tips.length).map(({ trash, lastRemoval, ...visible }) => visible);
  }
  async head(logical) {
    const h = await this.rawHead(logical);
    if (!h?.tips.length) return null;
    const { trash, lastRemoval, ...visible } = h;
    return visible;
  }
  async rawHead(logical) {
    requireThat(/^[0-9a-f-]{36}$/i.test(logical), 'corrupt_data');
    const key = 'heads/' + logical;
    const r = await this.store.get(this.prefix + key);
    if (!r) return null;
    const h = unseal(r.body, this.key, this.space, key);
    requireThat(
      h.logicalId === logical && Array.isArray(h.tips) && Array.isArray(h.versions),
      'corrupt_data',
    );
    return { ...h, etag: r.etag };
  }
  async version(version, { legacy = false } = {}) {
    requireThat(/^[0-9a-f]{64}$/.test(version), 'corrupt_data');
    const key = 'versions/' + version;
    const r = await this.store.get(this.prefix + key);
    requireThat(r, 'missing_remote_object');
    const payload = unseal(r.body, this.key, this.space, key);
    requireThat(hash(JSON.stringify(payload)) === version, 'corrupt_data');
    // Early release candidates wrote another manifest format. It stays opaque: only removal reads it.
    if (payload?.format !== 2) {
      requireThat(legacy, 'legacy_format_unsupported');
      return { legacy: true, manifest: payload, objectBytes: r.body.length };
    }
    return validateBundle(payload);
  }
  async choose(logical, version, expectedEtag) {
    return withSpaceWriter(this, async () => {
      const head = await this.rawHead(logical);
      requireThat(
        head?.versions.some((x) => x.id === version),
        'invalid_selection',
      );
      requireThat(head.etag === expectedEtag, 'concurrent_update');
      const next = { ...head, tips: [version], resolvedAt: new Date().toISOString() };
      delete next.etag;
      await this.put(
        this.prefix + 'heads/' + logical,
        seal(next, this.key, this.space, 'heads/' + logical),
        head.etag,
      );
      return next;
    });
  }
  async publish(payload, device, expected) {
    return withSpaceWriter(this, async (guard) => {
      if (expected !== undefined)
        requireThat(
          ((await this.head(payload.logicalId))?.etag ?? null) === expected,
          'stale_plan',
        );
      return this.publishLocked(payload, device, guard.state());
    });
  }
  async publishLocked(payload, device, marker) {
    validateBundle(payload);
    for (let attempt = 0; attempt < 4; attempt++) {
      const head = await this.rawHead(payload.logicalId);
      const tips = head?.tips ?? [];
      const parents = [],
        remaining = [];
      for (const tip of tips) {
        const old = await this.version(tip, { legacy: true });
        const r =
          !old.legacy && bundleIdentity(payload) === bundleIdentity(old)
            ? 'synced'
            : payload.baseVersion === tip
              ? 'local_changes'
              : 'conflict';
        if (r === 'synced') return { version: tip, head, unchanged: true };
        if (r === 'local_changes') parents.push(tip);
        else remaining.push(tip);
      }
      await this.uploadChunks(payload, marker);
      const versionPayload = { ...payload, parents, device, uploadedAt: new Date().toISOString() };
      const version = hash(JSON.stringify(versionPayload));
      const object = 'versions/' + version;
      try {
        await this.put(
          this.prefix + object,
          seal(versionPayload, this.key, this.space, object),
          null,
        );
      } catch (e) {
        if (e.code !== 'concurrent_update') throw e;
      }
      const check = await this.version(version);
      requireThat(check.logicalId === payload.logicalId, 'corrupt_data');
      const next = {
        ...(head?.trash?.length ? { trash: head.trash } : {}),
        format: 1,
        logicalId: payload.logicalId,
        title: payload.title,
        source: payload.source,
        project: payload.project,
        originProject: payload.originProject,
        projectId: payload.projectId,
        updatedAt: payload.updatedAt,
        device,
        tips: [...remaining, version],
        versions: [
          ...(head?.versions ?? []),
          { id: version, parents, device, at: versionPayload.uploadedAt },
        ],
        omittedImageCount:
          attachmentReview(payload).optional.length + inheritedOmissions(payload).length,
        bytes: bundleBytes(payload),
        continuation: payload.continuation,
        messages: payload.messages,
        kind: payload.kind,
        parent: payload.parent,
        agent: payload.agent,
        archived: payload.archived,
        issues: payload.issues,
      };
      try {
        const etag = await this.put(
          this.prefix + 'heads/' + payload.logicalId,
          seal(next, this.key, this.space, 'heads/' + payload.logicalId),
          head?.etag ?? null,
        );
        return { version, head: { ...next, etag }, conflict: remaining.length > 0 };
      } catch (e) {
        if (e.code !== 'concurrent_update') throw e;
      }
    }
    throw new Fault('concurrent_update');
  }
}
