import { LuCircleDashed, LuSparkles } from 'react-icons/lu';
import { formatDate, t, tModuleFeatures } from '../../core/i18n/index.js';
import { useOrg } from '../../core/org/OrgProvider.jsx';
import { useAres } from '../../core/ares/AresProvider.jsx';
import { Badge, Card, Notice, Stat } from '../../core/ui/components.jsx';
import { isLowStock, orderTotals } from '../../../shared/marketplace/calc.js';
import { marketplace } from './api.js';
import { money, statusTone, useLoad } from './ui.jsx';

/** Modul 03 overview: numbers come only from this organization's own rows. */
export default function Overview({ module, settings, goTo }) {
  const { orgId } = useOrg();
  const { openAres } = useAres();
  const listings = useLoad(() => marketplace.listings(orgId), [orgId]);
  const orders = useLoad(() => marketplace.orders(orgId), [orgId]);
  const L = listings.data ?? [];
  const O = orders.data ?? [];
  const ready = listings.data && orders.data;
  const low = L.filter((l) => isLowStock(l, settings.low_stock_threshold));
  const totals = orderTotals(O.flatMap((o) => o.lines ?? []));
  const open = O.filter((o) => o.status === 'processing' || o.status === 'transit' || o.status === 'problem');

  return (
    <div className="stack">
      {(listings.error || orders.error) && <Notice tone="error">{listings.error || orders.error}</Notice>}
      <div className="grid grid-stats">
        <Stat featured label={t('mp.ov.sales')} money={ready ? totals.sale : null} sub={ready ? t('mp.ov.orders_n', { n: O.length }) : t('common.loading')} />
        <Stat label={t('mp.col.profit')} money={ready ? totals.net : null} signed />
        <Stat label={t('mp.ov.products')} value={ready ? L.length : null} sub={ready ? t('mp.ov.active_n', { n: L.filter((l) => l.status === 'active').length }) : undefined} />
        <Stat label={t('mp.ov.open_orders')} value={ready ? open.length : null} />
      </div>
      {ready && totals.costMissing && <Notice>{t('mp.ov.cost_missing')}</Notice>}
      <div className="grid grid-2">
        <Card title={t('mp.ov.recent')} actions={<button className="btn btn-ghost" onClick={() => goTo('orders')}>{t('mp.ov.all')}</button>}>
          {!ready ? <div className="card-pad faint">{t('common.loading')}</div> : !O.length ? <div className="card-pad faint">{t('mp.orders.empty')}</div> : (
            <div className="status-list card-pad">
              {O.slice(0, 6).map((o) => (
                <div className="status-row" key={o.id}>
                  <span className="label">{o.order_number} · {o.customer_name} <span className="faint">· {formatDate(o.placed_at)}</span></span>
                  <span><Badge tone={statusTone(o.status)}>{t(`mp.status.${o.status}`)}</Badge> <span className="num">{money(orderTotals(o.lines).sale)}</span></span>
                </div>
              ))}
            </div>
          )}
        </Card>
        <div className="stack">
          <Card title={t('mp.ov.low_stock')} actions={<button className="btn btn-ghost" onClick={() => goTo('products')}>{t('mp.ov.all')}</button>}>
            {!ready ? <div className="card-pad faint">{t('common.loading')}</div> : !low.length ? <div className="card-pad faint">{t('mp.ov.low_none')}</div> : (
              <div className="status-list card-pad">
                {low.slice(0, 6).map((l) => (
                  <div className="status-row" key={l.id}><span className="label">{l.product?.name}</span><span className="num neg">{l.stock}</span></div>
                ))}
              </div>
            )}
          </Card>
          <Card title={t('mw.features')}>
            <ul className="feature-list">
              {tModuleFeatures(module).map((f) => <li key={f}><LuCircleDashed aria-hidden />{f}</li>)}
            </ul>
          </Card>
          <Card pad className="stat featured" style={{ minHeight: 0 }}>
            <div className="stack" style={{ gap: 10 }}>
              <strong>{t('mp.ov.ares')}</strong>
              <p style={{ fontSize: 13, color: 'var(--featured-ink-2)' }}>{t('mw.assistant.body')}</p>
              <button className="btn btn-light" onClick={() => openAres('marketplace')}><LuSparkles /> {t('mw.assistant.open')}</button>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
