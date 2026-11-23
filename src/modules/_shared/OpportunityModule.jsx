/**
 * Shared screens for the research-style modules (table `opportunities`):
 *   01 product-research · 04 arbitrage · 05 import-export · 07 used-goods · 08 digital-products
 * Each module passes a config (which fields it uses, its own labels). Profit and score come
 * from shared/modules/opportunity.js — the same math ARES and the tests use.
 */
import { useMemo, useState } from 'react';
import { LuCopy, LuDownload, LuLightbulb, LuPencil, LuPlus, LuTrash2 } from 'react-icons/lu';
import { errorText, formatDate, hasKey, t, tModule, tModuleFeatures } from '../../core/i18n/index.js';
import { useOrg } from '../../core/org/OrgProvider.jsx';
import { Badge, Card, EmptyState, Modal, Notice, Stat } from '../../core/ui/components.jsx';
import { CURRENCY_CODES } from '../../../shared/finance.js';
import { opportunityMath, opportunityScore, scoreBand } from '../../../shared/modules/opportunity.js';
import ModuleWorkspace from './ModuleWorkspace.jsx';
import { data } from './data.js';
import { AresCard, Field, FormActions, MoneyInput, Toolbar, decimalOrNull, downloadCsv, formGrid, inputToMinor, intOrNull, minorToInput, money, pct, useLoad } from './kit.jsx';

export const OPP_STATUSES = ['idea', 'researching', 'approved', 'rejected', 'done'];
const QUALITY = ['unverified', 'estimated', 'verified'];
const CONDITIONS = ['new', 'like_new', 'good', 'fair', 'for_parts'];
const statusTone = { idea: undefined, researching: 'accent', approved: 'ok', rejected: 'warn', done: 'ok' };
const bandTone = { high: 'ok', medium: 'accent', low: 'warn' };

/** Label of a field: module-specific key first (op.<module>.<field>), then the shared one (op.f.<field>). */
const lbl = (cfg, field, vars) => (hasKey(`op.${cfg.key}.${field}`) ? t(`op.${cfg.key}.${field}`, vars) : t(`op.f.${field}`, vars));
const has = (cfg, f) => cfg.fields.includes(f);

function safeMath(o) {
  try { const m = opportunityMath(o); return { m, score: opportunityScore(o, m) }; } catch { return { m: null, score: null }; }
}

export function ScoreBadge({ score }) {
  if (score == null) return <span className="faint">—</span>;
  return <Badge tone={bandTone[scoreBand(score)]}>{score}</Badge>;
}

const EMPTY = {
  title: '', category: '', status: 'idea', origin: '', target: '', currency: 'AZN', fx: '1', buy: '', shipping: '', customs: '', tax: '',
  repair: '', other: '', duty: '', importVat: '', sellCurrency: 'AZN', sellFx: '1', sell: '', feePercent: '', feeFixed: '', quantity: '1',
  demand: '', competition: '', risk: '', condition: '', direction: 'import', sold: '', source_url: '', data_quality: 'unverified', notes: '',
};
function toForm(o) {
  if (!o) return { ...EMPTY };
  const m = (v) => minorToInput(v ?? 0, { blankZero: true });
  const p = (v) => (v == null || Number(v) === 0 ? '' : String(Number(v)));
  return {
    title: o.title ?? '', category: o.category ?? '', status: o.status ?? 'idea', origin: o.origin ?? '', target: o.target ?? '',
    currency: o.currency ?? 'AZN', fx: String(Number(o.fx_rate_to_base ?? 1)), buy: m(o.buy_price_minor), shipping: m(o.shipping_minor),
    customs: m(o.customs_minor), tax: m(o.tax_minor), repair: m(o.repair_minor), other: m(o.other_minor), duty: p(o.duty_percent),
    importVat: p(o.import_vat_percent), sellCurrency: o.sell_currency ?? 'AZN', sellFx: String(Number(o.sell_fx_rate_to_base ?? 1)),
    sell: m(o.sell_price_minor), feePercent: p(o.fee_percent), feeFixed: m(o.fee_fixed_minor), quantity: String(o.quantity ?? 1),
    demand: o.demand_score ?? '', competition: o.competition_score ?? '', risk: o.risk_score ?? '', condition: o.condition ?? '',
    direction: o.details?.direction ?? 'import', sold: o.details?.sold == null ? '' : String(o.details.sold),
    source_url: o.source_url ?? '', data_quality: o.data_quality ?? 'unverified', notes: o.notes ?? '',
  };
}
/** Form → row. Throws a dictionary key on bad input. */
function fromForm(f, cfg) {
  const fx = f.currency === 'AZN' ? 1 : decimalOrNull(f.fx);
  const sfx = f.sellCurrency === 'AZN' ? 1 : decimalOrNull(f.sellFx);
  if (!(fx > 0) || !(sfx > 0)) throw new Error('mp.err.fx');
  const percent = (v) => { const n = decimalOrNull(v) ?? 0; if (n >= 100) throw new Error('mp.err.percent'); return n; };
  const score = (v) => (v === '' || v == null ? null : Number(v));
  const details = {};
  if (has(cfg, 'direction')) details.direction = f.direction;
  if (has(cfg, 'sold')) details.sold = intOrNull(f.sold);
  return {
    title: f.title.trim(), category: f.category.trim() || null, status: f.status, origin: f.origin.trim() || null, target: f.target.trim() || null,
    currency: f.currency, fx_rate_to_base: fx, buy_price_minor: inputToMinor(f.buy), shipping_minor: inputToMinor(f.shipping),
    customs_minor: inputToMinor(f.customs), tax_minor: inputToMinor(f.tax), repair_minor: inputToMinor(f.repair), other_minor: inputToMinor(f.other),
    duty_percent: percent(f.duty), import_vat_percent: percent(f.importVat), sell_currency: f.sellCurrency, sell_fx_rate_to_base: sfx,
    sell_price_minor: inputToMinor(f.sell), fee_percent: percent(f.feePercent), fee_fixed_minor: inputToMinor(f.feeFixed),
    quantity: intOrNull(f.quantity, { min: 1 }) ?? 1, demand_score: score(f.demand), competition_score: score(f.competition), risk_score: score(f.risk),
    condition: f.condition || null, details, source_url: f.source_url.trim() || null, data_quality: f.data_quality, notes: f.notes.trim() || null,
  };
}

function Rating({ id, label, value, onChange }) {
  return (
    <Field id={id} label={label}>
      <select id={id} className="input" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">—</option>
        {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n} · {t(`op.rating.${n}`)}</option>)}
      </select>
    </Field>
  );
}

/** The editable fields + live result. Used by the record form and the calculator. */
function OpportunityFields({ cfg, f, set, withRecordFields = true }) {
  const money2 = (field, key) => (
    has(cfg, field) && <Field id={`op-${field}`} label={lbl(cfg, field, { cur: field === 'sell' || field === 'feeFixed' ? f.sellCurrency : f.currency })}>
      <MoneyInput id={`op-${field}`} value={f[key ?? field]} onChange={set(key ?? field)} />
    </Field>
  );
  return (
    <>
      {withRecordFields && (
        <div style={formGrid}>
          <Field id="op-title" label={lbl(cfg, 'title')} wide><input id="op-title" className="input" required value={f.title} onChange={set('title')} /></Field>
          <Field id="op-category" label={lbl(cfg, 'category')}><input id="op-category" className="input" value={f.category} onChange={set('category')} /></Field>
          <Field id="op-status" label={t('mp.f.status')}>
            <select id="op-status" className="input" value={f.status} onChange={set('status')}>
              {OPP_STATUSES.map((s) => <option key={s} value={s}>{t(`op.status.${s}`)}</option>)}
            </select>
          </Field>
          {has(cfg, 'direction') && (
            <Field id="op-direction" label={lbl(cfg, 'direction')}>
              <select id="op-direction" className="input" value={f.direction} onChange={set('direction')}>
                <option value="import">{t('op.dir.import')}</option><option value="export">{t('op.dir.export')}</option>
              </select>
            </Field>
          )}
          {has(cfg, 'condition') && (
            <Field id="op-condition" label={lbl(cfg, 'condition')}>
              <select id="op-condition" className="input" value={f.condition} onChange={set('condition')}>
                <option value="">—</option>
                {CONDITIONS.map((c) => <option key={c} value={c}>{t(`op.cond.${c}`)}</option>)}
              </select>
            </Field>
          )}
          {has(cfg, 'origin') && <Field id="op-origin" label={lbl(cfg, 'origin')}><input id="op-origin" className="input" value={f.origin} onChange={set('origin')} /></Field>}
          {has(cfg, 'target') && <Field id="op-target" label={lbl(cfg, 'target')}><input id="op-target" className="input" value={f.target} onChange={set('target')} /></Field>}
        </div>
      )}
      <strong>{t('op.group.costs')}</strong>
      <div style={formGrid}>
        <Field id="op-currency" label={t('op.f.currency')}>
          <select id="op-currency" className="input" value={f.currency} onChange={set('currency')}>{CURRENCY_CODES.map((c) => <option key={c}>{c}</option>)}</select>
        </Field>
        {f.currency !== 'AZN' && <Field id="op-fx" label={t('mp.sup.fx', { cur: f.currency })} hint={t('mp.sup.fx_hint')}><input id="op-fx" className="input num" inputMode="decimal" value={f.fx} onChange={set('fx')} /></Field>}
        {money2('buy')}{money2('shipping')}{money2('customs')}{money2('tax')}{money2('repair')}{money2('other')}
        {has(cfg, 'duty') && <Field id="op-duty" label={lbl(cfg, 'duty')}><input id="op-duty" className="input num" inputMode="decimal" value={f.duty} onChange={set('duty')} /></Field>}
        {has(cfg, 'importVat') && <Field id="op-importVat" label={lbl(cfg, 'importVat')}><input id="op-importVat" className="input num" inputMode="decimal" value={f.importVat} onChange={set('importVat')} /></Field>}
      </div>
      <strong>{t('op.group.sale')}</strong>
      <div style={formGrid}>
        <Field id="op-sellCurrency" label={t('op.f.sellCurrency')}>
          <select id="op-sellCurrency" className="input" value={f.sellCurrency} onChange={set('sellCurrency')}>{CURRENCY_CODES.map((c) => <option key={c}>{c}</option>)}</select>
        </Field>
        {f.sellCurrency !== 'AZN' && <Field id="op-sellFx" label={t('mp.sup.fx', { cur: f.sellCurrency })}><input id="op-sellFx" className="input num" inputMode="decimal" value={f.sellFx} onChange={set('sellFx')} /></Field>}
        {money2('sell')}
        {has(cfg, 'feePercent') && <Field id="op-feePercent" label={lbl(cfg, 'feePercent')}><input id="op-feePercent" className="input num" inputMode="decimal" value={f.feePercent} onChange={set('feePercent')} /></Field>}
        {money2('feeFixed')}
        <Field id="op-quantity" label={lbl(cfg, 'quantity')}><input id="op-quantity" className="input num" inputMode="numeric" value={f.quantity} onChange={set('quantity')} /></Field>
        {has(cfg, 'sold') && withRecordFields && <Field id="op-sold" label={lbl(cfg, 'sold')}><input id="op-sold" className="input num" inputMode="numeric" value={f.sold} onChange={set('sold')} /></Field>}
      </div>
      <strong>{t('op.group.assessment')}</strong>
      <div style={formGrid}>
        <Rating id="op-demand" label={t('op.f.demand')} value={f.demand} onChange={set('demand')} />
        <Rating id="op-competition" label={t('op.f.competition')} value={f.competition} onChange={set('competition')} />
        <Rating id="op-risk" label={t('op.f.risk')} value={f.risk} onChange={set('risk')} />
        {withRecordFields && (
          <Field id="op-quality" label={t('op.f.data_quality')} hint={t('op.quality_hint')}>
            <select id="op-quality" className="input" value={f.data_quality} onChange={set('data_quality')}>
              {QUALITY.map((q) => <option key={q} value={q}>{t(`op.quality.${q}`)}</option>)}
            </select>
          </Field>
        )}
        {withRecordFields && <Field id="op-url" label={t('op.f.source_url')} wide><input id="op-url" className="input" type="url" placeholder="https://" value={f.source_url} onChange={set('source_url')} /></Field>}
        {withRecordFields && <Field id="op-notes" label={t('mp.o.note')} wide><textarea id="op-notes" className="input" rows={2} value={f.notes} onChange={set('notes')} /></Field>}
      </div>
    </>
  );
}

function ResultPanel({ cfg, f }) {
  let r = null; let err = null;
  try { const row = fromForm({ ...f, title: f.title || 'x' }, cfg); const m = opportunityMath(row); r = { m, score: opportunityScore(row, m) }; } catch (e) { err = e.message; }
  if (err) return <Notice tone="error">{t(err.startsWith('mp.') ? err : 'mp.err.calc')}</Notice>;
  const { m, score } = r;
  const rows = [
    ['op.r.goods', m.goods], m.duty ? ['op.r.duty', m.duty] : null, m.importVat ? ['op.r.import_vat', m.importVat] : null,
    m.extras ? ['op.r.extras', m.extras] : null, ['op.r.cost', m.cost], ['op.r.revenue', m.revenue], m.fee ? ['op.r.fee', -m.fee] : null,
  ].filter(Boolean);
  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="grid grid-stats">
        <Stat featured label={t('op.r.profit_unit')} money={m.profit} sub={m.quantity > 1 ? t('op.r.total', { v: money(m.totalProfit), n: m.quantity }) : undefined} />
        <Stat label={t('mp.col.margin')} value={pct(m.marginPercent)} />
        <Stat label={t('mp.calc.roi')} value={pct(m.roiPercent)} />
        <Stat label={t('op.score')} value={score ?? '—'} sub={t('op.score_hint')} />
      </div>
      <div className="status-list op-result">
        {rows.map(([k, v]) => <div className="status-row" key={k}><span className="label">{t(k)}</span><span className="num">{money(v)}</span></div>)}
        <div className="status-row"><span className="label"><strong>{t('op.r.profit_unit')}</strong></span><strong className={`num ${m.profit < 0 ? 'neg' : 'pos'}`}>{money(m.profit)}</strong></div>
      </div>
      <div className="faint" style={{ fontSize: 12 }}>{lbl(cfg, 'formula')}</div>
    </div>
  );
}

function OpportunityForm({ cfg, orgId, record, onClose, onSaved }) {
  const [f, setF] = useState(() => toForm(record));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const set = (k) => (v) => setF((s) => ({ ...s, [k]: typeof v === 'string' ? v : v.target.value }));
  async function submit(e) {
    e.preventDefault(); setBusy(true); setMsg(null);
    try {
      if (!f.title.trim()) throw new Error('op.err.title');
      await data.saveOpportunity(orgId, cfg.key, { ...fromForm(f, cfg), id: record?.id });
      onSaved();
    } catch (err) { setMsg(errorText(err)); setBusy(false); }
  }
  return (
    <Modal title={record?.id ? t('op.edit') : lbl(cfg, 'new')} onClose={onClose} width={860}>
      <form className="stack" onSubmit={submit} style={{ gap: 14 }}>
        <OpportunityFields cfg={cfg} f={f} set={set} />
        <ResultPanel cfg={cfg} f={f} />
        {msg && <Notice tone="error">{msg}</Notice>}
        <FormActions onCancel={onClose} busy={busy} />
      </form>
    </Modal>
  );
}

function useRecords(cfg) {
  const { orgId } = useOrg();
  const res = useLoad(() => data.opportunities(orgId, cfg.key), [orgId, cfg.key]);
  const rows = useMemo(() => (res.data ?? []).map((o) => ({ ...o, ...safeMath(o) })), [res.data]);
  return { ...res, rows };
}

function Overview({ module, cfg, goTo }) {
  const { rows, error, data: raw } = useRecords(cfg);
  const ready = raw != null;
  const open = rows.filter((r) => ['idea', 'researching', 'approved'].includes(r.status));
  const approved = rows.filter((r) => r.status === 'approved');
  const scored = rows.filter((r) => r.score != null);
  const best = [...open].filter((r) => r.score != null).sort((a, b) => b.score - a.score).slice(0, 6);
  return (
    <div className="stack">
      {error && <Notice tone="error">{error}</Notice>}
      <div className="grid grid-stats">
        <Stat featured label={lbl(cfg, 'count')} value={ready ? rows.length : null} sub={ready ? t('op.ov.open', { n: open.length }) : t('common.loading')} />
        <Stat label={t('op.ov.approved_profit')} money={ready ? approved.reduce((s, r) => s + (r.m?.totalProfit ?? 0), 0) : null} signed />
        <Stat label={t('op.ov.avg_score')} value={ready ? (scored.length ? Math.round(scored.reduce((s, r) => s + r.score, 0) / scored.length) : '—') : null} />
        <Stat label={t('op.ov.verified')} value={ready ? `${rows.filter((r) => r.data_quality === 'verified').length} / ${rows.length}` : null} />
      </div>
      <div className="grid grid-2">
        <Card title={t('op.ov.best')} actions={<button className="btn btn-ghost" onClick={() => goTo('records')}>{t('mp.ov.all')}</button>}>
          {!ready ? <div className="card-pad faint">{t('common.loading')}</div> : !best.length ? <div className="card-pad faint">{lbl(cfg, 'empty')}</div> : (
            <div className="status-list card-pad">
              {best.map((r) => (
                <div className="status-row" key={r.id}>
                  <span className="label">{r.title} <span className="faint">· {t(`op.status.${r.status}`)}</span></span>
                  <span><span className="num">{money(r.m?.profit)}</span> <ScoreBadge score={r.score} /></span>
                </div>
              ))}
            </div>
          )}
        </Card>
        <div className="stack">
          <Card title={t('op.ov.by_status')} pad>
            <div className="status-list">
              {OPP_STATUSES.map((s) => <div className="status-row" key={s}><span className="label">{t(`op.status.${s}`)}</span><span className="num">{rows.filter((r) => r.status === s).length}</span></div>)}
            </div>
          </Card>
          <AresCard moduleKey={module.key} name={tModule(module, 'shortName')} />
          <Card title={t('mw.features')}>
            <ul className="feature-list">{tModuleFeatures(module).map((f) => <li key={f}><LuLightbulb aria-hidden />{f}</li>)}</ul>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Records({ cfg }) {
  const { orgId, can } = useOrg();
  const canWrite = can('data.write') && can(`module.${cfg.key}.write`);
  const { rows, error, loading, data: raw, reload } = useRecords(cfg);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('all');
  const [minScore, setMinScore] = useState('');
  const [sort, setSort] = useState('score');
  const [editing, setEditing] = useState(null);
  const [selected, setSelected] = useState([]);
  const [compare, setCompare] = useState(false);
  const [msg, setMsg] = useState(null);

  const list = useMemo(() => {
    const n = q.trim().toLowerCase();
    const out = rows.filter((r) => (status === 'all' || r.status === status)
      && (!minScore || (r.score ?? -1) >= Number(minScore))
      && (!n || [r.title, r.category, r.origin, r.target, r.notes].some((v) => v?.toLowerCase().includes(n))));
    const key = { score: (r) => r.score ?? -1, profit: (r) => r.m?.profit ?? -Infinity, margin: (r) => r.m?.marginPercent ?? -Infinity, date: (r) => r.created_at };
    return out.sort((a, b) => (key[sort](b) > key[sort](a) ? 1 : key[sort](b) < key[sort](a) ? -1 : 0));
  }, [rows, q, status, minScore, sort]);

  const act = async (fn, confirmText) => {
    if (confirmText && !window.confirm(confirmText)) return;
    setMsg(null);
    try { await fn(); await reload(); } catch (err) { setMsg(errorText(err)); }
  };
  const toggle = (id) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : s.length >= 4 ? s : [...s, id]));

  return (
    <Card title={lbl(cfg, 'list_title')} sub={lbl(cfg, 'list_sub')}
      actions={(
        <div style={{ display: 'flex', gap: 8 }}>
          {selected.length >= 2 && <button className="btn" onClick={() => setCompare(true)}>{t('op.compare_n', { n: selected.length })}</button>}
          {canWrite && <button className="btn btn-primary" onClick={() => setEditing('new')}><LuPlus /> {lbl(cfg, 'new')}</button>}
        </div>
      )}>
      <Toolbar>
        <input className="input" style={{ flex: '1 1 220px' }} placeholder={t('op.search')} aria-label={t('op.search')} value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="input" style={{ width: 160 }} aria-label={t('mp.f.status')} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="all">{t('mp.filter.all')}</option>
          {OPP_STATUSES.map((s) => <option key={s} value={s}>{t(`op.status.${s}`)}</option>)}
        </select>
        <select className="input" style={{ width: 150 }} aria-label={t('op.min_score')} value={minScore} onChange={(e) => setMinScore(e.target.value)}>
          <option value="">{t('op.min_score')}</option>
          {[40, 50, 60, 70, 80].map((n) => <option key={n} value={n}>≥ {n}</option>)}
        </select>
        <select className="input" style={{ width: 170 }} aria-label={t('op.sort')} value={sort} onChange={(e) => setSort(e.target.value)}>
          {['score', 'profit', 'margin', 'date'].map((s) => <option key={s} value={s}>{t(`op.sort.${s}`)}</option>)}
        </select>
      </Toolbar>
      {!canWrite && <div className="card-pad" style={{ paddingBottom: 0 }}><Notice>{t('mp.read_only')}</Notice></div>}
      {(error || msg) && <div className="card-pad" style={{ paddingBottom: 0 }}><Notice tone="error">{error || msg}</Notice></div>}
      {loading && !raw ? <div className="card-pad faint">{t('common.loading')}</div>
        : !list.length ? <EmptyState icon={LuLightbulb} title={raw?.length ? t('mp.products.none_found') : lbl(cfg, 'empty')}>{raw?.length ? null : lbl(cfg, 'empty_body')}</EmptyState>
          : (
            <div className="table-wrap">
              <table className="table op-table">
                <thead><tr>
                  <th aria-label={t('op.select')} />
                  <th>{lbl(cfg, 'title')}</th><th>{t('mp.f.status')}</th>
                  <th className="r">{t('op.r.cost')}</th><th className="r">{t('op.r.revenue')}</th>
                  <th className="r">{t('op.r.profit_unit')}</th><th className="r">{t('mp.col.margin')}</th><th className="r">{t('op.score')}</th><th className="r" />
                </tr></thead>
                <tbody>
                  {list.map((r) => (
                    <tr key={r.id} data-opp={r.title}>
                      <td><input type="checkbox" aria-label={t('op.select_of', { name: r.title })} checked={selected.includes(r.id)} onChange={() => toggle(r.id)} /></td>
                      <td>
                        <div>{r.title}</div>
                        <div className="faint" style={{ fontSize: 12 }}>
                          {[r.category, r.origin && r.target ? `${r.origin} → ${r.target}` : r.origin || r.target, r.condition ? t(`op.cond.${r.condition}`) : null,
                            r.details?.direction ? t(`op.dir.${r.details.direction}`) : null, t(`op.quality.${r.data_quality}`)].filter(Boolean).join(' · ')}
                        </div>
                      </td>
                      <td><Badge tone={statusTone[r.status]}>{t(`op.status.${r.status}`)}</Badge></td>
                      <td className="r num">{money(r.m?.cost)}</td>
                      <td className="r num">{money(r.m?.revenue)}</td>
                      <td className={`r num ${(r.m?.profit ?? 0) < 0 ? 'neg' : 'pos'}`}>{money(r.m?.profit)}</td>
                      <td className="r num">{pct(r.m?.marginPercent)}</td>
                      <td className="r"><ScoreBadge score={r.score} /></td>
                      <td className="r" style={{ whiteSpace: 'nowrap' }}>
                        {canWrite && <button className="btn btn-ghost btn-icon" aria-label={t('op.edit_of', { name: r.title })} onClick={() => setEditing(r)}><LuPencil /></button>}
                        {canWrite && <button className="btn btn-ghost btn-icon" aria-label={t('op.copy_of', { name: r.title })} onClick={() => setEditing({ ...r, id: undefined, title: `${r.title} (2)` })}><LuCopy /></button>}
                        {canWrite && <button className="btn btn-ghost btn-icon" aria-label={t('op.delete_of', { name: r.title })} onClick={() => act(() => data.deleteOpportunity(orgId, r.id), t('op.delete_confirm', { name: r.title }))}><LuTrash2 /></button>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
      <div className="card-pad faint" style={{ fontSize: 12 }}>{t('op.score_explain')}</div>
      {editing && <OpportunityForm cfg={cfg} orgId={orgId} record={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />}
      {compare && <CompareModal cfg={cfg} rows={rows.filter((r) => selected.includes(r.id))} onClose={() => setCompare(false)} />}
    </Card>
  );
}

function CompareModal({ cfg, rows, onClose }) {
  const metrics = [
    ['op.r.cost', (r) => money(r.m?.cost)], ['op.r.revenue', (r) => money(r.m?.revenue)], ['op.r.fee', (r) => money(r.m?.fee)],
    ['op.r.profit_unit', (r) => money(r.m?.profit)], ['mp.col.margin', (r) => pct(r.m?.marginPercent)], ['mp.calc.roi', (r) => pct(r.m?.roiPercent)],
    ['op.r.total_profit', (r) => money(r.m?.totalProfit)], ['op.f.demand', (r) => r.demand_score ?? '—'], ['op.f.competition', (r) => r.competition_score ?? '—'],
    ['op.f.risk', (r) => r.risk_score ?? '—'], ['op.score', (r) => r.score ?? '—'], ['op.f.data_quality', (r) => t(`op.quality.${r.data_quality}`)],
  ];
  const best = (fn) => Math.max(...rows.map((r) => fn(r) ?? -Infinity));
  const bestProfit = best((r) => r.m?.profit); const bestScore = best((r) => r.score);
  return (
    <Modal title={t('op.compare_title')} onClose={onClose} width={960}>
      <div className="table-wrap">
        <table className="table op-compare">
          <thead><tr><th />{rows.map((r) => <th key={r.id}>{r.title}</th>)}</tr></thead>
          <tbody>
            {metrics.map(([k, fn]) => (
              <tr key={k}><td className="faint">{t(k)}</td>
                {rows.map((r) => {
                  const win = (k === 'op.r.profit_unit' && r.m?.profit === bestProfit) || (k === 'op.score' && r.score === bestScore);
                  return <td key={r.id} className={`num ${win ? 'pos' : ''}`}>{fn(r)}{win ? ' ★' : ''}</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="faint" style={{ fontSize: 12 }}>{lbl(cfg, 'compare_note')}</p>
    </Modal>
  );
}

function Calculator({ cfg }) {
  const { orgId, can } = useOrg();
  const canWrite = can('data.write') && can(`module.${cfg.key}.write`);
  const [f, setF] = useState({ ...EMPTY });
  const [saving, setSaving] = useState(null);
  const set = (k) => (v) => setF((s) => ({ ...s, [k]: typeof v === 'string' ? v : v.target.value }));
  return (
    <div className="stack">
      <Card title={lbl(cfg, 'calc_title')} sub={t('op.calc_sub')} pad
        actions={canWrite && <button className="btn" onClick={() => setSaving({ ...fromSafe(f, cfg), title: '' })}><LuPlus /> {t('op.calc_save')}</button>}>
        <div className="stack" style={{ gap: 14 }}><OpportunityFields cfg={cfg} f={f} set={set} withRecordFields={false} /></div>
      </Card>
      <ResultPanel cfg={cfg} f={f} />
      {saving && <OpportunityForm cfg={cfg} orgId={orgId} record={saving} onClose={() => setSaving(null)} onSaved={() => setSaving(null)} />}
    </div>
  );
}
function fromSafe(f, cfg) { try { return fromForm({ ...f, title: 'x' }, cfg); } catch { return {}; } }

function Reports({ cfg }) {
  const { rows, data: raw, error } = useRecords(cfg);
  const group = (key) => {
    const map = new Map();
    for (const r of rows) {
      const k = (typeof key === 'function' ? key(r) : r[key]) || t('op.rep.none');
      const g = map.get(k) ?? { k, n: 0, profit: 0, margins: [] };
      g.n += 1; g.profit += r.m?.totalProfit ?? 0; if (r.m?.marginPercent != null) g.margins.push(r.m.marginPercent);
      map.set(k, g);
    }
    return [...map.values()].sort((a, b) => b.profit - a.profit);
  };
  const exportCsv = () => downloadCsv(`${cfg.key}-${new Date().toISOString().slice(0, 10)}.csv`,
    [lbl(cfg, 'title'), t('mp.f.status'), lbl(cfg, 'category'), lbl(cfg, 'origin'), lbl(cfg, 'target'), t('op.r.cost'), t('op.r.revenue'),
      t('op.r.profit_unit'), t('mp.col.margin'), t('op.f.quantity'), t('op.r.total_profit'), t('op.score'), t('op.f.data_quality'), t('mp.o.date')],
    rows.map((r) => [r.title, t(`op.status.${r.status}`), r.category, r.origin, r.target, (r.m?.cost ?? 0) / 100, (r.m?.revenue ?? 0) / 100,
      (r.m?.profit ?? 0) / 100, r.m?.marginPercent, r.quantity, (r.m?.totalProfit ?? 0) / 100, r.score, t(`op.quality.${r.data_quality}`), formatDate(r.created_at)]));
  const Table = ({ title, groups }) => (
    <Card title={title}>
      {!groups.length ? <div className="card-pad faint">{t('common.no_data_yet')}</div> : (
        <div className="table-wrap"><table className="table">
          <thead><tr><th /><th className="r">{t('op.rep.count')}</th><th className="r">{t('op.r.total_profit')}</th><th className="r">{t('op.rep.avg_margin')}</th></tr></thead>
          <tbody>{groups.map((g) => (
            <tr key={g.k}><td>{g.k}</td><td className="r num">{g.n}</td><td className={`r num ${g.profit < 0 ? 'neg' : ''}`}>{money(g.profit)}</td>
              <td className="r num">{g.margins.length ? pct(g.margins.reduce((a, b) => a + b, 0) / g.margins.length) : '—'}</td></tr>
          ))}</tbody>
        </table></div>
      )}
    </Card>
  );
  return (
    <div className="stack">
      {error && <Notice tone="error">{error}</Notice>}
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button className="btn" onClick={exportCsv} disabled={!raw?.length}><LuDownload /> {t('op.rep.csv')}</button>
      </div>
      <div className="grid grid-2">
        <Table title={t('op.rep.by_status')} groups={group((r) => t(`op.status.${r.status}`))} />
        <Table title={t('op.rep.by_category')} groups={group('category')} />
        {has(cfg, 'origin') && <Table title={lbl(cfg, 'origin')} groups={group('origin')} />}
        {has(cfg, 'target') && <Table title={lbl(cfg, 'target')} groups={group('target')} />}
        {has(cfg, 'condition') && <Table title={lbl(cfg, 'condition')} groups={group((r) => (r.condition ? t(`op.cond.${r.condition}`) : null))} />}
        {has(cfg, 'direction') && <Table title={lbl(cfg, 'direction')} groups={group((r) => (r.details?.direction ? t(`op.dir.${r.details.direction}`) : null))} />}
      </div>
      <div className="faint" style={{ fontSize: 12 }}>{t('op.rep.note')}</div>
    </div>
  );
}

const SECTIONS = { overview: Overview, records: Records, calculator: Calculator, reports: Reports };

/** A full module built from a config: { key, fields } (labels come from the dictionaries). */
export default function OpportunityModule({ module, cfg }) {
  const tabs = ['overview', 'records', 'calculator', 'reports', 'finance', 'ai'].map((id) => ({
    id, get label() { return id === 'records' ? lbl(cfg, 'tab_records') : ['finance', 'ai'].includes(id) ? t(`mw.tab.${id}`) : t(`op.tab.${id}`); },
  }));
  return <ModuleWorkspace module={module} sections={SECTIONS} tabs={tabs} sectionProps={{ cfg }} />;
}

