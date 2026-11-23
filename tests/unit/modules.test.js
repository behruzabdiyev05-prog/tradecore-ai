/** Phase 3: shared math of Modules 01, 02, 04–10 — every expected value worked out by hand. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { opportunityMath, opportunityScore, scoreBand } from '../../shared/modules/opportunity.js';
import { bulkDeal, documentTotals, lineTotal, nextNumber } from '../../shared/modules/documents.js';
import { followUpState, leadScore, offerText, recommendedServices, SEGMENT_SERVICES, SEGMENTS, SERVICES } from '../../shared/modules/leads.js';
import { dec, div, mul, positions, positionSize, rsi, sma, str, technicalReading, unrealized } from '../../shared/modules/trading.js';

test('opportunity: USD purchase sold in AZN with 10 % platform fee', () => {
  const o = { buy_price_minor: 450, shipping_minor: 120, currency: 'USD', fx_rate_to_base: 1.7, sell_price_minor: 2500, fee_percent: 10 };
  const m = opportunityMath(o);
  assert.equal(m.goods, 969);          // (4.50 + 1.20) USD × 1.7
  assert.equal(m.cost, 969);
  assert.equal(m.fee, 250);
  assert.equal(m.profit, 1281);        // 25.00 − 2.50 − 9.69
  assert.equal(m.marginPercent, 51.24);
  assert.equal(m.roiPercent, 132.2);
  assert.equal(opportunityScore(o, m), 80);   // 40 + 20 + 10 + 5 + 5
  assert.equal(scoreBand(80), 'high');
});

test('opportunity: import landed cost with duty and import VAT', () => {
  const m = opportunityMath({ buy_price_minor: 10000, shipping_minor: 2000, customs_minor: 1000, fx_rate_to_base: 1.7,
    duty_percent: 15, import_vat_percent: 18, sell_price_minor: 40000, quantity: 10 });
  assert.equal(m.goods, 20400);
  assert.equal(m.duty, 3060);
  assert.equal(m.importVat, 4223);     // round((20400 + 3060) × 18 %) = round(4222.8)
  assert.equal(m.extras, 1700);
  assert.equal(m.cost, 29383);
  assert.equal(m.totalProfit, (40000 - 29383) * 10);
});

test('opportunity: guards and empty cases', () => {
  assert.equal(opportunityMath({}).marginPercent, null);
  assert.equal(opportunityScore({}), null);
  assert.throws(() => opportunityMath({ fx_rate_to_base: 0 }), RangeError);
  assert.throws(() => opportunityMath({ buy_price_minor: -5 }), RangeError);
  assert.throws(() => opportunityMath({ fee_percent: 100 }), RangeError);
  const loss = opportunityMath({ buy_price_minor: 1000, sell_price_minor: 500 });
  assert.equal(loss.profit, -500);
  assert.equal(opportunityScore({ buy_price_minor: 1000, sell_price_minor: 500, demand_score: 1, competition_score: 5, risk_score: 5 }), 0);
});

test('documents: line totals equal SQL trade_line_total (half away from zero)', () => {
  assert.equal(lineTotal({ quantity: 3, unit_price_minor: 1000, discount_percent: 10 }), 2700);
  assert.equal(lineTotal({ quantity: 2.5, unit_price_minor: 333 }), 833);       // 832.5 → 833
  assert.equal(lineTotal({ quantity: 0, unit_price_minor: 333 }), 0);
  const t = documentTotals([{ quantity: 3, unit_price_minor: 1000, unit_cost_minor: 600 }, { quantity: 1, unit_price_minor: 500, unit_cost_minor: 200 }], 1.7);
  assert.deepEqual([t.total, t.cost, t.margin, t.marginPercent, t.totalBase], [3500, 2000, 1500, 42.86, 5950]);
  assert.equal(documentTotals([{ quantity: 1, unit_price_minor: 500 }]).margin, null);   // unknown cost → no margin
});

test('documents: next number and wholesale bulk deal', () => {
  assert.equal(nextNumber(['S-001', 'S-009', 'P-100'], 'S-'), 'S-010');
  assert.equal(nextNumber([], 'P-'), 'P-001');
  const d = bulkDeal({ unitPrice: 400, qty: 1000, moq: 500, shippingTotal: 20000, sellPrice: 900, feePercent: 2 });
  assert.deepEqual([d.purchase, d.cost, d.revenue, d.fee, d.profit, d.unitCost, d.marginPercent, d.belowMoq],
    [400000, 420000, 900000, 18000, 462000, 420, 51.33, false]);
  assert.equal(bulkDeal({ unitPrice: 400, qty: 100, moq: 500 }).belowMoq, true);
});

test('leads: recommendations, score, follow-ups, offer text', () => {
  assert.equal(SEGMENTS.length, 10);
  for (const s of SEGMENTS) for (const x of SEGMENT_SERVICES[s]) assert.ok(SERVICES.includes(x), `${s}:${x}`);
  assert.equal(recommendedServices('cafe')[0], 'menus');
  assert.equal(recommendedServices('unknown')[0], 'business_cards');
  const lead = { segment: 'cafe', size: 'small', is_new_business: true, services: ['menus', 'stickers'], stage: 'contacted' };
  assert.equal(leadScore(lead, { phone: '+994', email: 'a@b.az', website: 'https://x.az' }), 72);   // 25+8+10+8+6+6+4+5
  assert.equal(leadScore({ ...lead, stage: 'lost' }, {}), 0);
  assert.equal(leadScore({ segment: 'other', stage: 'new' }, {}), 14);                                // 8 + unknown size 6
  assert.equal(followUpState('2026-11-20', '2026-11-23'), 'overdue');
  assert.equal(followUpState('2026-11-23', '2026-11-23'), 'today');
  assert.equal(followUpState('2026-11-25', '2026-11-23'), 'soon');
  assert.equal(followUpState('2026-12-25', '2026-11-23'), 'later');
  assert.equal(followUpState(null), null);
  const txt = offerText({ template: 'Hörmətli {company}!\n{services}\n{sender}', company: 'Şirin Kafe', sender: 'Çap Evi',
    services: ['menus'], prices: { menus: 1500 }, labels: { menus: 'Menyu' }, money: (m) => `${m / 100} ₼` });
  assert.equal(txt, 'Hörmətli Şirin Kafe!\n• Menyu — 15 ₼\nÇap Evi');
});

test('trading: exact decimals', () => {
  assert.equal(dec('0.1') + dec('0.2'), dec('0.3'));
  assert.equal(str(mul(dec('0.015'), dec('60000'))), '900');
  assert.equal(str(div(dec('1'), dec('3')), 4), '0.3333');
  assert.equal(str(dec('-2.50')), '-2.5');
  assert.throws(() => dec('1e5'), TypeError);
});

test('trading: average-cost positions, realized and unrealized P&L', () => {
  const trades = [
    { symbol: 'BTC/USDT', market: 'crypto', side: 'buy', quantity: '0.015', price: '60000', fee: '0.9', executed_at: '2026-11-01T10:00:00Z' },
    { symbol: 'BTC/USDT', market: 'crypto', side: 'buy', quantity: '0.005', price: '62000', fee: '0.31', executed_at: '2026-11-02T10:00:00Z' },
    { symbol: 'BTC/USDT', market: 'crypto', side: 'sell', quantity: '0.01', price: '65000', fee: '0.65', executed_at: '2026-11-03T10:00:00Z' },
  ];
  const [p] = positions(trades);
  assert.equal(str(p.qty), '0.01');
  assert.equal(str(p.realized), '43.745');      // 650 − 0.65 − 0.01 × 60560.5
  assert.equal(str(p.cost), '605.605');
  assert.equal(str(p.avgCost), '60560.5');
  assert.equal(str(unrealized(p, dec('64000'))), '34.395');
  assert.equal(unrealized(p, null), null);
  const [o] = positions([{ symbol: 'X', side: 'sell', quantity: 1, price: 1, executed_at: '1' }]);
  assert.equal(o.oversold, true);
  assert.equal(o.qty, 0n);
});

test('trading: indicators and reading', () => {
  assert.deepEqual(sma([1, 2, 3, 4], 2), [null, 1.5, 2.5, 3.5]);
  const up = Array.from({ length: 30 }, (_, i) => 100 + i);
  assert.equal(rsi(up, 14).at(-1), 100);
  assert.equal(technicalReading(up).reading, 'overbought');
  assert.equal(technicalReading([1, 2, 3]).reading, 'insufficient');
  const zig = Array.from({ length: 30 }, (_, i) => 100 + (i % 2 ? 1 : -1) + i * 0.05);
  assert.equal(technicalReading(zig).reading, 'bullish');
});

test('trading: position size from risk', () => {
  const r = positionSize({ balance: 10000, riskPercent: 1, entry: 100, stop: 95, target: 115 });
  assert.deepEqual([str(r.riskAmount), str(r.qty), str(r.positionValue), str(r.rewardRisk), r.direction], ['100', '20', '2000', '3', 'long']);
  assert.equal(positionSize({ balance: 10000, riskPercent: 1, entry: 100, stop: 100 }), null);
  assert.equal(positionSize({ balance: 10000, riskPercent: 1, entry: 100, stop: 105 }).direction, 'short');
});
