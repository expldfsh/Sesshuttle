import { getTheme } from '../shared/themes';
// All components and body portals inherit these semantic tokens. New themes
// extend the shared registry without changing component CSS or native menus.
export function applyTheme(id?: unknown) {
  const theme = getTheme(id);
  const root = document.documentElement;
  root.dataset.theme = theme.id;
  root.style.colorScheme = theme.colorScheme;
  for (const [name, value] of Object.entries(theme.colors))
    root.style.setProperty(`--${name}`, value);
}
