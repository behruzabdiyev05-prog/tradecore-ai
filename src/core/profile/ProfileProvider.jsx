/**
 * The signed-in user's own profile (Phase 2B). A profile belongs to the user, not to
 * an organization: the same profile is used in every company the user works in.
 *
 * Personal settings saved here follow the user to every device:
 *   locale → the app language, preferences.theme → light/dark, preferences.sidebar → rail.
 * When the profile cannot be loaded (e.g. 2B not deployed) the app keeps working with
 * the per-browser settings exactly as before.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../auth/AuthProvider.jsx';
import { account, AVATAR_BUCKET } from '../data/account.js';
import { errorText, getLocale, setLocale, LOCALE_CODES } from '../i18n/index.js';
import { setMode, MODES } from '../ui/mode.js';
import { setRailPreference } from '../ui/rail.js';

const ProfileContext = createContext(null);

function applyPersonal(profile) {
  if (!profile) return;
  const prefs = profile.preferences ?? {};
  if (prefs.theme && MODES.includes(prefs.theme)) setMode(prefs.theme);
  if (prefs.sidebar) setRailPreference(prefs.sidebar === 'expanded');
  if (LOCALE_CODES.includes(profile.locale) && profile.locale !== getLocale()) setLocale(profile.locale);
}

export function ProfileProvider({ children }) {
  const { user } = useAuth();
  const [state, setState] = useState({ loading: true, profile: null, error: null });
  const [avatarUrl, setAvatarUrl] = useState(null);

  const load = useCallback(async () => {
    try {
      const profile = await account.profile(user.id);
      setState({ loading: false, profile, error: null });
      applyPersonal(profile);
      return profile;
    } catch (err) {
      setState({ loading: false, profile: null, error: errorText(err) });
      return null;
    }
  }, [user.id]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    let alive = true;
    account.signedUrl(AVATAR_BUCKET, state.profile?.avatar_path).then((u) => alive && setAvatarUrl(u)).catch(() => {});
    return () => { alive = false; };
  }, [state.profile?.avatar_path]);

  /** Save own profile fields. Language and personal settings apply immediately. */
  const update = useCallback(async (patch) => {
    await account.updateProfile(user.id, patch);
    const fresh = await load();
    return fresh;
  }, [user.id, load]);

  /** Merge one personal preference (theme, sidebar, onboarding_dismissed, timezone). Silent when profiles are unavailable. */
  const setPreference = useCallback(async (key, value) => {
    const current = state.profile?.preferences;
    if (!state.profile || current?.[key] === value) return;
    try {
      await account.updateProfile(user.id, { preferences: { ...(current ?? {}), [key]: value } });
      setState((s) => ({ ...s, profile: { ...s.profile, preferences: { ...(s.profile?.preferences ?? {}), [key]: value } } }));
    } catch { /* the browser setting still applies */ }
  }, [state.profile, user.id]);

  const value = useMemo(() => ({
    ...state, available: Boolean(state.profile), reload: load, update, setPreference, avatarUrl,
  }), [state, load, update, setPreference, avatarUrl]);
  return <ProfileContext.Provider value={value}>{children}</ProfileContext.Provider>;
}

const EMPTY = { loading: false, profile: null, available: false, error: null, reload: async () => null,
  update: async () => null, setPreference: async () => {}, avatarUrl: null };

export function useProfile() {
  return useContext(ProfileContext) ?? EMPTY;
}
