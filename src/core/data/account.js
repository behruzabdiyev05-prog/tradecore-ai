/**
 * Phase 2B data access: profile, preferences, notifications, search, 2FA, files.
 * Every call uses the user's own session — RLS, column grants and the SQL functions
 * are the real gate. Supabase features that a deployment may not have (Storage,
 * Realtime, MFA) are detected, never assumed: callers get `available: false`.
 */
import { supabase } from '../auth/supabaseClient.js';
import { DataError } from './db.js';
import { cleanPreferences } from '../../../shared/preferences.js';

export const AVATAR_BUCKET = 'avatars';
export const LOGO_BUCKET = 'org-logos';
export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
export const IMAGE_MAX_BYTES = 2 * 1024 * 1024;
export const PROFILE_COLUMNS = 'id, full_name, phone, job_title, avatar_path, locale, base_currency, preferences';
export const ORG_DETAIL_COLUMNS = 'id, name, base_currency, legal_name, tax_id, address, phone, email, website, logo_path, mfa_required_roles';

/** Notification types created by the database (0010) — shown in notification settings. */
export const NOTIFICATION_TYPES = ['member.joined', 'invite.accepted', 'member.role_changed', 'member.status_changed', 'security.policy_changed'];

function client() {
  if (!supabase) throw new DataError('db.not_configured');
  return supabase;
}
async function run(query) {
  const { data, error } = await query;
  if (error) throw new DataError(error.message, error);
  return data;
}
const rpc = (name, args) => run(client().rpc(name, args));

export const features = {
  storage: () => Boolean(supabase?.storage?.from),
  realtime: () => typeof supabase?.channel === 'function',
  mfa: () => Boolean(supabase?.auth?.mfa?.listFactors),
};

/** Validate an image before upload (the bucket enforces the same limits server-side). */
export function checkImage(file) {
  if (!file) return 'file.none';
  if (!IMAGE_TYPES.includes(file.type)) return 'file.type';
  if (file.size > IMAGE_MAX_BYTES) return 'file.size';
  return null;
}
const ext = (file) => ({ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }[file.type]);

export const account = {
  // ── profile ──────────────────────────────────────────────
  profile: async (userId) => (await run(client().from('profiles').select(PROFILE_COLUMNS).eq('id', userId)))?.[0] ?? null,
  /** Only the columns the database lets a user write (active_org_id is not one of them). */
  updateProfile: (userId, patch) => {
    const allowed = ['full_name', 'phone', 'job_title', 'avatar_path', 'locale', 'base_currency', 'preferences'];
    const body = Object.fromEntries(Object.entries(patch).filter(([k]) => allowed.includes(k)));
    if (body.preferences) body.preferences = cleanPreferences(body.preferences);
    return run(client().from('profiles').update(body).eq('id', userId));
  },

  // ── files (private buckets; shown through short-lived signed URLs) ──
  uploadImage: async (bucket, folder, file, name) => {
    if (!features.storage()) throw new DataError('storage.unavailable');
    const path = `${folder}/${name}-${Date.now()}.${ext(file)}`;
    const { error } = await client().storage.from(bucket).upload(path, file, { contentType: file.type, upsert: false });
    if (error) throw new DataError(error.message, error);
    return path;
  },
  removeImage: async (bucket, path) => {
    if (!features.storage() || !path) return;
    await client().storage.from(bucket).remove([path]);
  },
  signedUrl: async (bucket, path) => {
    if (!features.storage() || !path) return null;
    const { data, error } = await client().storage.from(bucket).createSignedUrl(path, 3600);
    return error ? null : data?.signedUrl ?? null;
  },

  // ── organization details & security policy ───────────────
  orgDetails: async (orgId) => (await run(client().from('organizations').select(ORG_DETAIL_COLUMNS).eq('id', orgId)))?.[0] ?? null,
  setSecurityPolicy: (orgId, roles) => rpc('set_security_policy', { p_org: orgId, p_roles: roles }),
  mfaGate: async () => {
    try { return (await rpc('org_mfa_gate')) ?? []; } catch { return []; }   // not deployed → no gate
  },

  // ── notifications ────────────────────────────────────────
  notifications: (orgId, { unreadOnly = false, type = '', limit = 20, before = null } = {}) => {
    let q = client().from('notifications')
      .select('id, type, title, body, link, data, read_at, created_at')
      .eq('org_id', orgId);
    if (unreadOnly) q = q.is('read_at', null);
    if (type) q = q.eq('type', type);
    if (before) q = q.lt('created_at', before);
    return run(q.order('created_at', { ascending: false }).limit(limit));
  },
  unreadCount: (orgId) => rpc('unread_notification_count', { p_org: orgId }),
  markRead: (ids) => rpc('mark_notifications_read', { p_ids: ids }),
  markAllRead: (orgId) => rpc('mark_all_notifications_read', { p_org: orgId }),
  myActivity: (orgId, { limit = 50, before = null } = {}) => rpc('my_activity', { p_org: orgId, p_limit: limit, p_before: before }),

  /** Realtime: only INSERTs of the user's own rows (Realtime applies RLS too). Returns an unsubscribe function. */
  subscribeNotifications: (userId, orgId, onInsert) => {
    if (!features.realtime()) return () => {};
    const ch = client().channel(`notifications:${userId}:${orgId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` },
        (payload) => { if (payload?.new?.org_id === orgId) onInsert(payload.new); })
      .subscribe();
    return () => { try { client().removeChannel(ch); } catch { /* already closed */ } };
  },

  // ── notification settings: a row only exists for a type that is switched OFF ──
  notificationPrefs: (orgId) => run(client().from('notification_preferences').select('type, enabled').eq('org_id', orgId)),
  setNotificationEnabled: (userId, orgId, type, enabled) => (enabled
    ? run(client().from('notification_preferences').delete().eq('org_id', orgId).eq('type', type).eq('user_id', userId))
    : run(client().from('notification_preferences').insert({ user_id: userId, org_id: orgId, type, enabled: false }))),

  // ── search ───────────────────────────────────────────────
  search: (orgId, query, limit = 20) => rpc('global_search', { p_org: orgId, p_query: query, p_limit: limit }),

  // ── auth: password, e-mail, sessions, 2FA ────────────────
  /**
   * Re-authenticate with the current password, then set the new one.
   * Signing in again gives a password-only (aal1) session; when 2FA is on, the code is
   * verified right away so the session is back at aal2 before the password is changed.
   */
  changePassword: async (email, current, next, mfaCode = null) => {
    const { error: e1 } = await client().auth.signInWithPassword({ email, password: current });
    if (e1) throw new DataError('password.current_wrong', e1);
    const { totp } = await account.mfaFactors();
    if (totp[0]) {
      if (!mfaCode) throw new DataError('mfa.code_needed');
      await account.mfaVerify(totp[0].id, mfaCode);
    }
    const { error } = await client().auth.updateUser({ password: next });
    if (error) throw new DataError(error.message, error);
  },
  changeEmail: async (email) => {
    const { error } = await client().auth.updateUser({ email });
    if (error) throw new DataError(error.message, error);
  },
  signOutOthers: async () => {
    const { error } = await client().auth.signOut({ scope: 'others' });
    if (error) throw new DataError(error.message, error);
  },
  mfaFactors: async () => {
    if (!features.mfa()) return { available: false, totp: [] };
    const { data, error } = await client().auth.mfa.listFactors();
    if (error) throw new DataError(error.message, error);
    return { available: true, totp: (data?.totp ?? []).filter((f) => f.status === 'verified') };
  },
  mfaLevel: async () => {
    if (!features.mfa()) return { currentLevel: null, nextLevel: null };
    const { data } = await client().auth.mfa.getAuthenticatorAssuranceLevel();
    return data ?? { currentLevel: null, nextLevel: null };
  },
  mfaEnroll: async () => {
    const { data, error } = await client().auth.mfa.enroll({ factorType: 'totp', friendlyName: `TRADECORE ${Date.now()}` });
    if (error) throw new DataError(error.message, error);
    return { factorId: data.id, qr: data.totp?.qr_code, secret: data.totp?.secret };
  },
  /** challenge + verify; on success the session is upgraded to aal2. */
  mfaVerify: async (factorId, code) => {
    const { data: ch, error: e1 } = await client().auth.mfa.challenge({ factorId });
    if (e1) throw new DataError(e1.message, e1);
    const { error } = await client().auth.mfa.verify({ factorId, challengeId: ch.id, code });
    if (error) throw new DataError('mfa.code_wrong', error);
  },
  mfaUnenroll: async (factorId) => {
    const { error } = await client().auth.mfa.unenroll({ factorId });
    if (error) throw new DataError(error.message, error);
  },
};
