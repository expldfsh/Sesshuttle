// Built-in line icons on a 24-unit grid, drawn with the current text color.
const paths = {
  upload:
    'M12 16V4m0 0-4.5 4.5M12 4l4.5 4.5M4 15v3.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V15',
  download:
    'M12 4v12m0 0-4.5-4.5M12 16l4.5-4.5M4 15v3.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V15',
  cloud: 'M7.5 18.5h9.25a4.25 4.25 0 0 0 .5-8.47A6 6 0 0 0 5.6 9.2 4.75 4.75 0 0 0 7.5 18.5Z',
  laptop:
    'M5 6.5A1.5 1.5 0 0 1 6.5 5h11A1.5 1.5 0 0 1 19 6.5V15H5V6.5ZM3 15h18l-1.2 2.6a1.5 1.5 0 0 1-1.36.9H5.56a1.5 1.5 0 0 1-1.36-.9L3 15Z',
  refresh: 'M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4.5v4h-4',
  trash:
    'M4.5 7h15M9.5 7V5.5A1.5 1.5 0 0 1 11 4h2a1.5 1.5 0 0 1 1.5 1.5V7m3 0-.7 11.1a1.5 1.5 0 0 1-1.5 1.4H8.7a1.5 1.5 0 0 1-1.5-1.4L6.5 7m3.5 4v5m4-5v5',
  settings:
    'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm7.4-3a7.4 7.4 0 0 0-.1-1.2l2-1.5-2-3.4-2.3.9a7.5 7.5 0 0 0-2.1-1.2L14.5 3h-5l-.4 2.6A7.5 7.5 0 0 0 7 6.8l-2.3-.9-2 3.4 2 1.5a7.4 7.4 0 0 0 0 2.4l-2 1.5 2 3.4 2.3-.9a7.5 7.5 0 0 0 2.1 1.2l.4 2.6h5l.4-2.6a7.5 7.5 0 0 0 2.1-1.2l2.3.9 2-3.4-2-1.5c.07-.4.1-.8.1-1.2Z',
  folder:
    'M3.5 7.5A1.5 1.5 0 0 1 5 6h4.2l2 2H19a1.5 1.5 0 0 1 1.5 1.5v8A1.5 1.5 0 0 1 19 19H5a1.5 1.5 0 0 1-1.5-1.5v-10Z',
  check: 'm5 12.5 4.5 4.5L19 7.5',
  alert:
    'M12 9v4.5m0 3h.01M10.3 4.6 3.2 17a2 2 0 0 0 1.7 3h14.2a2 2 0 0 0 1.7-3L13.7 4.6a2 2 0 0 0-3.4 0Z',
  chevron: 'm9 6 6 6-6 6',
  more: 'M5.5 12h.01M12 12h.01M18.5 12h.01',
  copy: 'M9 9.5A1.5 1.5 0 0 1 10.5 8h8A1.5 1.5 0 0 1 20 9.5v8a1.5 1.5 0 0 1-1.5 1.5h-8A1.5 1.5 0 0 1 9 17.5v-8ZM15 8V6.5A1.5 1.5 0 0 0 13.5 5h-8A1.5 1.5 0 0 0 4 6.5v8A1.5 1.5 0 0 0 5.5 16H9',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-10v5.5M12 7.5h.01',
  history: 'M3.5 12a8.5 8.5 0 1 0 2.5-6M3.5 4v4h4M12 7.5V12l3 2',
  activity: 'M3.5 12h3.5l2.5-6 5 12 2.5-6h3.5',
  backup:
    'M4.5 7c0-1.66 3.36-3 7.5-3s7.5 1.34 7.5 3-3.36 3-7.5 3-7.5-1.34-7.5-3Zm0 0v10c0 1.66 3.36 3 7.5 3s7.5-1.34 7.5-3V7m-15 5c0 1.66 3.36 3 7.5 3s7.5-1.34 7.5-3',
  close: 'M6.5 6.5l11 11m0-11-11 11',
  app: 'M4 5.5A1.5 1.5 0 0 1 5.5 4h13A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5v-13ZM4 9h16M7.5 6.5h.01M10 6.5h.01',
} as const;

export type IconName = keyof typeof paths;
export const iconNames = Object.keys(paths) as IconName[];

export function Icon({
  name,
  size = 16,
  className = '',
}: {
  name: IconName;
  size?: 16 | 20;
  className?: string;
}) {
  return (
    <svg
      className={'icon ' + className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={paths[name]} />
    </svg>
  );
}
