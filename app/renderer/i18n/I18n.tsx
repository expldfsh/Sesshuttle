import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { zh, en } from '../locale';

export type Locale = 'zh-CN' | 'en';
export type Translate = (key: string) => string;

const formatters = new Map<string, Intl.DateTimeFormat>();
// One formatter per language and style; creating them is comparatively slow.
export function dateFormatter(locale: string, options: Intl.DateTimeFormatOptions) {
  const key = locale + JSON.stringify(options);
  let formatter = formatters.get(key);
  if (!formatter) formatters.set(key, (formatter = new Intl.DateTimeFormat(locale, options)));
  return formatter;
}

export function formatSize(n: number) {
  if (!Number.isFinite(n)) return '—';
  if (n >= 1073741824) return `${(n / 1073741824).toFixed(2)} GiB`;
  if (n >= 1048576) return `${(n / 1048576).toFixed(1)} MiB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KiB`;
  return `${n} B`;
}

export type I18n = {
  locale: Locale;
  t: Translate;
  has: (key: string) => boolean;
  date: (value?: string) => string;
  size: (n: number) => string;
};

export function makeI18n(locale: Locale): I18n {
  const dict = locale === 'zh-CN' ? zh : en;
  const long = dateFormatter(locale, { dateStyle: 'medium', timeStyle: 'long' });
  return {
    locale,
    t: (key) => dict[key] ?? key,
    has: (key) => Object.hasOwn(dict, key),
    date: (value) => (value ? long.format(new Date(value)) : '—'),
    size: formatSize,
  };
}

const I18nContext = createContext<I18n>(makeI18n('zh-CN'));

export function I18nProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  const value = useMemo(() => makeI18n(locale), [locale]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export const useI18n = () => useContext(I18nContext);
