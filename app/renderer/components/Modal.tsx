import { useEffect, useId, useLayoutEffect, useRef, type ReactNode } from 'react';
import { useI18n } from '../i18n/I18n';

type Props = {
  title: ReactNode;
  onClose: () => void;
  // While true, Esc and the close button do nothing.
  busy?: boolean;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
  size?: 'small' | 'medium' | 'large';
  // A new value (the next step of a flow) moves focus back to the title and scrolls to the top.
  step?: string | number;
};

// A native modal <dialog>: the page behind it is inert, so focus cannot leave it;
// Esc closes only the topmost dialog. Focus moves to the title on open and
// returns to the element that opened the dialog when it closes.
export function Modal({
  title,
  onClose,
  busy = false,
  children,
  footer,
  className = '',
  size = 'medium',
  step,
}: Props) {
  const { t } = useI18n();
  const ref = useRef<HTMLDialogElement>(null),
    heading = useRef<HTMLHeadingElement>(null);
  const titleId = useId();
  useLayoutEffect(() => {
    const dialog = ref.current!;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.showModal();
    heading.current?.focus({ preventScroll: true });
    return () => {
      dialog.close();
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, []);
  const firstStep = useRef(step);
  useEffect(() => {
    if (step === firstStep.current) return;
    firstStep.current = step;
    heading.current?.focus({ preventScroll: true });
    ref.current?.querySelector('.modal-body')?.scrollTo({ top: 0 });
  }, [step]);
  return (
    <dialog
      ref={ref}
      className={`modal modal-${size} ${className}`}
      aria-labelledby={titleId}
      aria-busy={busy || undefined}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      <header className="modal-header">
        <h2 id={titleId} tabIndex={-1} ref={heading}>
          {title}
        </h2>
        <button
          type="button"
          className="icon-button"
          aria-label={t('close')}
          disabled={busy}
          onClick={onClose}
        >
          ×
        </button>
      </header>
      <div className="modal-body">{children}</div>
      {footer && <footer className="modal-actions">{footer}</footer>}
    </dialog>
  );
}
