import { useEffect, useState } from 'react';
import { useApp } from '../App';
import { useI18n } from '../i18n/I18n';
import { call } from '../hooks/useApi';
import { ManualBackups } from '../ManualBackups';
import { RemovalBins } from '../RemovalFlow';

export function BackupsPage() {
  const app = useApp();
  const { t, date, size } = useI18n();
  const { cfg, busy, work } = app;
  const [backupData, setBackupData] = useState<any>({ backups: [], imports: [] });
  const [bins, setBins] = useState<any>(null);
  // Saved local backup state is shown on arrival; nothing is scanned or fetched.
  useEffect(() => {
    let active = true;
    call('backups')
      .then((result) => active && setBackupData(result))
      .catch((e) => active && app.notify({ error: true, text: t(e.code ?? 'operation_failed') }));
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <>
      <ManualBackups
        data={backupData}
        cfg={cfg}
        t={t}
        date={date}
        size={size}
        busy={busy}
        ask={app.ask}
        work={work}
        call={call}
        reload={async () => setBackupData(await call('backups'))}
        changed={() => app.setNeedsRefresh(true)}
        notify={(text: string) => app.notify({ text })}
      />
      <button
        disabled={busy}
        onClick={() => work(async () => setBins(await call('backupBins')), 'refreshing')}
      >
        {t('refreshBins')}
      </button>
      {bins && (
        <RemovalBins
          t={t}
          data={bins}
          connected={app.init.connected}
          date={date}
          busy={busy}
          open={app.setRemoval}
          settings={() => app.setPage('settings')}
          resume={(id: string, storageKey: string) =>
            work(async () => {
              if (await app.ask(t('finishPendingHint'))) {
                await call('finishCloudRemoval', { id, storageKey });
                setBins(await call('backupBins'));
                await app.reloadInit();
                app.notify({ text: t('cloudFinishDone') });
              }
            }, 'removingNow')
          }
        />
      )}
    </>
  );
}
