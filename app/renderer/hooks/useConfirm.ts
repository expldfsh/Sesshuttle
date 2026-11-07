import { useCallback, useState, type ReactNode } from 'react';

// A confirmation names what will happen; `danger` marks irreversible actions.
export type Question = {
  title?: string;
  message: ReactNode;
  detail?: ReactNode;
  confirm?: string;
  danger?: boolean;
};
type Pending = Question & { resolve: (answer: boolean) => void };

export function useConfirm() {
  const [pending, setPending] = useState<Pending | null>(null);
  const ask = useCallback(
    (question: Question | string) =>
      new Promise<boolean>((resolve) =>
        setPending({
          ...(typeof question === 'string' ? { message: question } : question),
          resolve,
        }),
      ),
    [],
  );
  const answer = useCallback(
    (value: boolean) => {
      pending?.resolve(value);
      setPending(null);
    },
    [pending],
  );
  return { question: pending, ask, answer };
}
