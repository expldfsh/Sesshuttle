import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { messages, type Message, type Plural } from './messages';

export type Locale = 'zh-CN' | 'en';
export type Vars = Record<string, string | number>;
export type Translate = (key: string, vars?: Vars) => string;

const table: Record<string, Message> = messages;
const plurals = new Map<string, Intl.PluralRules>();
const pluralRules = (locale: string) => {
  let rules = plurals.get(locale);
  if (!rules) plurals.set(locale, (rules = new Intl.PluralRules(locale)));
  return rules;
};
const fill = (text: string, vars?: Vars) =>
  vars
    ? text.replace(/\{(\w+)\}/g, (all, name) => (name in vars ? String(vars[name]) : all))
    : text;
// `{@key}` names another message, usually a button or page: it shows that message's
// current text in quotation marks, so a label and the hints that mention it stay equal.
const quote = (locale: Locale, label: string) =>
  locale === 'zh-CN' ? `「${label}」` : `“${label}”`;
const references = (locale: Locale, text: string) =>
  text.includes('{@')
    ? text.replace(/\{@([\w$]+)\}/g, (all, key) =>
        Object.hasOwn(table, key) ? quote(locale, translate(locale, key)) : all,
      )
    : text;
// The message for one language; an unknown key (a code without a message) shows as is.
export function translate(locale: Locale, key: string, vars?: Vars, count?: number): string {
  const entry = table[key];
  if (!entry) return key;
  const value: string | Plural = entry[locale === 'zh-CN' ? 0 : 1];
  const text =
    typeof value === 'string'
      ? value
      : (value[pluralRules(locale).select(count ?? 2) as keyof Plural] ?? value.other);
  return fill(references(locale, text), count === undefined ? vars : { n: count, ...vars });
}

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
  // A message with a count: English picks the plural form, `{n}` is the count.
  tn: (key: string, n: number, vars?: Vars) => string;
  has: (key: string) => boolean;
  date: (value?: string) => string;
  size: (n: number) => string;
};

export function makeI18n(locale: Locale): I18n {
  const long = dateFormatter(locale, { dateStyle: 'medium', timeStyle: 'long' });
  return {
    locale,
    t: (key, vars) => translate(locale, key, vars),
    tn: (key, n, vars) => translate(locale, key, vars, n),
    has: (key) => Object.hasOwn(table, key),
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
