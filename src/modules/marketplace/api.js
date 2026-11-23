/**
 * Modul 03 (Marketplace) data access. Everything goes through Supabase with the
 * user's own session: RLS, the D1 guard triggers and the SQL functions are the
 * real rules; this file only shapes the calls.
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

const LISTING_COLS = 'id, product_id, channel, external_id, admin_url, image_url, supplier_name, supplier_url, '
  + 'purchase_azn_minor, shipping_azn_minor, other_azn_minor, sale_azn_minor, stock, status, low_stock_threshold, '
  + 'variant_count, created_at, updated_at, product:products(id, name, sku, category)';
const ORDER_COLS = 'id, channel, order_number, external_id, customer_name, customer_email, currency, status, '
  + 'financial_status, fulfillment_status, tracking_number, carrier, shipped_at, delivered_at, note, placed_at, '
  + 'archived_at, created_at, lines:marketplace_order_lines(id, listing_id, variant_id, line_title, quantity, '
  + 'sale_azn_minor, shipping_income_azn_minor, tax_azn_minor, discount_azn_minor, fee_azn_minor, refund_azn_minor, '
  + 'cost_azn_minor, cost_missing, supplier_order_number, supplier_order_status, supplier_ordered_at, supplier_paid_azn_minor)';
const OFFER_COLS = 'id, product_id, supplier_name, url, supplier_sku, currency, price_minor, shipping_minor, fx_rate_to_base, '
  + 'price_azn_minor, shipping_azn_minor, delivery_min_days, delivery_max_days, supplier_stock, notes, is_primary, '
  + 'last_checked_at, origin_module, updated_at';

/** Listing fields the browser may write (D1: Shopify ids, images and counters are server-only). */
const LISTING_WRITABLE = ['supplier_name', 'supplier_url', 'purchase_azn_minor', 'shipping_azn_minor', 'other_azn_minor',
  'sale_azn_minor', 'stock', 'status', 'low_stock_threshold'];
const pick = (obj, keys) => Object.fromEntries(keys.filter((k) => k in obj).map((k) => [k, obj[k]]));

export const marketplace = {
  // ── Listings ──────────────────────────────────────────────
  listings: (orgId) =>
    run(client().from('marketplace_listings').select(LISTING_COLS).eq('org_id', orgId).order('created_at', { ascending: false })),

  /** Manual product: central catalogue row + its Modul 03 listing. The catalogue row is removed again if the listing fails. */
  createListing: async (orgId, { name, sku, category, ...listing }) => {
    const [product] = await run(client().from('products')
      .insert({ org_id: orgId, origin_module: 'marketplace', name: name.trim(), sku: sku?.trim() || null, category: category?.trim() || null })
      .select('id'));
    try {
      const [row] = await run(client().from('marketplace_listings')
        .insert({ org_id: orgId, product_id: product.id, channel: 'manual', ...pick(listing, LISTING_WRITABLE) })
        .select('id'));
      return row.id;
    } catch (err) {
      await client().from('products').delete().eq('id', product.id).eq('org_id', orgId);
      throw err;
    }
  },

  updateListing: async (orgId, listing, { name, sku, category, ...patch }) => {
    const p = pick(patch, LISTING_WRITABLE);
    if (Object.keys(p).length) await run(client().from('marketplace_listings').update(p).eq('id', listing.id).eq('org_id', orgId));
    const prod = {};
    if (name !== undefined && name.trim() !== listing.product?.name) prod.name = name.trim();
    if (sku !== undefined && (sku.trim() || null) !== (listing.product?.sku ?? null)) prod.sku = sku.trim() || null;
    if (category !== undefined && (category.trim() || null) !== (listing.product?.category ?? null)) prod.category = category.trim() || null;
    if (Object.keys(prod).length) await run(client().from('products').update(prod).eq('id', listing.product_id).eq('org_id', orgId));
  },

  /** D6: refused when the product has order lines (the error hint is 'draft'). */
  deleteListing: (listingId) => run(client().rpc('marketplace_delete_listing', { p_listing: listingId })),

  history: (entity, id) => run(client().rpc('marketplace_history', { p_entity: entity, p_id: id })),

  // ── Orders ────────────────────────────────────────────────
  orders: (orgId, { archived = false } = {}) => {
    let q = client().from('marketplace_orders').select(ORDER_COLS).eq('org_id', orgId);
    q = archived ? q.not('archived_at', 'is', null) : q.is('archived_at', null);
    return run(q.order('placed_at', { ascending: false }).limit(500));
  },

  /** D4 + D7: one transaction in the database (order, lines, stock). Returns the order id. */
  createManualOrder: (orgId, order, lines) =>
    run(client().rpc('marketplace_create_manual_order', { p_org: orgId, p_order: order, p_lines: lines })),

  updateOrder: (orgId, id, patch) =>
    run(client().from('marketplace_orders')
      .update(pick(patch, ['status', 'tracking_number', 'carrier', 'note', 'customer_name', 'customer_email', 'shipped_at', 'delivered_at', 'archived_at']))
      .eq('id', id).eq('org_id', orgId)),

  /** D2: only manual orders can be deleted (Shopify orders are archived). */
  deleteOrder: (orgId, id) => run(client().from('marketplace_orders').delete().eq('id', id).eq('org_id', orgId).eq('channel', 'manual')),

  updateLine: (orgId, id, patch) =>
    run(client().from('marketplace_order_lines')
      .update(pick(patch, ['supplier_order_number', 'supplier_order_status', 'supplier_ordered_at', 'supplier_paid_azn_minor']))
      .eq('id', id).eq('org_id', orgId)),

  // ── Supplier offers ───────────────────────────────────────
  offers: (orgId) =>
    run(client().from('supplier_offers').select(OFFER_COLS).eq('org_id', orgId).order('updated_at', { ascending: false })),

  saveOffer: (orgId, offer) => {
    const row = pick(offer, ['product_id', 'supplier_name', 'url', 'supplier_sku', 'currency', 'price_minor', 'shipping_minor',
      'fx_rate_to_base', 'delivery_min_days', 'delivery_max_days', 'supplier_stock', 'notes', 'is_primary']);
    return offer.id
      ? run(client().from('supplier_offers').update({ ...row, last_checked_at: new Date().toISOString() }).eq('id', offer.id).eq('org_id', orgId))
      : run(client().from('supplier_offers').insert({ org_id: orgId, origin_module: 'marketplace', ...row }));
  },

  /** One primary offer per product: clear the others first. */
  setPrimaryOffer: async (orgId, offer) => {
    await run(client().from('supplier_offers').update({ is_primary: false })
      .eq('org_id', orgId).eq('product_id', offer.product_id).neq('id', offer.id).eq('is_primary', true));
    await run(client().from('supplier_offers').update({ is_primary: true }).eq('id', offer.id).eq('org_id', orgId));
  },

  deleteOffer: (orgId, id) => run(client().from('supplier_offers').delete().eq('id', id).eq('org_id', orgId)),

  offerPrices: (orgId, offerId) =>
    run(client().from('supplier_offer_prices')
      .select('id, currency, price_minor, shipping_minor, fx_rate_to_base, price_azn_minor, shipping_azn_minor, recorded_at')
      .eq('org_id', orgId).eq('offer_id', offerId).order('recorded_at', { ascending: false }).limit(50)),

  // ── Settings ──────────────────────────────────────────────
  settings: async (orgId) =>
    (await run(client().from('marketplace_settings')
      .select('payment_fee_percent, payment_fee_fixed_azn_minor, low_stock_threshold, updated_at').eq('org_id', orgId)))?.[0] ?? null,

  saveSettings: async (orgId, values, exists) => {
    const row = pick(values, ['payment_fee_percent', 'payment_fee_fixed_azn_minor', 'low_stock_threshold']);
    return exists
      ? run(client().from('marketplace_settings').update(row).eq('org_id', orgId))
      : run(client().from('marketplace_settings').insert({ org_id: orgId, ...row }));
  },

  storeStatus: (orgId) => run(client().rpc('marketplace_store_status', { p_org: orgId })),

  // ── Calculator preferences (per user) ─────────────────────
  calcPrefs: async (orgId, userId) =>
    (await run(client().from('marketplace_calc_prefs').select('calc_settings').eq('org_id', orgId).eq('user_id', userId)))?.[0]?.calc_settings ?? null,

  saveCalcPrefs: (orgId, settings) =>
    run(client().from('marketplace_calc_prefs').upsert({ org_id: orgId, calc_settings: settings }, { onConflict: 'org_id,user_id' })),
};

/** Defaults used until the organization saves its own settings (same as the table defaults). */
export const DEFAULT_SETTINGS = Object.freeze({ payment_fee_percent: 2.9, payment_fee_fixed_azn_minor: 0, low_stock_threshold: 5 });
