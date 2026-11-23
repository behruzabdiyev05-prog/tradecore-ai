/**
 * Notifications of the signed-in user in the ACTIVE organization (Phase 2B).
 * Mounted inside the org-keyed tree, so switching organization unmounts it and
 * nothing of the previous organization stays in the bell (scenario 44).
 * New rows arrive through Supabase Realtime (own rows only — RLS applies there too);
 * without Realtime the count is refreshed every 60 s and when the tab gets focus.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../auth/AuthProvider.jsx';
import { useOrg } from '../org/OrgProvider.jsx';
import { account, features } from '../data/account.js';
import { hasKey, t, tRole } from '../i18n/index.js';

const Ctx = createContext(null);
const LATEST = 10;

/** Text of a notification in the current language (type + data), or the stored AZ text. */
export function notificationText(n) {
  const vars = { ...(n.data ?? {}) };
  if (vars.role) vars.role = tRole(vars.role);
  if (vars.status) vars.status = t(`team.status.${vars.status}`);
  const key = `notif.${n.type}${n.type === 'member.status_changed' ? `.${n.data?.status ?? 'active'}` : ''}`;
  return hasKey(key) ? t(key, vars) : n.title;
}

export function NotificationsProvider({ children }) {
  const { user } = useAuth();
  const { orgId } = useOrg();
  const [state, setState] = useState({ available: true, unread: 0, latest: [], loading: true });
  const alive = useRef(true);

  const refresh = useCallback(async () => {
    if (!orgId) return;
    try {
      const [unread, latest] = await Promise.all([account.unreadCount(orgId), account.notifications(orgId, { limit: LATEST })]);
      if (alive.current) setState({ available: true, unread: Number(unread ?? 0), latest: latest ?? [], loading: false });
    } catch {
      if (alive.current) setState({ available: false, unread: 0, latest: [], loading: false });   // 2B not deployed
    }
  }, [orgId]);

  useEffect(() => {
    alive.current = true;
    refresh();
    const unsubscribe = account.subscribeNotifications(user.id, orgId, (row) => {
      setState((s) => ({ ...s, unread: s.unread + (row.read_at ? 0 : 1), latest: [row, ...s.latest.filter((x) => x.id !== row.id)].slice(0, LATEST) }));
    });
    const onFocus = () => refresh();
    window.addEventListener('focus', onFocus);
    const timer = features.realtime() ? null : setInterval(refresh, 60_000);
    return () => { alive.current = false; unsubscribe(); window.removeEventListener('focus', onFocus); if (timer) clearInterval(timer); };
  }, [user.id, orgId, refresh]);

  const markRead = useCallback(async (ids) => {
    if (!ids.length) return;
    await account.markRead(ids);
    await refresh();
  }, [refresh]);
  const markAllRead = useCallback(async () => {
    await account.markAllRead(orgId);
    await refresh();
  }, [orgId, refresh]);

  const value = useMemo(() => ({ ...state, refresh, markRead, markAllRead }), [state, refresh, markRead, markAllRead]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useNotifications() {
  return useContext(Ctx) ?? { available: false, unread: 0, latest: [], loading: false, refresh: async () => {}, markRead: async () => {}, markAllRead: async () => {} };
}
