import { useCallback, useState } from 'react';

// Errors and warnings stay where they happened (`place`) until dismissed.
export type Notice = {
  text: string;
  detail?: string;
  error?: boolean;
  code?: string;
  place?: string;
};

export function useNotice() {
  const [notice, setNotice] = useState<Notice | null>(null);
  const clearNotice = useCallback(() => setNotice(null), []);
  return { notice, setNotice, clearNotice };
}
