import { inspectAttachment, attachmentIssue, attachmentUnchanged } from './attachments.mjs';
import { packStream } from './bundle.mjs';
import { readBlocks } from './stream.mjs';
import { hash, requireThat } from './util.mjs';

// A replacement on download belongs to this plan's private staging area only.
export async function repairDownload(original, replacements, vault, stage) {
  if (!Object.keys(replacements).length) return original;
  const payload = structuredClone(original);
  for (const file of payload.files) {
    const resolvedIssues = new Set();
    for (const previous of file.attachmentReport ?? []) {
      const replacement = replacements[previous.key];
      if (!replacement || previous.status === 'included') continue;
      requireThat(
        previous.sessionId === file.id &&
          previous.key === hash(file.id + '\0' + previous.path) &&
          previous.status !== 'unsafe',
        'invalid_selection',
      );
      const report = await inspectAttachment({ id: file.id }, previous.path, [], replacement);
      requireThat(report.status === 'included', 'replacement_invalid');
      const asset = await packStream(readBlocks(report.resolved), 'asset', vault, stage, {
        path: previous.path,
      });
      requireThat(await attachmentUnchanged(report), 'stale_plan');
      resolvedIssues.add(attachmentIssue(previous.status));
      file.artifacts.push(asset);
      delete previous.readError;
      Object.assign(previous, report, { hash: asset.hash });
    }
    file.issues = (file.issues ?? []).filter(
      (code) =>
        !resolvedIssues.has(code) ||
        file.attachmentReport.some((a) => attachmentIssue(a.status) === code),
    );
  }
  const oldFileIssues = new Set(original.files.flatMap((f) => f.issues ?? []));
  payload.issues = [
    ...new Set([
      ...(original.issues ?? []).filter((i) => !oldFileIssues.has(i)),
      ...payload.files.flatMap((f) => f.issues ?? []),
    ]),
  ];
  return payload;
}
