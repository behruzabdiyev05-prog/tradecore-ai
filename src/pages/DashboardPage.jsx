import { useEffect, useMemo, useState } from 'react';
import { LuArrowRight, LuArrowUpRight, LuSparkles } from 'react-icons/lu';
import { MODULES } from '../../shared/modules.js';
import { formatMoney, monthlySeries, seriesStartDate } from '../../shared/finance.js';
import { Link } from '../core/router/router.jsx';
import { ModuleIcon } from '../core/ui/icons.jsx';
import { Badge, Card, Notice, Stat } from '../core/ui/components.jsx';
import { CapsuleBars, Donut, chartColor } from '../core/ui/charts.jsx';
import { useFinanceSummary, mapSummaryRow } from '../core/finance/useFinanceSummary.js';
import { useAuth } from '../core/auth/AuthProvider.jsx';
import { useAres } from '../core/ares/AresProvider.jsx';
import { db } from '../core/data/db.js';
import { useOrg } from '../core/org/OrgProvider.jsx';
import { moduleHref } from '../layout/Sidebar.jsx';
import { SystemStatusCard } from './SystemPage.jsx';
import { errorText, t as tr, tModule } from '../core/i18n/index.js';
import OnboardingCard from './OnboardingCard.jsx';

const MONTHS = 8;

/** Real monthly revenue for the last N months (zero-filled, never invented). */
function useRevenueSeries(orgId) {
  const [state, setState] = useState({ loading: true });
  useEffect(() => {
    let alive = true;
    db.transactionsSince(orgId, seriesStartDate(MONTHS))
      .then((tx) => alive && setState({ loading: false, series: monthlySeries(tx, { months: MONTHS }) }))
      .catch((e) => alive && setState({ loading: false, error: errorText(e) }));
    return () => { alive = false; };
  }, [orgId]);
  return state;
}

function useSavedCount(orgId) {
  const [n, setN] = useState(null);
  useEffect(() => {
    let alive = true;
    db.savedItemsCount(orgId).then((c) => alive && setN(c)).catch(() => alive && setN(null));
    return () => { alive = false; };
  }, [orgId]);
  return n;
}

const shortMoney = (minor) => formatMoney(minor).replace(/[.,]00(?= )/, '');

export default function DashboardPage() {
  const { user } = useAuth();
  const { openAres } = useAres();
  const { orgId, can, canModule } = useOrg();
  const { loading, error, data } = useFinanceSummary(undefined);
  const revenue = useRevenueSeries(orgId);
  const saved = useSavedCount(orgId);
  const t = data?.total;
  const firstName = user?.user_metadata?.full_name?.split(/\s+/)[0];
  const ready = !loading && !error;
  const activeModules = MODULES.filter((m) => m.status === 'active').length;

  const segments = useMemo(
    () => (data?.rows ?? [])
      .map((r) => ({ key: r.module_key, ...mapSummaryRow(r) }))
      .filter((r) => r.revenue > 0)
      .sort((a, b) => b.revenue - a.revenue)
      .map((r, i) => ({ label: r.key ? tModule(r.key, 'shortName') || r.key : tr('dash.general'), value: r.revenue, color: chartColor(i) })),
    [data],
  );

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{firstName ? tr('dash.hello_name', { name: firstName }) : tr('dash.hello')} <span aria-hidden>👋</span></h1>
          <p>{tr('dash.subtitle')}</p>
        </div>
        <div className="page-actions">
          <Link to="/finance" className="btn">{tr('nav.finance')}</Link>
          <button className="btn btn-primary" onClick={() => openAres(null)}><LuSparkles /> {tr('dash.ask_ares')}</button>
        </div>
      </div>

      <OnboardingCard />
      {!can('finance.read') && <div style={{ marginBottom: 16 }}><Notice>{tr('dash.no_finance_perm')}</Notice></div>}
      {error && <div style={{ marginBottom: 16 }}><Notice tone="error">{tr('finance.load_error')}: {error}</Notice></div>}

      <div className="grid grid-stats" style={{ marginBottom: 16 }}>
        <Stat featured label={tr('dash.total_revenue')} money={ready ? t.revenue : null} to="/finance"
          sub={loading ? tr('common.loading') : error ? tr('common.no_data') : t.count === 0 ? tr('dash.no_transactions') : tr('dash.all_modules')} />
        <Stat label={tr('dash.transactions')} value={ready ? t.count : null} sub={tr('dash.transactions.sub')} />
        <Stat label={tr('finance.net_profit')} money={ready ? t.netProfit : null} signed sub={tr('finance.net_profit.sub')} />
        <Stat label={tr('finance.cash_flow')} money={ready ? t.cashFlow : null} signed sub={tr('finance.cash_flow.sub')} />
      </div>

      <div className="grid grid-2" style={{ marginBottom: 16 }}>
        <Card title={tr('dash.revenue_trend')} sub={tr('dash.revenue_trend.sub', { n: MONTHS })}
          actions={<Link to="/finance" className="corner-btn" aria-label={tr('nav.finance')}><LuArrowUpRight /></Link>}>
          {revenue.error
            ? <div className="card-pad"><Notice tone="error">{revenue.error}</Notice></div>
            : <CapsuleBars data={revenue.series ?? monthlySeries([], { months: MONTHS })} format={shortMoney}
                emptyText={revenue.loading ? tr('common.loading') : tr('dash.no_sales')} />}
        </Card>

        <div className="stack">
          <div className="grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
            <Stat label={tr('dash.saved')} value={saved} sub={tr('dash.saved.sub')} />
            <Stat label={tr('dash.active_modules')} value={`${activeModules} / ${MODULES.length}`} sub={tr('dash.active_modules.sub')} />
          </div>
          <Card title={tr('dash.revenue_by_module')} sub={tr('dash.revenue_by_module.sub')} style={{ flex: 1 }}>
            <div className="donut-row">
              <Donut segments={segments} centerTop={tr('dash.total')} centerValue={ready ? shortMoney(t.revenue) : '—'} />
              {segments.length > 0 ? (
                <ul className="legend">
                  {segments.slice(0, 6).map((s) => (
                    <li key={s.label}><i style={{ background: s.color }} />{s.label}<span className="v">{shortMoney(s.value)}</span></li>
                  ))}
                </ul>
              ) : (
                <p className="muted" style={{ fontSize: 13 }}>{tr('dash.share_hint')}</p>
              )}
            </div>
          </Card>
        </div>
      </div>

      <div className="grid grid-2">
        <Card title={tr('nav.modules')} sub={tr('dash.modules.sub')}>
          <div className="grid grid-modules" style={{ padding: '4px 16px 16px' }}>
            {MODULES.filter((m) => canModule(m.key)).map((m) => (
              <Link key={m.key} to={moduleHref(m.key)} className="glass module-card">
                <div className="module-card-top">
                  <div className="module-card-icon"><ModuleIcon icon={m.icon} /></div>
                  <span className="nav-code">{m.code}</span>
                </div>
                <h3>{tModule(m, 'name')}</h3>
                <p>{tModule(m, 'summary')}</p>
                <div className="module-card-top">
                  <Badge tone="warn">Phase 3</Badge>
                  <LuArrowRight className="faint" aria-hidden />
                </div>
              </Link>
            ))}
          </div>
        </Card>
        <SystemStatusCard />
      </div>
    </>
  );
}
