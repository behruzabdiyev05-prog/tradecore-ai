import { MODULES, getModule } from '../../shared/modules.js';
import { CURRENCIES, TRANSACTION_KINDS, formatMoney, netMarginPercent } from '../../shared/finance.js';
import { useFinanceSummary, mapSummaryRow } from '../core/finance/useFinanceSummary.js';
import { Badge, Card, EmptyState, Notice, Stat } from '../core/ui/components.jsx';
import { Gauge } from '../core/ui/charts.jsx';
import { t as tr, tCurrency, tModule, tTxKind } from '../core/i18n/index.js';

const groupLabel = (g) => tr(`finance.group.${g}`);

export default function FinancePage() {
  const { loading, error, data } = useFinanceSummary(undefined);
  const t = data?.total;
  const rows = (data?.rows ?? []).map((r) => ({ key: r.module_key, ...mapSummaryRow(r) }));
  const v = (x) => (loading || error ? null : x);

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">{tr('finance.eyebrow')}</div>
          <h1>{tr('finance.title')}</h1>
          <p>{tr('finance.subtitle')}</p>
        </div>
      </div>

      {error && <div style={{ marginBottom: 16 }}><Notice tone="error">{error}</Notice></div>}

      <div className="grid grid-stats" style={{ marginBottom: 16 }}>
        <Stat featured label={tr('finance.revenue')} money={v(t?.revenue)} sub={tr('finance.revenue.sub')} />
        <Stat label={tr('finance.cogs')} money={v(t?.cogs)} sub={tr('finance.cogs.sub')} />
        <Stat label={tr('finance.expenses')} money={v(t?.expenses)} sub={tr('finance.expenses.sub')} />
        <Stat label={tr('finance.net_profit')} money={v(t?.netProfit)} signed sub={tr('finance.net_profit.sub')} />
      </div>

      <div className="grid grid-3" style={{ marginBottom: 16 }}>
        <Stat label={tr('finance.gross_profit')} money={v(t?.grossProfit)} signed sub={tr('finance.gross_profit.sub')} />
        <Stat label={tr('finance.cash_flow')} money={v(t?.cashFlow)} signed sub={tr('finance.cash_flow.sub')} />
        <Card title={tr('finance.margin')} sub={tr('finance.margin.sub')}>
          <div style={{ display: 'grid', placeItems: 'center', paddingBottom: 10 }}>
            <Gauge value={loading || error ? null : netMarginPercent(t)} label={!loading && !error && !t.revenue ? tr('finance.no_revenue') : tr('finance.margin.short')} size={190} />
          </div>
        </Card>
      </div>

      <div className="grid grid-2">
        <Card title={tr('finance.by_module')}>
          {!loading && !error && rows.length === 0 ? (
            <EmptyState title={tr('finance.empty.title')}>
              {tr('finance.empty.body')}
            </EmptyState>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>{tr('finance.col.module')}</th><th className="r">{tr('finance.revenue')}</th><th className="r">{tr('finance.net_profit')}</th><th className="r">{tr('finance.col.count')}</th></tr></thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.key ?? 'general'}>
                      <td>{r.key ? `${getModule(r.key)?.code} · ${tModule(r.key, 'name')}` : tr('dash.general')}</td>
                      <td className="r num">{formatMoney(r.revenue)}</td>
                      <td className={`r num ${r.netProfit < 0 ? 'neg' : ''}`}>{formatMoney(r.netProfit)}</td>
                      <td className="r num">{r.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <div className="stack">
          <Card title={tr('finance.currencies')}>
            <div className="status-list">
              {Object.values(CURRENCIES).map((c) => (
                <div className="status-row" key={c.code}>
                  <span className="label">{c.code} · {tCurrency(c.code)}</span>
                  {c.code === 'AZN' ? <Badge tone="accent">{tr('finance.base')}</Badge> : <span className="faint" style={{ fontSize: 12 }}>{tr('finance.rate_source')}</span>}
                </div>
              ))}
            </div>
          </Card>
          <Card title={tr('finance.kinds')}>
            <div className="status-list">
              {Object.entries(TRANSACTION_KINDS).map(([k, d]) => (
                <div className="status-row" key={k}><span className="label">{tTxKind(k)}</span><Badge>{groupLabel(d.group)}</Badge></div>
              ))}
            </div>
          </Card>
          <p className="faint" style={{ fontSize: 12 }}>
            {tr('finance.note', { n: MODULES.filter((m) => m.finance).length })}
          </p>
        </div>
      </div>
    </>
  );
}
