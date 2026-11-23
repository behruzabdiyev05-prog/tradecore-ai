// Public (browser-safe) configuration only. Secret keys never live here.
const env = import.meta.env ?? {};

/** Clean a pasted value: surrounding spaces / quotes. */
const clean = (v) => String(v ?? '').trim().replace(/^['"]+|['"]+$/g, '').trim();

/**
 * Normalise the Supabase project URL so a pasted API URL still works:
 * "https://x.supabase.co/rest/v1/" → "https://x.supabase.co". Returns '' if it is not an http(s) URL.
 */
export function normalizeSupabaseUrl(value) {
  let v = clean(value);
  if (!v) return '';
  if (/^[a-z0-9-]+\.supabase\.(co|in)(\/|$)/i.test(v)) v = `https://${v}`;   // pasted without https://
  try {
    const u = new URL(v);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return '';
    return u.origin;
  } catch {
    return '';
  }
}

const rawUrl = clean(env.VITE_SUPABASE_URL);

export const config = Object.freeze({
  supabaseUrl: normalizeSupabaseUrl(rawUrl),
  supabaseAnonKey: clean(env.VITE_SUPABASE_ANON_KEY),
  apiBase: '/api',
  appVersion: '0.1.0',
  phase: 'Phase 2B',
});

/** A value was given but it is not a usable URL (shown on the setup screen instead of a blank page). */
export const supabaseUrlInvalid = Boolean(rawUrl) && !config.supabaseUrl;

export const isSupabaseConfigured = Boolean(
  config.supabaseUrl && config.supabaseAnonKey && !config.supabaseUrl.includes('your-project-ref'),
);
