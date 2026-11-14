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

/** The language a browser language tag names (de-AT -> de, pt -> pt-BR), the way the server reads Accept-Language. */
function matchTag(tag: string): Locale | null {
  const exact = LOCALES.find(l => l.toLowerCase() === tag.toLowerCase());
  if (exact) return exact;
  const base = tag.split('-')[0].toLowerCase();
  return LOCALES.find(l => l.split('-')[0].toLowerCase() === base) ?? null;
}

/** The language the address asks for (?lang=de): a per-language address, which wins over the cookie. */
export function urlLocale(): Locale | null {
  try {
    const v = new URLSearchParams(location.search).get('lang');
    return v ? matchTag(v.trim()) : null;
  } catch {
    return null;
  }
}

export function guessLocale(): Locale {
  const fromUrl = urlLocale();
  if (fromUrl) {
    // an address in a language is a choice: it is remembered like the menu does, and ?lang=en returns to English
    setPref('hop_lang', fromUrl);
    storeLocale(fromUrl);
    return fromUrl;
  }
  const stored = readStored();
  if (stored && isLocale(stored)) return stored;
  const tags = navigator.languages ?? [navigator.language];
  for (const tag of tags) {
    const l = matchTag(tag);
    if (l) return l;
  }
  return 'en';
}

/** An internal link keeps the language of the address: on /?lang=de the links to /send and /changelog are
    /send?lang=de and /changelog?lang=de, so a visitor (or a crawler) who came in German stays in German.
    On a bare address, and in English, the links stay bare (English lives at the bare address). */
export function withLang(path: string): string {
  if (!urlLocale() || i18n.locale === 'en') return path;
  const hash = path.indexOf('#');
  const [p, h] = hash < 0 ? [path, ''] : [path.slice(0, hash), path.slice(hash)];
  return p + (p.includes('?') ? '&' : '?') + 'lang=' + i18n.locale + h;
}

/** The language chosen before: the family cookie hop_lang (any HOP app), then this app's own old key,
    which is moved once into the cookie (the server reads the cookie to write the page's first view). */
function readStored(): string | null {
  const family = getPref('hop_lang');
  if (family && isLocale(family)) return family;
  let old: string | null = null;
  try { old = localStorage.getItem('hop-lang'); } catch { /* storage blocked */ }
  if (family === null && old && isLocale(old)) setPref('hop_lang', old);
  return old;
}

/** The person picked a language: every HOP app follows it (hop_lang), and the old key keeps up. */
export function chooseLocale(l: Locale): void {
  setPref('hop_lang', l);
  storeLocale(l);
  // on a per-language address the address follows the choice, or a reload would bring the old language back
  try {
    const u = new URL(location.href);
    if (u.searchParams.has('lang')) {
      u.searchParams.set('lang', l);
      history.replaceState(history.state, '', u.pathname + u.search + u.hash);
    }
  } catch {
    /* no address bar to keep up */
  }
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
      return;
    }
    const loader = LOADERS[locale] ?? LOADERS.en;
    const mod = await loader();
    this.cache.set(locale, mod.default);
    this.loaded.add(locale);
    this.dict = mod.default;
    this.locale = locale;
    // only a language the person picks is stored (chooseLocale), never one guessed from the browser
    document.documentElement.lang = locale;
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
