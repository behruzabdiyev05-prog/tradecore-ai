/**
 * Opportunity math for Modules 01, 04, 05, 07, 08 (table `opportunities`).
 * Shared by the UI, ARES and tests. Integer minor units; AZN is the base currency;
 * rounding half away from zero after each conversion (same as PostgreSQL round()).
 *
 * Per unit, in AZN minor units:
 *   goods      = (buy + shipping) × fx                          — customs value
 *   duty       = round(goods × duty% / 100)
 *   import VAT = round((goods + duty) × importVat% / 100)
 *   cost       = goods + (customs + tax + repair + other) × fx + duty + import VAT
 *   revenue    = sell × sellFx
 *   fee        = round(revenue × fee% / 100) + feeFixed × sellFx
 *   profit     = revenue − fee − cost
 *   margin %   = profit / revenue × 100;  ROI % = profit / cost × 100
 *   totals     = per unit × quantity
 */

const int = (v) => {
  const n = Number(v ?? 0);
  if (!Number.isFinite(n) || n < 0) throw new RangeError('Məbləğ mənfi və ya yanlış ola bilməz');
  return Math.round(n);
};
const rate = (v) => {
  const n = Number(v ?? 1);
  if (!Number.isFinite(n) || n <= 0) throw new RangeError('Məzənnə müsbət olmalıdır');
  return n;
};
const pct = (v) => {
  const n = Number(v ?? 0);
  if (!Number.isFinite(n) || n < 0 || n >= 100) throw new RangeError('Faiz 0 ilə 100 arasında olmalıdır');
  return n;
};
export const roundHalfAway = (x) => (x < 0 ? -Math.round(-x) : Math.round(x));
const toBase = (minor, fx) => roundHalfAway(minor * fx);
const round2 = (x) => Math.round(x * 100) / 100;

export function opportunityMath(o) {
  const fx = rate(o.fx_rate_to_base);
  const sfx = rate(o.sell_fx_rate_to_base);
  const goods = toBase(int(o.buy_price_minor) + int(o.shipping_minor), fx);
  const duty = roundHalfAway((goods * pct(o.duty_percent)) / 100);
  const importVat = roundHalfAway(((goods + duty) * pct(o.import_vat_percent)) / 100);
  const extras = toBase(int(o.customs_minor) + int(o.tax_minor) + int(o.repair_minor) + int(o.other_minor), fx);
  const cost = goods + extras + duty + importVat;
  const revenue = toBase(int(o.sell_price_minor), sfx);
  const feeP = pct(o.fee_percent);   // validated even when nothing is sold yet
  const fee = (revenue > 0 ? roundHalfAway((revenue * feeP) / 100) : 0) + toBase(int(o.fee_fixed_minor), sfx);
  const profit = revenue - fee - cost;
  const qty = Math.max(1, Math.round(Number(o.quantity ?? 1)));
  return {
    goods, duty, importVat, extras, cost, revenue, fee, profit, quantity: qty,
    totalCost: cost * qty, totalRevenue: revenue * qty, totalProfit: profit * qty,
    marginPercent: revenue > 0 ? round2((profit / revenue) * 100) : null,
    roiPercent: cost > 0 ? round2((profit / cost) * 100) : null,
  };
}

/**
 * Opportunity score 0–100 (transparent, shown to the user):
 *   margin   0–40  (40 % margin or more = 40; loss = 0)
 *   ROI      0–20  (100 % ROI or more = 20)
 *   demand   0–20  (1 → 0 … 5 → 20)
 *   competition 0–10 (low competition scores higher)
 *   risk     0–10  (low risk scores higher)
 * A missing 1–5 rating counts as neutral (3). No revenue → score null.
 */
export function opportunityScore(o, m = opportunityMath(o)) {
  if (m.marginPercent == null) return null;
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  const r = (v) => (v == null || v === '' ? 3 : clamp(Number(v), 1, 5));
  const margin = clamp(m.marginPercent, 0, 40);
  const roi = m.roiPercent == null ? 0 : clamp(m.roiPercent, 0, 100) / 5;
  const demand = (r(o.demand_score) - 1) * 5;
  const competition = (5 - r(o.competition_score)) * 2.5;
  const risk = (5 - r(o.risk_score)) * 2.5;
  return Math.round(margin + roi + demand + competition + risk);
}

/** Score band for a badge. */
export const scoreBand = (s) => (s == null ? null : s >= 70 ? 'high' : s >= 45 ? 'medium' : 'low');
