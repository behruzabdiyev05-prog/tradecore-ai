/**
 * Shared screens for trading modules that work with documents (tables `trade_documents` + lines):
 *   02 wholesale · 06 b2b-trading
 * Counterparties = central `companies`, items = central `products`, supplier quotes = `supplier_offers`.
 * Purchases and sales are posted to the central ledger by trade_document_post() (once, finance.write).
 */
import { useMemo, useState } from 'react';
import { LuBookCheck, LuBuilding2, LuDownload, LuFileText, LuPackage, LuPencil, LuPlus, LuPrinter, LuTrash2, LuX } from 'react-icons/lu';
import { errorText, formatDate, hasKey, t, tModule, tModuleFeatures } from '../../core/i18n/index.js';
import { useOrg } from '../../core/org/OrgProvider.jsx';
import { Badge, Card, EmptyState, Modal, Notice, Stat } from '../../core/ui/components.jsx';
import { CURRENCY_CODES, fromMinor } from '../../../shared/finance.js';
import { bulkDeal, documentTotals, lineTotal, nextNumber } from '../../../shared/modules/documents.js';
import ModuleWorkspace from './ModuleWorkspace.jsx';
import { data } from './data.js';
import { CompanyForm } from './CompanyForm.jsx';
import { AresCard, Field, FormActions, MoneyInput, Toolbar, decimalOrNull, downloadCsv, formGrid, inputToMinor, intOrNull, minorToInput, money, numText, pct, useLoad } from './kit.jsx';

const STATUSES = { purchase: ['draft', 'ordered', 'received', 'paid', 'cancelled'], sale: ['draft', 'sent', 'delivered', 'paid', 'cancelled'], offer: ['draft', 'sent', 'accepted', 'rejected'] };
const PREFIX = { purchase: 'P-', sale: 'S-', offer: 'T-' };
const tone = { draft: undefined, sent: 'accent', ordered: 'accent', accepted: 'ok', received: 'ok', delivered: 'ok', paid: 'ok', rejected: 'warn', cancelled: 'warn' };
const lbl = (cfg, k, v) => (hasKey(`dl.${cfg.key}.${k}`) ? t(`dl.${cfg.key}.${k}`, v) : t(`dl.${k}`, v));
/** Money in a document currency (AZN gets the ₼ formatting). */
const cur = (minor, c) => (c === 'AZN' ? money(minor) : `${numText(Number(fromMinor(Math.round(minor ?? 0))), 2)} ${c}`);

function useDocs(cfg) {
  const { orgId } = useOrg();
  const res = useLoad(() => data.documents(orgId, cfg.key), [orgId, cfg.key]);
  const rows = useMemo(() => (res.data ?? []).map((d) => ({ ...d, tot: documentTotals(d.lines ?? [], d.fx_rate_to_base) })), [res.data]);
  return { ...res, rows };
}

function DocumentForm({ cfg, orgId, kind, doc, docs, products, companies, onClose, onSaved }) {
  const [f, setF] = useState(() => ({
    number: doc?.number ?? nextNumber(docs.filter((d) => d.kind === kind).map((d) => d.number), PREFIX[kind]),
    company_id: doc?.company_id ?? '', counterparty_name: doc?.counterparty_name ?? '', status: doc?.status ?? 'draft',
    currency: doc?.currency ?? 'AZN', fx: String(Number(doc?.fx_rate_to_base ?? 1)), doc_date: doc?.doc_date ?? new Date().toISOString().slice(0, 10),
    due_date: doc?.due_date ?? '', valid_until: doc?.valid_until ?? '', notes: doc?.notes ?? '', terms: doc?.terms ?? '',
  }));
  const [lines, setLines] = useState(() => (doc?.lines?.length ? [...doc.lines].sort((a, b) => a.position - b.position) : [{}]).map((l) => ({
    id: l.id, product_id: l.product_id ?? '', description: l.description ?? '', quantity: String(Number(l.quantity ?? 1)), unit: l.unit ?? 'pcs',
    price: minorToInput(l.unit_price_minor ?? 0, { blankZero: true }), cost: l.unit_cost_minor == null ? '' : minorToInput(l.unit_cost_minor),
    discount: l.discount_percent ? String(Number(l.discount_percent)) : '',
  })));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));
  const setL = (i, patch) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const byId = Object.fromEntries(products.map((p) => [p.id, p]));

  const parsed = () => lines.filter((l) => l.description.trim() || l.product_id).map((l) => {
    const q = decimalOrNull(l.quantity);
    if (!(q > 0)) throw new Error('mp.err.integer');
    const d = decimalOrNull(l.discount) ?? 0;
    if (d > 100) throw new Error('mp.err.percent');
    return { id: l.id, product_id: l.product_id || null, description: (l.description.trim() || byId[l.product_id]?.name || '').slice(0, 500), quantity: q, unit: l.unit || 'pcs',
      unit_price_minor: inputToMinor(l.price), unit_cost_minor: l.cost.trim() === '' ? null : inputToMinor(l.cost), discount_percent: d };
  });
  let tot = null;
  try { tot = documentTotals(parsed(), 1); } catch { /* still typing */ }

  async function submit(e) {
    e.preventDefault(); setBusy(true); setMsg(null);
    try {
      const ls = parsed();
      if (!ls.length) throw new Error('dl.err.no_lines');
      const fx = f.currency === 'AZN' ? 1 : decimalOrNull(f.fx);
      if (!(fx > 0)) throw new Error('mp.err.fx');
      const company = companies.find((c) => c.id === f.company_id);
      await data.saveDocument(orgId, cfg.key, kind, {
        id: doc?.id, number: f.number.trim(), company_id: f.company_id || null, counterparty_name: company?.name ?? (f.counterparty_name.trim() || null),
        status: f.status, currency: f.currency, fx_rate_to_base: fx, doc_date: f.doc_date, due_date: f.due_date || null,
        valid_until: f.valid_until || null, notes: f.notes.trim() || null, terms: f.terms.trim() || null,
      }, ls);
      onSaved();
    } catch (err) { setMsg(errorText(err)); setBusy(false); }
  }

  return (
    <Modal title={doc?.id ? t('dl.edit', { n: doc.number }) : lbl(cfg, `new.${kind}`)} onClose={onClose} width={980}>
      <form className="stack" onSubmit={submit} style={{ gap: 14 }}>
        <div style={formGrid}>
          <Field id="d-number" label={t('dl.f.number')}><input id="d-number" className="input" required value={f.number} onChange={set('number')} /></Field>
          <Field id="d-company" label={lbl(cfg, `party.${kind}`)}>
            <select id="d-company" className="input" value={f.company_id} onChange={set('company_id')}>
              <option value="">{t('dl.f.party_free')}</option>
              {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          {!f.company_id && <Field id="d-party" label={t('dl.f.party_name')}><input id="d-party" className="input" value={f.counterparty_name} onChange={set('counterparty_name')} /></Field>}
          <Field id="d-status" label={t('mp.f.status')}>
            <select id="d-status" className="input" value={f.status} onChange={set('status')}>{STATUSES[kind].map((s) => <option key={s} value={s}>{t(`dl.status.${s}`)}</option>)}</select>
          </Field>
          <Field id="d-date" label={t('dl.f.date')}><input id="d-date" type="date" className="input" required value={f.doc_date} onChange={set('doc_date')} /></Field>
          {kind === 'offer'
            ? <Field id="d-valid" label={t('dl.f.valid_until')}><input id="d-valid" type="date" className="input" value={f.valid_until} onChange={set('valid_until')} /></Field>
            : <Field id="d-due" label={t('dl.f.due_date')}><input id="d-due" type="date" className="input" value={f.due_date} onChange={set('due_date')} /></Field>}
          <Field id="d-currency" label={t('mp.sup.currency')}>
            <select id="d-currency" className="input" value={f.currency} onChange={set('currency')}>{CURRENCY_CODES.map((c) => <option key={c}>{c}</option>)}</select>
          </Field>
          {f.currency !== 'AZN' && <Field id="d-fx" label={t('mp.sup.fx', { cur: f.currency })} hint={t('mp.sup.fx_hint')}><input id="d-fx" className="input num" inputMode="decimal" value={f.fx} onChange={set('fx')} /></Field>}
        </div>
        <div className="stack" style={{ gap: 6 }}>
          <strong>{t('dl.lines', { cur: f.currency })}</strong>
          <div className="table-wrap">
            <table className="table dl-lines">
              <thead><tr><th>{t('mp.o.product')}</th><th>{t('dl.f.description')}</th><th className="r">{t('mp.o.qty')}</th><th>{t('dl.f.unit')}</th>
                <th className="r">{t('dl.f.price')}</th>{kind !== 'purchase' && <th className="r">{t('dl.f.cost')}</th>}<th className="r">{t('dl.f.discount')}</th><th className="r">{t('dl.f.total')}</th><th /></tr></thead>
              <tbody>
                {lines.map((l, i) => {
                  let total = null; try { total = lineTotal({ quantity: decimalOrNull(l.quantity), unit_price_minor: inputToMinor(l.price), discount_percent: decimalOrNull(l.discount) ?? 0 }); } catch { /* typing */ }
                  return (
                    <tr key={i}>
                      <td><select className="input" aria-label={t('mp.o.product')} value={l.product_id}
                        onChange={(e) => setL(i, { product_id: e.target.value, description: l.description || byId[e.target.value]?.name || '' })}>
                        <option value="">—</option>{products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </select></td>
                      <td><input className="input" aria-label={t('dl.f.description')} id={`dl-desc-${i}`} value={l.description} onChange={(e) => setL(i, { description: e.target.value })} /></td>
                      <td><input className="input num" style={{ width: 80 }} aria-label={t('mp.o.qty')} id={`dl-qty-${i}`} inputMode="decimal" value={l.quantity} onChange={(e) => setL(i, { quantity: e.target.value })} /></td>
                      <td><select className="input" style={{ width: 90 }} aria-label={t('dl.f.unit')} value={l.unit} onChange={(e) => setL(i, { unit: e.target.value })}>
                        {['pcs', 'kg', 'm', 'm2', 'l', 'box', 'set', 'pack'].map((u) => <option key={u} value={u}>{t(`dl.unit.${u}`)}</option>)}
                      </select></td>
                      <td><input className="input num" style={{ width: 100 }} aria-label={t('dl.f.price')} id={`dl-price-${i}`} inputMode="decimal" value={l.price} onChange={(e) => setL(i, { price: e.target.value })} /></td>
                      {kind !== 'purchase' && <td><input className="input num" style={{ width: 100 }} aria-label={t('dl.f.cost')} id={`dl-cost-${i}`} inputMode="decimal" value={l.cost} onChange={(e) => setL(i, { cost: e.target.value })} /></td>}
                      <td><input className="input num" style={{ width: 70 }} aria-label={t('dl.f.discount')} inputMode="decimal" value={l.discount} onChange={(e) => setL(i, { discount: e.target.value })} /></td>
                      <td className="r num">{total == null ? '—' : cur(total, f.currency)}</td>
                      <td><button type="button" className="btn btn-ghost btn-icon" aria-label={t('mp.o.remove_line')} disabled={lines.length === 1} onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}><LuX /></button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div><button type="button" className="btn btn-ghost" onClick={() => setLines((ls) => [...ls, { product_id: '', description: '', quantity: '1', unit: 'pcs', price: '', cost: '', discount: '' }])}><LuPlus /> {t('dl.add_line')}</button></div>
        </div>
        {tot && (
          <div className="status-list">
            <div className="status-row"><span className="label"><strong>{t('dl.f.total')}</strong></span><strong className="num">{cur(tot.total, f.currency)}</strong></div>
            {kind !== 'purchase' && <div className="status-row"><span className="label">{t('dl.margin')}</span><span className="num">{tot.margin == null ? t('dl.margin_unknown') : `${cur(tot.margin, f.currency)} · ${pct(tot.marginPercent)}`}</span></div>}
          </div>
        )}
        <div style={formGrid}>
          <Field id="d-notes" label={t('mp.o.note')} wide><textarea id="d-notes" className="input" rows={2} value={f.notes} onChange={set('notes')} /></Field>
          {kind !== 'purchase' && <Field id="d-terms" label={t('dl.f.terms')} wide><textarea id="d-terms" className="input" rows={2} value={f.terms} onChange={set('terms')} /></Field>}
        </div>
        {msg && <Notice tone="error">{msg}</Notice>}
        <FormActions onCancel={onClose} busy={busy} />
      </form>
    </Modal>
  );
}

/** Printable view (offer / sale / purchase). The print stylesheet shows only `.print-area`. */
function PrintView({ doc, org, onClose }) {
  return (
    <Modal title={t(`dl.kind.${doc.kind}`)} onClose={onClose} width={820}>
      <div className="print-area stack" style={{ gap: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}>
          <div><strong>{org?.name}</strong></div>
          <div className="r"><div><strong>{t(`dl.kind.${doc.kind}`)} {doc.number}</strong></div><div>{formatDate(doc.doc_date)}</div>
            {doc.valid_until && <div>{t('dl.f.valid_until')}: {formatDate(doc.valid_until)}</div>}</div>
        </div>
        <div>{t(`dl.party.${doc.kind}`)}: <strong>{doc.counterparty_name ?? '—'}</strong></div>
        <table className="table">
          <thead><tr><th>#</th><th>{t('dl.f.description')}</th><th className="r">{t('mp.o.qty')}</th><th className="r">{t('dl.f.price')}</th><th className="r">{t('dl.f.discount')}</th><th className="r">{t('dl.f.total')}</th></tr></thead>
          <tbody>{[...doc.lines].sort((a, b) => a.position - b.position).map((l, i) => (
            <tr key={l.id}><td>{i + 1}</td><td>{l.description}</td><td className="r num">{numText(l.quantity, 3)} {t(`dl.unit.${l.unit}`)}</td>
              <td className="r num">{cur(l.unit_price_minor, doc.currency)}</td><td className="r num">{Number(l.discount_percent) ? `${numText(l.discount_percent)} %` : '—'}</td>
              <td className="r num">{cur(lineTotal(l), doc.currency)}</td></tr>
          ))}</tbody>
        </table>
        <div className="r"><strong>{t('dl.f.total')}: {cur(doc.tot.total, doc.currency)}</strong></div>
        {doc.terms && <p style={{ whiteSpace: 'pre-wrap' }}>{doc.terms}</p>}
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
        <button className="btn btn-primary" onClick={() => window.print()}><LuPrinter /> {t('dl.print')}</button>
      </div>
    </Modal>
  );
}

function Documents({ cfg }) {
  const { orgId, can, org } = useOrg();
  const canWrite = can('data.write') && can(`module.${cfg.key}.write`);
  const canPost = can('finance.write');
  const docs = useDocs(cfg);
  const products = useLoad(() => data.products(orgId), [orgId]);
  const companies = useLoad(() => data.companies(orgId), [orgId]);
  const [kind, setKind] = useState(cfg.kinds[0]);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('all');
  const [editing, setEditing] = useState(null);
  const [printing, setPrinting] = useState(null);
  const [msg, setMsg] = useState(null);
  const list = docs.rows.filter((d) => d.kind === kind && (status === 'all' || d.status === status)
    && (!q.trim() || [d.number, d.counterparty_name, d.notes].some((v) => v?.toLowerCase().includes(q.trim().toLowerCase()))));
  const act = async (fn, confirmText) => {
    if (confirmText && !window.confirm(confirmText)) return;
    setMsg(null);
    try { await fn(); await docs.reload(); } catch (err) { setMsg(errorText(err)); }
  };
  return (
    <Card title={lbl(cfg, 'docs_title')} sub={lbl(cfg, 'docs_sub')}
      actions={canWrite && <button className="btn btn-primary" onClick={() => setEditing('new')}><LuPlus /> {lbl(cfg, `new.${kind}`)}</button>}>
      <Toolbar>
        <div className="tabs" role="tablist" style={{ margin: 0 }}>
          {cfg.kinds.map((k) => <button key={k} role="tab" className="tab" aria-selected={kind === k} onClick={() => { setKind(k); setStatus('all'); }}>{lbl(cfg, `kinds.${k}`)}</button>)}
        </div>
        <input className="input" style={{ flex: '1 1 200px' }} placeholder={t('dl.search')} aria-label={t('dl.search')} value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="input" style={{ width: 160 }} aria-label={t('mp.f.status')} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="all">{t('mp.filter.all')}</option>{STATUSES[kind].map((s) => <option key={s} value={s}>{t(`dl.status.${s}`)}</option>)}
        </select>
      </Toolbar>
      {!canWrite && <div className="card-pad" style={{ paddingBottom: 0 }}><Notice>{t('mp.read_only')}</Notice></div>}
      {(docs.error || msg) && <div className="card-pad" style={{ paddingBottom: 0 }}><Notice tone="error">{docs.error || msg}</Notice></div>}
      {docs.loading && !docs.data ? <div className="card-pad faint">{t('common.loading')}</div>
        : !list.length ? <EmptyState icon={LuFileText} title={lbl(cfg, `empty.${kind}`)}>{t('dl.empty_body')}</EmptyState> : (
          <div className="table-wrap">
            <table className="table dl-docs">
              <thead><tr><th>{t('dl.f.number')}</th><th>{lbl(cfg, `party.${kind}`)}</th><th>{t('dl.f.date')}</th><th>{t('mp.f.status')}</th>
                <th className="r">{t('dl.f.total')}</th>{kind !== 'purchase' && <th className="r">{t('dl.margin')}</th>}<th>{t('dl.finance')}</th><th className="r" /></tr></thead>
              <tbody>
                {list.map((d) => (
                  <tr key={d.id} data-doc={d.number}>
                    <td>{d.number}</td><td>{d.counterparty_name ?? '—'}</td><td className="faint">{formatDate(d.doc_date)}</td>
                    <td>{canWrite ? (
                      <select className="input" style={{ height: 32 }} aria-label={t('dl.status_of', { n: d.number })} value={d.status} onChange={(e) => act(() => data.setDocumentStatus(orgId, d.id, e.target.value))}>
                        {STATUSES[d.kind].map((s) => <option key={s} value={s}>{t(`dl.status.${s}`)}</option>)}
                      </select>) : <Badge tone={tone[d.status]}>{t(`dl.status.${d.status}`)}</Badge>}</td>
                    <td className="r num">{cur(d.tot.total, d.currency)}{d.currency !== 'AZN' && <div className="faint" style={{ fontSize: 12 }}>{money(d.tot.totalBase)}</div>}</td>
                    {kind !== 'purchase' && <td className="r num">{d.tot.margin == null ? '—' : pct(d.tot.marginPercent)}</td>}
                    <td>{d.kind === 'offer' ? <span className="faint">—</span> : d.posted_at ? <Badge tone="ok">{t('dl.posted')}</Badge>
                      : canPost && canWrite ? <button className="btn btn-ghost" onClick={() => act(() => data.postDocument(d.id), t('dl.post_confirm', { n: d.number, v: cur(d.tot.total, d.currency) }))}><LuBookCheck /> {t('dl.post')}</button>
                        : <span className="faint">{t('dl.not_posted')}</span>}</td>
                    <td className="r" style={{ whiteSpace: 'nowrap' }}>
                      <button className="btn btn-ghost btn-icon" aria-label={t('dl.print_of', { n: d.number })} onClick={() => setPrinting(d)}><LuPrinter /></button>
                      {canWrite && !d.posted_at && <button className="btn btn-ghost btn-icon" aria-label={t('dl.edit', { n: d.number })} onClick={() => setEditing(d)}><LuPencil /></button>}
                      {canWrite && !d.posted_at && <button className="btn btn-ghost btn-icon" aria-label={t('dl.delete_of', { n: d.number })} onClick={() => act(() => data.deleteDocument(orgId, d.id), t('dl.delete_confirm', { n: d.number }))}><LuTrash2 /></button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      <div className="card-pad faint" style={{ fontSize: 12 }}>{t('dl.post_note')}</div>
      {editing && <DocumentForm cfg={cfg} orgId={orgId} kind={editing === 'new' ? kind : editing.kind} doc={editing === 'new' ? null : editing}
        docs={docs.rows} products={products.data ?? []} companies={companies.data ?? []} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); docs.reload(); }} />}
      {printing && <PrintView doc={printing} org={org} onClose={() => setPrinting(null)} />}
    </Card>
  );
}

function Counterparties({ cfg }) {
  const { orgId, can } = useOrg();
  const canWrite = can('data.write');
  const [role, setRole] = useState(cfg.roles[0]);
  const res = useLoad(() => data.companies(orgId, role), [orgId, role]);
  const docs = useDocs(cfg);
  const [editing, setEditing] = useState(null);
  const [msg, setMsg] = useState(null);
  const totals = useMemo(() => {
    const m = new Map();
    for (const d of docs.rows) if (d.company_id && d.kind !== 'offer') m.set(d.company_id, (m.get(d.company_id) ?? 0) + d.tot.totalBase);
    return m;
  }, [docs.rows]);
  return (
    <Card title={lbl(cfg, 'parties_title')} sub={t('dl.parties_sub')}
      actions={canWrite && <button className="btn btn-primary" onClick={() => setEditing({ roles: [role] })}><LuPlus /> {t(`dl.role_new.${role}`)}</button>}>
      <Toolbar>
        <div className="tabs" role="tablist" style={{ margin: 0 }}>
          {cfg.roles.map((r) => <button key={r} role="tab" className="tab" aria-selected={role === r} onClick={() => setRole(r)}>{t(`dl.role.${r}`)}</button>)}
        </div>
      </Toolbar>
      {(res.error || msg) && <div className="card-pad" style={{ paddingBottom: 0 }}><Notice tone="error">{res.error || msg}</Notice></div>}
      {res.loading && !res.data ? <div className="card-pad faint">{t('common.loading')}</div>
        : !res.data?.length ? <EmptyState icon={LuBuilding2} title={t(`dl.role_empty.${role}`)}>{t('dl.parties_empty_body')}</EmptyState> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>{t('co.f.name')}</th><th>{t('co.f.city')}</th><th>{t('co.f.contact')}</th><th className="r">{t('dl.turnover')}</th><th className="r" /></tr></thead>
            <tbody>{res.data.map((c) => (
              <tr key={c.id} data-company={c.name}>
                <td>{c.name}<div className="faint" style={{ fontSize: 12 }}>{[c.legal_name, t(`op.quality.${c.data_quality}`)].filter(Boolean).join(' · ')}</div></td>
                <td>{[c.city, c.country_code].filter(Boolean).join(', ') || '—'}</td>
                <td>{[c.phone, c.email].filter(Boolean).join(' · ') || '—'}</td>
                <td className="r num">{money(totals.get(c.id) ?? 0)}</td>
                <td className="r" style={{ whiteSpace: 'nowrap' }}>
                  {canWrite && <button className="btn btn-ghost btn-icon" aria-label={t('co.edit_of', { name: c.name })} onClick={() => setEditing(c)}><LuPencil /></button>}
                  {canWrite && <button className="btn btn-ghost btn-icon" aria-label={t('co.delete_of', { name: c.name })} onClick={async () => {
                    if (!window.confirm(t('co.delete_confirm', { name: c.name }))) return;
                    try { await data.deleteCompany(orgId, c.id); res.reload(); } catch (err) { setMsg(errorText(err)); }
                  }}><LuTrash2 /></button>}
                </td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      {editing && <CompanyForm orgId={orgId} moduleKey={cfg.key} company={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); res.reload(); }} />}
    </Card>
  );
}

function OfferForm({ orgId, cfg, offer, products, suppliers, onClose, onSaved }) {
  const [f, setF] = useState(() => ({
    product_id: offer?.product_id ?? products[0]?.id ?? '', company_id: offer?.company_id ?? '', supplier_name: offer?.supplier_name ?? '',
    currency: offer?.currency ?? 'USD', price: offer ? fromMinor(Number(offer.price_minor)) : '', shipping: offer ? fromMinor(Number(offer.shipping_minor)) : '',
    fx: offer ? String(Number(offer.fx_rate_to_base)) : '', moq: offer?.min_order_qty ?? '', dmin: offer?.delivery_min_days ?? '', dmax: offer?.delivery_max_days ?? '',
    url: offer?.url ?? '', notes: offer?.notes ?? '',
  }));
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState(null);
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));
  async function submit(e) {
    e.preventDefault(); setBusy(true); setMsg(null);
    try {
      const fx = f.currency === 'AZN' ? 1 : decimalOrNull(f.fx);
      if (!(fx > 0)) throw new Error('mp.err.fx');
      const sup = suppliers.find((s) => s.id === f.company_id);
      await data.saveSupplierOffer(orgId, cfg.key, { id: offer?.id, product_id: f.product_id, company_id: f.company_id || null,
        supplier_name: sup?.name ?? (f.supplier_name.trim() || t('dl.supplier')), currency: f.currency, price_minor: inputToMinor(f.price),
        shipping_minor: inputToMinor(f.shipping), fx_rate_to_base: fx, min_order_qty: intOrNull(f.moq, { min: 1 }),
        delivery_min_days: intOrNull(f.dmin), delivery_max_days: intOrNull(f.dmax), url: f.url.trim() || null, notes: f.notes.trim() || null });
      onSaved();
    } catch (err) { setMsg(errorText(err)); setBusy(false); }
  }
  return (
    <Modal title={offer ? t('mp.sup.edit') : t('mp.sup.new')} onClose={onClose} width={720}>
      <form className="stack" onSubmit={submit} style={{ gap: 14 }}>
        <div style={formGrid}>
          <Field id="so-prod" label={t('mp.o.product')} wide><select id="so-prod" className="input" value={f.product_id} onChange={set('product_id')} disabled={Boolean(offer)}>
            {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
          <Field id="so-sup" label={t('mp.f.supplier')}><select id="so-sup" className="input" value={f.company_id} onChange={set('company_id')}>
            <option value="">{t('dl.f.party_free')}</option>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
          {!f.company_id && <Field id="so-supname" label={t('dl.f.party_name')}><input id="so-supname" className="input" value={f.supplier_name} onChange={set('supplier_name')} /></Field>}
          <Field id="so-cur" label={t('mp.sup.currency')}><select id="so-cur" className="input" value={f.currency} onChange={set('currency')}>{CURRENCY_CODES.map((c) => <option key={c}>{c}</option>)}</select></Field>
          <Field id="so-price" label={t('dl.f.unit_price', { cur: f.currency })}><MoneyInput id="so-price" value={f.price} onChange={(v) => setF((s) => ({ ...s, price: v }))} /></Field>
          <Field id="so-ship" label={t('mp.sup.shipping', { cur: f.currency })}><MoneyInput id="so-ship" value={f.shipping} onChange={(v) => setF((s) => ({ ...s, shipping: v }))} /></Field>
          {f.currency !== 'AZN' && <Field id="so-fx" label={t('mp.sup.fx', { cur: f.currency })}><input id="so-fx" className="input num" inputMode="decimal" value={f.fx} onChange={set('fx')} /></Field>}
          <Field id="so-moq" label={t('dl.f.moq')}><input id="so-moq" className="input num" inputMode="numeric" value={f.moq} onChange={set('moq')} /></Field>
          <Field id="so-dmin" label={t('mp.sup.days_min')}><input id="so-dmin" className="input num" inputMode="numeric" value={f.dmin} onChange={set('dmin')} /></Field>
          <Field id="so-dmax" label={t('mp.sup.days_max')}><input id="so-dmax" className="input num" inputMode="numeric" value={f.dmax} onChange={set('dmax')} /></Field>
          <Field id="so-url" label={t('mp.f.supplier_url')} wide><input id="so-url" type="url" className="input" value={f.url} onChange={set('url')} /></Field>
        </div>
        {msg && <Notice tone="error">{msg}</Notice>}
        <FormActions onCancel={onClose} busy={busy} />
      </form>
    </Modal>
  );
}

function Catalogue({ cfg }) {
  const { orgId, can } = useOrg();
  const canWrite = can('data.write') && can(`module.${cfg.key}.write`);
  const products = useLoad(() => data.products(orgId), [orgId]);
  const offers = useLoad(() => data.supplierOffers(orgId), [orgId]);
  const suppliers = useLoad(() => data.companies(orgId, 'supplier'), [orgId]);
  const docs = useDocs(cfg);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState({ name: '', sku: '', category: '' });
  const [offerEdit, setOfferEdit] = useState(null);
  const [msg, setMsg] = useState(null);
  const lastSale = useMemo(() => {
    const m = new Map();
    for (const d of [...docs.rows].filter((x) => x.kind === 'sale').sort((a, b) => String(a.doc_date).localeCompare(String(b.doc_date)))) {
      for (const l of d.lines ?? []) if (l.product_id) m.set(l.product_id, { price: Math.round(Number(l.unit_price_minor) * Number(d.fx_rate_to_base)), date: d.doc_date });
    }
    return m;
  }, [docs.rows]);
  const offersBy = useMemo(() => {
    const m = new Map();
    for (const o of offers.data ?? []) { const l = m.get(o.product_id) ?? []; l.push(o); m.set(o.product_id, l); }
    for (const l of m.values()) l.sort((a, b) => (Number(a.price_azn_minor) + Number(a.shipping_azn_minor)) - (Number(b.price_azn_minor) + Number(b.shipping_azn_minor)));
    return m;
  }, [offers.data]);
  async function addProduct(e) {
    e.preventDefault(); setMsg(null);
    try { if (!name.name.trim()) throw new Error('mp.err.name'); await data.createProduct(orgId, cfg.key, name); setName({ name: '', sku: '', category: '' }); setAdding(false); products.reload(); }
    catch (err) { setMsg(errorText(err)); }
  }
  return (
    <Card title={lbl(cfg, 'catalogue_title')} sub={lbl(cfg, 'catalogue_sub')}
      actions={canWrite && (
        <div style={{ display: 'flex', gap: 8 }}>
          {cfg.offers && products.data?.length > 0 && <button className="btn" onClick={() => setOfferEdit('new')}><LuPlus /> {t('mp.sup.new')}</button>}
          <button className="btn btn-primary" onClick={() => setAdding((a) => !a)}><LuPackage /> {t('mp.products.new')}</button>
        </div>
      )}>
      {adding && (
        <form className="card-pad" onSubmit={addProduct} style={{ ...formGrid, alignItems: 'end' }}>
          <Field id="cat-name" label={t('mp.f.name')}><input id="cat-name" className="input" required value={name.name} onChange={(e) => setName((s) => ({ ...s, name: e.target.value }))} /></Field>
          <Field id="cat-sku" label={t('mp.f.sku')}><input id="cat-sku" className="input" value={name.sku} onChange={(e) => setName((s) => ({ ...s, sku: e.target.value }))} /></Field>
          <Field id="cat-cat" label={t('mp.f.category')}><input id="cat-cat" className="input" value={name.category} onChange={(e) => setName((s) => ({ ...s, category: e.target.value }))} /></Field>
          <div><button type="submit" className="btn btn-primary">{t('common.save')}</button></div>
        </form>
      )}
      {(products.error || offers.error || msg) && <div className="card-pad" style={{ paddingBottom: 0 }}><Notice tone="error">{products.error || offers.error || msg}</Notice></div>}
      {products.loading && !products.data ? <div className="card-pad faint">{t('common.loading')}</div>
        : !products.data?.length ? <EmptyState icon={LuPackage} title={t('mp.products.empty')}>{t('dl.catalogue_empty')}</EmptyState> : (
          <div className="table-wrap"><table className="table dl-catalogue">
            <thead><tr><th>{t('mp.f.name')}</th><th>{t('mp.f.sku')}</th>{cfg.offers && <th>{t('dl.best_offer')}</th>}{cfg.offers && <th className="r">{t('dl.f.moq')}</th>}<th className="r">{t('dl.last_sale')}</th>{cfg.offers && <th className="r" />}</tr></thead>
            <tbody>{products.data.map((p) => {
              const best = offersBy.get(p.id)?.[0]; const ls = lastSale.get(p.id);
              return (
                <tr key={p.id} data-product={p.name}>
                  <td>{p.name}<div className="faint" style={{ fontSize: 12 }}>{p.category ?? ''}</div></td>
                  <td>{p.sku ?? '—'}</td>
                  {cfg.offers && <td>{best ? <>{best.supplier_name} · <span className="num">{money(Number(best.price_azn_minor) + Number(best.shipping_azn_minor))}</span>
                    {(offersBy.get(p.id)?.length ?? 0) > 1 && <span className="faint"> {t('dl.offers_n', { n: offersBy.get(p.id).length })}</span>}</> : <span className="faint">—</span>}</td>}
                  {cfg.offers && <td className="r num">{best?.min_order_qty ?? '—'}</td>}
                  <td className="r num">{ls ? money(ls.price) : '—'}</td>
                  {cfg.offers && <td className="r">{best && canWrite && <button className="btn btn-ghost btn-icon" aria-label={t('mp.sup.edit')} onClick={() => setOfferEdit(best)}><LuPencil /></button>}</td>}
                </tr>
              );
            })}</tbody>
          </table></div>
        )}
      {offerEdit && <OfferForm orgId={orgId} cfg={cfg} offer={offerEdit === 'new' ? null : offerEdit} products={products.data ?? []} suppliers={suppliers.data ?? []}
        onClose={() => setOfferEdit(null)} onSaved={() => { setOfferEdit(null); offers.reload(); }} />}
    </Card>
  );
}

function Calculator({ cfg }) {
  const [f, setF] = useState({ unitPrice: '', qty: '', moq: '', shipping: '', other: '', sell: '', fee: '', cost: '', markup: '30' });
  const set = (k) => (v) => setF((s) => ({ ...s, [k]: typeof v === 'string' ? v : v.target.value }));
  let r = null; let err = null;
  try {
    if (cfg.calc === 'bulk') {
      r = bulkDeal({ unitPrice: inputToMinor(f.unitPrice), qty: intOrNull(f.qty) ?? 0, moq: intOrNull(f.moq), shippingTotal: inputToMinor(f.shipping),
        otherTotal: inputToMinor(f.other), sellPrice: inputToMinor(f.sell), feePercent: decimalOrNull(f.fee) ?? 0 });
    } else {
      const cost = inputToMinor(f.cost); const mk = decimalOrNull(f.markup) ?? 0;
      const price = Math.round(cost * (1 + mk / 100));
      r = { price, profit: price - cost, marginPercent: price > 0 ? Math.round(((price - cost) / price) * 10000) / 100 : null };
    }
  } catch (e) { err = e.message; }
  return (
    <div className="stack">
      <Card title={lbl(cfg, 'calc_title')} sub={lbl(cfg, 'calc_sub')} pad>
        <div style={formGrid}>
          {cfg.calc === 'bulk' ? (
            <>
              <Field id="bc-price" label={t('dl.calc.unit_price')}><MoneyInput id="bc-price" value={f.unitPrice} onChange={set('unitPrice')} /></Field>
              <Field id="bc-qty" label={t('dl.calc.qty')}><input id="bc-qty" className="input num" inputMode="numeric" value={f.qty} onChange={set('qty')} /></Field>
              <Field id="bc-moq" label={t('dl.f.moq')}><input id="bc-moq" className="input num" inputMode="numeric" value={f.moq} onChange={set('moq')} /></Field>
              <Field id="bc-ship" label={t('dl.calc.shipping_total')}><MoneyInput id="bc-ship" value={f.shipping} onChange={set('shipping')} /></Field>
              <Field id="bc-other" label={t('dl.calc.other_total')}><MoneyInput id="bc-other" value={f.other} onChange={set('other')} /></Field>
              <Field id="bc-sell" label={t('dl.calc.sell')}><MoneyInput id="bc-sell" value={f.sell} onChange={set('sell')} /></Field>
              <Field id="bc-fee" label={t('dl.calc.fee')}><input id="bc-fee" className="input num" inputMode="decimal" value={f.fee} onChange={set('fee')} /></Field>
            </>
          ) : (
            <>
              <Field id="bc-cost" label={t('dl.calc.cost')}><MoneyInput id="bc-cost" value={f.cost} onChange={set('cost')} /></Field>
              <Field id="bc-markup" label={t('dl.calc.markup')}><input id="bc-markup" className="input num" inputMode="decimal" value={f.markup} onChange={set('markup')} /></Field>
            </>
          )}
        </div>
      </Card>
      {err ? <Notice tone="error">{t(err.startsWith('mp.') ? err : 'mp.err.calc')}</Notice> : cfg.calc === 'bulk' ? (
        <>
          {r.belowMoq && <Notice tone="error">{t('dl.calc.below_moq', { moq: f.moq })}</Notice>}
          <div className="grid grid-stats">
            <Stat featured label={t('mp.col.profit')} money={r.profit} />
            <Stat label={t('dl.calc.unit_cost')} money={r.unitCost} />
            <Stat label={t('mp.col.margin')} value={pct(r.marginPercent)} />
            <Stat label={t('dl.calc.investment')} money={r.cost} />
          </div>
          <Card pad><div className="status-list">
            <div className="status-row"><span className="label">{t('dl.calc.purchase')}</span><span className="num">{money(r.purchase)}</span></div>
            <div className="status-row"><span className="label">{t('dl.calc.landed')}</span><span className="num">{money(r.cost)}</span></div>
            <div className="status-row"><span className="label">{t('dl.calc.revenue')}</span><span className="num">{money(r.revenue)}</span></div>
            <div className="status-row"><span className="label">{t('mp.calc.fee')}</span><span className="num">−{money(r.fee)}</span></div>
            <div className="status-row"><span className="label"><strong>{t('mp.col.profit')}</strong></span><strong className={`num ${r.profit < 0 ? 'neg' : 'pos'}`}>{money(r.profit)}</strong></div>
          </div></Card>
        </>
      ) : (
        <div className="grid grid-stats">
          <Stat featured label={t('dl.calc.offer_price')} money={r.price} />
          <Stat label={t('mp.col.profit')} money={r.profit} />
          <Stat label={t('mp.col.margin')} value={pct(r.marginPercent)} />
        </div>
      )}
    </div>
  );
}

function Overview({ module, cfg, goTo }) {
  const docs = useDocs(cfg);
  const ready = docs.data != null;
  const sum = (kind, filter = () => true) => docs.rows.filter((d) => d.kind === kind && d.status !== 'cancelled' && filter(d)).reduce((s, d) => s + d.tot.totalBase, 0);
  const sales = docs.rows.filter((d) => d.kind === 'sale' && d.status !== 'cancelled');
  const marginKnown = sales.filter((d) => d.tot.margin != null);
  const openOffers = docs.rows.filter((d) => d.kind === 'offer' && ['draft', 'sent'].includes(d.status));
  return (
    <div className="stack">
      {docs.error && <Notice tone="error">{docs.error}</Notice>}
      <div className="grid grid-stats">
        <Stat featured label={t('dl.ov.sales')} money={ready ? sum('sale') : null} sub={ready ? t('dl.ov.docs_n', { n: sales.length }) : t('common.loading')} />
        <Stat label={t('dl.ov.purchases')} money={ready ? sum('purchase') : null} />
        <Stat label={t('dl.ov.gross_margin')} money={ready ? marginKnown.reduce((s, d) => s + Math.round(d.tot.margin * Number(d.fx_rate_to_base)), 0) : null} signed />
        <Stat label={cfg.kinds.includes('offer') ? t('dl.ov.open_offers') : t('dl.ov.unposted')} value={ready ? (cfg.kinds.includes('offer') ? openOffers.length : docs.rows.filter((d) => d.kind !== 'offer' && !d.posted_at).length) : null} />
      </div>
      <div className="grid grid-2">
        <Card title={t('dl.ov.recent')} actions={<button className="btn btn-ghost" onClick={() => goTo('documents')}>{t('mp.ov.all')}</button>}>
          {!ready ? <div className="card-pad faint">{t('common.loading')}</div> : !docs.rows.length ? <div className="card-pad faint">{t('dl.ov.none')}</div> : (
            <div className="status-list card-pad">{docs.rows.slice(0, 7).map((d) => (
              <div className="status-row" key={d.id}><span className="label">{t(`dl.kind.${d.kind}`)} {d.number} · {d.counterparty_name ?? '—'} <span className="faint">· {formatDate(d.doc_date)}</span></span>
                <span><Badge tone={tone[d.status]}>{t(`dl.status.${d.status}`)}</Badge> <span className="num">{money(d.tot.totalBase)}</span></span></div>
            ))}</div>
          )}
        </Card>
        <div className="stack">
          <AresCard moduleKey={module.key} name={tModule(module, 'shortName')} />
          <Card title={t('mw.features')}><ul className="feature-list">{tModuleFeatures(module).map((f) => <li key={f}><LuFileText aria-hidden />{f}</li>)}</ul></Card>
        </div>
      </div>
    </div>
  );
}

function Reports({ cfg }) {
  const docs = useDocs(cfg);
  const valid = docs.rows.filter((d) => d.status !== 'cancelled' && d.kind !== 'offer');
  const byMonth = new Map();
  for (const d of valid) {
    const k = String(d.doc_date).slice(0, 7); const g = byMonth.get(k) ?? { sale: 0, purchase: 0 };
    g[d.kind] += d.tot.totalBase; byMonth.set(k, g);
  }
  const byParty = new Map();
  for (const d of valid) {
    const k = d.counterparty_name ?? '—'; const g = byParty.get(k) ?? { sale: 0, purchase: 0, n: 0 };
    g[d.kind] += d.tot.totalBase; g.n += 1; byParty.set(k, g);
  }
  const byProduct = new Map();
  for (const d of valid.filter((x) => x.kind === 'sale')) for (const l of d.lines ?? []) {
    const k = l.description; const g = byProduct.get(k) ?? { qty: 0, total: 0 };
    g.qty += Number(l.quantity); g.total += Math.round(lineTotal(l) * Number(d.fx_rate_to_base)); byProduct.set(k, g);
  }
  const exportCsv = () => downloadCsv(`${cfg.key}-documents-${new Date().toISOString().slice(0, 10)}.csv`,
    [t('dl.f.kind'), t('dl.f.number'), t('dl.f.party_name'), t('dl.f.date'), t('mp.f.status'), t('mp.sup.currency'), t('dl.f.total'), 'AZN', t('dl.margin'), t('dl.finance')],
    docs.rows.map((d) => [t(`dl.kind.${d.kind}`), d.number, d.counterparty_name, d.doc_date, t(`dl.status.${d.status}`), d.currency, d.tot.total / 100, d.tot.totalBase / 100,
      d.tot.margin == null ? '' : d.tot.margin / 100, d.posted_at ? t('dl.posted') : '']));
  return (
    <div className="stack">
      {docs.error && <Notice tone="error">{docs.error}</Notice>}
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}><button className="btn" onClick={exportCsv} disabled={!docs.rows.length}><LuDownload /> {t('op.rep.csv')}</button></div>
      <div className="grid grid-2">
        <Card title={t('dl.rep.by_month')}><div className="table-wrap"><table className="table">
          <thead><tr><th /><th className="r">{t('dl.ov.sales')}</th><th className="r">{t('dl.ov.purchases')}</th></tr></thead>
          <tbody>{[...byMonth.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([k, g]) => <tr key={k}><td>{k}</td><td className="r num">{money(g.sale)}</td><td className="r num">{money(g.purchase)}</td></tr>)}</tbody>
        </table></div></Card>
        <Card title={t('dl.rep.by_party')}><div className="table-wrap"><table className="table">
          <thead><tr><th /><th className="r">{t('op.rep.count')}</th><th className="r">{t('dl.ov.sales')}</th><th className="r">{t('dl.ov.purchases')}</th></tr></thead>
          <tbody>{[...byParty.entries()].sort((a, b) => (b[1].sale + b[1].purchase) - (a[1].sale + a[1].purchase)).map(([k, g]) => <tr key={k}><td>{k}</td><td className="r num">{g.n}</td><td className="r num">{money(g.sale)}</td><td className="r num">{money(g.purchase)}</td></tr>)}</tbody>
        </table></div></Card>
        <Card title={t('dl.rep.by_product')}><div className="table-wrap"><table className="table">
          <thead><tr><th /><th className="r">{t('mp.o.qty')}</th><th className="r">{t('dl.ov.sales')}</th></tr></thead>
          <tbody>{[...byProduct.entries()].sort((a, b) => b[1].total - a[1].total).map(([k, g]) => <tr key={k}><td>{k}</td><td className="r num">{numText(g.qty, 3)}</td><td className="r num">{money(g.total)}</td></tr>)}</tbody>
        </table></div></Card>
      </div>
      <div className="faint" style={{ fontSize: 12 }}>{t('dl.rep.note')}</div>
    </div>
  );
}

const SECTIONS = { overview: Overview, documents: Documents, parties: Counterparties, catalogue: Catalogue, calculator: Calculator, reports: Reports };

/** cfg: { key, kinds, roles, offers (supplier quotes with MOQ), calc: 'bulk' | 'markup' } */
export default function DealsModule({ module, cfg }) {
  const tabs = ['overview', 'documents', 'parties', 'catalogue', 'calculator', 'reports', 'finance', 'ai'].map((id) => ({
    id, get label() { return ['finance', 'ai'].includes(id) ? t(`mw.tab.${id}`) : lbl(cfg, `tab.${id}`); },
  }));
  return <ModuleWorkspace module={module} sections={SECTIONS} tabs={tabs} sectionProps={{ cfg }} />;
}
