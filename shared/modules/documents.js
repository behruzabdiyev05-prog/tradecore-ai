/**
 * Trade document math for Modules 02, 06, 09 (tables `trade_documents`, `trade_document_lines`).
 * Line total = round(qty × unit price × (100 − discount%) / 100) — identical to SQL trade_line_total().
 * Amounts are minor units of the document currency; `toBase` converts with the document's rate.
 */
import { roundHalfAway } from './opportunity.js';

export function lineTotal(l) {
  const q = Number(l.quantity ?? 0);
  const p = Number(l.unit_price_minor ?? 0);
  const d = Number(l.discount_percent ?? 0);
  if (!(q > 0) || p < 0 || d < 0 || d > 100) return 0;
  return roundHalfAway((q * p * (100 - d)) / 100);
}

export function lineCost(l) {
  if (l.unit_cost_minor == null || l.unit_cost_minor === '') return null;
  return roundHalfAway(Number(l.quantity ?? 0) * Number(l.unit_cost_minor));
}

/** { total, cost (null if any line has no cost), margin, marginPercent, totalBase } */
export function documentTotals(lines = [], fx = 1) {
  let total = 0; let cost = 0; let costKnown = lines.length > 0;
  for (const l of lines) {
    total += lineTotal(l);
    const c = lineCost(l);
    if (c == null) costKnown = false; else cost += c;
  }
  const margin = costKnown ? total - cost : null;
  return {
    total, cost: costKnown ? cost : null, margin,
    marginPercent: costKnown && total > 0 ? Math.round((margin / total) * 10000) / 100 : null,
    totalBase: roundHalfAway(total * Number(fx || 1)),
  };
}

/** Next document number: prefix + (highest numeric suffix + 1), zero-padded to 3. */
export function nextNumber(existing = [], prefix = 'S-') {
  let max = 0;
  for (const n of existing) {
    const m = String(n ?? '').match(/(\d+)\s*$/);
    if (m && String(n).startsWith(prefix)) max = Math.max(max, Number(m[1]));
  }
  return `${prefix}${String(max + 1).padStart(3, '0')}`;
}

/** Wholesale: profit of buying `qty` units at a supplier price and reselling them. */
export function bulkDeal({ unitPrice = 0, qty = 0, moq = null, shippingTotal = 0, otherTotal = 0, sellPrice = 0, feePercent = 0 }) {
  const q = Math.max(0, Math.round(Number(qty)));
  const purchase = roundHalfAway(Number(unitPrice) * q);
  const cost = purchase + Math.round(Number(shippingTotal)) + Math.round(Number(otherTotal));
  const revenue = roundHalfAway(Number(sellPrice) * q);
  const fee = roundHalfAway((revenue * Number(feePercent)) / 100);
  const profit = revenue - fee - cost;
  return {
    purchase, cost, revenue, fee, profit,
    unitCost: q > 0 ? roundHalfAway(cost / q) : null,
    marginPercent: revenue > 0 ? Math.round((profit / revenue) * 10000) / 100 : null,
    belowMoq: moq != null && q < Number(moq),
  };
}
