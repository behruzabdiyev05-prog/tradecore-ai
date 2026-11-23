/**
 * Standard workspace every module is built on. It provides the common
 * sections (overview, search, data, finance, reports, AI) so all 10 modules
 * share one structure while keeping their own content.
 *
 * A module passes `sections` to override any tab with its own component
 * as it gets implemented in Phase 3+. Tabs without an implementation show
 * an honest "not built yet" state — never sample data.
 */
import { useEffect, useState } from 'react';
import { LuCircleDashed, LuSparkles } from 'react-icons/lu';
import { ModuleIcon } from '../../core/ui/icons.jsx';
import { Badge, Card, EmptyState, Notice, Stat } from '../../core/ui/components.jsx';
import { useFinanceSummary } from '../../core/finance/useFinanceSummary.js';
import { useAres } from '../../core/ares/AresProvider.jsx';
import { db } from '../../core/data/db.js';
import { useOrg } from '../../core/org/OrgProvider.jsx';
import { errorText, t as tr, tModule, tModuleFeatures } from '../../core/i18n/index.js';

/** Tab ids; labels come from the dictionaries (mw.tab.<id>). */
export const STANDARD_TABS = ['overview', 'search', 'data', 'finance', 'history', 'reports', 'ai'].map((id) => ({
  id, get label() { return tr(`mw.tab.${id}`); },
}));

const STATUS_LABEL = {
  planned: { tone: 'warn', key: 'mw.status.planned' },
  in_development: { tone: 'accent', key: 'mw.status.in_development' },
  active: { tone: 'ok', key: 'common.active' },
};

function ModuleFinance({ module }) {
  const { loading, error, data } = useFinanceSummary(module.key);
  if (!module.finance) {
    return (
      <Card pad>
        <Notice>{tr('mw.finance.separate')}</Notice>
      </Card>
    );
  }
  if (error) return <Notice tone="error">{tr('finance.load_error')}: {error}</Notice>;
  const t = data?.total;
  return (
    <div className="grid grid-stats">
      <Stat featured label={tr('finance.revenue')} money={loading ? null : t.revenue} sub={loading ? tr('common.loading') : tr('mw.finance.count', { n: t.count })} />
      <Stat label={tr('finance.cogs')} money={loading ? null : t.cogs} />
      <Stat label={tr('finance.gross_profit')} money={loading ? null : t.grossProfit} signed />
      <Stat label={tr('finance.net_profit')} money={loading ? null : t.netProfit} signed />
    </div>
  );
}

function SavedCount({ moduleKey }) {
  const { orgId } = useOrg();
  const [state, setState] = useState({ loading: true });
  useEffect(() => {
    let alive = true;
    db.savedItems(orgId, moduleKey)
      .then((rows) => alive && setState({ loading: false, count: rows.length }))
      .catch((e) => alive && setState({ loading: false, error: errorText(e) }));
    return () => { alive = false; };
  }, [orgId, moduleKey]);
  if (state.loading) return <span className="faint">{tr('common.loading')}</span>;
  if (state.error) return <span className="neg">{tr('system.state.error')}: {state.error}</span>;
  return <span className="num">{state.count}</span>;
}

function NotBuilt({ label }) {
  return (
    <Card>
      <EmptyState icon={LuCircleDashed} title={tr('mw.not_built.title', { label })}>
        {tr('mw.not_built.body')}
      </EmptyState>
    </Card>
  );
}

export default function ModuleWorkspace({ module, sections = {} }) {
  const [tab, setTab] = useState('overview');
  const { openAres } = useAres();
  const status = STATUS_LABEL[module.status] ?? STATUS_LABEL.planned;
  const name = tModule(module, 'name');
  const shortName = tModule(module, 'shortName');

  useEffect(() => setTab('overview'), [module.key]);

  const Custom = sections[tab];
  let body;
  if (Custom) body = <Custom module={module} />;
  else if (tab === 'overview') {
    body = (
      <div className="grid grid-2">
        <Card title={tr('mw.features')} actions={<Badge tone={status.tone}>{tr(status.key)}</Badge>}>
          <ul className="feature-list">
            {tModuleFeatures(module).map((f) => (
              <li key={f}><LuCircleDashed aria-hidden />{f}</li>
            ))}
          </ul>
        </Card>
        <div className="stack">
          <Card title={tr('mw.info')}>
            <div className="status-list">
              <div className="status-row"><span className="label">{tr('dash.saved')}</span><SavedCount moduleKey={module.key} /></div>
              <div className="status-row"><span className="label">{tr('mw.central_finance')}</span><span>{module.finance ? tr('mw.connected') : tr('mw.separate')}</span></div>
              <div className="status-row"><span className="label">{tr('mw.key')}</span><code className="faint">{module.key}</code></div>
            </div>
          </Card>
          <Card pad className="stat featured" style={{ minHeight: 0 }}>
            <div className="stack" style={{ gap: 10 }}>
              <strong>{tr('mw.assistant', { name: shortName })}</strong>
              <p style={{ fontSize: 13, color: 'var(--featured-ink-2)' }}>{tr('mw.assistant.body')}</p>
              <button className="btn btn-light" onClick={() => openAres(module.key)}><LuSparkles /> {tr('mw.assistant.open')}</button>
            </div>
          </Card>
        </div>
      </div>
    );
  } else if (tab === 'finance') body = <ModuleFinance module={module} />;
  else if (tab === 'ai') {
    body = (
      <Card>
        <EmptyState icon={LuSparkles} title={tr('mw.ai.title', { name })}
          action={<button className="btn btn-primary" onClick={() => openAres(module.key)}>{tr('mw.ai.open')}</button>}>
          {tr('mw.ai.body')}
        </EmptyState>
      </Card>
    );
  } else body = <NotBuilt label={STANDARD_TABS.find((t) => t.id === tab)?.label} />;

  return (
    <>
      <div className="page-head">
        <div className="module-hero">
          <div className="module-card-icon"><ModuleIcon icon={module.icon} /></div>
          <div>
            <div className="eyebrow">{tr('mw.eyebrow', { code: module.code })}</div>
            <h1>{name}</h1>
            <p>{tModule(module, 'summary')}</p>
          </div>
        </div>
        <div className="page-actions">
          <button className="btn btn-primary" onClick={() => openAres(module.key)}><LuSparkles /> {tr('mw.assistant', { name: shortName })}</button>
        </div>
      </div>
      <div className="tabs" role="tablist">
        {STANDARD_TABS.map((t) => (
          <button key={t.id} role="tab" className="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}>{t.label}</button>
        ))}
      </div>
      {body}
    </>
  );
}
