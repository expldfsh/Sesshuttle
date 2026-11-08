import React, { useEffect, useRef, useState } from 'react';
import { ErrorNotice } from './components/ErrorNotice';
import { errorRule, runtimeFix } from './errors';

// The quick check of one executable. `onDone` follows a passed check; `onSettled`
// follows every finished check, since a failed one is saved as well. `onChoose` and
// `onUse` open the repair for this app's "Codex runtime" field in the page or dialog
// that shows this block; they only change the unsaved path.
export function RuntimeCheck({
  binary,
  info,
  call,
  t,
  onDone,
  onSettled,
  onBusy,
  onChoose,
  onUse,
  onProblem,
  resolved,
  candidate,
  disabled = false,
}: any) {
  const [stage, setStage] = useState(''),
    [problem, setProblem] = useState<any>(null),
    [result, setResult] = useState<any>(null);
  const current = useRef(''),
    active = useRef(true),
    lastStage = useRef('');
  useEffect(() => {
    active.current = true;
    setProblem(null);
    setResult(null);
    const off = window.sesshuttle.onRuntimeStage((event) => {
      if (current.current === event.id) {
        lastStage.current = event.stage;
        setStage(event.stage);
      }
    });
    return () => {
      active.current = false;
      off();
      if (current.current) void call('cancelRuntimeCheck', { id: current.current }).catch(() => {});
    };
    // A check belongs to one executable; a new `call` identity must not cancel it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [binary]);
  useEffect(() => {
    onProblem?.(!!problem);
    return () => onProblem?.(false);
    // The parent's callback changes with every render; only a new problem matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [problem]);
  const proof = info ?? result;
  async function check() {
    if (current.current) return;
    const id = crypto.randomUUID();
    current.current = id;
    onBusy?.(true);
    lastStage.current = 'runtimeSample';
    setStage('runtimeSample');
    setProblem(null);
    try {
      const completed = await call('verifyRuntime', { id, binary });
      if (active.current && current.current === id) {
        setResult(completed);
        await onDone?.();
      }
    } catch (e: any) {
      if (active.current && current.current === id) setProblem({ ...e, stage: lastStage.current });
    } finally {
      if (current.current === id) {
        current.current = '';
        if (active.current) setStage('');
        onBusy?.(false);
        onSettled?.();
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
  const checked = proof?.resolved ?? resolved ?? binary;
  const fix = problem ? runtimeFix(problem.code) : null;
  const repair = (
    <>
      {fix === 'chooseRuntime' && (
        <button type="button" className="primary" onClick={onChoose}>
          {t('chooseRuntime')}
        </button>
      )}
      {fix === 'chooseRuntime' && candidate && (
        <button type="button" onClick={() => onUse?.(candidate)}>
          {t('useRuntime', { path: candidate })}
        </button>
      )}
      {(fix === 'retryRuntime' || fix === 'startRuntime') && (
        <button type="button" className="primary" disabled={disabled} onClick={check}>
          {t(fix === 'retryRuntime' ? 'retryRuntimeCheck' : 'startRuntimeCheck')}
        </button>
      )}
    </>
  );
  return (
    <section className="runtime-check" aria-live="polite">
      <strong>
        {t(info ? 'runtimePathsReady' : 'runtimeCheckTitle')}
        {proof?.version && ' · ' + proof.version}
      </strong>
      <code className="runtime-path">{checked}</code>
      <p>{t('runtimeCheckHint')}</p>
      {problem && (
        <ErrorNotice
          error={problem}
          severity={errorRule(problem.code).severity}
          subject={checked}
          copySubject
          action={fix ? repair : undefined}
          onDismiss={fix ? undefined : () => setProblem(null)}
        />
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
        !problem && (
          <button type="button" className="primary" disabled={disabled} onClick={check}>
            {t('startRuntimeCheck')}
          </button>
        )
      )}
    </section>
  );
}
