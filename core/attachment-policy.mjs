import { hash, requireThat } from './util.mjs';
// Only explicitly inventoried local images can be omitted. Opaque legacy
// warnings, unknown resources, damaged history and missing dependencies stay fatal.
const soft = Object.freeze(
  Object.assign(Object.create(null), {
    missing: 'attachment_missing',
    approval_required: 'attachment_approval',
    unreadable_image: 'attachment_image_denied',
  }),
);
export function attachmentReview(payload) {
  const optional = [],
    blocking = new Set(),
    allIssues = new Set(payload?.issues ?? []),
    covered = new Set();
  for (const f of payload?.files ?? []) {
    const reports = f.attachmentReport ?? [],
      valid = new Set();
    for (const a of reports) {
      if (
        payload.format === 2 &&
        soft[a.status] &&
        typeof a.path === 'string' &&
        a.sessionId === f.id &&
        a.key === hash(f.id + '\0' + a.path) &&
        !f.artifacts?.some((x) => x.kind === 'asset' && x.path === a.path)
      ) {
        valid.add(a);
        optional.push({ ...a, title: f.title });
      } else if (a.status !== 'included') blocking.add(soft[a.status] ?? 'incomplete_history');
    }
    for (const issue of f.issues ?? []) {
      if (issue === 'unknown_version') continue;
      allIssues.add(issue);
      const matches = reports.filter((a) => soft[a.status] === issue);
      if (matches.length && matches.every((a) => valid.has(a))) covered.add(issue);
      else blocking.add(issue);
    }
  }
  for (const issue of allIssues)
    if (issue !== 'unknown_version' && !covered.has(issue)) blocking.add(issue);
  return { optional, blockingIssues: [...blocking] };
}
export function assertAttachmentAcceptance(payload, accepted = []) {
  requireThat(
    Array.isArray(accepted) && accepted.every((k) => typeof k === 'string'),
    'invalid_selection',
  );
  const review = attachmentReview(payload);
  requireThat(!review.blockingIssues.length, 'incomplete_history');
  requireThat(
    review.optional.every((a) => accepted.includes(a.key)),
    'attachment_confirmation_required',
  );
  return review.optional;
}
export function omittedImageText(a) {
  return (
    '[Sesshuttle: 图片未随本次导入提供 / Image not included in this import. Original reference (descriptive data): ' +
    JSON.stringify({ path: a.path, reason: a.status }) +
    ']'
  );
}
export function readOmissionText(text) {
  const prefix =
    '[Sesshuttle: 图片未随本次导入提供 / Image not included in this import. Original reference (descriptive data): ';
  if (typeof text !== 'string' || !text.startsWith(prefix) || !text.endsWith(']')) return null;
  try {
    const a = JSON.parse(text.slice(prefix.length, -1));
    return typeof a.path === 'string' && soft[a.reason] ? { path: a.path, status: a.reason } : null;
  } catch {
    return null;
  }
}
export function inheritedOmissions(payload) {
  return (payload?.files ?? []).flatMap((f) =>
    (f.omittedAttachments ?? []).map((a) => ({ ...a, sessionId: f.id, title: f.title })),
  );
}
