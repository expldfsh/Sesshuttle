import { Fragment } from 'react';
import { Icon } from '../components/Icon';
import { useI18n } from '../i18n/I18n';

// Upload: this computer → cloud. Import: cloud → this computer. Both: up, then back down.
export function DirectionIcon({ direction }: { direction: string }) {
  const { t } = useI18n();
  const path: ('laptop' | 'cloud')[] =
    direction === 'upload'
      ? ['laptop', 'cloud']
      : direction === 'both'
        ? ['laptop', 'cloud', 'laptop']
        : ['cloud', 'laptop'];
  return (
    <span
      className="direction"
      role="img"
      aria-label={t(
        direction === 'upload' ? 'uploadCloud' : direction === 'both' ? 'both' : 'importLocal',
      )}
    >
      {path.map((name, i) => (
        <Fragment key={i}>
          {i > 0 && <Icon name="chevron" className="direction-arrow" />}
          <Icon name={name} />
        </Fragment>
      ))}
    </span>
  );
}

export const actionDirection = (action: string) =>
  ['upload', 'preserve_conflict'].includes(action)
    ? 'upload'
    : action === 'upload_import'
      ? 'both'
      : ['download', 'resolve'].includes(action)
        ? 'download'
        : null;
