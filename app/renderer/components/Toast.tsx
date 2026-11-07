import { Icon } from './Icon';
import { useEffect, useState } from 'react';
import { useI18n } from '../i18n/I18n';

export type ToastMessage = { id: number; text: string; detail?: string };
let next = 0;
const listeners = new Set<(toast: ToastMessage) => void>();

// Success messages only. Warnings and errors stay where they happened.
export function toast(text: string, detail?: string) {
  const message = { id: ++next, text, detail };
  for (const listener of listeners) listener(message);
}

// Bottom-right, read by screen readers, gone after 5 seconds or when closed.
export function Toasts() {
  const { t } = useI18n();
  const [items, setItems] = useState<ToastMessage[]>([]);
  useEffect(() => {
    const show = (message: ToastMessage) => {
      setItems((old) => [...old.slice(-2), message]);
      setTimeout(() => setItems((old) => old.filter((x) => x.id !== message.id)), 5000);
    };
    listeners.add(show);
    return () => void listeners.delete(show);
  }, []);
  return (
    <div className="toasts" role="status" aria-live="polite">
      {items.map((item) => (
        <div className="toast" key={item.id}>
          <span>
            {item.text}
            {item.detail && <small>{item.detail}</small>}
          </span>
          <button
            type="button"
            className="icon-button"
            aria-label={t('close')}
            onClick={() => setItems((old) => old.filter((x) => x.id !== item.id))}
          >
            <Icon name="close" />
          </button>
        </div>
      ))}
    </div>
  );
}
