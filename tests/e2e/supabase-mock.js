/**
 * In-browser stand-in for @supabase/supabase-js used ONLY by the local
 * E2E harness (aliased at bundle time). It emulates the Phase 2A backend
 * contract (RPCs + RLS-like filtering) with an in-memory database kept in
 * localStorage. Real enforcement is tested in tests/sql against PostgreSQL.
 *
 * Fixture: user demo@tradecore.test is Owner of "Test Şirkəti" (empty ledger)
 * and Viewer of "İkinci Şirkət" (has 1 000,00 ₼ revenue).
 */
import { ROLES, ROLE_MATRIX, canAssignRole } from '../../shared/permissions.js';
import { MODULE_KEYS } from '../../shared/modules.js';

export const ORG_A = '0a000000-0000-4000-8000-00000000000a';
export const ORG_B = '0b000000-0000-4000-8000-00000000000b';
const DEMO = 'u-e2e';
const listeners = new Set();
const SKEY = 'e2e-session';
const DKEY = 'e2e-db';

const roleId = (key) => `r-${key}`;
const roleKey = (id) => id.slice(2);
const userIdFor = (email) => (email === 'demo@tradecore.test' ? DEMO : `u-${email}`);

function seed() {
  const now = new Date().toISOString();
  return {
    users: {
      [DEMO]: { email: 'demo@tradecore.test', full_name: 'Test İstifadəçi', active: ORG_A },
      'u-aysel@test.local': { email: 'aysel@test.local', full_name: 'Aysel Məmmədova', active: ORG_A },
      'u-murad@test.local': { email: 'murad@test.local', full_name: 'Murad Əliyev', active: ORG_A },
    },
    orgs: [
      { id: ORG_A, name: 'Test Şirkəti', base_currency: 'AZN', status: 'active' },
      { id: ORG_B, name: 'İkinci Şirkət', base_currency: 'AZN', status: 'active' },
    ],
    members: [
      { org_id: ORG_A, user_id: DEMO, role: 'owner', status: 'active', joined_at: now },
      { org_id: ORG_A, user_id: 'u-aysel@test.local', role: 'admin', status: 'active', joined_at: now },
      { org_id: ORG_A, user_id: 'u-murad@test.local', role: 'employee', status: 'active', joined_at: now },
      { org_id: ORG_B, user_id: DEMO, role: 'viewer', status: 'active', joined_at: now },
    ],
    invites: [],
    audit: [
      { id: 1, org_id: ORG_A, actor_id: null, table_name: 'organizations', record_id: ORG_A, action: 'INSERT', changed: { name: 'Test Şirkəti' }, at: now },
      { id: 2, org_id: ORG_A, actor_id: DEMO, table_name: 'organization_members', record_id: 'm2', action: 'INSERT', changed: { role_id: 'r-admin', status: 'active' }, at: now },
    ],
    finance: [
      { org_id: ORG_B, module_key: 'wholesale', tx_count: 1, revenue_minor: 100000, cogs_minor: 0, expenses_minor: 0,
        gross_profit_minor: 100000, net_profit_minor: 100000, cash_flow_minor: 100000 },
    ],
  };
}

let db = JSON.parse(localStorage.getItem(DKEY) || 'null') ?? seed();
const save = () => localStorage.setItem(DKEY, JSON.stringify(db));
let session = JSON.parse(localStorage.getItem(SKEY) || 'null');

function emit(evt) {
  if (session) localStorage.setItem(SKEY, JSON.stringify(session)); else localStorage.removeItem(SKEY);
  for (const l of listeners) l(evt, session);
}

const uid = () => session?.user?.id;
const member = (org, user = uid()) => db.members.find((m) => m.org_id === org && m.user_id === user);
const activeMember = (org) => { const m = member(org); return m?.status === 'active' ? m : null; };
const can = (org, perm) => { const m = activeMember(org); return Boolean(m && ROLE_MATRIX[m.role].includes(perm)); };
const fail = (message) => ({ data: null, error: { message, code: '42501' } });
const ok = (data) => ({ data, error: null });
const audit = (org, table, action, changed) => {
  db.audit.unshift({ id: db.audit.length + 1, org_id: org, actor_id: uid(), table_name: table, record_id: null, action, changed, at: new Date().toISOString() });
};
const ownersLeft = (org, exceptUser) =>
  db.members.filter((m) => m.org_id === org && m.role === 'owner' && m.status === 'active' && m.user_id !== exceptUser).length;

const RPC = {
  my_orgs: () => ok(db.members.filter((m) => m.user_id === uid() && m.status === 'active').map((m) => {
    const o = db.orgs.find((x) => x.id === m.org_id);
    return { org_id: o.id, name: o.name, base_currency: o.base_currency, role_key: m.role,
      role_name: ROLES.find((r) => r.key === m.role).name, permissions: ROLE_MATRIX[m.role], modules: [...MODULE_KEYS],
      is_active: db.users[uid()]?.active === o.id };
  })),
  switch_org: ({ p_org }) => {
    if (!activeMember(p_org)) return fail('Bu şirkətin üzvü deyilsiniz');
    db.users[uid()].active = p_org; return ok(null);
  },
  create_organization: ({ p_name }) => {
    const id = `0c000000-0000-4000-8000-${String(db.orgs.length).padStart(12, '0')}`;
    db.orgs.push({ id, name: p_name, base_currency: 'AZN', status: 'active' });
    db.members.push({ org_id: id, user_id: uid(), role: 'owner', status: 'active', joined_at: new Date().toISOString() });
    if (!db.users[uid()].active) db.users[uid()].active = id;
    return ok(id);
  },
  list_members: ({ p_org }) => {
    if (!can(p_org, 'members.read')) return fail('İcazə yoxdur');
    return ok(db.members.filter((m) => m.org_id === p_org).map((m) => ({
      user_id: m.user_id, email: db.users[m.user_id].email, full_name: db.users[m.user_id].full_name,
      role_key: m.role, role_name: ROLES.find((r) => r.key === m.role).name, status: m.status, joined_at: m.joined_at })));
  },
  create_invite: ({ p_org, p_email, p_role_key }) => {
    if (!can(p_org, 'members.manage')) return fail('Dəvət göndərmək icazəniz yoxdur');
    if (!canAssignRole({ actorRole: member(p_org).role, targetCurrentRole: null, newRole: p_role_key, isSelf: false })) return fail('Bu rolu təyin etmək icazəniz yoxdur');
    const token = Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, '0')).join('');
    db.invites.push({ id: `i-${db.invites.length + 1}`, org_id: p_org, email: p_email.toLowerCase(), role_id: roleId(p_role_key),
      token, expires_at: new Date(Date.now() + 7 * 864e5).toISOString(), accepted_at: null, revoked_at: null, created_at: new Date().toISOString() });
    audit(p_org, 'organization_invites', 'INSERT', { email: p_email });
    return ok(token);
  },
  revoke_invite: ({ p_invite }) => {
    const i = db.invites.find((x) => x.id === p_invite);
    if (!i || !can(i.org_id, 'members.manage')) return fail('İcazə yoxdur');
    i.revoked_at = new Date().toISOString(); return ok(null);
  },
  accept_invite: ({ p_token }) => {
    const i = db.invites.find((x) => x.token === p_token);
    if (!i) return { data: null, error: { message: 'Dəvət etibarsızdır' } };
    if (i.revoked_at) return { data: null, error: { message: 'Dəvət ləğv edilib' } };
    if (i.accepted_at) return { data: null, error: { message: 'Dəvət artıq istifadə olunub' } };
    if (session.user.email.toLowerCase() !== i.email) return fail('Dəvət başqa e-poçt ünvanı üçündür');
    db.users[uid()] ??= { email: session.user.email, full_name: null, active: null };
    db.members.push({ org_id: i.org_id, user_id: uid(), role: roleKey(i.role_id), status: 'active', joined_at: new Date().toISOString() });
    i.accepted_at = new Date().toISOString();
    if (!db.users[uid()].active) db.users[uid()].active = i.org_id;
    audit(i.org_id, 'organization_members', 'INSERT', { status: 'active' });
    return ok(i.org_id);
  },
  set_member_role: ({ p_user, p_org, p_role_key }) => {
    const t = member(p_org, p_user);
    if (!can(p_org, 'members.manage') || !t) return fail('İcazə yoxdur');
    if (!canAssignRole({ actorRole: member(p_org).role, targetCurrentRole: t.role, newRole: p_role_key, isSelf: p_user === uid() })) return fail('Bu dəyişiklik üçün icazəniz yoxdur');
    if (t.role === 'owner' && p_role_key !== 'owner' && ownersLeft(p_org, p_user) === 0) return fail('Şirkətin sonuncu Sahibi silinə, dayandırıla və ya rolu azaldıla bilməz');
    audit(p_org, 'organization_members', 'UPDATE', { role_id: { old: roleId(t.role), new: roleId(p_role_key) } });
    t.role = p_role_key; return ok(null);
  },
  set_member_status: ({ p_user, p_org, p_status }) => {
    const t = member(p_org, p_user);
    if (!can(p_org, 'members.manage') || !t || p_user === uid()) return fail('İcazə yoxdur');
    if (!canAssignRole({ actorRole: member(p_org).role, targetCurrentRole: t.role,
      newRole: ['owner', 'admin'].includes(t.role) ? t.role : 'viewer', isSelf: false })) return fail('Bu dəyişiklik üçün icazəniz yoxdur');
    audit(p_org, 'organization_members', 'UPDATE', { status: { old: t.status, new: p_status } });
    t.status = p_status; return ok(null);
  },
  remove_member: ({ p_user, p_org }) => {
    const t = member(p_org, p_user);
    if (!t) return fail('Üzv tapılmadı');
    if (t.role === 'owner' && ownersLeft(p_org, p_user) === 0) return fail('Şirkətin sonuncu Sahibi silinə bilməz');
    db.members = db.members.filter((m) => m !== t);
    audit(p_org, 'organization_members', 'DELETE', {});
    return ok(null);
  },
};

/** Minimal PostgREST-like query builder with RLS-style filtering. */
function query(table) {
  const filters = [];
  let head = false; let op = 'select'; let payload = null; let limit = Infinity;
  const rows = () => {
    switch (table) {
      case 'modules': return MODULE_KEYS.map((key) => ({ key }));
      case 'roles': return ROLES.map((r, i) => ({ id: roleId(r.key), key: r.key, name: r.name, rank: (i + 1) * 10, org_id: null }));
      case 'finance_module_summary': return db.finance.filter((r) => can(r.org_id, 'finance.read'));
      case 'organization_invites': return db.invites.filter((i) => can(i.org_id, 'members.manage'))
        .map(({ token, ...rest }) => rest);   // token never readable (only a hash exists in the real DB)
      case 'audit_log': return db.audit.filter((a) => can(a.org_id, 'audit.read'));
      case 'organization_subscriptions': return db.orgs.filter((o) => activeMember(o.id)).map((o) => ({ org_id: o.id, plan_id: 'p-internal', status: 'active', current_period_end: null }));
      case 'plans': return [{ id: 'p-internal', key: 'internal', name: 'Daxili plan', modules: [...MODULE_KEYS], limits: {} }];
      case 'organizations': return db.orgs.filter((o) => activeMember(o.id));
      default: return [];   // financial_transactions, saved_items, module_events, …: empty ledger
    }
  };
  const exec = () => {
    if (op === 'update' && table === 'organizations') {
      const id = filters.find((f) => f[0] === 'id')?.[1];
      if (!can(id, 'org.manage')) return fail('İcazə yoxdur');
      Object.assign(db.orgs.find((o) => o.id === id), payload);
      audit(id, 'organizations', 'UPDATE', Object.fromEntries(Object.entries(payload).map(([k, v]) => [k, { new: v }])));
      save(); return ok(null);
    }
    if (op !== 'select') return ok(null);
    const data = rows().filter((r) => filters.every(([c, v]) => (v === null ? r[c] == null : r[c] === v))).slice(0, limit);
    return head ? { data: null, count: data.length, error: null } : ok(data);
  };
  const b = {
    select: (_c, opts) => { head = Boolean(opts?.head); return b; },
    eq: (c, v) => { filters.push([c, v]); return b; },
    is: (c, v) => { filters.push([c, v]); return b; },
    gte: () => b, order: () => b, limit: (n) => { limit = n; return b; },
    insert: (row) => { op = 'insert'; payload = row; return b; },
    update: (patch) => { op = 'update'; payload = patch; return b; },
    then: (res, rej) => Promise.resolve().then(exec).then(res, rej),
  };
  return b;
}

export function createClient() {
  return {
    auth: {
      getSession: async () => ({ data: { session } }),
      onAuthStateChange: (cb) => { listeners.add(cb); return { data: { subscription: { unsubscribe: () => listeners.delete(cb) } } }; },
      signInWithPassword: async ({ email, password }) => {
        if (password !== 'correct-password') return { error: { message: 'Invalid login credentials' } };
        const id = userIdFor(email.toLowerCase());
        if (!db.users[id]) {
          db.users[id] = { email, full_name: null, active: null };
          // Real signup creates the user's own organization unless they came through an invite.
          let invited = false;
          try { invited = Boolean(sessionStorage.getItem('tc.pendingInvite')); } catch { /* ignore */ }
          if (!invited) {
            const orgId = `0d000000-0000-4000-8000-${String(db.orgs.length).padStart(12, '0')}`;
            db.orgs.push({ id: orgId, name: `${email} şirkəti`, base_currency: 'AZN', status: 'active' });
            db.members.push({ org_id: orgId, user_id: id, role: 'owner', status: 'active', joined_at: new Date().toISOString() });
            db.users[id].active = orgId;
          }
        }
        save();
        session = { access_token: id === DEMO ? 'mock-token' : `mock-token:${id}`,
          user: { id, email, user_metadata: { full_name: db.users[id].full_name ?? undefined } } };
        emit('SIGNED_IN');
        return { data: { session }, error: null };
      },
      signUp: async () => ({ data: { session: null }, error: null }),
      resetPasswordForEmail: async () => ({ error: null }),
      signOut: async () => { session = null; emit('SIGNED_OUT'); return { error: null }; },
    },
    from: query,
    rpc: async (name, args = {}) => {
      if (!session) return fail('JWT required');
      const res = RPC[name] ? RPC[name](args) : { data: null, error: { message: `unknown rpc ${name}` } };
      save();
      return res;
    },
  };
}
