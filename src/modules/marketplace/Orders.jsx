import { useMemo, useState } from 'react';
import { LuArchive, LuArchiveRestore, LuHistory, LuPencil, LuPlus, LuReceipt, LuTrash2, LuX } from 'react-icons/lu';
import { errorText, formatDate, t } from '../../core/i18n/index.js';
import { useOrg } from '../../core/org/OrgProvider.jsx';
import { Badge, Card, EmptyState, Modal, Notice } from '../../core/ui/components.jsx';
import { orderTotals, unitCost } from '../../../shared/marketplace/calc.js';
import { marketplace } from './api.js';
import { HistoryModal } from './History.jsx';
import { Field, MoneyInput, formGrid, inputToMinor, minorToInput, money, statusTone, useLoad } from './ui.jsx';

const ORDER_STATUSES = ['processing', 'transit', 'complete', 'problem'];
const SUPPLIER_STATUSES = ['not_ordered', 'ordered', 'shipped', 'delivered', 'problem'];

/** D4 + D7: the whole order is written by one database function (stock checked atomically). */
function NewOrder({ orgId, listings, onClose, onSaved }) {
  const usable = listings.filter((l) => l.status !== 'draft' && l.variant_count === 0);
  const [head, setHead] = useState({ order_number: '', customer_name: '', customer_email: '', status: 'processing', tracking_number: '', note: '' });
  const [lines, setLines] = useState([{ listing_id: usable[0]?.id ?? '', quantity: '1', sale: minorToInput(usable[0]?.sale_azn_minor ?? 0) }]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const byId = Object.fromEntries(listings.map((l) => [l.id, l]));
  const setH = (k) => (e) => setHead((s) => ({ ...s, [k]: e.target.value }));
  const setL = (i, patch) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  let preview = null;
  try {
    preview = orderTotals(lines.map((l) => {
      const lst = byId[l.listing_id]; const qty = Number(l.quantity) || 0;
      return { sale_azn_minor: inputToMinor(l.sale) * qty, cost_azn_minor: lst ? unitCost({ purchase: lst.purchase_azn_minor, shipping: lst.shipping_azn_minor, other: lst.other_azn_minor }) * qty : 0 };
    }));
  } catch { /* amount still being typed */ }

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setMsg(null);
    try {
      const payload = lines.map((l) => {
        const lst = byId[l.listing_id];
        if (!lst) throw new Error('mp.err.line_product');
        const qty = Number(l.quantity);
        if (!Number.isInteger(qty) || qty <= 0) throw new Error('mp.err.integer');
        return {
          listing_id: lst.id, quantity: qty,
          sale_azn_minor: inputToMinor(l.sale) * qty,     // line totals
          cost_azn_minor: unitCost({ purchase: lst.purchase_azn_minor, shipping: lst.shipping_azn_minor, other: lst.other_azn_minor }) * qty,
        };
      });
      await marketplace.createManualOrder(orgId, {
        order_number: head.order_number.trim(), customer_name: head.customer_name.trim(), customer_email: head.customer_email.trim(),
        status: head.status, tracking_number: head.tracking_number.trim(), note: head.note.trim(),
      }, payload);
      onSaved();
    } catch (err) {
      setMsg(errorText(err));
      setBusy(false);
    }
  }

  return (
    <Modal title={t('mp.orders.new')} onClose={onClose} width={760}>
      {!usable.length ? <Notice>{t('mp.orders.no_products')}</Notice> : (
        <form className="stack" onSubmit={submit} style={{ gap: 14 }}>
          <div style={formGrid}>
            <Field id="o-num" label={t('mp.o.number')}><input id="o-num" className="input" required value={head.order_number} onChange={setH('order_number')} /></Field>
            <Field id="o-cust" label={t('mp.o.customer')}><input id="o-cust" className="input" required value={head.customer_name} onChange={setH('customer_name')} /></Field>
            <Field id="o-mail" label={t('mp.o.email')}><input id="o-mail" className="input" type="email" value={head.customer_email} onChange={setH('customer_email')} /></Field>
            <Field id="o-status" label={t('mp.f.status')}>
              <select id="o-status" className="input" value={head.status} onChange={setH('status')}>
                {ORDER_STATUSES.map((s) => <option key={s} value={s}>{t(`mp.status.${s}`)}</option>)}
              </select>
            </Field>
            <Field id="o-track" label={t('mp.o.tracking')}><input id="o-track" className="input" value={head.tracking_number} onChange={setH('tracking_number')} /></Field>
            <Field id="o-note" label={t('mp.o.note')}><input id="o-note" className="input" value={head.note} onChange={setH('note')} /></Field>
          </div>

          <div className="stack" style={{ gap: 8 }}>
            <strong>{t('mp.o.lines')}</strong>
            {lines.map((l, i) => {
              const lst = byId[l.listing_id];
              return (
                <div key={i} style={{ display: 'grid', gridTemplateColumns: 'minmax(180px,2fr) 90px 130px auto', gap: 8, alignItems: 'end' }}>
                  <Field id={`l-p-${i}`} label={t('mp.o.product')}>
                    <select id={`l-p-${i}`} className="input" value={l.listing_id}
                      onChange={(e) => setL(i, { listing_id: e.target.value, sale: minorToInput(byId[e.target.value]?.sale_azn_minor ?? 0) })}>
                      {usable.map((u) => <option key={u.id} value={u.id}>{u.product?.name} ({t('mp.o.in_stock', { n: u.stock })})</option>)}
                    </select>
                  </Field>
                  <Field id={`l-q-${i}`} label={t('mp.o.qty')}>
                    <input id={`l-q-${i}`} className="input num" inputMode="numeric" value={l.quantity} onChange={(e) => setL(i, { quantity: e.target.value })} />
                  </Field>
                  <Field id={`l-s-${i}`} label={t('mp.o.unit_price')}><MoneyInput id={`l-s-${i}`} value={l.sale} onChange={(v) => setL(i, { sale: v })} /></Field>
                  <button type="button" className="btn btn-ghost btn-icon" aria-label={t('mp.o.remove_line')} disabled={lines.length === 1}
                    onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}><LuX /></button>
                  {lst && Number(l.quantity) > lst.stock && <div className="neg" style={{ gridColumn: '1 / -1', fontSize: 12 }}>{t('mp.o.stock_short', { n: lst.stock })}</div>}
                </div>
              );
            })}
            <div><button type="button" className="btn btn-ghost" onClick={() => setLines((ls) => [...ls, { listing_id: usable[0].id, quantity: '1', sale: minorToInput(usable[0].sale_azn_minor) }])}><LuPlus /> {t('mp.o.add_line')}</button></div>
          </div>

          {preview && (
            <div className="status-list">
              <div className="status-row"><span className="label">{t('mp.o.total_sale')}</span><span className="num">{money(preview.sale)}</span></div>
              <div className="status-row"><span className="label">{t('mp.o.total_cost')}</span><span className="num">{money(preview.cost)}</span></div>
              <div className="status-row"><span className="label">{t('mp.col.profit')}</span><span className={`num ${preview.net < 0 ? 'neg' : 'pos'}`}>{money(preview.net)}</span></div>
            </div>
          )}
          <div className="faint" style={{ fontSize: 12 }}>{t('mp.orders.atomic_note')}</div>
          {msg && <Notice tone="error">{msg}</Notice>}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-ghost" onClick={onClose}>{t('common.cancel')}</button>
            <button type="submit" className="btn btn-primary" disabled={busy}>{t('mp.orders.create')}</button>
          </div>
        </form>
      )}
    </Modal>
  );
}

function OrderDetail({ orgId, order, canWrite, onClose, onSaved }) {
  const [f, setF] = useState({ status: order.status, tracking_number: order.tracking_number ?? '', carrier: order.carrier ?? '', note: order.note ?? '' });
  const [lines, setLines] = useState(() => order.lines.map((l) => ({ ...l, paid: minorToInput(l.supplier_paid_azn_minor, { blankZero: false }) })));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const tot = orderTotals(order.lines);
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));

  async function save(e) {
    e.preventDefault();
    setBusy(true); setMsg(null);
    try {
      const patch = { status: f.status, tracking_number: f.tracking_number.trim() || null, carrier: f.carrier.trim() || null, note: f.note.trim() || null };
      if (f.status === 'transit' && !order.shipped_at) patch.shipped_at = new Date().toISOString();
      if (f.status === 'complete' && !order.delivered_at) patch.delivered_at = new Date().toISOString();
      await marketplace.updateOrder(orgId, order.id, patch);
      for (const l of lines) {
        const orig = order.lines.find((o) => o.id === l.id);
        const paid = l.paid.trim() === '' ? null : inputToMinor(l.paid);
        const p = {};
        if ((l.supplier_order_number ?? '') !== (orig.supplier_order_number ?? '')) p.supplier_order_number = l.supplier_order_number?.trim() || null;
        if (l.supplier_order_status !== orig.supplier_order_status) {
          p.supplier_order_status = l.supplier_order_status;
          if (l.supplier_order_status === 'ordered' && !orig.supplier_ordered_at) p.supplier_ordered_at = new Date().toISOString();
        }
        if (paid !== (orig.supplier_paid_azn_minor ?? null)) p.supplier_paid_azn_minor = paid;
        if (Object.keys(p).length) await marketplace.updateLine(orgId, l.id, p);
      }
      onSaved();
    } catch (err) {
      setMsg(errorText(err));
      setBusy(false);
    }
  }

  return (
    <Modal title={t('mp.orders.detail', { n: order.order_number })} onClose={onClose} width={820}>
      <form className="stack" onSubmit={save} style={{ gap: 14 }}>
        <div className="faint">{order.customer_name}{order.customer_email ? ` · ${order.customer_email}` : ''} · {formatDate(order.placed_at)} · {order.channel === 'shopify' ? 'Shopify' : t('mp.channel.manual')}</div>
        <div style={formGrid}>
          <Field id="d-status" label={t('mp.f.status')}>
            <select id="d-status" className="input" value={f.status} onChange={set('status')} disabled={!canWrite}>
              {ORDER_STATUSES.map((s) => <option key={s} value={s}>{t(`mp.status.${s}`)}</option>)}
            </select>
          </Field>
          <Field id="d-track" label={t('mp.o.tracking')}><input id="d-track" className="input" value={f.tracking_number} onChange={set('tracking_number')} disabled={!canWrite} /></Field>
          <Field id="d-carrier" label={t('mp.o.carrier')}><input id="d-carrier" className="input" value={f.carrier} onChange={set('carrier')} disabled={!canWrite} /></Field>
          <Field id="d-note" label={t('mp.o.note')} wide><textarea id="d-note" className="input" rows={2} value={f.note} onChange={set('note')} disabled={!canWrite} /></Field>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>{t('mp.o.product')}</th><th className="r">{t('mp.o.qty')}</th><th className="r">{t('mp.o.total_sale')}</th><th className="r">{t('mp.col.cost')}</th><th>{t('mp.o.supplier_order')}</th><th>{t('mp.o.supplier_status')}</th><th className="r">{t('mp.o.supplier_paid')}</th></tr></thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={l.id}>
                  <td>{l.line_title}{l.cost_missing && <div className="neg" style={{ fontSize: 12 }}>{t('mp.o.cost_missing')}</div>}</td>
                  <td className="r num">{l.quantity}</td>
                  <td className="r num">{money(l.sale_azn_minor)}</td>
                  <td className="r num">{money(l.cost_azn_minor)}</td>
                  <td><input className="input" style={{ minWidth: 110 }} aria-label={t('mp.o.supplier_order')} value={l.supplier_order_number ?? ''} disabled={!canWrite}
                    onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, supplier_order_number: e.target.value } : x)))} /></td>
                  <td><select className="input" aria-label={t('mp.o.supplier_status')} value={l.supplier_order_status} disabled={!canWrite}
                    onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, supplier_order_status: e.target.value } : x)))}>
                    {SUPPLIER_STATUSES.map((s) => <option key={s} value={s}>{t(`mp.sup.${s}`)}</option>)}
                  </select></td>
                  <td className="r"><input className="input num" style={{ width: 100 }} inputMode="decimal" aria-label={t('mp.o.supplier_paid')} value={l.paid} disabled={!canWrite}
                    onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, paid: e.target.value } : x)))} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="status-list">
          <div className="status-row"><span className="label">{t('mp.o.total_sale')}</span><span className="num">{money(tot.sale)}</span></div>
          {tot.shippingIncome > 0 && <div className="status-row"><span className="label">{t('mp.o.shipping_income')}</span><span className="num">{money(tot.shippingIncome)}</span></div>}
          {tot.discount > 0 && <div className="status-row"><span className="label">{t('mp.o.discount')}</span><span className="num">−{money(tot.discount)}</span></div>}
          {tot.fee > 0 && <div className="status-row"><span className="label">{t('mp.o.fee')}</span><span className="num">−{money(tot.fee)}</span></div>}
          {tot.refund > 0 && <div className="status-row"><span className="label">{t('mp.o.refund')}</span><span className="num">−{money(tot.refund)}</span></div>}
          <div className="status-row"><span className="label">{t('mp.o.total_cost')}</span><span className="num">−{money(tot.cost)}</span></div>
          <div className="status-row"><span className="label"><strong>{t('mp.col.profit')}</strong></span><strong className={`num ${tot.net < 0 ? 'neg' : 'pos'}`}>{money(tot.net)}</strong></div>
        </div>
        {msg && <Notice tone="error">{msg}</Notice>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn-ghost" onClick={onClose}>{t('common.close')}</button>
          {canWrite && <button type="submit" className="btn btn-primary" disabled={busy}>{t('common.save')}</button>}
        </div>
      </form>
    </Modal>
  );
}

export default function Orders() {
  const { orgId, can } = useOrg();
  const canWrite = can('data.write') && can('module.marketplace.write');
  const [archived, setArchived] = useState(false);
  const orders = useLoad(() => marketplace.orders(orgId, { archived }), [orgId, archived]);
  const listings = useLoad(() => marketplace.listings(orgId), [orgId]);
  const [status, setStatus] = useState('all');
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState(null);
  const [history, setHistory] = useState(null);
  const [msg, setMsg] = useState(null);

  const rows = useMemo(() => {
    const n = q.trim().toLowerCase();
    return (orders.data ?? []).filter((o) => (status === 'all' || o.status === status)
      && (!n || [o.order_number, o.customer_name, o.customer_email, o.tracking_number].some((v) => v?.toLowerCase().includes(n))));
  }, [orders.data, status, q]);

  const act = async (fn, confirmText) => {
    if (confirmText && !window.confirm(confirmText)) return;
    setMsg(null);
    try { await fn(); await orders.reload(); await listings.reload(); } catch (err) { setMsg(errorText(err)); }
  };

  return (
    <Card title={t('mp.orders.title')} sub={t('mp.orders.sub')}
      actions={canWrite && !archived && <button className="btn btn-primary" onClick={() => setCreating(true)}><LuPlus /> {t('mp.orders.new')}</button>}>
      <div className="card-pad" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', paddingBottom: 0 }}>
        <input className="input" style={{ flex: '1 1 220px' }} placeholder={t('mp.orders.search')} aria-label={t('mp.orders.search')} value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="input" style={{ width: 170 }} aria-label={t('mp.f.status')} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="all">{t('mp.filter.all')}</option>
          {ORDER_STATUSES.map((s) => <option key={s} value={s}>{t(`mp.status.${s}`)}</option>)}
        </select>
        <button className="btn btn-ghost" aria-pressed={archived} onClick={() => setArchived((a) => !a)}>
          {archived ? <><LuArchiveRestore /> {t('mp.orders.show_active')}</> : <><LuArchive /> {t('mp.orders.show_archived')}</>}
        </button>
      </div>
      {!canWrite && <div className="card-pad" style={{ paddingBottom: 0 }}><Notice>{t('mp.read_only')}</Notice></div>}
      {(orders.error || msg) && <div className="card-pad" style={{ paddingBottom: 0 }}><Notice tone="error">{orders.error || msg}</Notice></div>}
      {orders.loading && !orders.data ? <div className="card-pad faint">{t('common.loading')}</div>
        : !rows.length ? (
          <EmptyState icon={LuReceipt} title={archived ? t('mp.orders.no_archived') : orders.data?.length ? t('mp.products.none_found') : t('mp.orders.empty')}>
            {!archived && !orders.data?.length ? t('mp.orders.empty_body') : null}
          </EmptyState>
        ) : (
          <div className="table-wrap">
            <table className="table mp-orders">
              <thead><tr><th>{t('mp.o.number')}</th><th>{t('mp.o.customer')}</th><th>{t('mp.f.status')}</th><th className="r">{t('mp.o.total_sale')}</th><th className="r">{t('mp.col.profit')}</th><th>{t('mp.o.date')}</th><th className="r" /></tr></thead>
              <tbody>
                {rows.map((o) => {
                  const tot = orderTotals(o.lines);
                  return (
                    <tr key={o.id} data-order={o.order_number}>
                      <td><button className="link-btn" onClick={() => setOpen(o)}>{o.order_number}</button>
                        <div className="faint" style={{ fontSize: 12 }}>{o.channel === 'shopify' ? 'Shopify' : t('mp.channel.manual')}</div></td>
                      <td>{o.customer_name}</td>
                      <td><Badge tone={statusTone(o.status)}>{t(`mp.status.${o.status}`)}</Badge></td>
                      <td className="r num">{money(tot.sale)}</td>
                      <td className={`r num ${tot.net < 0 ? 'neg' : 'pos'}`}>{money(tot.net)}{tot.costMissing && <span className="neg" title={t('mp.o.cost_missing')}> *</span>}</td>
                      <td className="faint">{formatDate(o.placed_at)}</td>
                      <td className="r" style={{ whiteSpace: 'nowrap' }}>
                        <button className="btn btn-ghost btn-icon" aria-label={t('mp.history.of', { name: o.order_number })} onClick={() => setHistory(o)}><LuHistory /></button>
                        <button className="btn btn-ghost btn-icon" aria-label={t('mp.orders.open_of', { n: o.order_number })} onClick={() => setOpen(o)}><LuPencil /></button>
                        {canWrite && (o.archived_at
                          ? <button className="btn btn-ghost btn-icon" aria-label={t('mp.orders.unarchive')} onClick={() => act(() => marketplace.updateOrder(orgId, o.id, { archived_at: null }))}><LuArchiveRestore /></button>
                          : <button className="btn btn-ghost btn-icon" aria-label={t('mp.orders.archive')} onClick={() => act(() => marketplace.updateOrder(orgId, o.id, { archived_at: new Date().toISOString() }))}><LuArchive /></button>)}
                        {canWrite && o.channel === 'manual' && (
                          <button className="btn btn-ghost btn-icon" aria-label={t('mp.orders.delete_of', { n: o.order_number })}
                            onClick={() => act(() => marketplace.deleteOrder(orgId, o.id), t('mp.orders.delete_confirm', { n: o.order_number }))}><LuTrash2 /></button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      <div className="card-pad faint" style={{ fontSize: 12 }}>{t('mp.orders.profit_note')}</div>
      {creating && <NewOrder orgId={orgId} listings={listings.data ?? []} onClose={() => setCreating(false)} onSaved={() => { setCreating(false); orders.reload(); listings.reload(); }} />}
      {open && <OrderDetail orgId={orgId} order={open} canWrite={canWrite} onClose={() => setOpen(null)} onSaved={() => { setOpen(null); orders.reload(); }} />}
      {history && <HistoryModal entity="order" id={history.id} title={history.order_number} onClose={() => setHistory(null)} />}
    </Card>
  );
}
