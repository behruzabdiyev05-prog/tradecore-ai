// Public (browser-safe) configuration only. Secret keys never live here.
const env = import.meta.env ?? {};

export const config = Object.freeze({
  supabaseUrl: env.VITE_SUPABASE_URL ?? '',
  supabaseAnonKey: env.VITE_SUPABASE_ANON_KEY ?? '',
  apiBase: '/api',
  appVersion: '0.1.0',
  phase: 'Phase 2B',
});

export const isSupabaseConfigured = Boolean(
  config.supabaseUrl && config.supabaseAnonKey && !config.supabaseUrl.includes('your-project-ref'),
);
