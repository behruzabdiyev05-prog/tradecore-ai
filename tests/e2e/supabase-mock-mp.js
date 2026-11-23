/**
 * İ-4 browser-test stand-in for @supabase/supabase-js. It WRAPS the Phase 2B mock
 * (unchanged) and adds the Modul 03 tables and functions the screens use:
 * products, marketplace_listings / _orders / _order_lines / _settings / _calc_prefs,
 * supplier_offers (+ price log) and the RPCs marketplace_create_manual_order (D4/D7),
 * marketplace_delete_listing (D6), marketplace_history, marketplace_store_status.
 * It mirrors the database rules closely enough to drive the UI; the real rules are
 * tested against PostgreSQL in tests/sql/marketplace_tests.sql (303 checks).
 */
import { createClient as createBase, ORG_A, ORG_B } from './supabase-mock-2b.js';

export { ORG_A, ORG_B };
const KEY = 'e2e-db-mp';
const seed = () => ({ products: [], listings: [], orders: [], lines: [], offers: [], prices: [], settings: [], prefs: [], audit: [] });
let db = JSON.parse(localStorage.getItem(KEY) || 'null') ?? seed();
const save = () => localStorage.setItem(KEY, JSON.stringify(db));
const ok = (data) => ({ data, error: null });
const fail = (message, extra = {}) => ({ data: null, error: { message, code: '42501', ...extra } });
const uuid = () => crypto.randomUUID();
const now = () => new Date().toISOString();
const TABLE = {
  products: 'products', marketplace_listings: 'listings', marketplace_orders: 'orders', marketplace_order_lines: 'lines',
  supplier_offers: 'offers', supplier_offer_prices: 'prices', marketplace_settings: 'settings', marketplace_calc_prefs: 'prefs',
};
const LISTING_SERVER_ONLY = ['external_id', 'admin_url', 'image_url', 'variant_count', 'inventory_item_id', 'location_id', 'channel'];

export function createClient(...args) {
  const base = createBase(...args);
  let uid = null;
  base.auth.getSession().then(({ data }) => { uid = data.session?.user?.id ?? null; });
  base.auth.onAuthStateChange((_e, s) => { uid = s?.user?.id ?? null; });

  const perms = async (org) => {
    const { data } = await base.rpc('my_orgs');
    return new Set((data ?? []).find((o) => o.org_id === org)?.permissions ?? []);
  };
  const canRead = async (org) => (await perms(org)).has('module.marketplace.read');
  const canWrite = async (org) => { const p = await perms(org); return p.has('data.write') && p.has('module.marketplace.write'); };
  const logAudit = (org, table, id, changed) => db.audit.unshift({ org_id: org, table_name: table, record_id: id, at: now(), action: 'UPDATE', changed });

  function withEmbeds(table, row) {
    if (table === 'marketplace_listings') return { ...row, product: db.products.find((p) => p.id === row.product_id) ?? null };
    if (table === 'marketplace_orders') return { ...row, lines: db.lines.filter((l) => l.order_id === row.id) };
    return row;
  }

  function query(table) {
    const key = TABLE[table];
    const filters = [];
    let op = 'select'; let payload = null; let limit = Infinity; let returning = false; let upsert = false;
    const match = (r) => filters.every(([kind, c, v]) => (kind === 'eq' ? String(r[c]) === String(v)
      : kind === 'neq' ? String(r[c]) !== String(v)
        : kind === 'is' ? (v === null ? r[c] == null : r[c] === v)
          : kind === 'not' ? r[c] != null : true));
    async function exec() {
      const org = filters.find(([k, c]) => k === 'eq' && c === 'org_id')?.[2] ?? payload?.org_id;
      if (op === 'select') {
        if (!(await canRead(org))) return ok([]);
        const rows = db[key].filter(match).map((r) => withEmbeds(table, r));
        rows.sort((a, b) => String(b.created_at ?? b.placed_at ?? b.recorded_at ?? '').localeCompare(String(a.created_at ?? a.placed_at ?? a.recorded_at ?? '')));
        return ok(rows.slice(0, limit));
      }
      if (table === 'marketplace_settings') {
        if (!(await perms(org)).has('integrations.manage')) return fail('new row violates row-level security policy');
      } else if (table === 'marketplace_calc_prefs') {
        if (!(await canRead(org))) return fail('new row violates row-level security policy');
      } else if (!(await canWrite(org))) return fail('new row violates row-level security policy');

      if (op === 'insert' || upsert) {
        const rows = (Array.isArray(payload) ? payload : [payload]).map((p) => ({ id: uuid(), user_id: uid, created_at: now(), updated_at: now(), ...p }));
        for (const r of rows) {
          if (table === 'marketplace_listings') {
            if (r.channel && r.channel !== 'manual') return fail('new row violates row-level security policy');
            Object.assign(r, { channel: 'manual', stock: r.stock ?? 0, status: r.status ?? 'active', variant_count: 0,
              purchase_azn_minor: r.purchase_azn_minor ?? 0, shipping_azn_minor: r.shipping_azn_minor ?? 0, other_azn_minor: r.other_azn_minor ?? 0, sale_azn_minor: r.sale_azn_minor ?? 0 });
          }
          if (table === 'supplier_offers') {
            r.fx_rate_to_base = Number(r.fx_rate_to_base ?? 1);
            if (r.currency === 'AZN' && r.fx_rate_to_base !== 1) return fail('new row violates check constraint "supplier_offers_azn_rate"');
            r.price_azn_minor = Math.round(r.price_minor * r.fx_rate_to_base); r.shipping_azn_minor = Math.round(r.shipping_minor * r.fx_rate_to_base);
            r.last_checked_at = now();
            db.prices.push({ id: db.prices.length + 1, org_id: r.org_id, offer_id: r.id, currency: r.currency, price_minor: r.price_minor, shipping_minor: r.shipping_minor,
              fx_rate_to_base: r.fx_rate_to_base, price_azn_minor: r.price_azn_minor, shipping_azn_minor: r.shipping_azn_minor, recorded_at: now() });
          }
          if (upsert && table === 'marketplace_calc_prefs') {
            const ex = db.prefs.find((x) => x.org_id === r.org_id && x.user_id === uid);
            if (ex) { ex.calc_settings = r.calc_settings; continue; }
          }
          db[key].push(r);
        }
        save();
        return ok(returning ? rows.map((r) => ({ id: r.id })) : null);
      }
      if (op === 'update') {
        for (const r of db[key].filter(match)) {
          if (table === 'marketplace_listings' && r.channel === 'shopify' && ('stock' in payload || 'sale_azn_minor' in payload)) return fail('Shopify-dan gələn sahələr dəyişdirilə bilməz');
          if (table === 'marketplace_listings' && LISTING_SERVER_ONLY.some((c) => c in payload)) return fail('Shopify identifikatorları və məhsul bağlantısı dəyişdirilə bilməz');
          const changed = Object.fromEntries(Object.entries(payload).filter(([c, v]) => r[c] !== v).map(([c, v]) => [c, { old: r[c] ?? null, new: v }]));
          Object.assign(r, payload, { updated_at: now() });
          if (table === 'supplier_offers' && ('price_minor' in changed || 'shipping_minor' in changed || 'fx_rate_to_base' in changed)) {
            r.price_azn_minor = Math.round(r.price_minor * r.fx_rate_to_base); r.shipping_azn_minor = Math.round(r.shipping_minor * r.fx_rate_to_base);
            db.prices.push({ id: db.prices.length + 1, org_id: r.org_id, offer_id: r.id, currency: r.currency, price_minor: r.price_minor, shipping_minor: r.shipping_minor,
              fx_rate_to_base: r.fx_rate_to_base, price_azn_minor: r.price_azn_minor, shipping_azn_minor: r.shipping_azn_minor, recorded_at: now() });
          }
          if (['marketplace_listings', 'marketplace_orders', 'marketplace_order_lines'].includes(table) && Object.keys(changed).length) logAudit(r.org_id, table, r.id, changed);
        }
        save(); return ok(null);
      }
      if (op === 'delete') {
        if (table === 'marketplace_orders') {
          for (const o of db.orders.filter(match)) if (o.channel === 'manual') db.lines = db.lines.filter((l) => l.order_id !== o.id);
          db.orders = db.orders.filter((o) => !(match(o) && o.channel === 'manual'));
        } else if (table === 'products' && db.listings.some((l) => db.products.some((p) => match(p) && p.id === l.product_id))) {
          return fail('update or delete on table "products" violates foreign key constraint');
        } else db[key] = db[key].filter((r) => !match(r));
        save(); return ok(null);
      }
      return ok(null);
    }
    const b = {
      select: () => { if (op !== 'select') returning = true; return b; },
      eq: (c, v) => { filters.push(['eq', c, v]); return b; },
      neq: (c, v) => { filters.push(['neq', c, v]); return b; },
      is: (c, v) => { filters.push(['is', c, v]); return b; },
      not: (c) => { filters.push(['not', c]); return b; },
      order: () => b,
      limit: (n) => { limit = n; return b; },
      insert: (row) => { op = 'insert'; payload = row; return b; },
      upsert: (row) => { op = 'insert'; upsert = true; payload = row; return b; },
      update: (patch) => { op = 'update'; payload = patch; return b; },
      delete: () => { op = 'delete'; return b; },
      then: (res, rej) => exec().then(res, rej),
    };
    return b;
  }

  const RPC = {
    async marketplace_create_manual_order({ p_org, p_order, p_lines }) {
      if (!(await canWrite(p_org))) return fail('Bu şirkətdə sifariş yaratmaq icazəniz yoxdur');
      if (!Array.isArray(p_lines) || !p_lines.length) return fail('Sifarişdə ən azı bir sətir olmalıdır');
      if (db.orders.some((o) => o.org_id === p_org && o.channel === 'manual' && o.order_number === p_order.order_number.trim())) {
        return fail(`Bu nömrəli sifariş artıq var: ${p_order.order_number.trim()}`);
      }
      // D4: check every line first — nothing is written when stock is short
      const need = new Map();
      for (const l of p_lines) {
        const lst = db.listings.find((x) => x.id === l.listing_id && x.org_id === p_org);
        if (!lst) return fail('Məhsul bu şirkətdə tapılmadı');
        need.set(lst.id, (need.get(lst.id) ?? 0) + l.quantity);
        if (lst.stock < need.get(lst.id)) return fail(`Stok kifayət etmir. Mövcud stok: ${lst.stock}`, { code: 'P0001' });
      }
      const id = uuid();
      db.orders.push({ id, org_id: p_org, user_id: uid, channel: 'manual', order_number: p_order.order_number.trim(), external_id: null,
        customer_name: p_order.customer_name.trim(), customer_email: p_order.customer_email || null, currency: 'AZN', status: p_order.status ?? 'processing',
        tracking_number: p_order.tracking_number || null, carrier: null, note: p_order.note || null, placed_at: now(), archived_at: null, created_at: now() });
      for (const l of p_lines) {
        const lst = db.listings.find((x) => x.id === l.listing_id);
        lst.stock -= l.quantity;
        if (lst.stock <= 0 && lst.status !== 'draft') lst.status = 'out_of_stock';
        db.lines.push({ id: uuid(), org_id: p_org, order_id: id, listing_id: lst.id, variant_id: null, quantity: l.quantity,
          line_title: db.products.find((p) => p.id === lst.product_id)?.name, sale_azn_minor: l.sale_azn_minor, cost_azn_minor: l.cost_azn_minor,
          shipping_income_azn_minor: 0, tax_azn_minor: 0, discount_azn_minor: 0, fee_azn_minor: 0, refund_azn_minor: 0, cost_missing: false,
          supplier_order_number: null, supplier_order_status: 'not_ordered', supplier_ordered_at: null, supplier_paid_azn_minor: null });
      }
      save(); return ok(id);
    },
    async marketplace_delete_listing({ p_listing }) {
      const v = db.listings.find((l) => l.id === p_listing);
      if (!v) return fail('Məhsul tapılmadı');
      if (!(await canWrite(v.org_id))) return fail('Bu məhsulu silmək icazəniz yoxdur');
      const n = db.lines.filter((l) => l.listing_id === p_listing).length;
      if (n > 0) return fail(`Bu məhsulun ${n} sifariş sətri var. Sifariş tarixçəsi itməsin deyə onu silmək olmur. Qaralama edə bilərsiniz.`, { code: 'P0001', hint: 'draft' });
      db.offers = db.offers.filter((o) => o.product_id !== v.product_id);
      db.listings = db.listings.filter((l) => l.id !== p_listing);
      db.products = db.products.filter((p) => p.id !== v.product_id);
      save(); return ok(null);
    },
    async marketplace_history({ p_id }) {
      return ok(db.audit.filter((a) => a.record_id === p_id).map((a) => ({ changed_at: a.at, actor_id: uid, action: a.action, changed: a.changed })));
    },
    async marketplace_store_status({ p_org }) {
      return (await canRead(p_org)) ? ok({ connected: false, last_event_at: null, failed_events: 0 }) : ok(null);
    },
  };

  return {
    ...base,
    from: (table) => (TABLE[table] ? query(table) : base.from(table)),
    rpc: async (name, args = {}) => (RPC[name] ? RPC[name](args) : base.rpc(name, args)),
  };
}
