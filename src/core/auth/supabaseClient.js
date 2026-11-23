import { createClient } from '@supabase/supabase-js';
import { config, isSupabaseConfigured } from '../config/env.js';

/** Shared Supabase client (anon key + user session; data protected by RLS). */
export const supabase = isSupabaseConfigured
  ? createClient(config.supabaseUrl, config.supabaseAnonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    })
  : null;
