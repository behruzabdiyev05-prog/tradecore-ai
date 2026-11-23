/**
 * TRADECORE AI — personal preferences (profiles.preferences).
 *
 * The same rule is enforced in the database by public.valid_preferences()
 * (migration 20261123000900). tests/sql/run_phase2b.sh feeds the cases from
 * scripts/preference-cases.mjs to both and fails if they disagree.
 */

export const PREFERENCES_MAX_BYTES = 8192;

const TIMEZONE_RE = /^[A-Za-z]+(\/[A-Za-z0-9_+-]+){0,2}$/;

/** Allowed keys → validator. Anything else is rejected. */
export const PREFERENCE_RULES = Object.freeze({
  theme: (v) => v === 'light' || v === 'dark',
  sidebar: (v) => v === 'expanded' || v === 'collapsed',
  onboarding_dismissed: (v) => typeof v === 'boolean',
  timezone: (v) => typeof v === 'string' && v.length <= 64 && TIMEZONE_RE.test(v),
});

export const DEFAULT_PREFERENCES = Object.freeze({ theme: 'light', sidebar: 'expanded', onboarding_dismissed: false });

/** Length in bytes of PostgreSQL's jsonb text form (`{"a": 1, "b": "x"}`), used for the size limit. */
export function pgJsonBytes(value) {
  const text = (function render(v) {
    if (Array.isArray(v)) return `[${v.map(render).join(', ')}]`;
    if (v && typeof v === 'object') return `{${Object.entries(v).map(([k, x]) => `${JSON.stringify(k)}: ${render(x)}`).join(', ')}}`;
    return JSON.stringify(v);
  })(value);
  return new TextEncoder().encode(text).length;
}

export function validPreferences(p) {
  if (!p || typeof p !== 'object' || Array.isArray(p)) return false;
  if (pgJsonBytes(p) > PREFERENCES_MAX_BYTES) return false;
  return Object.entries(p).every(([k, v]) => Object.hasOwn(PREFERENCE_RULES, k) && PREFERENCE_RULES[k](v));
}

/** Keep only valid keys (used before saving, so one bad value never blocks the rest). */
export function cleanPreferences(p) {
  const out = {};
  for (const [k, v] of Object.entries(p ?? {})) if (Object.hasOwn(PREFERENCE_RULES, k) && PREFERENCE_RULES[k](v)) out[k] = v;
  return out;
}
