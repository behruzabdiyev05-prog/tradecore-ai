/**
 * Phase 3 browser-test stand-in for @supabase/supabase-js. It WRAPS the İ-4 mock
 * (tests/e2e/supabase-mock-mp.js, unchanged) and adds the tables of Modules 01, 02, 04–10:
 * companies, opportunities, trade_documents (+ lines), leads (+ activities), trading_*.
 * A small in-memory engine mirrors the rules the UI depends on (module permissions,
 * posting once, alerts firing); the real rules are tested in tests/sql/modules_tests.sql.
 */
import { createClient as createBase, ORG_A, ORG_B } from './supabase-mock-mp.js';

export { ORG_A, ORG_B };
const KEY = 'e2e-db-p3';
const TABLES = ['companies', 'opportunities', 'trade_documents', 'trade_document_lines', 'leads', 'lead_activities',
  'trading_accounts', 'trading_trades', 'trading_prices', 'trading_alerts'];
let db = JSON.parse(localStorage.getItem(KEY) || 'null') ?? Object.fromEntries(TABLES.map((t) => [t, []]));
const save = () => localStorage.setItem(KEY, JSON.stringify(db));
const ok = (data) => ({ data, error: null });
const fail = (message) => ({ data: null, error: { message, code: '42501' } });
const now = () => new Date().toISOString();
const moduleOf = {
  opportunities: (r) => r.module_key, trade_documents: (r) => r.module_key,
  trade_document_lines: (r) => db.trade_documents.find((d) => d.id === r.document_id)?.module_key,
  leads: () => 'b2b-client-finder', lead_activities: () => 'b2b-client-finder',
  trading_accounts: () => 'financial-trading', trading_trades: () => 'financial-trading', trading_prices: () => 'financial-trading', trading_alerts: () => 'financial-trading',
  companies: () => null,
};
const lineTotal = (l) => Math.round((Number(l.quantity) * Number(l.unit_price_minor) * (100 - Number(l.discount_percent ?? 0))) / 100);

export function createClient(...args) {
  const base = createBase(...args);
  let uid = null;
  base.auth.getSession().then(({ data }) => { uid = data.session?.user?.id ?? null; });
  base.auth.onAuthStateChange((_e, s) => { uid = s?.user?.id ?? null; });
  const perms = async (org) => {
    const { data } = await base.rpc('my_orgs');
    return new Set((data ?? []).find((o) => o.org_id === org)?.permissions ?? []);
  };
  const allowed = async (table, row, write) => {
    const p = await perms(row.org_id);
    const mod = moduleOf[table](row);
    if (!p.has(write ? 'data.write' : 'data.read')) return false;
    if (table === 'trading_alerts' && row.user_id && row.user_id !== uid) return false;
    return mod ? p.has(`module.${mod}.${write ? 'write' : 'read'}`) : true;
  };
  const embed = (table, r) => {
    if (table === 'trade_documents') return { ...r, lines: db.trade_document_lines.filter((l) => l.document_id === r.id) };
    if (table === 'leads') return { ...r, company: db.companies.find((c) => c.id === r.company_id) ?? null };
    return r;
  };

  function query(table) {
    const filters = []; const orders = [];
    let op = 'select'; let payload = null; let limit = Infinity; let returning = false;
    const match = (r) => filters.every(([k, c, v]) => (k === 'eq' ? String(r[c]) === String(v) : k === 'neq' ? String(r[c]) !== String(v)
      : k === 'is' ? (v === null ? r[c] == null : r[c] === v) : k === 'not' ? r[c] != null : k === 'contains' ? v.every((x) => (r[c] ?? []).includes(x)) : true));
    async function exec() {
      if (op === 'select') {
        const out = [];
        for (const r of db[table].filter(match)) if (await allowed(table, r, false)) out.push(embed(table, r));
        for (const [c, asc] of [...orders].reverse()) out.sort((a, b) => (String(a[c] ?? '') < String(b[c] ?? '') ? -1 : String(a[c] ?? '') > String(b[c] ?? '') ? 1 : 0) * (asc ? 1 : -1));
        return ok(out.slice(0, limit));
      }
      if (op === 'insert') {
        const rows = (Array.isArray(payload) ? payload : [payload]).map((p) => ({ id: table === 'trading_prices' ? db.trading_prices.length + 1 : crypto.randomUUID(), user_id: uid, created_at: now(), updated_at: now(), ...p }));
        for (const r of rows) {
          if (!(await allowed(table, r, true))) return fail('new row violates row-level security policy');
          if (table === 'trade_documents' && db.trade_documents.some((d) => d.org_id === r.org_id && d.module_key === r.module_key && d.kind === r.kind && d.number === r.number)) {
            return fail('duplicate key value violates unique constraint "trade_documents_number_uq"');
          }
          if (table === 'trade_document_lines' && db.trade_documents.find((d) => d.id === r.document_id)?.posted_at) return fail('Maliyyəyə yazılmış sənədin sətirləri dəyişdirilə bilməz');
          Object.assign(r, { status: r.status ?? (table === 'leads' ? 'new' : 'draft'), ...(table === 'leads' ? { stage: r.stage ?? 'new', services: r.services ?? [] } : {}),
            ...(table === 'trading_alerts' ? { active: true, triggered_at: null } : {}), ...(table === 'lead_activities' ? { happened_at: r.happened_at ?? now() } : {}), ...(table === 'companies' ? { roles: r.roles ?? [], social: r.social ?? {}, data_quality: r.data_quality ?? 'unverified' } : {}) });
          if (table === 'leads') delete r.status;
          db[table].push(r);
          if (table === 'trading_prices') {
            for (const a of db.trading_alerts.filter((x) => x.org_id === r.org_id && x.symbol === r.symbol && x.active)) {
              if ((a.condition === 'above' && Number(r.price) >= Number(a.price)) || (a.condition === 'below' && Number(r.price) <= Number(a.price))) {
                Object.assign(a, { active: false, triggered_at: now(), trigger_price: r.price });
              }
            }
          }
        }
        save();
        return ok(returning ? rows.map((r) => ({ id: r.id })) : null);
      }
      if (op === 'update') {
        for (const r of db[table].filter(match)) {
          if (!(await allowed(table, r, true))) continue;
          if (table === 'trade_documents' && 'posted_at' in payload) return fail('Sənəd yalnız "Maliyyəyə yaz" əməliyyatı ilə yazıla bilər');
          if (table === 'trade_document_lines' && db.trade_documents.find((d) => d.id === r.document_id)?.posted_at) return fail('Maliyyəyə yazılmış sənədin sətirləri dəyişdirilə bilməz');
          Object.assign(r, payload, { updated_at: now() });
        }
        save(); return ok(null);
      }
      if (op === 'delete') {
        const keep = [];
        for (const r of db[table]) {
          if (match(r) && (await allowed(table, r, true)) && !(table === 'trade_documents' && r.posted_at)) {
            if (table === 'trade_documents') db.trade_document_lines = db.trade_document_lines.filter((l) => l.document_id !== r.id);
            if (table === 'leads') db.lead_activities = db.lead_activities.filter((a) => a.lead_id !== r.id);
            if (table === 'trading_accounts') db.trading_trades = db.trading_trades.filter((x) => x.account_id !== r.id);
            continue;
          }
          keep.push(r);
        }
        db[table] = keep; save(); return ok(null);
      }
      return ok(null);
    }
    const b = {
      select: () => { if (op !== 'select') returning = true; return b; },
      eq: (c, v) => { filters.push(['eq', c, v]); return b; }, neq: (c, v) => { filters.push(['neq', c, v]); return b; },
      is: (c, v) => { filters.push(['is', c, v]); return b; }, not: (c) => { filters.push(['not', c]); return b; },
      contains: (c, v) => { filters.push(['contains', c, v]); return b; },
      order: (c, o) => { orders.push([c, o?.ascending !== false]); return b; }, limit: (n) => { limit = n; return b; },
      insert: (row) => { op = 'insert'; payload = row; return b; }, update: (p) => { op = 'update'; payload = p; return b; },
      delete: () => { op = 'delete'; return b; },
      then: (res, rej) => exec().then(res, rej),
    };
    return b;
  }

  const RPC = {
    async trade_document_post({ p_document }) {
      const d = db.trade_documents.find((x) => x.id === p_document);
      if (!d) return fail('Sənəd tapılmadı');
      if (!(await perms(d.org_id)).has('finance.write')) return fail('new row violates row-level security policy for table "financial_transactions"');
      if (d.kind === 'offer') return fail('Təklif maliyyəyə yazılmır — yalnız alış və satış');
      if (d.posted_at) return fail('Bu sənəd artıq maliyyəyə yazılıb');
      const total = db.trade_document_lines.filter((l) => l.document_id === d.id).reduce((s, l) => s + lineTotal(l), 0);
      if (total <= 0) return fail('Sənədin məbləği sıfırdır — əvvəlcə sətir əlavə edin');
      d.posted_at = now(); save();
      return ok(crypto.randomUUID());
    },
  };

  return {
    ...base,
    from: (table) => (TABLES.includes(table) ? query(table) : base.from(table)),
    rpc: async (name, a = {}) => (RPC[name] ? RPC[name](a) : base.rpc(name, a)),
  };
}
