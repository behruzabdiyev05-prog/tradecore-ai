/** Pure helpers for `finance_module_summary` rows (AZN minor units). */
const EMPTY = { revenue: 0, cogs: 0, expenses: 0, grossProfit: 0, netProfit: 0, cashFlow: 0, count: 0 };

/** Map a `finance_module_summary` row to camelCase minor-unit totals. */
export function mapSummaryRow(r) {
  return {
    revenue: Number(r.revenue_minor),
    cogs: Number(r.cogs_minor),
    expenses: Number(r.expenses_minor),
    grossProfit: Number(r.gross_profit_minor),
    netProfit: Number(r.net_profit_minor),
    cashFlow: Number(r.cash_flow_minor),
    count: Number(r.tx_count),
  };
}

/** Add per-module rows into a consolidated total. */
export function consolidate(rows) {
  return rows.map(mapSummaryRow).reduce(
    (acc, r) => Object.fromEntries(Object.keys(EMPTY).map((k) => [k, acc[k] + r[k]])),
    { ...EMPTY },
  );
}
