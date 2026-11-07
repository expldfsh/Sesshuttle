import { useId, type InputHTMLAttributes, type ReactNode } from 'react';

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange'> & {
  label: ReactNode;
  value: string;
  onChange: (value: string) => void;
  hint?: ReactNode;
  error?: ReactNode;
};

// A labelled input with an optional hint and an error announced next to it.
export function Field({ label, value, onChange, hint, error, ...input }: Props) {
  const id = useId();
  return (
    <label className={'field' + (error ? ' invalid' : '')}>
      <span>{label}</span>
      <input
        {...input}
        value={value ?? ''}
        autoComplete={input.autoComplete ?? 'off'}
        aria-invalid={error ? true : undefined}
        aria-describedby={hint || error ? id : undefined}
        onChange={(e) => onChange(e.target.value)}
      />
      {(hint || error) && (
        <small
          id={id}
          className={error ? 'field-error' : 'field-hint'}
          role={error ? 'alert' : undefined}
        >
          {error ?? hint}
        </small>
      )}
    </label>
  );
}
