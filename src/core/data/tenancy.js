/**
 * Organization / team data access (Phase 2A). Every call goes through Supabase
 * with the user's session, so RLS and the SQL RPC checks are the real gate.
 */
import { supabase } from '../auth/supabaseClient.js';
import { DataError } from './db.js';

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

export const tenancy = {
  myOrgs: () => rpc('my_orgs'),
  switchOrg: (orgId) => rpc('switch_org', { p_org: orgId }),
  createOrganization: (name) => rpc('create_organization', { p_name: name }),

  listMembers: (orgId) => rpc('list_members', { p_org: orgId }),
  roles: () => run(client().from('roles').select('id, key, name, rank').is('org_id', null).order('rank')),
  listInvites: (orgId) =>
    run(client().from('organization_invites')
      .select('id, email, role_id, expires_at, accepted_at, revoked_at, created_at')
      .eq('org_id', orgId).order('created_at', { ascending: false })),
  createInvite: (orgId, email, roleKey) => rpc('create_invite', { p_org: orgId, p_email: email, p_role_key: roleKey }),
  revokeInvite: (inviteId) => rpc('revoke_invite', { p_invite: inviteId }),
  acceptInvite: (token) => rpc('accept_invite', { p_token: token }),
  setMemberRole: (orgId, userId, roleKey) => rpc('set_member_role', { p_user: userId, p_org: orgId, p_role_key: roleKey }),
  setMemberStatus: (orgId, userId, status) => rpc('set_member_status', { p_user: userId, p_org: orgId, p_status: status }),
  removeMember: (orgId, userId) => rpc('remove_member', { p_user: userId, p_org: orgId }),

  updateOrganization: (orgId, patch) => run(client().from('organizations').update(patch).eq('id', orgId)),
  subscription: async (orgId) => {
    const subs = await run(client().from('organization_subscriptions').select('plan_id, status, current_period_end').eq('org_id', orgId));
    const sub = subs?.[0];
    if (!sub) return null;
    const plans = await run(client().from('plans').select('key, name, modules, limits').eq('id', sub.plan_id));
    return { ...sub, plan: plans?.[0] ?? null };
  },
  auditLog: (orgId, { table, limit = 200 } = {}) => {
    let q = client().from('audit_log').select('id, actor_id, table_name, record_id, action, changed, at').eq('org_id', orgId);
    if (table) q = q.eq('table_name', table);
    return run(q.order('at', { ascending: false }).limit(limit));
  },
};

/** Pending invite token (from /invite/<token>) — kept only for this browser tab. */
const PENDING_KEY = 'tc.pendingInvite';
export const pendingInvite = {
  get: () => { try { return sessionStorage.getItem(PENDING_KEY); } catch { return null; } },
  set: (token) => { try { sessionStorage.setItem(PENDING_KEY, token); } catch { /* storage unavailable */ } },
  clear: () => { try { sessionStorage.removeItem(PENDING_KEY); } catch { /* storage unavailable */ } },
};
