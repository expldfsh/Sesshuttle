export const DEFAULT_THEME_ID = 'tokyo-night-moon';
export const themes = {
  'tokyo-night-moon': {
    id: 'tokyo-night-moon',
    colorScheme: 'dark',
    colors: {
      bg: '#222436',
      panel: '#1e2030',
      highlight: '#2f334d',
      line: '#3b4261',
      fg: '#c8d3f5',
      muted: '#a0a9cf',
      accent: '#82aaff',
      'accent-hover': '#a7c5ff',
      'on-accent': '#191b29',
      source: '#c099ff',
      success: '#c3e88d',
      warning: '#ffc777',
      danger: '#ff757f',
      'success-bg': '#293a32',
      'success-line': '#4b6555',
      'warning-bg': '#403536',
      'danger-bg': '#3c2b3b',
      'danger-line': '#694451',
      backdrop: '#10111dcc',
      shadow: '#00000066',
      'scroll-thumb': '#545c7e',
      'scroll-hover': '#737aa2',
    },
  },
} as const;
export type ThemeId = keyof typeof themes;
export type Theme = {
  id: string;
  colorScheme: 'dark' | 'light';
  colors: Record<keyof (typeof themes)[typeof DEFAULT_THEME_ID]['colors'], string>;
};
export function getTheme(id?: unknown): Theme {
  return themes[
    typeof id === 'string' && Object.hasOwn(themes, id) ? (id as ThemeId) : DEFAULT_THEME_ID
  ];
}
