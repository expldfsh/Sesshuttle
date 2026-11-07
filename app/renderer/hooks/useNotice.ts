import { useCallback, useState } from 'react';

export type Notice = { text: string; detail?: string; error?: boolean; code?: string };

export function useNotice() {
  const [notice, setNotice] = useState<Notice | null>(null);
  const clearNotice = useCallback(() => setNotice(null), []);
  return { notice, setNotice, clearNotice };
}
