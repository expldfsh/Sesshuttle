import { Icon } from './Icon';

// Numbered steps: done steps show a check, the current step is marked for assistive tech.
export function Stepper({ steps, current }: { steps: string[]; current: number }) {
  return (
    <ol className="stepper">
      {steps.map((label, i) => (
        <li
          key={label}
          className={i < current ? 'done' : i === current ? 'current' : ''}
          aria-current={i === current ? 'step' : undefined}
        >
          <span className="step-mark">{i < current ? <Icon name="check" /> : i + 1}</span>
          <span>{label}</span>
        </li>
      ))}
    </ol>
  );
}
