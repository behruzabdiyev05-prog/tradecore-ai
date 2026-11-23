/**
 * Phase 2B browser-test stand-in for @supabase/supabase-js. It WRAPS the Phase 2A mock
 * (tests/e2e/supabase-mock.js, unchanged) and adds what Phase 2B uses:
 * profiles, organization details, notifications (+ Realtime), notification settings,
 * global search, security policy + 2FA gate, Auth MFA (TOTP), Storage.
 * It mirrors the database rules closely enough to exercise the UI; the real enforcement
 * is tested against PostgreSQL in tests/sql/phase2b_tests.sql.
 *
 * Test hooks (browser tests only): window.__e2eNotify(row), window.__e2eSetPolicy(orgId, roles).
 * Valid 2FA code in this mock: 123456.
 */
import { createClient as createBase, ORG_A, ORG_B } from './supabase-mock.js';
import { validPreferences } from '../../shared/preferences.js';

export { ORG_A, ORG_B };
const KEY = 'e2e-db-2b';
const PROFILE_COLS = ['full_name', 'phone', 'job_title', 'avatar_path', 'locale', 'base_currency', 'preferences'];
const DETAIL_COLS = ['legal_name', 'tax_id', 'address', 'phone', 'email', 'website', 'logo_path'];
const MFA_CODE = '123456';

function seed() {
  const now = Date.now();
  const iso = (minAgo) => new Date(now - minAgo * 60000).toISOString();
  return {
    profiles: {
      'u-e2e': { full_name: 'Test İstifadəçi', phone: null, job_title: null, avatar_path: null, locale: 'az', base_currency: 'AZN', preferences: {} },
    },
    details: {},              // orgId → legal details + logo_path + mfa_required_roles
    notifications: [
      { id: 'n1', org_id: ORG_A, user_id: 'u-e2e', type: 'member.joined', title: 'Aysel Məmmədova komandaya qoşuldu', data: { name: 'Aysel Məmmədova', role: 'admin' }, link: '/settings/team', read_at: null, created_at: iso(30) },
      { id: 'n2', org_id: ORG_A, user_id: 'u-e2e', type: 'invite.accepted', title: 'Murad Əliyev dəvətinizi qəbul etdi', data: { name: 'Murad Əliyev', role: 'employee' }, link: '/settings/team', read_at: null, created_at: iso(10) },
      { id: 'n3', org_id: ORG_B, user_id: 'u-e2e', type: 'member.role_changed', title: '"İkinci Şirkət" şirkətində rolunuz dəyişdi: Müşahidəçi', data: { org: 'İkinci Şirkət', role: 'viewer' }, link: '/settings/team', read_at: null, created_at: iso(5) },
      { id: 'n4', org_id: ORG_A, user_id: 'u-aysel@test.local', type: 'member.joined', title: 'Başqasının bildirişi', data: { name: 'X' }, link: '/', read_at: null, created_at: iso(1) },
    ],
    prefs: [],                // { user_id, org_id, type, enabled:false }
    records: [                // search fixture (companies / products / saved items per organization)
      { org_id: ORG_A, kind: 'company', id: 'c1', title: 'Şəhər Market', subtitle: 'Bakı', link: '/m/b2b-client-finder' },
      { org_id: ORG_A, kind: 'product', id: 'p1', title: 'Vizit kartı 90x50', subtitle: 'VK-90', link: '/search' },
      { org_id: ORG_B, kind: 'company', id: 'c2', title: 'Gizli B Market', subtitle: 'Gəncə', link: '/search' },
    ],
    factors: {},              // userId → [{ id, status, friendly_name }]
    aal: {},                  // userId → 'aal1' | 'aal2'
    files: {},                // 'bucket/path' → data URL
  };
}

let db = JSON.parse(localStorage.getItem(KEY) || 'null') ?? seed();
const save = () => localStorage.setItem(KEY, JSON.stringify(db));
const ok = (data) => ({ data, error: null });
const fail = (message, code = '42501') => ({ data: null, error: { message, code } });
const fold = (s) => String(s ?? '').replace(/[ƏəİıÖöÜüŞşÇçĞğ]/g, (c) => ({ Ə: 'e', ə: 'e', İ: 'i', ı: 'i', Ö: 'o', ö: 'o', Ü: 'u', ü: 'u', Ş: 's', ş: 's', Ç: 'c', ç: 'c', Ğ: 'g', ğ: 'g' }[c])).toLowerCase();

export function createClient(...args) {
  const base = createBase(...args);
  const channels = new Set();
  let session = null;
  base.auth.getSession().then(({ data }) => { session = data.session; });
  base.auth.onAuthStateChange((_e, s) => { session = s; });
  const uid = () => session?.user?.id;
  const aal = () => db.aal[uid()] ?? 'aal1';

  /** Active memberships of the current user, with the 2FA gate applied like member_org_ids(). */
  const memberships = async ({ gate = true } = {}) => {
    const { data } = await base.rpc('my_orgs');
    return (data ?? []).filter((o) => !gate || !(db.details[o.org_id]?.mfa_required_roles ?? []).includes(o.role_key) || aal() === 'aal2');
  };
  const memberOf = async (org) => (await memberships()).find((o) => o.org_id === org);
  const can = async (org, perm) => Boolean((await memberOf(org))?.permissions.includes(perm));

  function notifyRealtime(row) {
    for (const ch of channels) if (ch.cb && row.user_id === uid()) ch.cb({ new: row });
  }
  if (typeof window !== 'undefined') {
    window.__e2eNotify = (row) => {
      const full = { id: `n-${Date.now()}`, user_id: uid(), read_at: null, created_at: new Date().toISOString(), data: {}, link: '/notifications', ...row };
      db.notifications.unshift(full); save(); notifyRealtime(full);
    };
    window.__e2eSetPolicy = (org, roles) => { db.details[org] = { ...(db.details[org] ?? {}), mfa_required_roles: roles }; save(); };
  }

  const RPC = {
    unread_notification_count: async ({ p_org }) => {
      if (!(await memberOf(p_org))) return ok(0);
      return ok(db.notifications.filter((n) => n.org_id === p_org && n.user_id === uid() && !n.read_at).length);
    },
    mark_notifications_read: async ({ p_ids }) => {
      const orgs = new Set((await memberships()).map((o) => o.org_id));
      let n = 0;
      for (const x of db.notifications) if (p_ids.includes(x.id) && x.user_id === uid() && orgs.has(x.org_id) && !x.read_at) { x.read_at = new Date().toISOString(); n++; }
      return ok(n);
    },
    mark_all_notifications_read: async ({ p_org }) => {
      if (!(await memberOf(p_org))) return ok(0);
      let n = 0;
      for (const x of db.notifications) if (x.org_id === p_org && x.user_id === uid() && !x.read_at) { x.read_at = new Date().toISOString(); n++; }
      return ok(n);
    },
    my_activity: async ({ p_org, p_limit }) => {
      if (!(await memberOf(p_org))) return ok([]);
      const { data } = await base.from('audit_log').select('*').eq('org_id', p_org);
      return ok((data ?? []).filter((r) => r.actor_id === uid()).slice(0, Math.min(p_limit ?? 50, 100)));
    },
    global_search: async ({ p_org, p_query, p_limit }) => {
      const q = fold(String(p_query ?? '').slice(0, 100).trim());
      const lim = Math.min(Math.max(p_limit ?? 20, 0), 50);
      const m = await memberOf(p_org);
      if (q.length < 2 || !m) return ok([]);
      const out = [];
      if (m.permissions.includes('data.read')) for (const r of db.records) if (r.org_id === p_org && fold(`${r.title} ${r.subtitle}`).includes(q)) out.push({ ...r, score: 1 });
      if (m.permissions.includes('members.read')) {
        const { data } = await base.rpc('list_members', { p_org });
        for (const x of data ?? []) if (fold(`${x.full_name} ${x.email}`).includes(q)) out.push({ kind: 'member', id: x.user_id, title: x.full_name || x.email, subtitle: x.email, link: '/settings/team', score: 1 });
      }
      for (const n of db.notifications) if (n.org_id === p_org && n.user_id === uid() && fold(n.title).includes(q)) out.push({ kind: 'notification', id: n.id, title: n.title, subtitle: n.type, link: n.link, score: 1 });
      return ok(out.slice(0, lim));
    },
    set_security_policy: async ({ p_org, p_roles }) => {
      const m = (await memberships({ gate: false })).find((o) => o.org_id === p_org);
      if (m?.role_key !== 'owner') return fail('Təhlükəsizlik siyasətini yalnız Sahib dəyişə bilər');
      const current = db.details[p_org]?.mfa_required_roles ?? [];
      if ((p_roles.includes('owner') || current.includes('owner')) && aal() !== 'aal2') return fail('Əvvəlcə özünüz üçün iki addımlı girişi aktivləşdirin və onunla daxil olun');
      db.details[p_org] = { ...(db.details[p_org] ?? {}), mfa_required_roles: [...new Set(p_roles)].sort() };
      return ok(null);
    },
    org_mfa_gate: async () => ok((await memberships({ gate: false })).map((o) => ({
      org_id: o.org_id, required: (db.details[o.org_id]?.mfa_required_roles ?? []).includes(o.role_key) && aal() !== 'aal2' }))),
  };

  /** PostgREST-like builder for the Phase 2B tables (and the 2B view of organizations). */
  function query(table) {
    const filters = []; let op = 'select'; let payload = null; let limit = Infinity; let order = null;
    const match = (r) => filters.every(([kind, c, v]) => (kind === 'eq' ? r[c] === v : kind === 'is' ? r[c] == null : kind === 'lt' ? r[c] < v : true));
    const exec = async () => {
      const me = uid();
      if (!me) return fail('JWT required');
      if (table === 'profiles') {
        if (op === 'select') return ok(filters.some(([, c, v]) => c === 'id' && v === me) && db.profiles[me] ? [{ id: me, ...db.profiles[me] }] : []);
        if (op === 'update') {
          const id = filters.find(([, c]) => c === 'id')?.[2];
          if (Object.keys(payload).some((k) => !PROFILE_COLS.includes(k))) return fail('permission denied for table profiles');
          if (id !== me) return ok(null);
          if (payload.preferences && !validPreferences(payload.preferences)) return fail('new row for relation "profiles" violates check constraint "profiles_preferences_check"', '23514');
          if (payload.phone && !/^\+?[0-9 ()-]{5,20}$/.test(payload.phone)) return fail('new row for relation "profiles" violates check constraint "profiles_phone_check"', '23514');
          if (payload.locale && !['az', 'en', 'ru'].includes(payload.locale)) return fail('violates check constraint "profiles_locale_check"', '23514');
          db.profiles[me] = { ...(db.profiles[me] ?? {}), ...payload }; save(); return ok(null);
        }
      }
      if (table === 'organizations' && op === 'select') {
        const { data } = await base.from('organizations').select('*');
        return ok((data ?? []).filter(match).map((o) => ({ ...Object.fromEntries(DETAIL_COLS.map((k) => [k, null])), mfa_required_roles: [], ...o, ...(db.details[o.id] ?? {}) })));
      }
      if (table === 'organizations' && op === 'update') {
        const id = filters.find(([, c]) => c === 'id')?.[2];
        if ('mfa_required_roles' in payload) return fail('permission denied for table organizations');
        if (!(await can(id, 'org.manage'))) return ok(null);
        if (payload.tax_id && !/^[0-9]{10}$/.test(payload.tax_id)) return fail('violates check constraint "organizations_tax_id_check"', '23514');
        const detail = Object.fromEntries(Object.entries(payload).filter(([k]) => DETAIL_COLS.includes(k)));
        const rest = Object.fromEntries(Object.entries(payload).filter(([k]) => !DETAIL_COLS.includes(k)));
        db.details[id] = { ...(db.details[id] ?? {}), ...detail }; save();
        return Object.keys(rest).length ? base.from('organizations').update(rest).eq('id', id) : ok(null);
      }
      if (table === 'notifications') {
        if (op !== 'select') return fail('permission denied for table notifications');
        const orgs = new Set((await memberships()).map((o) => o.org_id));
        let rows = db.notifications.filter((n) => n.user_id === me && orgs.has(n.org_id)).filter(match);
        if (order) rows = rows.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
        return ok(rows.slice(0, limit));
      }
      if (table === 'notification_preferences') {
        const orgs = new Set((await memberships()).map((o) => o.org_id));
        if (op === 'select') return ok(db.prefs.filter((p) => p.user_id === me && orgs.has(p.org_id)).filter(match));
        if (op === 'insert') {
          if (payload.user_id !== me || !orgs.has(payload.org_id)) return fail('new row violates row-level security policy');
          if (!db.prefs.some((p) => p.user_id === me && p.org_id === payload.org_id && p.type === payload.type)) db.prefs.push({ ...payload });
          save(); return ok(null);
        }
        if (op === 'delete') { db.prefs = db.prefs.filter((p) => !(p.user_id === me && match(p))); save(); return ok(null); }
      }
      return base.from(table);
    };
    const b = {
      select: () => b, eq: (c, v) => { filters.push(['eq', c, v]); return b; }, is: (c) => { filters.push(['is', c]); return b; },
      lt: (c, v) => { filters.push(['lt', c, v]); return b; }, gte: () => b, order: (c) => { order = c; return b; }, limit: (n) => { limit = n; return b; },
      insert: (row) => { op = 'insert'; payload = row; return b; }, update: (p) => { op = 'update'; payload = p; return b; }, delete: () => { op = 'delete'; return b; },
      then: (res, rej) => exec().then(res, rej),
    };
    return b;
  }

  const factorsOf = () => (db.factors[uid()] ??= []);
  const mfa = {
    listFactors: async () => ok({ totp: factorsOf().filter((f) => f.status === 'verified'), all: factorsOf() }),
    getAuthenticatorAssuranceLevel: async () => ok({ currentLevel: aal(), nextLevel: factorsOf().some((f) => f.status === 'verified') ? 'aal2' : aal() }),
    enroll: async () => {
      const f = { id: `f-${Date.now()}`, status: 'unverified', friendly_name: 'TOTP' };
      factorsOf().push(f); save();
      const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="180" height="180"><rect width="180" height="180" fill="#fff"/><rect x="20" y="20" width="40" height="40"/><rect x="120" y="20" width="40" height="40"/><rect x="20" y="120" width="40" height="40"/></svg>';
      return ok({ id: f.id, totp: { qr_code: `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`, secret: 'JBSWY3DPEHPK3PXP' } });
    },
    challenge: async () => ok({ id: `ch-${Date.now()}` }),
    verify: async ({ factorId, code }) => {
      if (code !== MFA_CODE) return { data: null, error: { message: 'Invalid TOTP code entered' } };
      const f = factorsOf().find((x) => x.id === factorId);
      if (!f) return { data: null, error: { message: 'Factor not found' } };
      f.status = 'verified'; db.aal[uid()] = 'aal2'; save();
      return ok({});
    },
    unenroll: async ({ factorId }) => { db.factors[uid()] = factorsOf().filter((f) => f.id !== factorId); save(); return ok({}); },
  };

  const storage = {
    from: (bucket) => ({
      upload: async (path, file) => {
        const [folder] = path.split('/');
        if (bucket === 'avatars' && folder !== uid()) return { error: { message: 'new row violates row-level security policy' } };
        if (bucket === 'org-logos' && !(await can(folder, 'org.manage'))) return { error: { message: 'new row violates row-level security policy' } };
        const url = await new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(file); });
        db.files[`${bucket}/${path}`] = url; save();
        return { data: { path }, error: null };
      },
      remove: async (paths) => { for (const p of paths) delete db.files[`${bucket}/${p}`]; save(); return { data: [], error: null }; },
      createSignedUrl: async (path) => (db.files[`${bucket}/${path}`] ? { data: { signedUrl: db.files[`${bucket}/${path}`] }, error: null } : { data: null, error: { message: 'not found' } }),
    }),
  };

  return {
    ...base,
    auth: {
      ...base.auth,
      signInWithPassword: async (creds) => {
        // a password sign-in always starts at aal1 — set BEFORE the base mock announces the new session
        const id = creds.email.toLowerCase() === 'demo@tradecore.test' ? 'u-e2e' : `u-${creds.email.toLowerCase()}`;
        if (creds.password === 'correct-password') {
          db.aal[id] = 'aal1';
          db.profiles[id] ??= { full_name: null, phone: null, job_title: null, avatar_path: null, locale: 'az', base_currency: 'AZN', preferences: {} };
          save();
        }
        return base.auth.signInWithPassword(creds);
      },
      signOut: async (opts) => (opts?.scope === 'others' ? { error: null } : base.auth.signOut(opts)),
      updateUser: async () => ({ data: { user: session?.user }, error: null }),
      mfa,
    },
    from: (table) => (['profiles', 'organizations', 'notifications', 'notification_preferences'].includes(table) ? query(table) : base.from(table)),
    rpc: async (name, args = {}) => {
      if (RPC[name]) { const r = await RPC[name](args); save(); return r; }
      return base.rpc(name, args);
    },
    channel: () => {
      const ch = { cb: null, on: (_t, _f, cb) => { ch.cb = cb; return ch; }, subscribe: () => { channels.add(ch); return ch; } };
      return ch;
    },
    removeChannel: (ch) => { channels.delete(ch); },
    storage,
  };
}
