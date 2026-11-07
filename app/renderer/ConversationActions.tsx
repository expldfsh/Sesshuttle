import { Icon } from './components/Icon';
import { DirectionIcon } from './transfer/DirectionIcon';

// The likely next step is the primary button: continue in a verified app, compare a
// conflict, or import when the cloud has news; otherwise upload.
export function ConversationActions({
  items,
  t,
  busy,
  open,
  remove,
  resume,
  versions,
  compact = false,
}: any) {
  const local = items.filter((i: any) => i.local).length,
    remote = items.filter((i: any) => i.remote).length;
  const single = items.length === 1 ? items[0] : null;
  const targets = Object.entries(single?.targets ?? {}).filter(
    ([, v]: any) => v.status === 'verified',
  );
  const importFirst = remote && (!local || single?.status === 'remote_changes');
  const upload = (
    <button
      disabled={busy}
      className={!importFirst && !targets.length ? 'primary' : ''}
      onClick={() => open('upload')}
    >
      <DirectionIcon direction="upload" />
      {t('uploadCloud')}
      {!single && ' (' + local + ')'}…
    </button>
  );
  const download = (
    <button
      disabled={busy}
      className={importFirst ? 'primary' : ''}
      onClick={() => open('download')}
    >
      <DirectionIcon direction="download" />
      {t('importLocal')}
      {!single && ' (' + remote + ')'}…
    </button>
  );
  return (
    <div className="actions conversation-actions">
      {targets.slice(0, 1).map(([entry]) => (
        <button
          key={entry}
          className="primary"
          disabled={busy}
          onClick={() => resume(single.id, entry)}
        >
          {t('continue')} · {t(entry)}
        </button>
      ))}
      {single?.status === 'conflict' && (
        <button className="primary" disabled={busy} onClick={versions}>
          {t('compareVersions')}
        </button>
      )}
      {importFirst ? (
        <>
          {remote > 0 && download}
          {local > 0 && upload}
        </>
      ) : (
        <>
          {local > 0 && upload}
          {remote > 0 && download}
        </>
      )}
      {!single && local > 0 && remote > 0 && (
        <button disabled={busy} onClick={() => open('both')}>
          <DirectionIcon direction="both" />
          {t('both')}…
        </button>
      )}
      {compact && (
        <button className="danger-button" disabled={busy} onClick={remove}>
          <Icon name="trash" /> {t('removeChats')}…
        </button>
      )}
    </div>
  );
}
