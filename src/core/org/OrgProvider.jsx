/**
 * Active organization + the current user's permissions in it.
 * UI hiding via usePermission/<Can> is convenience only — the database (RLS) and
 * the server (requireMember) are the real gate.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { tenancy } from '../data/tenancy.js';
import { account } from '../data/account.js';
import { errorText } from '../i18n/index.js';

const OrgContext = createContext(null);

export function OrgProvider({ children }) {
  const [state, setState] = useState({ loading: true, error: null, orgs: [] });
  const [mfaGate, setMfaGate] = useState({});   // Phase 2B: { [orgId]: true } where this session still needs 2FA
  const [switching, setSwitching] = useState(false);

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const [orgs, gate] = await Promise.all([tenancy.myOrgs(), account.mfaGate()]);
      setMfaGate(Object.fromEntries((gate ?? []).map((g) => [g.org_id, Boolean(g.required)])));
      setState({ loading: false, error: null, orgs: orgs ?? [] });
    } catch (err) {
      setState({ loading: false, error: errorText(err), orgs: [] });
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const active = state.orgs.find((o) => o.is_active) ?? state.orgs[0] ?? null;

  const switchOrg = useCallback(async (orgId) => {
    setSwitching(true);
    try {
      await tenancy.switchOrg(orgId);
      await load();
    } finally {
      setSwitching(false);
    }
  }, [load]);

  const value = useMemo(() => {
    const perms = new Set(active?.permissions ?? []);
    const modules = new Set(active?.modules ?? []);
    return {
      ...state,
      reload: load,
      switching,
      switchOrg,
      org: active,
      orgId: active?.org_id ?? null,
      role: active ? { key: active.role_key, name: active.role_name } : null,
      isOwner: active?.role_key === 'owner',
      mfaRequired: Boolean(active && mfaGate[active.org_id]),
      can: (key) => perms.has(key),
      canModule: (moduleKey, action = 'read') => modules.has(moduleKey) && perms.has(`module.${moduleKey}.${action}`),
    };
  }, [state, load, switching, switchOrg, active, mfaGate]);

  return <OrgContext.Provider value={value}>{children}</OrgContext.Provider>;
}

export function useOrg() {
  const ctx = useContext(OrgContext);
  if (!ctx) throw new Error('useOrg must be used inside <OrgProvider>');
  return ctx;
}

export function usePermission(key) {
  return useOrg().can(key);
}

export function Can({ permission, children, fallback = null }) {
  return usePermission(permission) ? children : fallback;
}
