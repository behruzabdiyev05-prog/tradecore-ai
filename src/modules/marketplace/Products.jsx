import { useMemo, useState } from 'react';
import { LuHistory, LuPackagePlus, LuPencil, LuTrash2 } from 'react-icons/lu';
import { errorText, t } from '../../core/i18n/index.js';
import { useOrg } from '../../core/org/OrgProvider.jsx';
import { Badge, Card, EmptyState, Modal, Notice } from '../../core/ui/components.jsx';
import { isLowStock, listingProfit } from '../../../shared/marketplace/calc.js';
import { marketplace } from './api.js';
import { Field, MoneyInput, formGrid, inputToMinor, intOrNull, minorToInput, money, pct, statusTone, useLoad } from './ui.jsx';
import { HistoryModal } from './History.jsx';

const STATUSES = ['active', 'out_of_stock', 'draft'];

function ListingForm({ orgId, listing, onClose, onSaved }) {
  const isNew = !listing;
  const shopify = listing?.channel === 'shopify';
  const [f, setF] = useState(() => ({
    name: listing?.product?.name ?? '', sku: listing?.product?.sku ?? '', category: listing?.product?.category ?? '',
    supplier_name: listing?.supplier_name ?? '', supplier_url: listing?.supplier_url ?? '',
    purchase: minorToInput(listing?.purchase_azn_minor ?? 0, { blankZero: true }),
    shipping: minorToInput(listing?.shipping_azn_minor ?? 0, { blankZero: true }),
    other: minorToInput(listing?.other_azn_minor ?? 0, { blankZero: true }),
    sale: minorToInput(listing?.sale_azn_minor ?? 0, { blankZero: true }),
    stock: String(listing?.stock ?? 0), status: listing?.status ?? 'active',
    low: listing?.low_stock_threshold == null ? '' : String(listing.low_stock_threshold),
  }));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const set = (k) => (v) => setF((s) => ({ ...s, [k]: typeof v === 'string' ? v : v.target.value }));

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setMsg(null);
    try {
      if (!f.name.trim()) throw new Error('mp.err.name');
      const values = {
        name: f.name, sku: f.sku, category: f.category,
        supplier_name: f.supplier_name.trim() || null, supplier_url: f.supplier_url.trim() || null,
        purchase_azn_minor: inputToMinor(f.purchase), shipping_azn_minor: inputToMinor(f.shipping),
        other_azn_minor: inputToMinor(f.other), sale_azn_minor: inputToMinor(f.sale),
        stock: intOrNull(f.stock) ?? 0, status: f.status, low_stock_threshold: intOrNull(f.low),
      };
      if (shopify) { delete values.stock; delete values.sale_azn_minor; }   // D1: comes from Shopify
      if (isNew) await marketplace.createListing(orgId, values);
      else await marketplace.updateListing(orgId, listing, values);
      onSaved();
    } catch (err) {
      setMsg(errorText(err));
      setBusy(false);
    }
  }

  return (
    <Modal title={isNew ? t('mp.products.new') : t('mp.products.edit')} onClose={onClose} width={680}>
      <form className="stack" onSubmit={submit} style={{ gap: 14 }}>
        {shopify && <Notice>{t('mp.products.shopify_note')}</Notice>}
        <div style={formGrid}>
          <Field id="mp-name" label={t('mp.f.name')} wide><input id="mp-name" className="input" required value={f.name} onChange={set('name')} /></Field>
          <Field id="mp-sku" label={t('mp.f.sku')}><input id="mp-sku" className="input" value={f.sku} onChange={set('sku')} /></Field>
          <Field id="mp-cat" label={t('mp.f.category')}><input id="mp-cat" className="input" value={f.category} onChange={set('category')} /></Field>
          <Field id="mp-purchase" label={t('mp.f.purchase')}><MoneyInput id="mp-purchase" value={f.purchase} onChange={set('purchase')} /></Field>
          <Field id="mp-shipping" label={t('mp.f.shipping')}><MoneyInput id="mp-shipping" value={f.shipping} onChange={set('shipping')} /></Field>
          <Field id="mp-other" label={t('mp.f.other')}><MoneyInput id="mp-other" value={f.other} onChange={set('other')} /></Field>
          <Field id="mp-sale" label={t('mp.f.sale')}><MoneyInput id="mp-sale" value={f.sale} onChange={set('sale')} disabled={shopify} /></Field>
          <Field id="mp-stock" label={t('mp.f.stock')}><input id="mp-stock" className="input num" inputMode="numeric" value={f.stock} onChange={set('stock')} disabled={shopify} /></Field>
          <Field id="mp-low" label={t('mp.f.low_stock')} hint={t('mp.f.low_stock_hint')}><input id="mp-low" className="input num" inputMode="numeric" value={f.low} onChange={set('low')} /></Field>
          <Field id="mp-status" label={t('mp.f.status')}>
            <select id="mp-status" className="input" value={f.status} onChange={set('status')}>
              {STATUSES.map((s) => <option key={s} value={s}>{t(`mp.status.${s}`)}</option>)}
            </select>
          </Field>
          <Field id="mp-sup" label={t('mp.f.supplier')}><input id="mp-sup" className="input" value={f.supplier_name} onChange={set('supplier_name')} /></Field>
          <Field id="mp-supurl" label={t('mp.f.supplier_url')} wide><input id="mp-supurl" className="input" type="url" placeholder="https://" value={f.supplier_url} onChange={set('supplier_url')} /></Field>
        </div>
        <div className="faint" style={{ fontSize: 12 }}>{t('mp.f.azn_note')}</div>
        {msg && <Notice tone="error">{msg}</Notice>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn-ghost" onClick={onClose}>{t('common.cancel')}</button>
          <button type="submit" className="btn btn-primary" disabled={busy}>{t('common.save')}</button>
        </div>
      </form>
    </Modal>
  );
}

export default function Products({ settings }) {
  const { orgId, can } = useOrg();
  const canWrite = can('data.write') && can('module.marketplace.write');
  const { data, error, loading, reload } = useLoad(() => marketplace.listings(orgId), [orgId]);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('all');
  const [editing, setEditing] = useState(null);   // null | 'new' | listing
  const [history, setHistory] = useState(null);
  const [actionMsg, setActionMsg] = useState(null);
  const fee = { feePercent: settings.payment_fee_percent, feeFixed: settings.payment_fee_fixed_azn_minor };

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (data ?? []).filter((l) => (status === 'all' || (status === 'low' ? isLowStock(l, settings.low_stock_threshold) : l.status === status))
      && (!needle || [l.product?.name, l.product?.sku, l.supplier_name, l.product?.category].some((v) => v?.toLowerCase().includes(needle))));
  }, [data, q, status, settings.low_stock_threshold]);

  async function remove(l) {
    if (!window.confirm(t('mp.products.delete_confirm', { name: l.product?.name ?? '' }))) return;
    setActionMsg(null);
    try {
      await marketplace.deleteListing(l.id);
      await reload();
    } catch (err) {
      if (err?.cause?.hint === 'draft' && l.status !== 'draft') {
        if (window.confirm(`${errorText(err)}\n\n${t('mp.products.make_draft')}`)) {
          try { await marketplace.updateListing(orgId, l, { status: 'draft' }); await reload(); } catch (e2) { setActionMsg(errorText(e2)); }
        }
      } else setActionMsg(errorText(err));
    }
  }

  return (
    <Card title={t('mp.products.title')} sub={t('mp.products.sub')}
      actions={canWrite && <button className="btn btn-primary" onClick={() => setEditing('new')}><LuPackagePlus /> {t('mp.products.new')}</button>}>
      <div className="card-pad" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', paddingBottom: 0 }}>
        <input className="input" style={{ flex: '1 1 220px' }} placeholder={t('mp.products.search')} aria-label={t('mp.products.search')} value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="input" style={{ width: 190 }} aria-label={t('mp.f.status')} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="all">{t('mp.filter.all')}</option>
          {STATUSES.map((s) => <option key={s} value={s}>{t(`mp.status.${s}`)}</option>)}
          <option value="low">{t('mp.filter.low')}</option>
        </select>
      </div>
      {!canWrite && <div className="card-pad" style={{ paddingBottom: 0 }}><Notice>{t('mp.read_only')}</Notice></div>}
      {(error || actionMsg) && <div className="card-pad" style={{ paddingBottom: 0 }}><Notice tone="error">{error || actionMsg}</Notice></div>}
      {loading && !data ? <div className="card-pad faint">{t('common.loading')}</div>
        : !rows.length ? (
          <EmptyState icon={LuPackagePlus} title={data?.length ? t('mp.products.none_found') : t('mp.products.empty')}>
            {data?.length ? null : t('mp.products.empty_body')}
          </EmptyState>
        ) : (
          <div className="table-wrap">
            <table className="table mp-products">
              <thead>
                <tr>
                  <th>{t('mp.f.name')}</th><th>{t('mp.f.status')}</th><th className="r">{t('mp.f.stock')}</th>
                  <th className="r">{t('mp.col.cost')}</th><th className="r">{t('mp.f.sale')}</th>
                  <th className="r">{t('mp.col.profit')}</th><th className="r">{t('mp.col.margin')}</th><th className="r" />
                </tr>
              </thead>
              <tbody>
                {rows.map((l) => {
                  const p = listingProfit({ sale: l.sale_azn_minor, purchase: l.purchase_azn_minor, shipping: l.shipping_azn_minor, other: l.other_azn_minor }, fee);
                  const low = isLowStock(l, settings.low_stock_threshold);
                  return (
                    <tr key={l.id} data-listing={l.product?.name}>
                      <td>
                        <div>{l.product?.name}</div>
                        <div className="faint" style={{ fontSize: 12 }}>
                          {[l.product?.sku, l.supplier_name, l.channel === 'shopify' ? 'Shopify' : null].filter(Boolean).join(' · ') || '—'}
                        </div>
                      </td>
                      <td><Badge tone={statusTone(l.status)}>{t(`mp.status.${l.status}`)}</Badge></td>
                      <td className={`r num ${low ? 'neg' : ''}`}>{l.stock}{low && <span className="sr-only"> {t('mp.filter.low')}</span>}</td>
                      <td className="r num">{money(p.cost)}</td>
                      <td className="r num">{money(l.sale_azn_minor)}</td>
                      <td className={`r num ${p.profit < 0 ? 'neg' : p.profit > 0 ? 'pos' : ''}`}>{money(p.profit)}</td>
                      <td className="r num">{pct(p.marginPercent)}</td>
                      <td className="r" style={{ whiteSpace: 'nowrap' }}>
                        <button className="btn btn-ghost btn-icon" aria-label={t('mp.history.of', { name: l.product?.name ?? '' })} onClick={() => setHistory(l)}><LuHistory /></button>
                        {canWrite && <button className="btn btn-ghost btn-icon" aria-label={t('mp.products.edit_of', { name: l.product?.name ?? '' })} onClick={() => setEditing(l)}><LuPencil /></button>}
                        {canWrite && <button className="btn btn-ghost btn-icon" aria-label={t('mp.products.delete_of', { name: l.product?.name ?? '' })} onClick={() => remove(l)}><LuTrash2 /></button>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      <div className="card-pad faint" style={{ fontSize: 12 }}>{t('mp.products.profit_note', { fee: settings.payment_fee_percent })}</div>
      {editing && <ListingForm orgId={orgId} listing={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />}
      {history && <HistoryModal entity="listing" id={history.id} title={history.product?.name} onClose={() => setHistory(null)} />}
    </Card>
  );
}
