/**
 * i18n core functions
 */

import { en, type Messages } from './en.js';
import { zh } from './zh.js';

export type Lang = 'en' | 'zh';

const messages: Record<Lang, Messages> = { en, zh };

/**
 * Get a translated string by key path
 * @param lang - Language code
 * @param key - Dot-separated key path (e.g., 'error.notFound')
 * @param vars - Optional variables to replace {var} placeholders
 */
export function t(lang: Lang, key: string, vars?: Record<string, string | number>): string {
  const keys = key.split('.');
  let value: unknown = messages[lang];

  for (const k of keys) {
    if (value && typeof value === 'object' && k in value) {
      value = (value as Record<string, unknown>)[k];
    } else {
      return key; // Key not found, return the key itself
    }
  }

  if (typeof value !== 'string') {
    return key;
  }

  if (vars) {
    return value.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ''));
  }

  return value;
}

/**
 * Get language display name
 */
export function getLangName(lang: Lang): string {
  return lang === 'en' ? 'English' : '中文';
}

export { en, zh };
export type { Messages };
