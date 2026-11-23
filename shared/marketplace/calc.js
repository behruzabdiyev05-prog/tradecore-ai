/**
 * Modul 03 (Marketplace) — profit math shared by the UI, ARES and tests.
 *
 * Rules (same as shared/finance.js):
 *  - every amount is an INTEGER in AZN minor units (qəpik); never floats for money;
 *  - rounding is half away from zero (PostgreSQL round(numeric));
 *  - percentages are plain numbers ("2.9" = 2.9 %), validated here.
 *
 * Definitions
 *  unit cost        = purchase + shipping + other
 *  payment fee      = round(sale × fee% / 100) + fixed fee
 *  VAT (included)   = round(sale × vat / (100 + vat))   — the price already contains VAT
 *  profit           = sale − VAT − payment fee − unit cost
 *  margin %         = profit / sale × 100
 *  ROI %            = profit / unit cost × 100
 *  break-even price = smallest sale price whose profit is ≥ 0
 *
 *  order line net   = sale + shipping income − discount − fee − refund − cost
 *                     (tax collected for the state is not income; amounts are LINE totals)
 */

const toInt = (v) => {
  const n = Number(v ?? 0);
  if (!Number.isFinite(n)) throw new TypeError('Məbləğ rəqəm olmalıdır');
  return Math.round(n);
};

/** Round half away from zero (x ≥ 0 or < 0), like PostgreSQL round(). */
export function roundHalfAway(x) {
  return x < 0 ? -Math.round(-x) : Math.round(x);
}

function percent(v, { max = 100 } = {}) {
  const n = Number(v ?? 0);
  if (!Number.isFinite(n) || n < 0 || n >= max) throw new RangeError('Faiz 0 ilə 100 arasında olmalıdır');
  return n;
}

export function unitCost({ purchase = 0, shipping = 0, other = 0 } = {}) {
  return toInt(purchase) + toInt(shipping) + toInt(other);
}

export function paymentFee(sale, { feePercent = 0, feeFixed = 0 } = {}) {
  const s = toInt(sale);
  if (s <= 0) return 0;
  return roundHalfAway((s * percent(feePercent)) / 100) + toInt(feeFixed);
}

export function vatIncluded(sale, vatPercent = 0) {
  const s = toInt(sale);
  const v = percent(vatPercent);
  if (s <= 0 || v === 0) return 0;
  return roundHalfAway((s * v) / (100 + v));
}

/**
 * Full breakdown for one unit.
 * @returns {{sale, cost, fee, vat, profit, marginPercent, roiPercent}}  margin/roi = null when undefined
 */
export function listingProfit({ sale = 0, purchase = 0, shipping = 0, other = 0 } = {},
  { feePercent = 0, feeFixed = 0, vatPercent = 0 } = {}) {
  const s = toInt(sale);
  const cost = unitCost({ purchase, shipping, other });
  const fee = paymentFee(s, { feePercent, feeFixed });
  const vat = vatIncluded(s, vatPercent);
  const profit = s - vat - fee - cost;
  return {
    sale: s, cost, fee, vat, profit,
    marginPercent: s > 0 ? round2((profit / s) * 100) : null,
    roiPercent: cost > 0 ? round2((profit / cost) * 100) : null,
  };
}

/** Smallest sale price (minor units) with profit ≥ 0, or null if no price can cover the fees. */
export function breakEvenPrice({ purchase = 0, shipping = 0, other = 0 } = {},
  { feePercent = 0, feeFixed = 0, vatPercent = 0 } = {}) {
  const cost = unitCost({ purchase, shipping, other }) + toInt(feeFixed);
  const keep = 100 / (100 + percent(vatPercent)) - percent(feePercent) / 100;   // share of the price that stays
  if (keep <= 0) return null;
  if (cost <= 0) return 0;
  let price = Math.max(0, Math.floor(cost / keep) - 2);
  const opts = { feePercent, feeFixed, vatPercent };
  // rounding of fee/VAT can move the answer by a qəpik or two: step to the exact minimum
  while (listingProfit({ sale: price, purchase, shipping, other }, opts).profit < 0) price += 1;
  while (price > 0 && listingProfit({ sale: price - 1, purchase, shipping, other }, opts).profit >= 0) price -= 1;
  return price;
}

/** Sale price (minor units) that gives the wanted margin %, or null if impossible. */
export function priceForMargin(costs, opts, marginPercent) {
  const m = percent(marginPercent, { max: 100 });
  const cost = unitCost(costs) + toInt(opts?.feeFixed);
  const keep = 100 / (100 + percent(opts?.vatPercent ?? 0)) - percent(opts?.feePercent ?? 0) / 100 - m / 100;
  if (keep <= 0) return null;
  let price = Math.max(0, Math.ceil(cost / keep) - 2);
  const ok = (p) => p > 0 && listingProfit({ sale: p, ...costs }, opts).profit * 100 >= m * p;
  while (!ok(price)) price += 1;
  while (price > 1 && ok(price - 1)) price -= 1;
  return price;
}

/** Net result of one order line (all amounts are line totals in AZN minor units). */
export function lineNet(l) {
  return toInt(l.sale_azn_minor) + toInt(l.shipping_income_azn_minor) - toInt(l.discount_azn_minor)
    - toInt(l.fee_azn_minor) - toInt(l.refund_azn_minor) - toInt(l.cost_azn_minor);
}

/** Order totals from its lines. */
export function orderTotals(lines = []) {
  const t = { sale: 0, shippingIncome: 0, discount: 0, fee: 0, refund: 0, cost: 0, tax: 0, net: 0, costMissing: false };
  for (const l of lines) {
    t.sale += toInt(l.sale_azn_minor);
    t.shippingIncome += toInt(l.shipping_income_azn_minor);
    t.discount += toInt(l.discount_azn_minor);
    t.fee += toInt(l.fee_azn_minor);
    t.refund += toInt(l.refund_azn_minor);
    t.cost += toInt(l.cost_azn_minor);
    t.tax += toInt(l.tax_azn_minor);
    t.net += lineNet(l);
    if (l.cost_missing) t.costMissing = true;
  }
  return t;
}

/** Listing is low on stock: threshold of the listing, else the organization default. */
export function isLowStock(listing, defaultThreshold = 5) {
  if (listing.status === 'draft') return false;
  const th = listing.low_stock_threshold ?? defaultThreshold;
  return Number(listing.stock) <= Number(th);
}

function round2(x) {
  return Math.round(x * 100) / 100;
}
