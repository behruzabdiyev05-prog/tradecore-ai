/**
 * Module 09 · B2B Client Finder (primary market: Azerbaijan; printing & polygraphy customers).
 * Businesses are central `companies` (role 'prospect'); `leads` holds the pipeline and
 * `lead_activities` the contact history. Contact data is typed in by the user from public,
 * legally accessible sources — nothing is scraped or invented. Recommendations and the
 * score are transparent rules (shared/modules/leads.js), labelled as such.
 */
import { useMemo, useState } from 'react';
import { LuArrowLeft, LuArrowRight, LuCalendarClock, LuCopy, LuDownload, LuFileText, LuMessageSquarePlus, LuPencil, LuPlus, LuTrash2, LuUsers } from 'react-icons/lu';
import ModuleWorkspace from '../_shared/ModuleWorkspace.jsx';
import { getModule } from '../../../shared/modules.js';
import { errorText, formatDate, formatDateTime, t, tModule, tModuleFeatures } from '../../core/i18n/index.js';
import { useOrg } from '../../core/org/OrgProvider.jsx';
import { useAuth } from '../../core/auth/AuthProvider.jsx';
import { Badge, Card, EmptyState, Modal, Notice, Stat } from '../../core/ui/components.jsx';
import { OPEN_STAGES, SEGMENTS, SERVICES, STAGES, followUpState, leadScore, offerText, recommendedServices } from '../../../shared/modules/leads.js';
import { data } from '../_shared/data.js';
import { CompanyFields, companyToForm, formToCompany } from '../_shared/CompanyForm.jsx';
import { AresCard, Field, FormActions, MoneyInput, Toolbar, downloadCsv, formGrid, inputToMinor, minorToInput, money, useLoad } from '../_shared/kit.jsx';

const MODULE = getModule('b2b-client-finder');
const stageTone = { new: undefined, contacted: 'accent', interested: 'accent', offer_sent: 'accent', negotiation: 'warn', won: 'ok', lost: 'warn' };
const fuTone = { overdue: 'warn', today: 'accent', soon: 'accent', later: undefined };
const today = () => new Date().toISOString().slice(0, 10);
const addDays = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

function useLeads() {
  const { orgId } = useOrg();
  const res = useLoad(() => data.leads(orgId), [orgId]);
  return res;
}
const canWriteLeads = (can) => can('data.write') && can('module.b2b-client-finder.write');

function ScoreBadge({ score }) {
  if (score == null) return <span className="faint">—</span>;
  return <Badge tone={score >= 70 ? 'ok' : score >= 45 ? 'accent' : 'warn'}>{score}</Badge>;
}
function FollowUp({ date }) {
  const s = followUpState(date, today());
  if (!s) return <span className="faint">—</span>;
  return <Badge tone={fuTone[s]}>{formatDate(date)} · {t(`lf.fu.${s}`)}</Badge>;
}

function LeadForm({ orgId, lead, existing, onClose, onSaved }) {
  const [c, setC] = useState(() => companyToForm(lead?.company ?? { country_code: 'AZ', roles: ['prospect'] }));
  const [l, setL] = useState(() => ({
    segment: lead?.segment ?? 'restaurant', size: lead?.size ?? '', is_new_business: lead?.is_new_business ?? false,
    services: lead?.services ?? recommendedServices(lead?.segment ?? 'restaurant').slice(0, 3), stage: lead?.stage ?? 'new',
    value: minorToInput(lead?.estimated_value_minor ?? 0, { blankZero: true }), next: lead?.next_follow_up ?? addDays(2), notes: lead?.notes ?? '',
    lost_reason: lead?.lost_reason ?? '',
  }));
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState(null);
  const setCo = (k) => (v) => setC((s) => ({ ...s, [k]: v?.target ? v.target.value : v }));
  const setLe = (k) => (v) => setL((s) => ({ ...s, [k]: v?.target ? (v.target.type === 'checkbox' ? v.target.checked : v.target.value) : v }));
  const dup = !lead?.id && existing.find((x) => x.company && ((c.name.trim() && x.company.name.trim().toLowerCase() === c.name.trim().toLowerCase() && (x.company.city ?? '') === c.city.trim())
    || (c.phone.trim() && x.company.phone === c.phone.trim())));
  const score = leadScore({ ...l, services: l.services }, { phone: c.phone, email: c.email, website: c.website, social: { main: c.social } });

  async function submit(e) {
    e.preventDefault(); setBusy(true); setMsg(null);
    try {
      const company = { ...formToCompany({ ...c, category: l.segment }), roles: Array.from(new Set([...(lead?.company?.roles ?? []), 'prospect'])), id: lead?.company_id };
      await data.saveLead(orgId, {
        id: lead?.id, company_id: lead?.company_id, segment: l.segment, size: l.size || null, is_new_business: Boolean(l.is_new_business), services: l.services,
        stage: l.stage, score, estimated_value_minor: l.value.trim() ? inputToMinor(l.value) : null, next_follow_up: l.next || null,
        notes: l.notes.trim() || null, lost_reason: l.stage === 'lost' ? (l.lost_reason.trim() || null) : null,
      }, company);
      onSaved();
    } catch (err) { setMsg(errorText(err)); setBusy(false); }
  }
  const rec = recommendedServices(l.segment);
  return (
    <Modal title={lead?.id ? t('lf.edit') : t('lf.new')} onClose={onClose} width={860}>
      <form className="stack" onSubmit={submit} style={{ gap: 14 }}>
        <strong>{t('lf.group.business')}</strong>
        <CompanyFields f={c} set={setCo} roles={false} idPrefix="lf" />
        {dup && <Notice>{t('lf.duplicate', { name: dup.company.name })}</Notice>}
        <strong>{t('lf.group.sales')}</strong>
        <div style={formGrid}>
          <Field id="lf-segment" label={t('lf.f.segment')}>
            <select id="lf-segment" className="input" value={l.segment} onChange={(e) => setL((s) => ({ ...s, segment: e.target.value, services: s.services.length ? s.services : recommendedServices(e.target.value).slice(0, 3) }))}>
              {SEGMENTS.map((x) => <option key={x} value={x}>{t(`lf.seg.${x}`)}</option>)}
            </select>
          </Field>
          <Field id="lf-size" label={t('lf.f.size')}>
            <select id="lf-size" className="input" value={l.size} onChange={setLe('size')}><option value="">—</option>{['micro', 'small', 'medium', 'large'].map((x) => <option key={x} value={x}>{t(`lf.size.${x}`)}</option>)}</select>
          </Field>
          <Field id="lf-stage" label={t('lf.f.stage')}>
            <select id="lf-stage" className="input" value={l.stage} onChange={setLe('stage')}>{STAGES.map((x) => <option key={x} value={x}>{t(`lf.stage.${x}`)}</option>)}</select>
          </Field>
          <Field id="lf-value" label={t('lf.f.value')}><MoneyInput id="lf-value" value={l.value} onChange={setLe('value')} /></Field>
          <Field id="lf-next" label={t('lf.f.next')}><input id="lf-next" type="date" className="input" value={l.next} onChange={setLe('next')} /></Field>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', alignSelf: 'end', minHeight: 40 }}>
            <input type="checkbox" checked={l.is_new_business} onChange={setLe('is_new_business')} /> {t('lf.f.new_business')}
          </label>
          {l.stage === 'lost' && <Field id="lf-lost" label={t('lf.f.lost_reason')} wide><input id="lf-lost" className="input" value={l.lost_reason} onChange={setLe('lost_reason')} /></Field>}
        </div>
        <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
          <legend>{t('lf.f.services')} <span className="faint" style={{ fontSize: 12 }}>· {t('lf.recommended_hint')}</span></legend>
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
            {SERVICES.map((s) => (
              <label key={s} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <input type="checkbox" checked={l.services.includes(s)} onChange={(e) => setL((x) => ({ ...x, services: e.target.checked ? [...x.services, s] : x.services.filter((y) => y !== s) }))} />
                {t(`lf.svc.${s}`)}{rec.includes(s) && <span className="faint"> ★</span>}
              </label>
            ))}
          </div>
        </fieldset>
        <Field id="lf-notes" label={t('mp.o.note')} wide><textarea id="lf-notes" className="input" rows={2} value={l.notes} onChange={setLe('notes')} /></Field>
        <div className="status-list"><div className="status-row"><span className="label">{t('lf.score')}</span><ScoreBadge score={score} /></div></div>
        <div className="faint" style={{ fontSize: 12 }}>{t('co.legal_note')}</div>
        {msg && <Notice tone="error">{msg}</Notice>}
        <FormActions onCancel={onClose} busy={busy} />
      </form>
    </Modal>
  );
}

function LeadDetail({ orgId, lead, canWrite, onClose, onChanged, onEdit, onOffer }) {
  const { user } = useAuth();
  const acts = useLoad(() => data.activities(orgId, lead.id), [orgId, lead.id]);
  const [a, setA] = useState({ kind: 'call', summary: '', outcome: '', next: addDays(3) });
  const [msg, setMsg] = useState(null);
  const c = lead.company ?? {};
  async function add(e) {
    e.preventDefault(); setMsg(null);
    try {
      if (!a.summary.trim()) throw new Error('lf.err.summary');
      await data.addActivity(orgId, { lead_id: lead.id, kind: a.kind, summary: a.summary.trim(), outcome: a.outcome.trim() || null });
      const patch = { next_follow_up: a.next || null };
      if (lead.stage === 'new') { patch.stage = 'contacted'; patch.score = leadScore({ ...lead, stage: 'contacted' }, c); }
      await data.updateLead(orgId, lead.id, patch);
      setA({ kind: 'call', summary: '', outcome: '', next: addDays(3) });
      acts.reload(); onChanged();
    } catch (err) { setMsg(errorText(err)); }
  }
  return (
    <Modal title={c.name} onClose={onClose} width={860}>
      <div className="stack" style={{ gap: 14 }}>
        <div className="grid grid-2">
          <div className="status-list">
            <div className="status-row"><span className="label">{t('lf.f.segment')}</span><span>{t(`lf.seg.${lead.segment}`)}{lead.is_new_business ? ` · ${t('lf.f.new_business')}` : ''}</span></div>
            <div className="status-row"><span className="label">{t('co.f.city')}</span><span>{[c.city, c.address].filter(Boolean).join(', ') || '—'}</span></div>
            <div className="status-row"><span className="label">{t('co.f.phone')}</span><span>{c.phone ? <a href={`tel:${c.phone}`}>{c.phone}</a> : '—'}</span></div>
            <div className="status-row"><span className="label">{t('co.f.email')}</span><span>{c.email ? <a href={`mailto:${c.email}`}>{c.email}</a> : '—'}</span></div>
            <div className="status-row"><span className="label">{t('co.f.website')}</span><span>{c.website ? <a href={c.website} target="_blank" rel="noopener noreferrer">{c.website}</a> : '—'}</span></div>
            <div className="status-row"><span className="label">{t('co.f.source')}</span><span>{c.source ?? '—'} · {t(`op.quality.${c.data_quality ?? 'unverified'}`)}</span></div>
          </div>
          <div className="status-list">
            <div className="status-row"><span className="label">{t('lf.f.stage')}</span><Badge tone={stageTone[lead.stage]}>{t(`lf.stage.${lead.stage}`)}</Badge></div>
            <div className="status-row"><span className="label">{t('lf.score')}</span><ScoreBadge score={lead.score} /></div>
            <div className="status-row"><span className="label">{t('lf.f.value')}</span><span className="num">{lead.estimated_value_minor == null ? '—' : money(lead.estimated_value_minor)}</span></div>
            <div className="status-row"><span className="label">{t('lf.f.next')}</span><FollowUp date={lead.next_follow_up} /></div>
            <div className="status-row"><span className="label">{t('lf.f.services')}</span><span>{lead.services.map((s) => t(`lf.svc.${s}`)).join(', ') || '—'}</span></div>
          </div>
        </div>
        {canWrite && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn" onClick={onEdit}><LuPencil /> {t('lf.edit')}</button>
            <button className="btn" onClick={onOffer}><LuFileText /> {t('lf.offer.make')}</button>
          </div>
        )}
        <strong>{t('lf.history')}</strong>
        {canWrite && (
          <form onSubmit={add} style={{ ...formGrid, alignItems: 'end' }}>
            <Field id="la-kind" label={t('lf.a.kind')}>
              <select id="la-kind" className="input" value={a.kind} onChange={(e) => setA((s) => ({ ...s, kind: e.target.value }))}>
                {['call', 'email', 'visit', 'meeting', 'message', 'note'].map((k) => <option key={k} value={k}>{t(`lf.a.${k}`)}</option>)}
              </select>
            </Field>
            <Field id="la-summary" label={t('lf.a.summary')} wide><input id="la-summary" className="input" value={a.summary} onChange={(e) => setA((s) => ({ ...s, summary: e.target.value }))} /></Field>
            <Field id="la-outcome" label={t('lf.a.outcome')}><input id="la-outcome" className="input" value={a.outcome} onChange={(e) => setA((s) => ({ ...s, outcome: e.target.value }))} /></Field>
            <Field id="la-next" label={t('lf.f.next')}><input id="la-next" type="date" className="input" value={a.next} onChange={(e) => setA((s) => ({ ...s, next: e.target.value }))} /></Field>
            <div><button type="submit" className="btn btn-primary"><LuMessageSquarePlus /> {t('lf.a.add')}</button></div>
          </form>
        )}
        {msg && <Notice tone="error">{msg}</Notice>}
        {acts.error && <Notice tone="error">{acts.error}</Notice>}
        {!acts.data?.length ? <div className="faint">{acts.loading ? t('common.loading') : t('lf.history_empty')}</div> : (
          <div className="stack lf-history" style={{ gap: 8 }}>
            {acts.data.map((x) => (
              <div key={x.id} className="status-row" style={{ alignItems: 'flex-start' }}>
                <span className="label"><Badge>{t(`lf.a.${x.kind}`)}</Badge> <span className="faint">{formatDateTime(x.happened_at)}</span></span>
                <span style={{ flex: 1, whiteSpace: 'pre-wrap', textAlign: 'left', marginLeft: 12 }}>{x.summary}{x.outcome ? ` — ${x.outcome}` : ''}</span>
                {canWrite && x.user_id === user?.id && <button className="btn btn-ghost btn-icon" aria-label={t('lf.a.delete')} onClick={async () => {
                  if (!window.confirm(t('lf.a.delete_confirm'))) return;
                  try { await data.deleteActivity(orgId, x.id); acts.reload(); } catch (err) { setMsg(errorText(err)); }
                }}><LuTrash2 /></button>}
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}

function OfferBuilder({ orgId, lead, org, onClose, onDone }) {
  const c = lead.company ?? {};
  const [services, setServices] = useState(lead.services.length ? lead.services : recommendedServices(lead.segment).slice(0, 3));
  const [prices, setPrices] = useState({});
  const [valid, setValid] = useState(addDays(14));
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const labels = Object.fromEntries(SERVICES.map((s) => [s, t(`lf.svc.${s}`)]));
  let minorPrices = {}; let priceErr = null;
  try { minorPrices = Object.fromEntries(Object.entries(prices).filter(([, v]) => v.trim()).map(([k, v]) => [k, inputToMinor(v)])); } catch (e) { priceErr = e.message; }
  const text = offerText({ template: t('lf.offer.template').replace('{intro}', t(`lf.offer.intro.${lead.segment}`)), company: c.name, sender: org?.name,
    services, prices: minorPrices, labels, money, validUntil: formatDate(valid) });
  const total = services.reduce((s, x) => s + (minorPrices[x] ?? 0), 0);
  async function save() {
    setBusy(true); setMsg(null);
    try {
      if (priceErr) throw new Error(priceErr);
      const docs = await data.documents(orgId, 'b2b-client-finder');
      const number = `T-${String(docs.length + 1).padStart(3, '0')}-${new Date().getFullYear()}`;
      await data.saveDocument(orgId, 'b2b-client-finder', 'offer', { number, company_id: lead.company_id, counterparty_name: c.name, status: 'sent',
        currency: 'AZN', fx_rate_to_base: 1, doc_date: today(), valid_until: valid, terms: text }, services.map((s) => ({ description: labels[s], quantity: 1, unit: 'set', unit_price_minor: minorPrices[s] ?? 0 })));
      await data.addActivity(orgId, { lead_id: lead.id, kind: 'offer', summary: text });
      const nextStage = OPEN_STAGES.indexOf(lead.stage) < OPEN_STAGES.indexOf('offer_sent') ? 'offer_sent' : lead.stage;
      await data.updateLead(orgId, lead.id, { stage: nextStage, services, estimated_value_minor: total || lead.estimated_value_minor, next_follow_up: addDays(3),
        score: leadScore({ ...lead, stage: nextStage, services }, c) });
      onDone();
    } catch (err) { setMsg(errorText(err)); setBusy(false); }
  }
  return (
    <Modal title={t('lf.offer.title', { name: c.name })} onClose={onClose} width={900}>
      <div className="stack" style={{ gap: 14 }}>
        <div style={formGrid}>
          {SERVICES.map((s) => (
            <div key={s} className="field">
              <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <input type="checkbox" checked={services.includes(s)} onChange={(e) => setServices((x) => (e.target.checked ? [...x, s] : x.filter((y) => y !== s)))} />
                {labels[s]}
              </label>
              {services.includes(s) && <MoneyInput id={`price-${s}`} value={prices[s] ?? ''} onChange={(v) => setPrices((p) => ({ ...p, [s]: v }))} />}
            </div>
          ))}
          <Field id="of-valid" label={t('dl.f.valid_until')}><input id="of-valid" type="date" className="input" value={valid} onChange={(e) => setValid(e.target.value)} /></Field>
        </div>
        <textarea className="input lf-offer-text" rows={12} readOnly value={text} aria-label={t('lf.offer.text')} />
        <div className="faint" style={{ fontSize: 12 }}>{t('lf.offer.note')}</div>
        {priceErr && <Notice tone="error">{t(priceErr)}</Notice>}
        {msg && <Notice tone="error">{msg}</Notice>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
          <button className="btn" onClick={() => navigator.clipboard?.writeText(text)}><LuCopy /> {t('lf.offer.copy')}</button>
          <button className="btn btn-primary" disabled={busy || !services.length} onClick={save}>{t('lf.offer.save')}</button>
        </div>
      </div>
    </Modal>
  );
}

function Leads() {
  const { orgId, can, org } = useOrg();
  const canWrite = canWriteLeads(can);
  const res = useLeads();
  const [f, setF] = useState({ q: '', city: '', segment: '', stage: 'open', service: '', minScore: '', onlyNew: false });
  const [editing, setEditing] = useState(null);
  const [open, setOpen] = useState(null);
  const [offer, setOffer] = useState(null);
  const [msg, setMsg] = useState(null);
  const rows = res.data ?? [];
  const cities = useMemo(() => [...new Set(rows.map((r) => r.company?.city).filter(Boolean))].sort(), [rows]);
  const list = rows.filter((r) => {
    const c = r.company ?? {}; const n = f.q.trim().toLowerCase();
    return (!n || [c.name, c.phone, c.email, c.address, r.notes].some((v) => v?.toLowerCase().includes(n)))
      && (!f.city || c.city === f.city) && (!f.segment || r.segment === f.segment)
      && (f.stage === 'all' || (f.stage === 'open' ? OPEN_STAGES.includes(r.stage) : r.stage === f.stage))
      && (!f.service || r.services.includes(f.service)) && (!f.minScore || (r.score ?? 0) >= Number(f.minScore)) && (!f.onlyNew || r.is_new_business);
  }).sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const refreshOpen = async () => { await res.reload(); };
  return (
    <Card title={t('lf.leads_title')} sub={t('lf.leads_sub')} actions={canWrite && <button className="btn btn-primary" onClick={() => setEditing('new')}><LuPlus /> {t('lf.new')}</button>}>
      <Toolbar>
        <input className="input" style={{ flex: '1 1 200px' }} placeholder={t('lf.search')} aria-label={t('lf.search')} value={f.q} onChange={set('q')} />
        <select className="input" style={{ width: 140 }} aria-label={t('co.f.city')} value={f.city} onChange={set('city')}><option value="">{t('lf.all_cities')}</option>{cities.map((c) => <option key={c}>{c}</option>)}</select>
        <select className="input" style={{ width: 150 }} aria-label={t('lf.f.segment')} value={f.segment} onChange={set('segment')}><option value="">{t('lf.all_segments')}</option>{SEGMENTS.map((x) => <option key={x} value={x}>{t(`lf.seg.${x}`)}</option>)}</select>
        <select className="input" style={{ width: 150 }} aria-label={t('lf.f.stage')} value={f.stage} onChange={set('stage')}>
          <option value="open">{t('lf.open_stages')}</option><option value="all">{t('mp.filter.all')}</option>{STAGES.map((x) => <option key={x} value={x}>{t(`lf.stage.${x}`)}</option>)}
        </select>
        <select className="input" style={{ width: 160 }} aria-label={t('lf.f.services')} value={f.service} onChange={set('service')}><option value="">{t('lf.all_services')}</option>{SERVICES.map((x) => <option key={x} value={x}>{t(`lf.svc.${x}`)}</option>)}</select>
        <select className="input" style={{ width: 120 }} aria-label={t('op.min_score')} value={f.minScore} onChange={set('minScore')}><option value="">{t('op.min_score')}</option>{[40, 60, 80].map((n) => <option key={n} value={n}>≥ {n}</option>)}</select>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" checked={f.onlyNew} onChange={set('onlyNew')} /> {t('lf.only_new')}</label>
      </Toolbar>
      {!canWrite && <div className="card-pad" style={{ paddingBottom: 0 }}><Notice>{t('mp.read_only')}</Notice></div>}
      {(res.error || msg) && <div className="card-pad" style={{ paddingBottom: 0 }}><Notice tone="error">{res.error || msg}</Notice></div>}
      {res.loading && !res.data ? <div className="card-pad faint">{t('common.loading')}</div>
        : !list.length ? <EmptyState icon={LuUsers} title={rows.length ? t('mp.products.none_found') : t('lf.empty')}>{rows.length ? null : t('lf.empty_body')}</EmptyState> : (
          <div className="table-wrap"><table className="table lf-table">
            <thead><tr><th>{t('co.f.name')}</th><th>{t('lf.f.segment')}</th><th>{t('co.f.city')}</th><th>{t('lf.f.stage')}</th><th>{t('lf.f.next')}</th><th className="r">{t('lf.score')}</th><th className="r" /></tr></thead>
            <tbody>{list.map((r) => (
              <tr key={r.id} data-lead={r.company?.name}>
                <td><button className="link-btn" onClick={() => setOpen(r)}>{r.company?.name}</button>
                  <div className="faint" style={{ fontSize: 12 }}>{r.services.slice(0, 3).map((s) => t(`lf.svc.${s}`)).join(', ')}{r.is_new_business ? ` · ${t('lf.f.new_business')}` : ''}</div></td>
                <td>{t(`lf.seg.${r.segment}`)}</td><td>{r.company?.city ?? '—'}</td>
                <td><Badge tone={stageTone[r.stage]}>{t(`lf.stage.${r.stage}`)}</Badge></td>
                <td><FollowUp date={OPEN_STAGES.includes(r.stage) ? r.next_follow_up : null} /></td>
                <td className="r"><ScoreBadge score={r.score} /></td>
                <td className="r" style={{ whiteSpace: 'nowrap' }}>
                  {canWrite && <button className="btn btn-ghost btn-icon" aria-label={t('lf.offer.make_of', { name: r.company?.name ?? '' })} onClick={() => setOffer(r)}><LuFileText /></button>}
                  {canWrite && <button className="btn btn-ghost btn-icon" aria-label={t('co.edit_of', { name: r.company?.name ?? '' })} onClick={() => setEditing(r)}><LuPencil /></button>}
                  {canWrite && <button className="btn btn-ghost btn-icon" aria-label={t('co.delete_of', { name: r.company?.name ?? '' })} onClick={async () => {
                    if (!window.confirm(t('lf.delete_confirm', { name: r.company?.name ?? '' }))) return;
                    try { await data.deleteLead(orgId, r); res.reload(); } catch (err) { setMsg(errorText(err)); }
                  }}><LuTrash2 /></button>}
                </td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      <div className="card-pad faint" style={{ fontSize: 12 }}>{t('lf.score_explain')}</div>
      {editing && <LeadForm orgId={orgId} lead={editing === 'new' ? null : editing} existing={rows} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); res.reload(); }} />}
      {open && <LeadDetail orgId={orgId} lead={rows.find((r) => r.id === open.id) ?? open} canWrite={canWrite} onClose={() => setOpen(null)} onChanged={refreshOpen}
        onEdit={() => { setEditing(rows.find((r) => r.id === open.id) ?? open); setOpen(null); }} onOffer={() => { setOffer(rows.find((r) => r.id === open.id) ?? open); setOpen(null); }} />}
      {offer && <OfferBuilder orgId={orgId} lead={offer} org={org} onClose={() => setOffer(null)} onDone={() => { setOffer(null); res.reload(); }} />}
    </Card>
  );
}

function Pipeline() {
  const { orgId, can } = useOrg();
  const canWrite = canWriteLeads(can);
  const res = useLeads();
  const [msg, setMsg] = useState(null);
  const move = async (r, dir) => {
    const i = STAGES.indexOf(r.stage); const next = STAGES[i + dir];
    if (!next) return;
    setMsg(null);
    try { await data.updateLead(orgId, r.id, { stage: next, score: leadScore({ ...r, stage: next }, r.company ?? {}) }); res.reload(); } catch (err) { setMsg(errorText(err)); }
  };
  return (
    <div className="stack">
      {(res.error || msg) && <Notice tone="error">{res.error || msg}</Notice>}
      <div className="lf-board" style={{ display: 'grid', gridTemplateColumns: `repeat(${STAGES.length}, minmax(180px, 1fr))`, gap: 10, overflowX: 'auto' }}>
        {STAGES.map((s) => {
          const items = (res.data ?? []).filter((r) => r.stage === s);
          return (
            <Card key={s} title={t(`lf.stage.${s}`)} sub={`${items.length} · ${money(items.reduce((a, r) => a + Number(r.estimated_value_minor ?? 0), 0))}`}>
              <div className="stack card-pad" style={{ gap: 8 }} data-stage={s}>
                {items.map((r) => (
                  <div key={r.id} className="card" style={{ padding: 10 }} data-card={r.company?.name}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6 }}><strong style={{ fontSize: 13 }}>{r.company?.name}</strong><ScoreBadge score={r.score} /></div>
                    <div className="faint" style={{ fontSize: 12 }}>{t(`lf.seg.${r.segment}`)} · {r.company?.city ?? '—'}</div>
                    {canWrite && (
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6 }}>
                        <button className="btn btn-ghost btn-icon" disabled={s === STAGES[0]} aria-label={t('lf.move_back', { name: r.company?.name ?? '' })} onClick={() => move(r, -1)}><LuArrowLeft /></button>
                        <button className="btn btn-ghost btn-icon" disabled={s === STAGES.at(-1)} aria-label={t('lf.move_next', { name: r.company?.name ?? '' })} onClick={() => move(r, 1)}><LuArrowRight /></button>
                      </div>
                    )}
                  </div>
                ))}
                {!items.length && <div className="faint" style={{ fontSize: 12 }}>—</div>}
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function FollowUps() {
  const res = useLeads();
  const groups = { overdue: [], today: [], soon: [], later: [], none: [] };
  for (const r of (res.data ?? []).filter((x) => OPEN_STAGES.includes(x.stage))) groups[followUpState(r.next_follow_up, today()) ?? 'none'].push(r);
  for (const g of Object.values(groups)) g.sort((a, b) => String(a.next_follow_up).localeCompare(String(b.next_follow_up)));
  return (
    <div className="grid grid-2">
      {res.error && <Notice tone="error">{res.error}</Notice>}
      {Object.entries(groups).map(([k, items]) => (
        <Card key={k} title={`${t(`lf.fu.${k}`)} (${items.length})`}>
          {!items.length ? <div className="card-pad faint">—</div> : (
            <div className="status-list card-pad">{items.map((r) => (
              <div className="status-row" key={r.id} data-followup={r.company?.name}>
                <span className="label">{r.company?.name} <span className="faint">· {t(`lf.stage.${r.stage}`)} · {r.company?.phone ?? '—'}</span></span>
                <span className="faint">{r.next_follow_up ? formatDate(r.next_follow_up) : '—'}</span>
              </div>
            ))}</div>
          )}
        </Card>
      ))}
    </div>
  );
}

function Overview({ module, goTo }) {
  const res = useLeads();
  const rows = res.data ?? []; const ready = res.data != null;
  const open = rows.filter((r) => OPEN_STAGES.includes(r.stage));
  const won = rows.filter((r) => r.stage === 'won').length; const lost = rows.filter((r) => r.stage === 'lost').length;
  const due = open.filter((r) => ['overdue', 'today'].includes(followUpState(r.next_follow_up, today())));
  return (
    <div className="stack">
      {res.error && <Notice tone="error">{res.error}</Notice>}
      <div className="grid grid-stats">
        <Stat featured label={t('lf.ov.open')} value={ready ? open.length : null} sub={ready ? t('lf.ov.total', { n: rows.length }) : t('common.loading')} />
        <Stat label={t('lf.ov.pipeline_value')} money={ready ? open.reduce((s, r) => s + Number(r.estimated_value_minor ?? 0), 0) : null} />
        <Stat label={t('lf.ov.due')} value={ready ? due.length : null} />
        <Stat label={t('lf.ov.win_rate')} value={ready ? (won + lost ? `${Math.round((won / (won + lost)) * 100)} %` : '—') : null} sub={ready ? t('lf.ov.won_lost', { w: won, l: lost }) : undefined} />
      </div>
      <div className="grid grid-2">
        <Card title={t('lf.ov.top')} actions={<button className="btn btn-ghost" onClick={() => goTo('leads')}>{t('mp.ov.all')}</button>}>
          {!ready ? <div className="card-pad faint">{t('common.loading')}</div> : !open.length ? <div className="card-pad faint">{t('lf.empty')}</div> : (
            <div className="status-list card-pad">{[...open].sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).slice(0, 6).map((r) => (
              <div className="status-row" key={r.id}><span className="label">{r.company?.name} <span className="faint">· {t(`lf.seg.${r.segment}`)} · {r.company?.city ?? '—'}</span></span><ScoreBadge score={r.score} /></div>
            ))}</div>
          )}
        </Card>
        <div className="stack">
          <Card title={t('lf.ov.due_list')} actions={<button className="btn btn-ghost" onClick={() => goTo('followups')}><LuCalendarClock /> {t('mp.ov.all')}</button>}>
            {!due.length ? <div className="card-pad faint">{t('lf.ov.due_none')}</div> : (
              <div className="status-list card-pad">{due.slice(0, 6).map((r) => <div className="status-row" key={r.id}><span className="label">{r.company?.name}</span><FollowUp date={r.next_follow_up} /></div>)}</div>
            )}
          </Card>
          <AresCard moduleKey={module.key} name={tModule(module, 'shortName')} />
          <Card title={t('mw.features')}><ul className="feature-list">{tModuleFeatures(module).map((x) => <li key={x}><LuUsers aria-hidden />{x}</li>)}</ul></Card>
        </div>
      </div>
    </div>
  );
}

function Reports() {
  const res = useLeads();
  const rows = res.data ?? [];
  const group = (fn) => {
    const m = new Map();
    for (const r of rows) { const k = fn(r) || '—'; const g = m.get(k) ?? { n: 0, value: 0, won: 0 }; g.n += 1; g.value += Number(r.estimated_value_minor ?? 0); if (r.stage === 'won') g.won += 1; m.set(k, g); }
    return [...m.entries()].sort((a, b) => b[1].n - a[1].n);
  };
  const svc = new Map();
  for (const r of rows.filter((x) => x.stage !== 'lost')) for (const s of r.services) svc.set(s, (svc.get(s) ?? 0) + 1);
  const Table = ({ title, groups }) => (
    <Card title={title}><div className="table-wrap"><table className="table">
      <thead><tr><th /><th className="r">{t('op.rep.count')}</th><th className="r">{t('lf.f.value')}</th><th className="r">{t('lf.stage.won')}</th></tr></thead>
      <tbody>{groups.map(([k, g]) => <tr key={k}><td>{k}</td><td className="r num">{g.n}</td><td className="r num">{money(g.value)}</td><td className="r num">{g.won}</td></tr>)}</tbody>
    </table></div></Card>
  );
  const exportCsv = () => downloadCsv(`b2b-client-finder-${today()}.csv`,
    [t('co.f.name'), t('lf.f.segment'), t('co.f.city'), t('co.f.phone'), t('co.f.email'), t('co.f.website'), t('lf.f.stage'), t('lf.score'), t('lf.f.services'), t('lf.f.value'), t('lf.f.next'), t('co.f.source'), t('op.f.data_quality')],
    rows.map((r) => [r.company?.name, t(`lf.seg.${r.segment}`), r.company?.city, r.company?.phone, r.company?.email, r.company?.website, t(`lf.stage.${r.stage}`), r.score,
      r.services.map((s) => t(`lf.svc.${s}`)).join(', '), r.estimated_value_minor == null ? '' : r.estimated_value_minor / 100, r.next_follow_up, r.company?.source, t(`op.quality.${r.company?.data_quality ?? 'unverified'}`)]));
  return (
    <div className="stack">
      {res.error && <Notice tone="error">{res.error}</Notice>}
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}><button className="btn" onClick={exportCsv} disabled={!rows.length}><LuDownload /> {t('op.rep.csv')}</button></div>
      <div className="grid grid-2">
        <Table title={t('lf.rep.by_stage')} groups={group((r) => t(`lf.stage.${r.stage}`))} />
        <Table title={t('lf.rep.by_segment')} groups={group((r) => t(`lf.seg.${r.segment}`))} />
        <Table title={t('lf.rep.by_city')} groups={group((r) => r.company?.city)} />
        <Card title={t('lf.rep.demand')}><div className="table-wrap"><table className="table">
          <thead><tr><th /><th className="r">{t('op.rep.count')}</th></tr></thead>
          <tbody>{[...svc.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => <tr key={k}><td>{t(`lf.svc.${k}`)}</td><td className="r num">{n}</td></tr>)}</tbody>
        </table></div></Card>
      </div>
    </div>
  );
}

const SECTIONS = { overview: Overview, leads: Leads, pipeline: Pipeline, followups: FollowUps, reports: Reports };
const TABS = ['overview', 'leads', 'pipeline', 'followups', 'reports', 'finance', 'ai'].map((id) => ({
  id, get label() { return ['finance', 'ai'].includes(id) ? t(`mw.tab.${id}`) : t(`lf.tab.${id}`); },
}));

export default function B2BClientFinderModule() {
  return <ModuleWorkspace module={MODULE} sections={SECTIONS} tabs={TABS} />;
}
