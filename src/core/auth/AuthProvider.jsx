import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { supabase } from './supabaseClient.js';
import { t } from '../i18n/index.js';

const AuthContext = createContext(null);

/** Translate common Supabase Auth errors (current language). */
export function authErrorMessage(error) {
  const msg = error?.message ?? '';
  if (/invalid login credentials/i.test(msg)) return t('auth.err.invalid');
  if (/email not confirmed/i.test(msg)) return t('auth.err.unconfirmed');
  if (/already registered/i.test(msg)) return t('auth.err.registered');
  if (/password should be at least/i.test(msg)) return t('auth.err.short');
  if (/rate limit/i.test(msg)) return t('auth.err.rate');
  if (/fetch/i.test(msg)) return t('auth.err.network');
  return msg || t('auth.err.unknown');
}

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(Boolean(supabase));

  useEffect(() => {
    if (!supabase) return undefined;
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (active) {
        setSession(data.session ?? null);
        setLoading(false);
      }
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => setSession(next ?? null));
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const signIn = useCallback(async (email, password) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw new Error(authErrorMessage(error));
  }, []);

  /**
   * Sign up. Without an invite a company name is required (an organization is created for the user).
   * With an invite only a flag is stored in metadata — never the token itself; after e-mail
   * confirmation the user returns to /invite/<token> to accept it.
   */
  const signUp = useCallback(async (email, password, fullName, { companyName, inviteToken } = {}) => {
    const meta = inviteToken
      ? { full_name: fullName || null, invite_token: 'pending' }
      : { full_name: fullName || null, company_name: companyName };
    const redirect = inviteToken ? `${window.location.origin}/invite/${inviteToken}` : window.location.origin;
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: meta, emailRedirectTo: redirect },
    });
    if (error) throw new Error(authErrorMessage(error));
    return { needsConfirmation: !data.session };
  }, []);

  const resetPassword = useCallback(async (email) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin });
    if (error) throw new Error(authErrorMessage(error));
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
  }, []);

  const value = useMemo(
    () => ({
      session,
      user: session?.user ?? null,
      accessToken: session?.access_token ?? null,
      loading,
      signIn,
      signUp,
      resetPassword,
      signOut,
    }),
    [session, loading, signIn, signUp, resetPassword, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
