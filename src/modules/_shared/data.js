/**
 * Data access for the Phase 3 module screens. Every call uses the user's own session:
 * RLS, guard triggers and the SQL functions are the real rules; this file only shapes calls.
 */
import { supabase } from '../../core/auth/supabaseClient.js';
import { DataError } from '../../core/data/db.js';

function client() {
  if (!supabase) throw new DataError('db.not_configured');
  return supabase;
}
async function run(query) {
  const { data, error } = await query;
  if (error) throw new DataError(error.message, error);
  return data;
}
const pick = (obj, keys) => Object.fromEntries(keys.filter((k) => k in obj).map((k) => [k, obj[k]]));

const OPP_FIELDS = ['title', 'product_id', 'company_id', 'category', 'status', 'origin', 'target', 'currency', 'fx_rate_to_base',
  'buy_price_minor', 'shipping_minor', 'customs_minor', 'tax_minor', 'repair_minor', 'other_minor', 'duty_percent', 'import_vat_percent',
  'sell_currency', 'sell_fx_rate_to_base', 'sell_price_minor', 'fee_percent', 'fee_fixed_minor', 'quantity', 'demand_score',
  'competition_score', 'risk_score', 'condition', 'details', 'source_url', 'data_quality', 'notes'];
const DOC_FIELDS = ['number', 'company_id', 'counterparty_name', 'status', 'currency', 'fx_rate_to_base', 'doc_date', 'due_date',
  'valid_until', 'notes', 'terms'];
const LINE_FIELDS = ['product_id', 'position', 'description', 'quantity', 'unit', 'unit_price_minor', 'unit_cost_minor', 'discount_percent'];
const COMPANY_FIELDS = ['name', 'legal_name', 'roles', 'country_code', 'city', 'category', 'website', 'phone', 'email', 'address',
  'social', 'notes', 'source', 'source_url', 'data_quality'];
const LEAD_FIELDS = ['segment', 'is_new_business', 'stage', 'services', 'score', 'size', 'estimated_value_minor', 'next_follow_up',
  'owner_id', 'lost_reason', 'notes'];

export const data = {
  // ── opportunities (01, 04, 05, 07, 08) ──
  opportunities: (orgId, moduleKey) =>
    run(client().from('opportunities').select('*').eq('org_id', orgId).eq('module_key', moduleKey).order('created_at', { ascending: false })),
  saveOpportunity: (orgId, moduleKey, o) => (o.id
    ? run(client().from('opportunities').update(pick(o, OPP_FIELDS)).eq('id', o.id).eq('org_id', orgId))
    : run(client().from('opportunities').insert({ org_id: orgId, module_key: moduleKey, ...pick(o, OPP_FIELDS) }))),
  deleteOpportunity: (orgId, id) => run(client().from('opportunities').delete().eq('id', id).eq('org_id', orgId)),

  // ── central catalogue and counterparties ──
  products: (orgId) => run(client().from('products').select('id, name, sku, category, origin_module').eq('org_id', orgId).order('name')),
  createProduct: async (orgId, moduleKey, p) =>
    (await run(client().from('products').insert({ org_id: orgId, origin_module: moduleKey, name: p.name.trim(), sku: p.sku?.trim() || null, category: p.category?.trim() || null }).select('id')))[0].id,
  updateProduct: (orgId, id, p) => run(client().from('products').update(pick(p, ['name', 'sku', 'category', 'description'])).eq('id', id).eq('org_id', orgId)),
  deleteProduct: (orgId, id) => run(client().from('products').delete().eq('id', id).eq('org_id', orgId)),
  companies: (orgId, role) => {
    let q = client().from('companies').select('*').eq('org_id', orgId);
    if (role) q = q.contains('roles', [role]);
    return run(q.order('name'));
  },
  saveCompany: async (orgId, moduleKey, c) => {
    if (c.id) { await run(client().from('companies').update(pick(c, COMPANY_FIELDS)).eq('id', c.id).eq('org_id', orgId)); return c.id; }
    return (await run(client().from('companies').insert({ org_id: orgId, origin_module: moduleKey, ...pick(c, COMPANY_FIELDS) }).select('id')))[0].id;
  },
  deleteCompany: (orgId, id) => run(client().from('companies').delete().eq('id', id).eq('org_id', orgId)),
  supplierOffers: (orgId) =>
    run(client().from('supplier_offers').select('*').eq('org_id', orgId).order('updated_at', { ascending: false })),
  saveSupplierOffer: (orgId, moduleKey, o) => {
    const row = pick(o, ['product_id', 'company_id', 'supplier_name', 'url', 'supplier_sku', 'currency', 'price_minor', 'shipping_minor',
      'fx_rate_to_base', 'delivery_min_days', 'delivery_max_days', 'supplier_stock', 'notes', 'min_order_qty']);
    return o.id
      ? run(client().from('supplier_offers').update({ ...row, last_checked_at: new Date().toISOString() }).eq('id', o.id).eq('org_id', orgId))
      : run(client().from('supplier_offers').insert({ org_id: orgId, origin_module: moduleKey, ...row }));
  },
  deleteSupplierOffer: (orgId, id) => run(client().from('supplier_offers').delete().eq('id', id).eq('org_id', orgId)),

  // ── trade documents (02, 06, 09) ──
  documents: (orgId, moduleKey) =>
    run(client().from('trade_documents').select('*, lines:trade_document_lines(*)').eq('org_id', orgId).eq('module_key', moduleKey)
      .order('doc_date', { ascending: false }).limit(1000)),
  saveDocument: async (orgId, moduleKey, kind, doc, lines) => {
    let id = doc.id;
    if (id) await run(client().from('trade_documents').update(pick(doc, DOC_FIELDS)).eq('id', id).eq('org_id', orgId));
    else id = (await run(client().from('trade_documents').insert({ org_id: orgId, module_key: moduleKey, kind, ...pick(doc, DOC_FIELDS) }).select('id')))[0].id;
    // lines: replace the set (a posted document refuses this in the database)
    const existing = await run(client().from('trade_document_lines').select('id').eq('document_id', id));
    const keep = new Set(lines.filter((l) => l.id).map((l) => l.id));
    for (const e of existing) if (!keep.has(e.id)) await run(client().from('trade_document_lines').delete().eq('id', e.id));
    for (const [i, l] of lines.entries()) {
      const row = { ...pick(l, LINE_FIELDS), position: i + 1 };
      if (l.id) await run(client().from('trade_document_lines').update(row).eq('id', l.id));
      else await run(client().from('trade_document_lines').insert({ org_id: orgId, document_id: id, ...row }));
    }
    return id;
  },
  setDocumentStatus: (orgId, id, status) => run(client().from('trade_documents').update({ status }).eq('id', id).eq('org_id', orgId)),
  deleteDocument: (orgId, id) => run(client().from('trade_documents').delete().eq('id', id).eq('org_id', orgId)),
  postDocument: (id) => run(client().rpc('trade_document_post', { p_document: id })),

  // ── leads (09) ──
  leads: (orgId) => run(client().from('leads').select('*, company:companies(*)').eq('org_id', orgId).order('updated_at', { ascending: false })),
  saveLead: async (orgId, lead, company) => {
    const companyId = await data.saveCompany(orgId, 'b2b-client-finder', { ...company, id: lead.company_id ?? company.id });
    if (lead.id) await run(client().from('leads').update(pick(lead, LEAD_FIELDS)).eq('id', lead.id).eq('org_id', orgId));
    else {
      try {
        await run(client().from('leads').insert({ org_id: orgId, company_id: companyId, ...pick(lead, LEAD_FIELDS) }));
      } catch (err) {
        if (!company.id) await client().from('companies').delete().eq('id', companyId).eq('org_id', orgId);
        throw err;
      }
    }
  },
  updateLead: (orgId, id, patch) => run(client().from('leads').update(pick(patch, LEAD_FIELDS)).eq('id', id).eq('org_id', orgId)),
  deleteLead: async (orgId, lead) => {
    await run(client().from('leads').delete().eq('id', lead.id).eq('org_id', orgId));
    // the company was created for this lead only (prospect role, this module): remove it too
    if (lead.company?.origin_module === 'b2b-client-finder' && (lead.company?.roles ?? []).every((r) => r === 'prospect')) {
      await client().from('companies').delete().eq('id', lead.company_id).eq('org_id', orgId);
    }
  },
  activities: (orgId, leadId) =>
    run(client().from('lead_activities').select('*').eq('org_id', orgId).eq('lead_id', leadId).order('happened_at', { ascending: false })),
  addActivity: (orgId, a) => run(client().from('lead_activities').insert({ org_id: orgId, ...pick(a, ['lead_id', 'kind', 'happened_at', 'summary', 'outcome']) })),
  deleteActivity: (orgId, id) => run(client().from('lead_activities').delete().eq('id', id).eq('org_id', orgId)),

  // ── trading (10) ──
  accounts: (orgId) => run(client().from('trading_accounts').select('*').eq('org_id', orgId).order('created_at')),
  saveAccount: (orgId, a) => (a.id
    ? run(client().from('trading_accounts').update(pick(a, ['name', 'kind', 'currency', 'starting_balance', 'notes'])).eq('id', a.id).eq('org_id', orgId))
    : run(client().from('trading_accounts').insert({ org_id: orgId, ...pick(a, ['name', 'kind', 'currency', 'starting_balance', 'notes']) }))),
  deleteAccount: (orgId, id) => run(client().from('trading_accounts').delete().eq('id', id).eq('org_id', orgId)),
  trades: (orgId) => run(client().from('trading_trades').select('*').eq('org_id', orgId).order('executed_at', { ascending: false }).limit(5000)),
  saveTrade: (orgId, tr) => (tr.id
    ? run(client().from('trading_trades').update(pick(tr, ['symbol', 'market', 'side', 'quantity', 'price', 'fee', 'executed_at', 'notes', 'account_id'])).eq('id', tr.id).eq('org_id', orgId))
    : run(client().from('trading_trades').insert({ org_id: orgId, ...pick(tr, ['account_id', 'symbol', 'market', 'side', 'quantity', 'price', 'fee', 'executed_at', 'notes']) }))),
  deleteTrade: (orgId, id) => run(client().from('trading_trades').delete().eq('id', id).eq('org_id', orgId)),
  prices: (orgId) => run(client().from('trading_prices').select('id, symbol, market, price, observed_at, source').eq('org_id', orgId).order('observed_at', { ascending: true }).limit(10000)),
  addPrice: (orgId, p) => run(client().from('trading_prices').insert({ org_id: orgId, ...pick(p, ['symbol', 'market', 'price', 'observed_at', 'source']) })),
  deletePrice: (orgId, id) => run(client().from('trading_prices').delete().eq('id', id).eq('org_id', orgId)),
  alerts: (orgId) => run(client().from('trading_alerts').select('*').eq('org_id', orgId).order('created_at', { ascending: false })),
  saveAlert: (orgId, a) => run(client().from('trading_alerts').insert({ org_id: orgId, ...pick(a, ['symbol', 'condition', 'price', 'note']) })),
  setAlertActive: (orgId, id, active) => run(client().from('trading_alerts').update({ active, ...(active ? { triggered_at: null, trigger_price: null } : {}) }).eq('id', id).eq('org_id', orgId)),
  deleteAlert: (orgId, id) => run(client().from('trading_alerts').delete().eq('id', id).eq('org_id', orgId)),
};
