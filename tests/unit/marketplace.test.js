/** İ-4: Modul 03 profit math, VAT table and translated database messages. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { breakEvenPrice, isLowStock, lineNet, listingProfit, orderTotals, paymentFee, priceForMargin, unitCost, vatIncluded } from '../../shared/marketplace/calc.js';
import { VAT_CODES, VAT_RATES, vatRate } from '../../shared/marketplace/vat.js';

const COSTS = { purchase: 800, shipping: 300, other: 100 };
const OPTS = { feePercent: 2.9, feeFixed: 30, vatPercent: 18 };

test('unit profit: worked example (20.00 ₼ sale, 12.00 ₼ cost, 2.9 % + 0.30 ₼ fee, 18 % VAT)', () => {
  const p = listingProfit({ sale: 2000, ...COSTS }, OPTS);
  assert.equal(p.cost, 1200);
  assert.equal(p.fee, 88);           // round(58.0) + 30
  assert.equal(p.vat, 305);          // round(2000 × 18 / 118 = 305.08)
  assert.equal(p.profit, 407);       // 2000 − 305 − 88 − 1200
  assert.equal(p.marginPercent, 20.35);
  assert.equal(p.roiPercent, 33.92);
});

test('fees and VAT: edge cases', () => {
  assert.equal(paymentFee(0, { feePercent: 2.9, feeFixed: 30 }), 0);   // nothing sold → no fee
  assert.equal(vatIncluded(1180, 18), 180);
  assert.equal(vatIncluded(1000, 0), 0);
  assert.equal(unitCost({}), 0);
  assert.equal(listingProfit({ sale: 0, ...COSTS }).marginPercent, null);
  assert.equal(listingProfit({ sale: 500 }).roiPercent, null);
  assert.throws(() => paymentFee(100, { feePercent: 100 }), RangeError);
  assert.throws(() => paymentFee(100, { feePercent: -1 }), RangeError);
});

test('break-even price is the exact smallest price with profit ≥ 0', () => {
  const be = breakEvenPrice(COSTS, OPTS);
  assert.ok(listingProfit({ sale: be, ...COSTS }, OPTS).profit >= 0);
  assert.ok(listingProfit({ sale: be - 1, ...COSTS }, OPTS).profit < 0);
  assert.equal(breakEvenPrice({}, {}), 0);
  assert.equal(breakEvenPrice(COSTS, { feePercent: 99, vatPercent: 50 }), null);   // fees eat the whole price
});

test('price for a target margin is the smallest price reaching it', () => {
  const p = priceForMargin(COSTS, OPTS, 30);
  const at = listingProfit({ sale: p, ...COSTS }, OPTS);
  assert.ok(at.profit * 100 >= 30 * p);
  const below = listingProfit({ sale: p - 1, ...COSTS }, OPTS);
  assert.ok(below.profit * 100 < 30 * (p - 1));
  assert.equal(priceForMargin(COSTS, { feePercent: 50, vatPercent: 0 }, 60), null);
});

test('order line net and order totals (line totals, tax is not income)', () => {
  const l = { sale_azn_minor: 5000, shipping_income_azn_minor: 500, discount_azn_minor: 200, fee_azn_minor: 150, refund_azn_minor: 0, cost_azn_minor: 3000, tax_azn_minor: 900 };
  assert.equal(lineNet(l), 2150);
  const t = orderTotals([l, { sale_azn_minor: '1000', cost_azn_minor: '400', cost_missing: true }]);
  assert.equal(t.sale, 6000);
  assert.equal(t.net, 2750);
  assert.equal(t.tax, 900);
  assert.equal(t.costMissing, true);
  assert.equal(orderTotals().net, 0);
});

test('low stock: listing threshold, else company default; drafts never warn', () => {
  assert.equal(isLowStock({ stock: 5, low_stock_threshold: null, status: 'active' }, 5), true);
  assert.equal(isLowStock({ stock: 3, low_stock_threshold: 2, status: 'active' }, 5), false);
  assert.equal(isLowStock({ stock: 0, low_stock_threshold: null, status: 'draft' }, 5), false);
});

test('VAT table (D5): codes unique, rates in range, lookup works', () => {
  assert.equal(new Set(VAT_CODES).size, VAT_RATES.length);
  for (const r of VAT_RATES) assert.ok(r.percent >= 0 && r.percent < 100, r.code);
  assert.equal(vatRate('AZ').percent, 18);
  assert.equal(vatRate('XX'), null);
});

test('database messages with values are translated (EN/RU) and unknown ones pass through', async () => {
  const i18n = await import('../../src/core/i18n/index.js');
  i18n.setLocale('en');
  assert.equal(i18n.tServerError('Stok kifayət etmir. Mövcud stok: 3'), 'Not enough stock. Available stock: 3');
  assert.match(i18n.tServerError('Bu məhsulun 2 sifariş sətri var. Sifariş tarixçəsi itməsin deyə onu silmək olmur. Qaralama edə bilərsiniz.'), /^This product has 2 order lines\./);
  assert.equal(i18n.tServerError('Məhsul tapılmadı'), 'Product not found');
  assert.equal(i18n.tServerError('Tamamilə naməlum'), 'Tamamilə naməlum');
  i18n.setLocale('ru');
  assert.equal(i18n.tServerError('Bu nömrəli sifariş artıq var: M-1'), 'Заказ с таким номером уже есть: M-1');
  i18n.setLocale('az');
  assert.equal(i18n.tServerError('Məhsul tapılmadı'), 'Məhsul tapılmadı');
});
