import en from './en.json';
import type { ActionDef } from '../core/types';
import { getPref, setPref } from '../util/prefs';

/* Nine languages, no Arabic, per the family rule. A missing key falls back to
   English and warns once, so the UI never shows a raw key.

   `dict` is a $state so that `t()` inside markup is reactive: switching the
   language repaints every string on the page, not only the ones that read
   `locale` directly. */

export const LOCALES = ['en', 'zh-CN', 'de', 'id', 'ja', 'pt-BR', 'es', 'fr', 'ru'] as const;
export type Locale = (typeof LOCALES)[number];

export const LOCALE_NAMES: Record<string, string> = {
  en: 'English',
  'zh-CN': '简体中文',
  de: 'Deutsch',
  id: 'Bahasa Indonesia',
  ja: '日本語',
  'pt-BR': 'Português (Brasil)',
  es: 'Español',
  fr: 'Français',
  ru: 'Русский'
};

type Dict = Record<string, string>;

const LOADERS: Record<string, () => Promise<{ default: Dict }>> = {
  en: async () => ({ default: en as Dict }),
  'zh-CN': () => import('./zh-CN.json') as Promise<{ default: Dict }>,
  de: () => import('./de.json') as Promise<{ default: Dict }>,
  id: () => import('./id.json') as Promise<{ default: Dict }>,
  ja: () => import('./ja.json') as Promise<{ default: Dict }>,
  'pt-BR': () => import('./pt-BR.json') as Promise<{ default: Dict }>,
  es: () => import('./es.json') as Promise<{ default: Dict }>,
  fr: () => import('./fr.json') as Promise<{ default: Dict }>,
  ru: () => import('./ru.json') as Promise<{ default: Dict }>
};

const FALLBACK = en as Dict;

export function isLocale(v: string): v is Locale {
  return (LOCALES as readonly string[]).includes(v);
}

export function guessLocale(): Locale {
  const stored = readStored();
  if (stored && isLocale(stored)) return stored;
  const tags = navigator.languages ?? [navigator.language];
  for (const tag of tags) {
    const exact = LOCALES.find(l => l.toLowerCase() === tag.toLowerCase());
    if (exact) return exact;
    const base = tag.split('-')[0].toLowerCase();
    const byBase = LOCALES.find(l => l.split('-')[0].toLowerCase() === base);
    if (byBase) return byBase;
  }
  return 'en';
}

/** The language chosen before: the family cookie hop_lang (any HOP app), then this app's own old key. */
function readStored(): string | null {
  const family = getPref('hop_lang');
  if (family && isLocale(family)) return family;
  try {
    return localStorage.getItem('hop-lang');
  } catch {
    return null;
  }
}

/** The person picked a language: every HOP app follows it (hop_lang), and the old key keeps up. */
export function chooseLocale(l: Locale): void {
  setPref('hop_lang', l);
  storeLocale(l);
}

function storeLocale(l: string): void {
  try {
    localStorage.setItem('hop-lang', l);
  } catch {
    /* private mode: the choice just does not survive a reload */
  }
}

class I18nState {
  locale = $state<Locale>('en');
  dict = $state<Dict>(FALLBACK);
  private loaded = new Set<string>();
  private missing = new Set<string>();

  async load(locale: Locale): Promise<void> {
    if (this.loaded.has(locale)) {
      this.locale = locale;
      this.dict = locale === 'en' ? FALLBACK : this.cache.get(locale)!;
      document.documentElement.lang = locale;
      storeLocale(locale);
      return;
    }
    const loader = LOADERS[locale] ?? LOADERS.en;
    const mod = await loader();
    this.cache.set(locale, mod.default);
    this.loaded.add(locale);
    this.dict = mod.default;
    this.locale = locale;
    document.documentElement.lang = locale;
    storeLocale(locale);
  }

  private cache = new Map<string, Dict>();

  t(key: string, vars?: Record<string, string | number>): string {
    const s = this.dict[key] ?? FALLBACK[key];
    if (s === undefined) {
      if (!this.missing.has(key)) {
        this.missing.add(key);
        console.warn(`[i18n] missing key: ${key}`);
      }
      return key;
    }
    if (!vars) return s;
    return s.replace(/\{(\w+)\}/g, (m, name) => (name in vars ? String(vars[name]) : m));
  }
}

export const i18n = new I18nState();

/** The label of a target chip in the current language: the translated word for Merge,
    Split or Pages → PNG, and the format name itself for WebP, JSON or ZIP. */
export function actionLabel(def: Pick<ActionDef, 'label' | 'labelKey'>): string {
  return def.labelKey ? i18n.t(def.labelKey) : def.label;
}
