import React, { useEffect, useRef, useState } from 'react';

export function RuntimeCheck({ binary, info, call, t, onDone, onBusy, disabled = false }: any) {
  const [stage, setStage] = useState(''),
    [problem, setProblem] = useState<any>(null),
    [result, setResult] = useState<any>(null);
  const current = useRef(''),
    active = useRef(true);
  useEffect(() => {
    active.current = true;
    setProblem(null);
    setResult(null);
    const off = window.sesshuttle.onRuntimeStage((event) => {
      if (current.current === event.id) setStage(event.stage);
    });
    return () => {
      active.current = false;
      off();
      if (current.current) void call('cancelRuntimeCheck', { id: current.current }).catch(() => {});
    };
    // A check belongs to one executable; a new `call` identity must not cancel it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [binary]);
  const proof = info ?? result;
  async function check() {
    if (current.current) return;
    const id = crypto.randomUUID();
    current.current = id;
    onBusy?.(true);
    setStage('runtimeSample');
    setProblem(null);
    try {
      const completed = await call('verifyRuntime', { id, binary });
      if (active.current && current.current === id) {
        setResult(completed);
        await onDone?.();
      }
    } catch (e: any) {
      if (active.current && current.current === id) setProblem(e);
    } finally {
      if (current.current === id) {
        current.current = '';
        if (active.current) setStage('');
        onBusy?.(false);
      }
    }
  }
  if (!binary) return null;
  if (proof?.status === 'builtin' || proof?.status === 'verified')
    return (
      <p role="status" className="runtime-ready">
        <strong>{t(proof.status === 'builtin' ? 'runtimeBuiltIn' : 'runtimeRemembered')}</strong> ·{' '}
        {proof.version}
      </p>
    );
  return (
    <section className="runtime-check" aria-live="polite">
      <strong>
        {t(info ? 'runtimePathsReady' : 'runtimeCheckTitle')}
        {proof?.version && ' · ' + proof.version}
      </strong>
      <p>{t('runtimeCheckHint')}</p>
      {problem && (
        <div
          className={'notice ' + (problem.code === 'runtime_cancelled' ? '' : 'warning-box')}
          role="status"
        >
          <span>
            {t(problem.code)}
            {problem.detail && (
              <details>
                <summary>{t('technicalDetails')}</summary>
                {problem.detail}
              </details>
            )}
          </span>
        </div>
      )}
      {stage ? (
        <div className="actions">
          <progress aria-label={t(stage)} />
          <strong>{t(stage)}</strong>
          <button onClick={() => call('cancelRuntimeCheck', { id: current.current })}>
            {t('stopRuntimeCheck')}
          </button>
        </div>
      ) : (
        <button type="button" className="primary" disabled={disabled} onClick={check}>
          {t(problem ? 'retryRuntimeCheck' : 'startRuntimeCheck')}
        </button>
      )}
    </section>
  );
}
