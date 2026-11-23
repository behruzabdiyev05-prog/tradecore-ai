import { useEffect, useState } from 'react';
import { errorText, t, tModule } from '../../core/i18n/index.js';
import { tenancy } from '../../core/data/tenancy.js';
import { useOrg } from '../../core/org/OrgProvider.jsx';
import { Badge, Card, Notice } from '../../core/ui/components.jsx';
import { getModule } from '../../../shared/modules.js';

export default function PlanPage() {
  const { orgId } = useOrg();
  const [state, setState] = useState({ loading: true });

  useEffect(() => {
    let alive = true;
    tenancy.subscription(orgId)
      .then((sub) => alive && setState({ loading: false, sub }))
      .catch((err) => alive && setState({ loading: false, error: errorText(err) }));
    return () => { alive = false; };
  }, [orgId]);

  const plan = state.sub?.plan;
  const limits = Object.entries(plan?.limits ?? {});

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">{t('nav.plan')}</div>
          <h1>{t('plan.title')}</h1>
          <p>{t('plan.subtitle')}</p>
        </div>
      </div>
      {state.error && <Notice tone="error">{state.error}</Notice>}
      {state.loading ? <div className="faint">{t('common.loading')}</div> : (
        <div className="grid grid-2">
          <Card title={t('plan.name')}>
            <div className="status-list">
              <div className="status-row"><span className="label">{t('plan.name')}</span><strong>{plan ? (plan.key === 'internal' ? t('plan.internal') : plan.name) : '—'}</strong></div>
              <div className="status-row"><span className="label">{t('plan.status')}</span><Badge tone="ok">{state.sub?.status ? t(`plan.status.${state.sub.status}`) : '—'}</Badge></div>
              <div className="status-row"><span className="label">{t('plan.limits')}</span>
                <span>{limits.length === 0 ? t('plan.unlimited') : limits.map(([k, v]) => `${k}: ${v}`).join(', ')}</span></div>
            </div>
          </Card>
          <Card title={t('plan.modules')} sub={`${plan?.modules?.length ?? 0} / 10`}>
            <div className="status-list">
              {(plan?.modules ?? []).map((k) => (
                <div className="status-row" key={k}><span className="label">{getModule(k)?.code} · {tModule(k, 'name') || k}</span><Badge tone="ok">{t('plan.open')}</Badge></div>
              ))}
            </div>
          </Card>
        </div>
      )}
    </>
  );
}
