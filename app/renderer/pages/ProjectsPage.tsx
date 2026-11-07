import { useState } from 'react';
import { useApp } from '../App';
import { useI18n } from '../i18n/I18n';
import { call } from '../hooks/useApi';
import { EntryFields } from '../Environment';
import { RuntimeCheck } from '../RuntimeCheck';
import { ENTRIES, projectLabel } from './rows';

export function ProjectsPage() {
  const app = useApp();
  const { t } = useI18n();
  const { cfg, data, busy, work } = app;
  const [git, setGit] = useState<any>(null);
  const update = (key: string, value: any) => app.setCfg({ ...cfg, [key]: value });
  const pick = async (cb: (p: string) => void) => {
    const p = await call('pickDirectory');
    if (p) cb(p);
  };
  const projects = Object.entries(
    Object.fromEntries(data.rows.filter((r: any) => r.projectId).map((r: any) => [r.projectId, r])),
  );
  return (
    <>
      <div className="actions">
        <button
          className="primary"
          disabled={busy}
          onClick={() =>
            work(async () => app.setDetection(await call('detectPaths')), 'checkingEntries')
          }
        >
          {t('detectEnvironment')}
        </button>
        <small>{t('projectMappingHint')}</small>
      </div>
      <section className="card">
        <h2>{t('projectPath')}</h2>
        {projects.map(([projectId, value]: any) => (
          <div className="project-row" key={projectId}>
            <div>
              <strong>{projectLabel(value, t)}</strong>
              <small>{value.project}</small>
            </div>
            <input
              value={cfg.bindings[projectId] ?? ''}
              placeholder={t('chooseProject')}
              onChange={(e) => update('bindings', { ...cfg.bindings, [projectId]: e.target.value })}
            />
            <button
              onClick={() =>
                work(() => pick((p) => update('bindings', { ...cfg.bindings, [projectId]: p })))
              }
            >
              {t('bind')}
            </button>
            <button
              disabled={!cfg.bindings[projectId]}
              onClick={() =>
                work(async () =>
                  setGit(await call('projectInfo', { project: cfg.bindings[projectId] })),
                )
              }
            >
              {t('gitInfo')}
            </button>
          </div>
        ))}
        {!data.rows.length && <p>{t('noProjects')}</p>}
        {git && (
          <div className="notice">
            {git.git === false
              ? t('noGit')
              : `${t('branch')}: ${git.branch} · ${t('commit')}: ${git.commit?.slice(0, 12)} · ${t('changes')}: ${git.changes}`}
          </div>
        )}
      </section>
      <section className="card">
        <h2>{t('targets')}</h2>
        <p className="muted">{t('entryHint')}</p>
        {ENTRIES.map((entry) => (
          <div className="target-card" key={entry}>
            <h3>{t(entry)}</h3>
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
            />
          </div>
        ))}
        <p className="muted">{t('readOnlyNotice')}</p>
      </section>
    </>
  );
}
