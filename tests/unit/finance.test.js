import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  toMinor, fromMinor, convertToBase, summarize, summarizeByModule, formatMoney, TRANSACTION_KIND_KEYS,
} from '../../shared/finance.js';
import { consolidate } from '../../src/core/finance/summary.js';

test('toMinor parses decimals exactly (no float drift)', () => {
  assert.equal(toMinor('0.1'), 10);
  assert.equal(toMinor('0.29'), 29); // 0.29*100 = 28.999… in floats
  assert.equal(toMinor(0.29), 29);
  assert.equal(toMinor('1234,56'), 123456);
  assert.equal(toMinor('12.345'), 1235); // half away from zero
  assert.equal(toMinor('-12.345'), -1235);
  assert.equal(toMinor('12.344'), 1234);
  assert.equal(toMinor('7'), 700);
  assert.throws(() => toMinor('abc'));
  assert.throws(() => toMinor('1.2.3'));
  assert.throws(() => toMinor('10', 'XYZ'));
});

test('fromMinor / formatMoney', () => {
  assert.equal(fromMinor(123456), '1234.56');
  assert.equal(fromMinor(5), '0.05');
  assert.equal(fromMinor(-5), '-0.05');
  assert.match(formatMoney(123456), /1.?234,56 ₼/);
  assert.throws(() => fromMinor(1.5));
});

test('convertToBase matches PostgreSQL round(amount * rate) (see tests/sql)', () => {
  assert.equal(convertToBase(20000, '1.70', 'USD'), 34000);
  assert.equal(convertToBase(3333, '0.0525', 'TRY'), 175);
  assert.equal(convertToBase(1, '1.99999999', 'EUR'), 2);
  assert.equal(convertToBase(100000, '1', 'AZN'), 100000);
  assert.equal(convertToBase(150, '0.01', 'USD'), 2); // 1.5 → 2 (half away from zero)
  assert.throws(() => convertToBase(100, '1.5', 'AZN'));
  assert.throws(() => convertToBase(100, '0', 'USD'));
  assert.throws(() => convertToBase(100, '-1', 'USD'));
});

test('summarize uses the same definitions as finance_module_summary', () => {
  const tx = [
    ['sale', 100000], ['purchase', 34000], ['shipping', 5000], ['customs', 175],
    ['commission', 2500], ['tax', 1000], ['capital_in', 500000],
  ].map(([kind, amountBaseMinor]) => ({ kind, amountBaseMinor, moduleKey: 'wholesale' }));
  const s = summarize(tx);
  // Same expected numbers as tests/sql/tests.sql
  assert.equal(s.revenue, 100000);
  assert.equal(s.cogs, 39175);
  assert.equal(s.expenses, 3500);
  assert.equal(s.grossProfit, 60825);
  assert.equal(s.netProfit, 57325);
  assert.equal(s.cashFlow, 557325);
  assert.equal(s.capitalNet, 500000);
  assert.equal(s.count, 7);
});

test('summarize: empty, capital-out, validation', () => {
  const e = summarize([]);
  assert.equal(e.netProfit, 0);
  assert.equal(e.cashFlow, 0);
  const s = summarize([{ kind: 'capital_out', amountBaseMinor: 500 }]);
  assert.equal(s.netProfit, 0, 'capital never affects profit');
  assert.equal(s.cashFlow, -500);
  assert.throws(() => summarize([{ kind: 'gift', amountBaseMinor: 1 }]));
  assert.throws(() => summarize([{ kind: 'sale', amountBaseMinor: -1 }]));
  assert.throws(() => summarize([{ kind: 'sale', amountBaseMinor: 1.5 }]));
});

test('summarizeByModule consolidates', () => {
  const r = summarizeByModule([
    { kind: 'sale', amountBaseMinor: 1000, moduleKey: 'wholesale' },
    { kind: 'sale', amountBaseMinor: 500, moduleKey: 'arbitrage' },
    { kind: 'operational', amountBaseMinor: 200 },
  ]);
  assert.equal(r.modules.wholesale.revenue, 1000);
  assert.equal(r.modules.core.netProfit, -200);
  assert.equal(r.total.netProfit, 1300);
});

test('consolidate() of DB view rows (bigint as strings)', () => {
  const t = consolidate([
    { revenue_minor: '1000', cogs_minor: '400', expenses_minor: '100', gross_profit_minor: '600', net_profit_minor: '500', cash_flow_minor: '500', tx_count: 3 },
    { revenue_minor: '200', cogs_minor: '0', expenses_minor: '50', gross_profit_minor: '200', net_profit_minor: '150', cash_flow_minor: '150', tx_count: 2 },
  ]);
  assert.deepEqual(t, { revenue: 1200, cogs: 400, expenses: 150, grossProfit: 800, netProfit: 650, cashFlow: 650, count: 5 });
  assert.equal(consolidate([]).revenue, 0);
});

test('transaction kinds match the DB enum', async () => {
  const { readFile } = await import('node:fs/promises');
  const sql = await readFile(new URL('../../supabase/migrations/20261121000300_finance.sql', import.meta.url), 'utf8');
  const body = sql.match(/create type public\.transaction_kind as enum \(([\s\S]*?)\);/)[1];
  const dbKinds = [...body.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
  assert.deepEqual([...dbKinds].sort(), [...TRANSACTION_KIND_KEYS].sort());
});

test('monthlySeries buckets by month, zero-fills, ignores other groups and out-of-window', async () => {
  const { monthlySeries, seriesStartDate } = await import('../../shared/finance.js');
  const now = new Date('2026-11-21T10:00:00Z');
  const s = monthlySeries([
    { kind: 'sale', amountBaseMinor: 1000, occurredOn: '2026-11-02' },
    { kind: 'sale', amountBaseMinor: 500, occurredOn: '2026-11-30' },
    { kind: 'sale', amountBaseMinor: 700, occurredOn: '2026-05-15' },
    { kind: 'purchase', amountBaseMinor: 9999, occurredOn: '2026-11-03' },
    { kind: 'sale', amountBaseMinor: 1, occurredOn: '2026-03-31' }, // outside 8-month window
  ], { months: 8, now });
  assert.deepEqual(s.map((b) => b.key), ['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11']);
  assert.deepEqual(s.map((b) => b.value), [0, 700, 0, 0, 0, 0, 0, 1500]);
  assert.equal(s[7].label, 'Noy');
  assert.equal(seriesStartDate(8, now), '2026-04-01');
  // year boundary
  const y = monthlySeries([{ kind: 'sale', amountBaseMinor: 5, occurredOn: '2025-12-10' }], { months: 3, now: new Date('2026-01-05T00:00:00Z') });
  assert.deepEqual(y.map((b) => `${b.key}:${b.value}`), ['2025-11:0', '2025-12:5', '2026-01:0']);
  assert.throws(() => monthlySeries([{ kind: 'x', amountBaseMinor: 1, occurredOn: '2026-11-01' }], { now }));
});

test('netMarginPercent', async () => {
  const { netMarginPercent } = await import('../../shared/finance.js');
  assert.equal(netMarginPercent({ revenue: 0, netProfit: 0 }), null);
  assert.equal(netMarginPercent({ revenue: 100000, netProfit: 57325 }), 57.3);
  assert.equal(netMarginPercent({ revenue: 1000, netProfit: -250 }), -25);
});
