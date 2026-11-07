import { copiesOf, copyToken, uploadSource } from './local-copies.mjs';
import { repairDownload } from './attachment-repair.mjs';
import { attachmentReview, assertAttachmentAcceptance } from './attachment-policy.mjs';
import { attachmentUnchanged, inspectAttachment } from './attachments.mjs';
import { captureBundle, relatedRows, bundleBytes, bundleIdentity } from './bundle.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { scan } from './codex.mjs';
import { Importer } from './importer.mjs';
import { id, hash, requireThat, publicError, canonical, indexBy } from './util.mjs';
const UPLOAD_ACTIONS = ['upload', 'upload_import', 'preserve_conflict'];
const ATTENTION = [
  'excluded',
  'failed',
  'partial',
  'conflict',
  'busy',
  'blocked',
  'conflict_preserved',
];
async function verifyAttachments(payload, rows, approved) {
  for (const f of payload.files)
    for (const a of f.attachmentReport ?? []) {
      if (a.status === 'included') requireThat(await attachmentUnchanged(a), 'stale_plan');
      if (['missing', 'approval_required', 'unreadable_image'].includes(a.status)) {
        const row = rows.find((r) => r.id === f.id);
        requireThat(row, 'stale_plan');
        const now = await inspectAttachment(row, a.path, approved);
        requireThat(
          now.status === a.status && now.stamp === a.stamp && now.resolved === a.resolved,
          'stale_plan',
        );
      }
    }
}
export class Engine {
  constructor(state, { vault = null, importer = null, onProgress = () => {} } = {}) {
    this.state = state;
    this.vault = vault;
    this.importer = importer ?? new Importer(state);
    this.onProgress = onProgress;
    this.plans = new Map();
    this.downloads = new Map();
    this.cancelled = false;
    this.running = false;
    this.local = { rows: [], errors: [] };
    this.remote = [];
    this.cloudError = null;
  }
  config() {
    return this.state.get('config', {
      language: 'zh-CN',
      sourceHomes: [path.join(os.homedir(), '.codex')],
      targets: {},
      bindings: {},
    });
  }
  scope() {
    return this.vault?.space ?? 'offline';
  }
  association(row) {
    const key = 'association/' + row.id;
    let x = this.state.get(key);
    if (!x) {
      const pkey =
        'project/' + hash(row.home + '\0' + (row.originProject?.nativeId ?? row.project));
      let projectId = this.state.get(pkey);
      if (!projectId) projectId = this.state.set(pkey, id());
      x = this.state.set(key, { projectId, source: row.source });
    }
    if (!x.importedOrigin && (row.originProject?.nativeId || !x.originProject))
      x = this.state.set(key, { ...x, originProject: row.originProject });
    return x;
  }
  signature(row, selection = {}) {
    return hash(
      JSON.stringify(
        relatedRows(row, this.local.rows, selection)
          .map((r) => [r.id, r.hash, r.title, r.archived, r.originProject])
          .sort((a, b) => a[0].localeCompare(b[0])),
      ),
    );
  }
  baselineKey(row) {
    return 'baseline/' + this.scope() + '/' + hash(row.home) + '/' + row.id;
  }
  rememberBaseline(row, version, selection = {}) {
    this.state.set(this.baselineKey(row), {
      signature: this.signature(row, selection),
      version,
      selection,
    });
  }
  async snapshot(row, stage, selection = {}) {
    const p = await captureBundle(row, this.local.rows, this.vault, stage, selection);
    const association = this.association(row);
    const base = this.state.get(this.baselineKey(row));
    return {
      ...p,
      originProject: association.originProject ?? p.originProject,
      baseVersion: base?.version ?? null,
      projectId: association.projectId,
    };
  }
  async downloadFolder(logicalId, version) {
    const cacheKey = [this.scope(), logicalId, version].join('/');
    let dir = this.downloads.get(cacheKey);
    if (!dir) {
      dir = path.join(this.state.root, 'downloads', id());
      await fs.mkdir(dir, { recursive: true, mode: 0o700 });
      this.downloads.set(cacheKey, dir);
    }
    return { cacheKey, dir };
  }
  async clearDownloads(keys = [...this.downloads.keys()]) {
    for (const k of keys) {
      const dir = this.downloads.get(k);
      if (!dir) continue;
      await fs.rm(dir, { recursive: true, force: true });
      this.downloads.delete(k);
    }
  }
  async refresh() {
    requireThat(!this.running, 'task_running');
    this.local = await scan(this.config().sourceHomes);
    this.cloudError = null;
    if (this.vault) {
      try {
        this.remote = await this.vault.heads();
        this.state.set('cache/' + this.scope(), {
          heads: this.remote,
          checkedAt: new Date().toISOString(),
        });
      } catch (e) {
        this.cloudError = publicError(e);
        this.remote = this.state.get('cache/' + this.scope(), { heads: [] }).heads;
      }
    } else this.remote = [];
    const rows = [],
      locals = indexBy(this.local.rows, 'id'),
      heads = indexBy(this.remote, 'logicalId');
    for (const logical of new Set([...locals.keys(), ...heads.keys()]))
      rows.push(this.buildRow(locals.get(logical), heads.get(logical)));
    this.rows = rows.sort((a, b) =>
      (b.updatedAt ?? b.cloudUpdatedAt ?? '').localeCompare(a.updatedAt ?? a.cloudUpdatedAt ?? ''),
    );
    return {
      rows: this.rows,
      errors: this.local.errors,
      cloudError: this.cloudError,
      checkedAt: this.local.checkedAt,
      remoteCheckedAt: this.state.get('cache/' + this.scope())?.checkedAt,
    };
  }
  // One conversation as the list shows it, from its local scan row and cloud head.
  buildRow(local, head) {
    const logical = local?.id ?? head.logicalId;
    let status = local ? (head ? 'unchecked' : 'local_only') : 'remote_only';
    const cloudRemoved = !!(
      local &&
      !head &&
      this.vault &&
      !this.cloudError &&
      this.vault.removedIds?.has(logical)
    );
    if (head?.tips.length > 1) status = 'conflict';
    else if (local && head && !this.cloudError) {
      const base = this.state.get(this.baselineKey(local));
      status = base
        ? base.signature === this.signature(local, base.selection)
          ? head.tips.includes(base.version)
            ? 'synced'
            : 'remote_changes'
          : head.tips.includes(base.version)
            ? 'local_changes'
            : 'conflict'
        : 'conflict';
    }
    const association = local
      ? this.association(local)
      : { projectId: head?.projectId, originProject: head?.originProject };
    const copies = local?.issues.includes('duplicate_identity')
      ? copiesOf(this.local.rows, logical)
      : [];
    return {
      copies,
      copyToken: copies.length ? copyToken(copies) : null,
      id: logical,
      title: local?.title ?? head.title,
      source: local ? local.source : head.source,
      project: local?.project ?? head.project,
      originProject: association.originProject ?? local?.originProject ?? head?.originProject,
      projectId: association.projectId,
      continuation: local?.continuation ?? head?.continuation ?? true,
      kind: local?.kind ?? head?.kind ?? (head?.source === 'subagent' ? 'background' : 'main'),
      parent: local?.parent ?? head?.parent,
      parentTitle: local?.parentTitle,
      agent: local?.agent ?? head?.agent,
      compressed: local?.compressed,
      historyBytes: local?.historyBytes,
      fileBytes: local?.fileBytes,
      databaseBytes: local?.databaseBytes,
      updatedAt: local?.updatedAt,
      cloudUpdatedAt: head?.versions.at(-1)?.at,
      device: head?.device,
      bytes: local?.bytes ?? head.bytes,
      archived: local?.archived ?? head?.archived ?? false,
      issues: local?.issues ?? head?.issues ?? [],
      cloudOmittedImages: head?.omittedImageCount ?? 0,
      status,
      busy: !!local?.busy,
      cloudRemoved,
      local: !!local,
      remote: !!head,
      version: local?.version,
      messages: local?.messages ?? head?.messages ?? [],
      totalMessages: local?.totalMessages ?? 0,
      versions: head?.versions ?? [],
      tips: head?.tips ?? [],
      targets: Object.fromEntries(
        Object.entries(this.state.get('entries/' + this.scope() + '/' + logical, {})).map(
          ([entry, value]) => [
            entry,
            {
              ...value,
              syncStatus: head
                ? head.tips.includes(value.version)
                  ? 'synced'
                  : 'remote_changes'
                : 'local_only',
            },
          ],
        ),
      ),
    };
  }
  async preview({
    ids,
    direction,
    targets,
    allowIncomplete = false,
    chosenVersion = null,
    uploadLimitMiB = 500,
    includeDescendants = false,
    approvedAttachments = [],
    replacements = {},
    copyChoice = null,
  }) {
    requireThat(!this.running, 'task_running');
    requireThat(this.vault, 'storage_not_connected');
    requireThat(!this.cloudError, 'cloud_check_failed');
    const rowsById = indexBy(this.rows ?? [], 'id'),
      headsById = indexBy(this.remote, 'logicalId');
    requireThat(
      Array.isArray(ids) &&
        ids.length > 0 &&
        ids.length <= 2000 &&
        ids.every((x) => rowsById.has(x)),
      'invalid_selection',
    );
    requireThat(['upload', 'download', 'both'].includes(direction), 'invalid_selection');
    allowIncomplete = allowIncomplete && direction === 'upload' && !chosenVersion;
    requireThat(
      Array.isArray(targets) && targets.every((x) => ['desktop', 'cli', 'ide'].includes(x)),
      'invalid_selection',
    );
    requireThat(direction === 'upload' || targets.length > 0, 'target_required');
    requireThat(
      typeof includeDescendants === 'boolean' &&
        Array.isArray(approvedAttachments) &&
        approvedAttachments.length <= 10000 &&
        approvedAttachments.every((k) => /^[0-9a-f]{64}$/.test(k)),
      'invalid_selection',
    );
    requireThat(
      replacements &&
        typeof replacements === 'object' &&
        Object.entries(replacements).every(
          ([k, p]) => /^[0-9a-f]{64}$/.test(k) && typeof p === 'string' && path.isAbsolute(p),
        ),
      'invalid_selection',
    );
    requireThat(
      !copyChoice ||
        (direction === 'upload' &&
          ids.length === 1 &&
          !chosenVersion &&
          typeof copyChoice.file === 'string' &&
          typeof copyChoice.token === 'string'),
      'invalid_selection',
    );
    const selection = { includeDescendants, approvedAttachments, replacements };
    requireThat(
      Number.isFinite(uploadLimitMiB) && uploadLimitMiB >= 1 && uploadLimitMiB <= 1048576,
      'invalid_settings',
    );
    for (const old of this.plans.values())
      if (old.stage) await fs.rm(old.stage, { recursive: true, force: true });
    this.plans.clear();
    this.vault.staged = new Map();
    const token = id(),
      stage = path.join(this.state.root, 'staging', token);
    await fs.mkdir(stage, { recursive: true, mode: 0o700 });
    const targetSnapshots = {};
    if (direction !== 'upload' || chosenVersion)
      for (const entry of targets) {
        const t = this.config().targets[entry];
        if (!t?.home) continue;
        try {
          const home = await canonical(t.home);
          if (!targetSnapshots[home]) {
            const scanResult = await scan([home]);
            targetSnapshots[home] = {
              hashes: Object.fromEntries(scanResult.rows.map((r) => [r.id, r.hash])),
              errors: scanResult.errors.length,
            };
          }
        } catch {}
      }
    const items = [];
    for (const logical of [...new Set(ids)]) {
      const row = rowsById.get(logical),
        local = uploadSource(this.local.rows, logical, copyChoice),
        head = headsById.get(logical);
      let action = 'skip';
      if (row.busy && direction !== 'download') action = 'busy';
      else if (chosenVersion) {
        requireThat(
          head?.versions.some((x) => x.id === chosenVersion),
          'invalid_selection',
        );
        action = 'resolve';
      } else if (direction === 'upload' && local) action = 'upload';
      else if (direction === 'download' && head)
        action = head.tips.length > 1 ? 'conflict' : 'download';
      else if (direction === 'both') {
        if (['local_only', 'local_changes'].includes(row.status)) action = 'upload_import';
        else if (['remote_only', 'remote_changes', 'synced'].includes(row.status))
          action = 'download';
        else if (row.status === 'conflict') action = 'preserve_conflict';
      }
      let fileCount = 1,
        assetCount = 0,
        bytes = row.bytes,
        issues = row.issues,
        payload = null;
      try {
        payload = ['download', 'resolve'].includes(action)
          ? await this.vault.version(chosenVersion ?? head.tips[0])
          : !['skip', 'busy', 'conflict'].includes(action) && local
            ? await this.snapshot(local, stage, selection)
            : null;
        if (payload && ['download', 'resolve'].includes(action))
          payload = await repairDownload(payload, replacements, this.vault, stage);
        if (copyChoice && payload) payload.baseVersion = null;

        if (payload) {
          fileCount = payload.files.length;
          assetCount = payload.files.reduce(
            (n, f) => n + f.artifacts.filter((a) => a.kind === 'asset').length,
            0,
          );
          bytes = bundleBytes(payload);
          issues = payload.issues;
        }
      } catch (e) {
        issues = [...issues, e.code ?? 'operation_failed'];
        action = 'blocked';
      }

      // Ancestors of the local row, computed once per item and only when needed.
      let ancestors;
      const isAncestor = (fileId) =>
        (ancestors ??= new Set(
          local ? relatedRows(local, this.local.rows).map((r) => r.id) : [],
        )).has(fileId);
      const describe = (p, role) =>
        p?.files.map((f) => ({
          id: f.id,
          role,
          title: f.title,
          kind: f.kind ?? (f.source === 'subagent' ? 'background' : 'main'),
          parent: f.parent,
          originProject: f.originProject ?? p.originProject,
          bytes: f.artifacts.reduce((n, a) => n + a.bytes, 0),
          reason:
            role === 'preserve'
              ? 'preserveLocal'
              : ids.includes(f.id)
                ? 'selectedChat'
                : ['download', 'resolve'].includes(action)
                  ? 'backupMember'
                  : isAncestor(f.id)
                    ? 'requiredParent'
                    : 'selectedDescendant',
          attachments: (f.attachmentReport ?? []).map((a) => ({ ...a, role })),
          omittedAttachments: f.omittedAttachments ?? [],
          issues: f.issues ?? [],
          missingDependencies: (f.dependencies ?? []).filter(
            (dep) => !p.files.some((member) => member.id === dep),
          ),
        })) ?? [];
      const primaryReview = attachmentReview(payload);
      const blockingIssues = primaryReview.blockingIssues;
      const optional = [...primaryReview.optional.map((a) => ({ ...a, role: 'primary' }))];
      let excludedReason = null;
      if (action === 'blocked') excludedReason = issues.at(-1) ?? 'incomplete_history';
      else if (action === 'busy' || action === 'conflict') excludedReason = action;
      else if (action === 'skip')
        excludedReason = direction === 'upload' ? 'noLocalForUpload' : 'noBackupToImport';
      else if (blockingIssues.length) excludedReason = blockingIssues[0];
      else if (payload?.continuation === false && !(allowIncomplete && action === 'upload'))
        excludedReason = 'missing_rollout';
      items.push({
        id: logical,
        title: row.title,
        action,
        bytes,
        fileCount,
        assetCount,
        expectedHash: local?.hash ?? null,
        expectedSignature: local ? this.signature(local, selection) : null,
        expectedHead: head?.etag ?? null,
        excludedReason,
        attachmentReview: { optional, blockingIssues },
        version: chosenVersion ?? head?.tips[0] ?? null,
        issues,
        continuation: payload?.continuation ?? row.continuation,
        targets: ['download', 'resolve', 'upload_import'].includes(action) ? targets : [],
        projectId: row.projectId,
        originProject: row.originProject,
        files: describe(payload, 'primary'),
        payload,
      });
    }
    const uploads = items
      .filter((x) => !x.excludedReason)
      .filter(
        (x) => ['upload', 'upload_import', 'preserve_conflict'].includes(x.action) && x.payload,
      )
      .map((x) => x.payload);
    const inventory = uploads.length
      ? await this.vault.inventory()
      : { objects: new Map(), bytes: 0 };
    const estimated = await this.vault.estimate(uploads, inventory);
    // Reserve a conservative upper bound for encrypted manifests and replacement heads.
    // Chunks have their exact encrypted size; metadata reserve avoids a false exact quota promise.
    const metadataReserve = uploads.reduce(
      (n, p) =>
        n +
        4 * Buffer.byteLength(JSON.stringify(p)) +
        4 * Buffer.byteLength(JSON.stringify(headsById.get(p.logicalId) ?? {})) +
        65536,
      0,
    );
    const uploadBytes = estimated.bytes + metadataReserve,
      uploadLimitBytes = Math.floor(uploadLimitMiB * 1024 * 1024);
    const plan = {
      copyChoice,
      stage,
      targetSnapshots,
      token,
      ids: [...new Set(ids)],
      chosenVersion,
      selection,
      space: this.scope(),
      configHash: hash(JSON.stringify(this.config())),
      direction,
      targets,
      allowIncomplete,
      items,
      createdAt: new Date().toISOString(),
      cloudBytes: inventory.bytes,
      chunkUploadBytes: estimated.bytes,
      metadataReserve,
      uploadBytes,
      uploadLimitBytes,
      overLimit: uploadBytes > uploadLimitBytes,
      largeUpload:
        uploadBytes > 100 * 1024 * 1024 || uploads.some((p) => bundleBytes(p) > 100 * 1024 * 1024),
    };
    this.plans.set(token, plan);
    return { ...plan, stage: undefined, items: items.map(({ payload, ...x }) => x) };
  }
  async discardPlan(token) {
    const plan = this.plans.get(token);
    if (plan) {
      this.plans.delete(token);
      await fs.rm(plan.stage, { recursive: true, force: true });
    }
  }
  cancel() {
    this.cancelled = true;
  }
  async execute(
    token,
    {
      confirmLarge = false,
      acceptedMissingAttachments = [],
      acceptedByItem,
      onlyEligible = false,
    } = {},
  ) {
    const plan = this.plans.get(token);
    this.checkExecution(plan, {
      confirmLarge,
      acceptedMissingAttachments,
      acceptedByItem,
      onlyEligible,
    });
    this.plans.delete(token);
    this.running = true;
    this.cancelled = false;
    this.vault.beginTransfer(plan.uploadBytes);
    const job = {
      id: id(),
      total: plan.items.length,
      startedAt: new Date().toISOString(),
      status: 'running',
      items: [],
    };
    this.state.set('job/' + job.id, job);
    try {
      for (const item of plan.items) {
        if (this.cancelled) {
          job.status = 'paused';
          break;
        }
        const accepted =
          acceptedByItem === undefined
            ? acceptedMissingAttachments
            : (acceptedByItem[item.id]?.primary ?? []);
        await this.runItem(plan, job, item, accepted);
      }
      if (job.status === 'running')
        job.status = job.items.some((x) => ATTENTION.includes(x.status))
          ? 'attention'
          : 'completed';
    } finally {
      await this.finishJob(plan, job);
    }
    return job;
  }
  // Every confirmation the preview asked for is checked before anything is written.
  checkExecution(plan, { confirmLarge, acceptedMissingAttachments, acceptedByItem, onlyEligible }) {
    requireThat(
      plan &&
        plan.space === this.scope() &&
        plan.configHash === hash(JSON.stringify(this.config())),
      'stale_plan',
    );
    requireThat(!this.running, 'task_running');
    requireThat(!plan.overLimit, 'upload_limit');
    requireThat(!plan.largeUpload || confirmLarge, 'large_upload_confirmation');
    const executable = plan.items.filter((i) => !i.excludedReason);
    if (executable.length && executable.length < plan.items.length)
      requireThat(onlyEligible === true, 'partial_scope_confirmation');
    function validateKeys(keys, optional) {
      requireThat(
        Array.isArray(keys) &&
          keys.every((k) => typeof k === 'string' && optional.some((a) => a.key === k)),
        'invalid_selection',
      );
    }
    validateKeys(
      acceptedMissingAttachments,
      executable.flatMap((i) => i.attachmentReview.optional),
    );
    if (acceptedByItem === undefined) return;
    requireThat(
      acceptedByItem && typeof acceptedByItem === 'object' && !Array.isArray(acceptedByItem),
      'invalid_selection',
    );
    for (const [logical, roles] of Object.entries(acceptedByItem)) {
      const item = executable.find((i) => i.id === logical);
      requireThat(item && roles && typeof roles === 'object', 'invalid_selection');
      for (const [role, keys] of Object.entries(roles)) {
        requireThat(['primary', 'preserve'].includes(role), 'invalid_selection');
        validateKeys(
          keys,
          item.attachmentReview.optional.filter((a) => a.role === role),
        );
      }
    }
    for (const item of executable) {
      for (const attachment of item.attachmentReview.optional) {
        const keys = acceptedByItem[item.id]?.[attachment.role] ?? [];
        requireThat(keys.includes(attachment.key), 'attachment_confirmation_required');
      }
    }
  }
  async finishJob(plan, job) {
    this.vault.endTransfer();
    delete job.progress;
    await fs.rm(plan.stage, { recursive: true, force: true }).catch(() => {});
    this.running = false;
    job.finishedAt = new Date().toISOString();
    this.state.set('job/' + job.id, job);
    this.onProgress({ ...job });
  }
  // One plan item. Its result is saved and reported whatever happens.
  async runItem(plan, job, item, accepted) {
    const result = {
      id: item.id,
      title: item.title,
      action: item.action,
      status: 'running',
      targets: {},
    };
    job.items.push(result);
    const step = (stage) => {
      result.stage = stage;
      job.progress = {
        index: job.items.length,
        total: plan.items.length,
        title: item.title,
        stage,
        bytes: 0,
      };
      this.onProgress({ ...job });
    };
    step('stageCheck');
    let lastEvent = 0;
    const advance = (n) => {
      job.progress.bytes += n;
      if (Date.now() - lastEvent > 150) {
        lastEvent = Date.now();
        this.onProgress({ ...job });
      }
    };
    this.vault.onBytes = advance;
    try {
      if (item.excludedReason) {
        result.requestedDirection = plan.direction;
        result.status = 'excluded';
        result.error = { code: item.excludedReason };
        return;
      }
      const { current, local } = await this.recheck(plan, item);
      let payload = item.payload,
        importVersion = item.version;
      if (UPLOAD_ACTIONS.includes(item.action)) {
        const published = await this.uploadItem(plan, item, result, {
          rows: current.rows,
          local,
          accepted,
          step,
        });
        if (item.action !== 'upload_import' || published.conflict) {
          result.status = published.conflict ? 'conflict_preserved' : 'uploaded';
          return;
        }
        importVersion = published.version;
        payload = await this.vault.version(importVersion);
      } else {
        // The immutable version was authenticated at preview and head/etag rechecked above.
        for (const f of payload.files)
          for (const a of f.attachmentReport ?? [])
            if (a.replacementPath && plan.selection.replacements[a.key])
              requireThat(await attachmentUnchanged(a), 'stale_plan');
      }
      await this.importItem(plan, item, result, {
        payload,
        importVersion,
        accepted,
        step,
        advance,
      });
    } catch (e) {
      result.status = 'failed';
      result.error = publicError(e);
    } finally {
      this.state.set('job/' + job.id, job);
      this.onProgress({ ...job });
    }
  }
  // The local source and the cloud head must still be the ones the preview showed.
  async recheck(plan, item) {
    const current = await scan(this.config().sourceHomes);
    const local = uploadSource(current.rows, item.id, plan.copyChoice);
    requireThat((local?.hash ?? null) === item.expectedHash, 'stale_plan');
    const head = await this.vault.head(item.id);
    requireThat((head?.etag ?? null) === item.expectedHead, 'stale_plan');
    this.local = current;
    requireThat(
      !local?.issues.includes('duplicate_identity') || item.action === 'download',
      'duplicate_identity',
      item.id,
    );
    requireThat(
      (local ? this.signature(local, plan.selection) : null) === item.expectedSignature,
      'stale_plan',
    );
    return { current, local };
  }
  async uploadItem(plan, item, result, { rows, local, accepted, step }) {
    requireThat(local, 'stale_plan');
    const payload = item.payload;
    await verifyAttachments(payload, rows, plan.selection.approvedAttachments);
    assertAttachmentAcceptance(payload, accepted);
    step('stageUpload');
    const published = await this.vault.publish(
      payload,
      this.state.get('device'),
      item.expectedHead,
    );
    if (!plan.copyChoice) this.rememberBaseline(local, published.version, plan.selection);
    const locals = indexBy(this.local.rows, 'id');
    for (const f of payload.files.filter((f) => !plan.copyChoice || f.id !== item.id)) {
      const r = locals.get(f.id);
      if (r) {
        const k = 'bundle-receipt/' + hash(r.home) + '/' + r.id;
        this.state.set(k, { hash: r.hash, identity: bundleIdentity(payload) });
      }
    }
    result.cloudStatus = 'uploaded';
    result.unchangedCloud = !!published.unchanged;
    result.omittedImages = attachmentReview(payload).optional.length;
    return published;
  }
  // Imports one version into every chosen app and reports each app separately.
  async importItem(plan, item, result, { payload, importVersion, accepted, step, advance }) {
    assertAttachmentAcceptance(payload, accepted);
    requireThat(payload.continuation !== false, 'missing_rollout');
    const cfg = this.config(),
      projectId = payload.projectId ?? item.projectId,
      project = cfg.bindings?.[projectId];
    requireThat(project, 'project_required');
    const cache = await this.downloadFolder(item.id, importVersion);
    const groups = await this.targetGroups(cfg, item, result, {
      projectId,
      project,
      step,
      received: () => {
        result.historyReady = true;
      },
    });
    const replacing = Object.keys(plan.selection.replacements ?? {}).length > 0;
    const readChunk = async (digest) => {
      const chunk = replacing
        ? await this.vault.readForImport(digest, cache?.dir)
        : await this.vault.readChunk(digest, cache?.dir);
      advance(chunk.length);
      return chunk;
    };
    const context = { payload, plan, item, result, project, importVersion, accepted, step };
    for (const group of groups) await this.importGroup(group, { ...context, readChunk });
    await this.recordImport(item, result, payload, importVersion, cache);
  }
  // Apps that share one Codex data folder are written once and verified per runtime.
  async targetGroups(cfg, item, result, { projectId, project, step, received }) {
    const grouped = new Map();
    for (const entry of item.targets) {
      const target = cfg.targets[entry];
      if (!target?.home || !target?.binary) {
        result.targets[entry] = {
          status: 'not_configured',
          error: { code: target?.binary ? 'entry_home_missing' : 'entry_binary_missing' },
        };
        continue;
      }
      try {
        const identity = await this.importer.authorize(target.binary),
          nativeProjectId = cfg.nativeBindings?.[projectId]?.[target.home] ?? null;
        requireThat(!nativeProjectId || identity.projects, 'project_assignment_unsupported');
        const home = await canonical(target.home);
        const group = grouped.get(home) ?? [];
        group.push({
          entry,
          identity,
          target: {
            ...target,
            home,
            project,
            onStage: step,
            onMaterialized: received,
            nativeProjectId,
          },
        });
        grouped.set(home, group);
      } catch (e) {
        result.targets[entry] = {
          status: 'failed',
          stage: result.stage,
          error: publicError(e),
        };
      }
    }
    return [...grouped.values()];
  }
  async importGroup(group, context) {
    const { payload, plan, item, result, accepted, readChunk } = context;
    try {
      requireThat(
        new Set(group.map((g) => g.target.nativeProjectId)).size === 1,
        'destinationAmbiguous',
      );
      const first = group[0];
      const imported = await this.importer.import(payload, first.target, {
        replace: item.action === 'resolve',
        vault: { readChunk },
        acceptedMissingAttachments: accepted,
        expectedHashes: Object.fromEntries(
          payload.files.map((f) => [
            f.id,
            plan.targetSnapshots[first.target.home]?.hashes[f.id] ?? null,
          ]),
        ),
      });
      for (const member of group)
        if (await this.verifyMember(member, first, imported, group, context)) break;
    } catch (e) {
      for (const { entry } of group)
        result.targets[entry] ??= {
          status: 'failed',
          stage: result.stage,
          error: publicError(e),
        };
    }
  }
  // Shared storage is written once; a different runtime on it is still checked natively.
  // Returns true when a failed native check leaves the folder needing recovery.
  async verifyMember({ entry, target, identity }, first, imported, group, context) {
    const { payload, result, project, importVersion, step } = context;
    let nativeStarted = false,
      nativeTask = null;
    try {
      if (entry !== first.entry && target.binary !== first.target.binary) {
        step('stageVerify');
        await this.importer.processGuard(target.home);
        nativeTask = id();
        this.state.set('import/' + nativeTask, {
          status: 'validating',
          backup: imported.backup,
          home: target.home,
        });
        nativeStarted = true;
        await this.importer.native({
          expectedKey: identity.key,
          binary: target.binary,
          home: target.home,
          project,
          files: payload.files,
          logicalId: payload.logicalId,
          nativeProjectId: target.nativeProjectId,
        });
        await this.importer.record(
          payload,
          target.home,
          project,
          target.binary,
          identity.version,
          identity.key,
        );
        this.state.set('import/' + nativeTask, {
          status: 'verified',
          backup: imported.backup,
          home: target.home,
        });
      }
      result.targets[entry] = {
        status: 'verified',
        nativeProjectId: target.nativeProjectId,
        nativeProjectName: imported.nativeProjectName,
        omittedAttachments: imported.omittedAttachments ?? [],
        version: importVersion,
        home: target.home,
        project,
        binary: target.binary,
        backup: imported.backup,
        checkedAt: new Date().toISOString(),
      };
      return false;
    } catch (e) {
      result.targets[entry] = {
        status: 'failed',
        stage: result.stage,
        error: publicError(e),
        backup: imported.backup,
      };
      if (!nativeStarted) return false;
      this.state.set('import/' + nativeTask, {
        status: 'failed',
        backup: imported.backup,
        home: target.home,
        error: e.code ?? 'native_error',
      });
      for (const prior of Object.values(result.targets))
        if (prior.home === target.home && prior.status === 'verified') prior.status = 'imported';
      for (const remaining of group)
        result.targets[remaining.entry] ??= {
          status: 'failed',
          error: { code: 'recovery_required', detail: '' },
          backup: imported.backup,
        };
      return true;
    }
  }
  // Saves what each app now holds; a fully verified import drops its download cache.
  async recordImport(item, result, payload, importVersion, cache) {
    this.local = await scan(this.config().sourceHomes);
    const importedLocal = this.local.rows.find((x) => x.id === item.id);
    if (
      importedLocal &&
      Object.values(result.targets).some(
        (x) => x.status === 'verified' && x.home === importedLocal.home,
      )
    )
      this.rememberBaseline(importedLocal, importVersion);
    for (const f of payload.files)
      this.state.set('association/' + f.id, {
        importedOrigin: true,
        projectId: payload.projectId,
        source: f.source ?? payload.source,
        originProject: f.originProject?.nativeId ? f.originProject : payload.originProject,
      });
    const key = 'entries/' + this.scope() + '/' + item.id;
    this.state.set(key, { ...this.state.get(key, {}), ...result.targets });
    const values = Object.values(result.targets);
    if (cache && values.length && values.every((x) => x.status === 'verified'))
      await this.clearDownloads([cache.cacheKey]);
    result.status = values.every((x) => ['verified', 'imported'].includes(x.status))
      ? 'downloaded'
      : values.some((x) => ['verified', 'imported'].includes(x.status))
        ? 'partial'
        : 'failed';
  }
}
