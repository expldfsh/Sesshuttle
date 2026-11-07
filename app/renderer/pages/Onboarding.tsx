import { useApp, useRefresh } from '../App';
import { useI18n } from '../i18n/I18n';
import { call } from '../hooks/useApi';
import { Icon } from '../components/Icon';
import { ENTRIES } from './rows';

// Four steps with their state. Each button starts only what it names; the last
// step is reached through a normal upload or import.
export function Onboarding() {
  const app = useApp();
  const { t } = useI18n();
  const refresh = useRefresh();
  const { init, cfg, data, busy, work } = app;
  const steps = [
    {
      key: 'Detect',
      done: ENTRIES.some((e) => cfg.targets?.[e]?.binary && cfg.targets?.[e]?.home),
      action: (
        <button
          disabled={busy}
          onClick={() =>
            work(async () => app.setDetection(await call('detectPaths')), 'checkingEntries')
          }
        >
          {t('detect')}
        </button>
      ),
    },
    {
      key: 'Connect',
      done: !!init.connected,
      action: <button onClick={() => app.setPage('settings', 'storage')}>{t('goConnect')}</button>,
    },
    {
      key: 'Refresh',
      done: !!data.checkedAt,
      action: (
        <button disabled={busy} onClick={refresh}>
          <Icon name="refresh" /> {t('refresh')}
        </button>
      ),
    },
    { key: 'Transfer', done: !!init.hasCompletedTransfer, action: null },
  ];
  const done = steps.filter((s) => s.done).length;
  if (cfg.onboardingDismissed || done === steps.length) return null;
  return (
    <section className="onboarding card" aria-labelledby="onboarding-title">
      <header>
        <h2 id="onboarding-title">{t('gettingStarted')}</h2>
        <span className="muted">{t('stepsDone', { done, n: steps.length })}</span>
        <button
          className="text-button"
          disabled={busy}
          onClick={() => work(() => app.persist({ ...cfg, onboardingDismissed: true }), 'applying')}
        >
          {t('hide')}
        </button>
      </header>
      <ol>
        {steps.map((step, i) => (
          <li key={step.key} className={step.done ? 'done' : ''}>
            <span className="step-mark" aria-hidden="true">
              {step.done ? <Icon name="check" /> : i + 1}
            </span>
            <span className="step-text">
              <strong>{t('onboard' + step.key)}</strong>
              <small>{t(step.done ? 'stepDone' : 'onboard' + step.key + 'Hint')}</small>
            </span>
            {!step.done && step.action}
          </li>
        ))}
      </ol>
    </section>
  );
}
