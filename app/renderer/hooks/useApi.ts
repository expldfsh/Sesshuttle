import { useCallback, useRef, useState } from 'react';

export type ApiError = { code: string; detail?: string };

declare global {
  interface Window {
    sesshuttle: {
      invoke: (method: string, args?: any) => Promise<any>;
      onRuntimeStage: (cb: (event: any) => void) => () => void;
      onClosePending: (cb: (removal: boolean) => void) => () => void;
      onProgress: (cb: (x: any) => void) => () => void;
    };
  }
}

// Every main-process call returns { ok, data } or { ok: false, error }.
export async function call<T = any>(method: string, args: any = {}): Promise<T> {
  const r = await window.sesshuttle.invoke(method, args);
  if (!r.ok) throw r.error as ApiError;
  return r.data as T;
}

// One user-started operation at a time. `phase` names it for the status line;
// a failure is handed to `onError` instead of being thrown.
// `place` names where a failure is shown: a dialog, the details panel, a card or the page.
export function useWork(onStart: () => void, onError: (error: ApiError, place: string) => void) {
  const lock = useRef(false);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState('');
  const work = useCallback(
    async <T>(fn: () => Promise<T>, label = 'working', place = 'page'): Promise<T | undefined> => {
      if (lock.current) return;
      lock.current = true;
      setPhase(label);
      setBusy(true);
      onStart();
      try {
        return await fn();
      } catch (e: any) {
        onError(e, place);
      } finally {
        lock.current = false;
        setPhase('');
        setBusy(false);
      }
    },
    [onStart, onError],
  );
  return { busy, phase, setPhase, work };
}
