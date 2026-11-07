import type { Translate } from '../i18n/I18n';

export const ENTRIES = ['desktop', 'cli', 'ide'];

export function projectLabel(r: any, t: Translate) {
  return (
    r.originProject?.name ||
    (r.originProject?.match === 'ambiguous'
      ? t('ambiguousProject') +
        ' · ' +
        r.originProject.candidates.map((p: any) => p.name).join(' / ')
      : t('unassignedProject'))
  );
}
export const projectKey = (r: any) => r.originProject?.nativeId ?? r.projectId ?? 'unknown';
export const hasMissingImages = (r: any) =>
  r.cloudOmittedImages > 0 ||
  Object.values(r.targets ?? {}).some((v: any) => v.omittedAttachments?.length);
