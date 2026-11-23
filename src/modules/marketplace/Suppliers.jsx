import { useMemo, useState } from 'react';
import { LuExternalLink, LuHistory, LuPencil, LuPlus, LuStar, LuTrash2, LuTruck } from 'react-icons/lu';
import { errorText, formatDate, formatDateTime, t } from '../../core/i18n/index.js';
import { useOrg } from '../../core/org/OrgProvider.jsx';
import { Badge, Card, EmptyState, Modal, Notice } from '../../core/ui/components.jsx';
import { CURRENCY_CODES, fromMinor } from '../../../shared/finance.js';
import { marketplace } from './api.js';
import { Field, MoneyInput, formGrid, intOrNull, money, useLoad } from './ui.jsx';

const amountText = (minor, cur) => `${fromMinor(Number(minor), cur)} ${cur}`;

function toCurMinor(text) {
  const s = String(text ?? '').trim().replace(',', '.');
  if (s === '') return 0;
  if (!/^\d+(\.\d{1,2})?$/.test(s)) throw new Error('mp.err.amount');
  return Math.round(Number(s) * 100);
}

function OfferForm({ orgId, offer, products, onClose, onSaved }) {
  const [f, setF] = useState(() => ({
    product_id: offer?.product_id ?? products[0]?.id ?? '', supplier_name: offer?.supplier_name ?? 'AliExpress',
    url: offer?.url ?? '', supplier_sku: offer?.supplier_sku ?? '', currency: offer?.currency ?? 'USD',
    price: offer ? fromMinor(Number(offer.price_minor), offer.currency) : '', shipping: offer ? fromMinor(Number(offer.shipping_minor), offer.currency) : '',
    fx: offer ? String(Number(offer.fx_rate_to_base)) : '', dmin: offer?.delivery_min_days ?? '', dmax: offer?.delivery_max_days ?? '',
    stock: offer?.supplier_stock ?? '', notes: offer?.notes ?? '',
  }));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const set = (k) => (v) => setF((s) => ({ ...s, [k]: typeof v === 'string' ? v : v.target.value }));
  const azn = f.currency === 'AZN';

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setMsg(null);
    try {
      const fx = azn ? 1 : Number(String(f.fx).replace(',', '.'));
      if (!azn && !(fx > 0)) throw new Error('mp.err.fx');
      await marketplace.saveOffer(orgId, {
        id: offer?.id, product_id: f.product_id, supplier_name: f.supplier_name.trim(), url: f.url.trim() || null,
        supplier_sku: f.supplier_sku.trim() || null, currency: f.currency, price_minor: toCurMinor(f.price), shipping_minor: toCurMinor(f.shipping),
        fx_rate_to_base: fx, delivery_min_days: intOrNull(f.dmin), delivery_max_days: intOrNull(f.dmax),
        supplier_stock: intOrNull(f.stock), notes: f.notes.trim() || null,
      });
      onSaved();
    } catch (err) {
      setMsg(errorText(err));
      setBusy(false);
    }
  }

  return (
    <Modal title={offer ? t('mp.sup.edit') : t('mp.sup.new')} onClose={onClose} width={680}>
      <form className="stack" onSubmit={submit} style={{ gap: 14 }}>
        <div style={formGrid}>
          <Field id="s-prod" label={t('mp.o.product')} wide>
            <select id="s-prod" className="input" value={f.product_id} onChange={set('product_id')} disabled={Boolean(offer)}>
              {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </Field>
          <Field id="s-name" label={t('mp.f.supplier')}><input id="s-name" className="input" required value={f.supplier_name} onChange={set('supplier_name')} /></Field>
          <Field id="s-sku" label={t('mp.sup.sku')}><input id="s-sku" className="input" value={f.supplier_sku} onChange={set('supplier_sku')} /></Field>
          <Field id="s-url" label={t('mp.f.supplier_url')} wide><input id="s-url" className="input" type="url" placeholder="https://" value={f.url} onChange={set('url')} /></Field>
          <Field id="s-cur" label={t('mp.sup.currency')}>
            <select id="s-cur" className="input" value={f.currency} onChange={set('currency')}>
              {CURRENCY_CODES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </Field>
          <Field id="s-price" label={t('mp.sup.price', { cur: f.currency })}><MoneyInput id="s-price" value={f.price} onChange={set('price')} /></Field>
          <Field id="s-ship" label={t('mp.sup.shipping', { cur: f.currency })}><MoneyInput id="s-ship" value={f.shipping} onChange={set('shipping')} /></Field>
          {!azn && (
            <Field id="s-fx" label={t('mp.sup.fx', { cur: f.currency })} hint={t('mp.sup.fx_hint')}>
              <input id="s-fx" className="input num" inputMode="decimal" required value={f.fx} onChange={set('fx')} />
            </Field>
          )}
          <Field id="s-dmin" label={t('mp.sup.days_min')}><input id="s-dmin" className="input num" inputMode="numeric" value={f.dmin} onChange={set('dmin')} /></Field>
          <Field id="s-dmax" label={t('mp.sup.days_max')}><input id="s-dmax" className="input num" inputMode="numeric" value={f.dmax} onChange={set('dmax')} /></Field>
          <Field id="s-stock" label={t('mp.sup.stock')}><input id="s-stock" className="input num" inputMode="numeric" value={f.stock} onChange={set('stock')} /></Field>
          <Field id="s-notes" label={t('mp.o.note')} wide><textarea id="s-notes" className="input" rows={2} value={f.notes} onChange={set('notes')} /></Field>
        </div>
        {msg && <Notice tone="error">{msg}</Notice>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn-ghost" onClick={onClose}>{t('common.cancel')}</button>
          <button type="submit" className="btn btn-primary" disabled={busy}>{t('common.save')}</button>
        </div>
      </form>
    </Modal>
  );
}

function PriceLog({ orgId, offer, onClose }) {
  const { data, error, loading } = useLoad(() => marketplace.offerPrices(orgId, offer.id), [orgId, offer.id]);
  return (
    <Modal title={t('mp.sup.price_log', { name: offer.supplier_name })} onClose={onClose} width={600}>
      {error && <Notice tone="error">{error}</Notice>}
      {loading && !data ? <div className="faint">{t('common.loading')}</div> : !data?.length ? <div className="faint">{t('mp.history.empty')}</div> : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>{t('mp.history.when')}</th><th className="r">{t('mp.sup.price_only')}</th><th className="r">{t('mp.sup.shipping_only')}</th><th className="r">AZN</th></tr></thead>
            <tbody>{data.map((p) => (
              <tr key={p.id}>
                <td className="faint">{formatDateTime(p.recorded_at)}</td>
                <td className="r num">{amountText(p.price_minor, p.currency)}</td>
                <td className="r num">{amountText(p.shipping_minor, p.currency)}</td>
                <td className="r num">{money(Number(p.price_azn_minor) + Number(p.shipping_azn_minor))}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}

export default function Suppliers() {
  const { orgId, can } = useOrg();
  const canWrite = can('data.write') && can('module.marketplace.write');
  const offers = useLoad(() => marketplace.offers(orgId), [orgId]);
  const listings = useLoad(() => marketplace.listings(orgId), [orgId]);
  const [editing, setEditing] = useState(null);
  const [log, setLog] = useState(null);
  const [msg, setMsg] = useState(null);

  const products = useMemo(() => (listings.data ?? []).map((l) => ({ id: l.product_id, name: l.product?.name ?? '—' })), [listings.data]);
  const groups = useMemo(() => {
    const byProduct = new Map(products.map((p) => [p.id, { ...p, offers: [] }]));
    for (const o of offers.data ?? []) byProduct.get(o.product_id)?.offers.push(o);
    return [...byProduct.values()].filter((g) => g.offers.length)
      .map((g) => ({ ...g, offers: g.offers.sort((a, b) => (Number(a.price_azn_minor) + Number(a.shipping_azn_minor)) - (Number(b.price_azn_minor) + Number(b.shipping_azn_minor))) }));
  }, [offers.data, products]);

  const act = async (fn, confirmText) => {
    if (confirmText && !window.confirm(confirmText)) return;
    setMsg(null);
    try { await fn(); await offers.reload(); } catch (err) { setMsg(errorText(err)); }
  };

  return (
    <Card title={t('mp.sup.title')} sub={t('mp.sup.sub')}
      actions={canWrite && products.length > 0 && <button className="btn btn-primary" onClick={() => setEditing('new')}><LuPlus /> {t('mp.sup.new')}</button>}>
      {!canWrite && <div className="card-pad" style={{ paddingBottom: 0 }}><Notice>{t('mp.read_only')}</Notice></div>}
      {(offers.error || listings.error || msg) && <div className="card-pad" style={{ paddingBottom: 0 }}><Notice tone="error">{offers.error || listings.error || msg}</Notice></div>}
      {(offers.loading && !offers.data) || (listings.loading && !listings.data) ? <div className="card-pad faint">{t('common.loading')}</div>
        : !groups.length ? (
          <EmptyState icon={LuTruck} title={t('mp.sup.empty')}>{products.length ? t('mp.sup.empty_body') : t('mp.sup.need_product')}</EmptyState>
        ) : (
          <div className="stack card-pad" style={{ gap: 18 }}>
            {groups.map((g) => (
              <div key={g.id} className="stack" style={{ gap: 6 }}>
                <strong>{g.name}</strong>
                <div className="table-wrap">
                  <table className="table">
                    <thead><tr><th>{t('mp.f.supplier')}</th><th className="r">{t('mp.sup.price_only')}</th><th className="r">{t('mp.sup.total_azn')}</th><th>{t('mp.sup.delivery')}</th><th>{t('mp.sup.checked')}</th><th className="r" /></tr></thead>
                    <tbody>
                      {g.offers.map((o, i) => (
                        <tr key={o.id} data-offer={o.supplier_name}>
                          <td>
                            {o.supplier_name} {o.is_primary && <Badge tone="accent">{t('mp.sup.primary')}</Badge>} {i === 0 && g.offers.length > 1 && <Badge tone="ok">{t('mp.sup.cheapest')}</Badge>}
                            {o.url && <a href={o.url} target="_blank" rel="noopener noreferrer" className="faint" style={{ marginLeft: 6 }} aria-label={t('mp.sup.open_link')}><LuExternalLink /></a>}
                          </td>
                          <td className="r num">{amountText(Number(o.price_minor) + Number(o.shipping_minor), o.currency)}</td>
                          <td className="r num">{money(Number(o.price_azn_minor) + Number(o.shipping_azn_minor))}</td>
                          <td>{o.delivery_min_days != null || o.delivery_max_days != null ? t('mp.sup.days', { a: o.delivery_min_days ?? '?', b: o.delivery_max_days ?? '?' }) : '—'}</td>
                          <td className="faint">{formatDate(o.last_checked_at)}</td>
                          <td className="r" style={{ whiteSpace: 'nowrap' }}>
                            <button className="btn btn-ghost btn-icon" aria-label={t('mp.sup.price_log', { name: o.supplier_name })} onClick={() => setLog(o)}><LuHistory /></button>
                            {canWrite && !o.is_primary && <button className="btn btn-ghost btn-icon" aria-label={t('mp.sup.make_primary')} onClick={() => act(() => marketplace.setPrimaryOffer(orgId, o))}><LuStar /></button>}
                            {canWrite && <button className="btn btn-ghost btn-icon" aria-label={t('mp.sup.edit')} onClick={() => setEditing(o)}><LuPencil /></button>}
                            {canWrite && <button className="btn btn-ghost btn-icon" aria-label={t('mp.sup.delete')} onClick={() => act(() => marketplace.deleteOffer(orgId, o.id), t('mp.sup.delete_confirm'))}><LuTrash2 /></button>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        )}
      <div className="card-pad faint" style={{ fontSize: 12 }}>{t('mp.sup.fx_note')}</div>
      {editing && <OfferForm orgId={orgId} offer={editing === 'new' ? null : editing} products={products} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); offers.reload(); }} />}
      {log && <PriceLog orgId={orgId} offer={log} onClose={() => setLog(null)} />}
    </Card>
  );
}
