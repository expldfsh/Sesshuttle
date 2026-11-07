import { useEffect, useMemo, useState } from 'react';
import { PlaceError, useApp } from '../App';
import { useI18n } from '../i18n/I18n';
import { call } from '../hooks/useApi';
import { EntryFields } from '../Environment';
import { RuntimeCheck } from '../RuntimeCheck';
import { StatusBadge } from '../components/StatusBadge';
import { EmptyState } from '../components/EmptyState';
import { UnsavedBar } from '../components/UnsavedBar';
import { Icon } from '../components/Icon';
import { useLocalSettings } from './SettingsPage';
import { ENTRIES, projectLabel } from './rows';

export function ProjectsPage() {
  const app = useApp();
  const { t } = useI18n();
  const { cfg, data, busy, work } = app;
  const settings = useLocalSettings();
  const [git, setGit] = useState<Record<string, any>>({});
  const [apps, setApps] = useState<Record<string, any>>({});
  const [folders, setFolders] = useState<Record<string, string>>({});
  const update = (key: string, value: any) => app.setCfg({ ...cfg, [key]: value });
  const pick = async (cb: (p: string) => void) => {
    const p = await call('pickDirectory');
    if (p) cb(p);
  };
  const projects = useMemo(
    () =>
      Object.entries(
        Object.fromEntries(
          data.rows.filter((r: any) => r.projectId).map((r: any) => [r.projectId, r]),
        ),
      ),
    [data.rows],
  );
  // Saved settings and saved runtime checks only; nothing runs or reads a data folder.
  // Read again when the saved paths change and after a user action elsewhere, such
  // as a quick check in the import dialog opened from the task panel.
  const savedTargets = JSON.stringify(app.init?.config?.targets);
  useEffect(() => {
    call('appStatus').then(setApps, () => {});
  }, [savedTargets, app.localRevision]);
  // Whether each project folder exists, by stat only; again after a user action that
  // may have created one.
  const paths = JSON.stringify(Object.values(cfg.bindings ?? {}).filter(Boolean));
  useEffect(() => {
    const list = JSON.parse(paths);
    if (!list.length) return;
    const timer = setTimeout(
      () => call('folderStatus', { paths: list }).then(setFolders, () => {}),
      250,
    );
    return () => clearTimeout(timer);
  }, [paths, app.localRevision]);
  return (
    <div className="projects">
      <div className="page-head">
        <button
          className="primary"
          disabled={busy}
          onClick={() =>
            work(
              async () => app.setDetection(await call('detectPaths')),
              'checkingEntries',
              'projects',
            )
          }
        >
          <Icon name="refresh" /> {t('detectEnvironment')}
        </button>
        <small className="muted">{t('detectHintPage')}</small>
      </div>
      <PlaceError place="projects" />
      <section className="card" aria-labelledby="apps-title">
        <h2 id="apps-title">{t('targets')}</h2>
        <p className="muted">{t('entryHint')}</p>
        <div className="app-cards">
          {ENTRIES.map((entry) => {
            const status = apps[entry]?.status;
            return (
              <div className="app-card" key={entry}>
                <div className="card-title">
                  <h3>{t(entry)}</h3>
                  {status && <StatusBadge status={status} />}
                </div>
                <EntryFields
                  entry={entry}
                  target={cfg.targets[entry]}
                  t={t}
                  pick={(method) => work(() => call(method)) as Promise<string | null>}
                  change={(value) => update('targets', { ...cfg.targets, [entry]: value })}
                />
                <RuntimeCheck
                  key={cfg.targets[entry]?.binary}
                  binary={cfg.targets[entry]?.binary}
                  call={call}
                  t={t}
                  onSettled={() => call('appStatus').then(setApps, () => {})}
                />
              </div>
            );
          })}
        </div>
        <p className="muted">{t('readOnlyNotice')}</p>
      </section>
      <section className="card" aria-labelledby="bindings-title">
        <h2 id="bindings-title">{t('projectPath')}</h2>
        <p className="muted">{t('projectMappingHint')}</p>
        {projects.map(([projectId, value]: any) => {
          const folder = cfg.bindings[projectId] ?? '';
          const state = folder ? folders[folder] : undefined;
          return (
            <div className="project-row" key={projectId}>
              <div className="project-name">
                <strong>{projectLabel(value, t)}</strong>
                <small>{value.project}</small>
              </div>
              <div className="project-folder">
                <input
                  value={folder}
                  aria-label={t('projectPath') + ' · ' + projectLabel(value, t)}
                  placeholder={t('chooseProject')}
                  onChange={(e) =>
                    update('bindings', { ...cfg.bindings, [projectId]: e.target.value })
                  }
                />
                {folder && state && (
                  <small
                    className={'folder-state ' + (state === 'ok' ? 'ok' : 'warn')}
                    role="status"
                  >
                    <Icon name={state === 'ok' ? 'check' : 'alert'} />
                    {t(
                      state === 'ok'
                        ? 'folderExists'
                        : state === 'notFolder'
                          ? 'folderNotFolder'
                          : state === 'unknown'
                            ? 'folderUnchecked'
                            : 'folderMissing',
                    )}
                  </small>
                )}
              </div>
              <div className="actions">
                <button
                  onClick={() =>
                    work(() => pick((p) => update('bindings', { ...cfg.bindings, [projectId]: p })))
                  }
                >
                  <Icon name="folder" /> {t('bind')}
                </button>
                <button
                  disabled={!folder}
                  onClick={() =>
                    work(
                      async () =>
                        setGit({
                          ...git,
                          [projectId]: await call('projectInfo', { project: folder }),
                        }),
                      'working',
                      'projects',
                    )
                  }
                >
                  {t('gitInfo')}
                </button>
              </div>
              {git[projectId] && (
                <small className="git-line">
                  {git[projectId].git === false
                    ? t('noGit')
                    : `${t('branch')}: ${git[projectId].branch} · ${t('commit')}: ${git[projectId].commit?.slice(0, 12)} · ${t('changes')}: ${git[projectId].changes}`}
                </small>
              )}
            </div>
          );
        })}
        {!projects.length && (
          <EmptyState icon="folder" title={t('noProjects')}>
            {t('noProjectsHint')}
          </EmptyState>
        )}
      </section>
      {settings.dirty && (
        <UnsavedBar busy={busy} onDiscard={settings.discard} onSave={settings.save} />
      )}
    </div>
  );
}
