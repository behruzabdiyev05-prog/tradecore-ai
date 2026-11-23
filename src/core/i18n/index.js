/**
 * Translations (Phase 2B, decision F/K): Azerbaijani is the primary language,
 * English and Russian are complete dictionaries with the same keys
 * (tests/unit/i18n.test.js checks key and placeholder parity).
 *
 * The chosen language is stored in the user's profile (profiles.locale, all devices)
 * and cached in this browser (tc.locale) for the sign-in screen.
 * Changing it re-renders the whole app (App keys its tree on the locale).
 */
import { useSyncExternalStore } from 'react';
import az from './az.js';
import en from './en.js';
import ru from './ru.js';
import { getModule } from '../../../shared/modules.js';
import { CURRENCIES, MONTH_LABELS_AZ, TRANSACTION_KINDS } from '../../../shared/finance.js';
import { ROLES } from '../../../shared/permissions.js';

export const LOCALES = Object.freeze([
  { code: 'az', label: 'Azərbaycanca', intl: 'az-AZ' },
  { code: 'en', label: 'English', intl: 'en-GB' },
  { code: 'ru', label: 'Русский', intl: 'ru-RU' },
]);
export const LOCALE_CODES = LOCALES.map((l) => l.code);
export const dictionaries = { az, en, ru };

const STORE_KEY = 'tc.locale';
const listeners = new Set();

function readStored() {
  try {
    const v = localStorage.getItem(STORE_KEY);
    return LOCALE_CODES.includes(v) ? v : 'az';
  } catch {
    return 'az';
  }
}

let current = typeof window === 'undefined' ? 'az' : readStored();
if (typeof document !== 'undefined') document.documentElement.lang = current;

export function getLocale() {
  return current;
}

export function setLocale(code) {
  if (!LOCALE_CODES.includes(code) || code === current) return;
  current = code;
  try { localStorage.setItem(STORE_KEY, code); } catch { /* storage unavailable */ }
  if (typeof document !== 'undefined') document.documentElement.lang = code;
  for (const l of listeners) l();
}

export function useLocale() {
  return useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => listeners.delete(cb); },
    () => current,
    () => current,
  );
}

/** Intl locale tag of the current language (numbers, dates). */
export function intlLocale() {
  return LOCALES.find((l) => l.code === current)?.intl ?? 'az-AZ';
}

const fill = (text, vars) => (vars ? text.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? '')) : text);

export function t(key, vars) {
  const text = dictionaries[current]?.[key] ?? dictionaries.az[key] ?? key;
  return fill(text, vars);
}

export function hasKey(key) {
  return key in dictionaries.az;
}

/** Text with an Azerbaijani source of truth outside the dictionaries (shared/*.js): AZ = the source itself. */
function sourced(key, azText, vars) {
  if (current === 'az') return fill(azText ?? '', vars);
  return fill(dictionaries[current]?.[key] ?? azText ?? '', vars);
}

/** Module texts: AZ comes from shared/modules.js (unchanged), EN/RU from the dictionaries. */
export function tModule(moduleOrKey, field) {
  const m = typeof moduleOrKey === 'string' ? getModule(moduleOrKey) : moduleOrKey;
  if (!m) return '';
  return sourced(`mod.${m.key}.${field}`, m[field]);
}
export function tModuleFeatures(m) {
  return m.features.map((f, i) => sourced(`mod.${m.key}.f${i}`, f));
}
export const tRole = (key, fallback) => sourced(`role.${key}`, ROLES.find((r) => r.key === key)?.name ?? fallback ?? key);
export const tCurrency = (code) => sourced(`cur.${code}`, CURRENCIES[code]?.name ?? code);
export const tTxKind = (kind) => sourced(`tx.${kind}`, TRANSACTION_KINDS[kind]?.label ?? kind);
export const tMonth = (i) => sourced(`month.${i}`, MONTH_LABELS_AZ[i]);

/**
 * Messages raised by the database are Azerbaijani (one source for every client).
 * In EN/RU the known ones are translated; unknown ones are shown as they are.
 */
export function tServerError(message) {
  if (!message) return message;
  // raw PostgreSQL messages (English) → plain words in every language
  if (/violates check constraint/i.test(message)) return t('srv.check_failed');
  if (/permission denied|row-level security/i.test(message)) return t('srv.permission_denied');
  if (current === 'az') return message;
  const key = Object.keys(dictionaries.az).find((k) => k.startsWith('srv.') && dictionaries.az[k] === message);
  return key ? t(key) : message;
}

export function formatDateTime(value) {
  return new Date(value).toLocaleString(intlLocale());
}
export function formatDate(value) {
  return new Date(value).toLocaleDateString(intlLocale());
}

/** "3 dəq əvvəl" style relative time (falls back to a date after a week). */
export function formatRelative(value, now = Date.now()) {
  const s = Math.round((now - new Date(value).getTime()) / 1000);
  if (s < 60) return t('time.now');
  if (s < 3600) return t('time.minutes', { n: Math.floor(s / 60) });
  if (s < 86400) return t('time.hours', { n: Math.floor(s / 3600) });
  if (s < 7 * 86400) return t('time.days', { n: Math.floor(s / 86400) });
  return formatDate(value);
}

/** User-facing text of an error: a dictionary key (client errors) or a database message. */
export function errorText(err) {
  const m = err?.message ?? String(err ?? '');
  return hasKey(m) ? t(m) : tServerError(m);
}
