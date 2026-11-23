/** Add / edit a central `companies` row (supplier, customer, prospect, partner). */
import { useState } from 'react';
import { errorText, t } from '../../core/i18n/index.js';
import { Modal, Notice } from '../../core/ui/components.jsx';
import { data } from './data.js';
import { Field, FormActions, formGrid } from './kit.jsx';

export const COMPANY_ROLES = ['supplier', 'customer', 'prospect', 'partner'];
const QUALITY = ['unverified', 'estimated', 'verified'];

/** Shared field set (also used by the B2B Client Finder lead form). */
export function CompanyFields({ f, set, roles = true, idPrefix = 'co' }) {
  const id = (k) => `${idPrefix}-${k}`;
  return (
    <div style={formGrid}>
      <Field id={id('name')} label={t('co.f.name')} wide><input id={id('name')} className="input" required value={f.name} onChange={set('name')} /></Field>
      <Field id={id('legal')} label={t('co.f.legal_name')}><input id={id('legal')} className="input" value={f.legal_name} onChange={set('legal_name')} /></Field>
      <Field id={id('country')} label={t('co.f.country')} hint={t('co.f.country_hint')}>
        <input id={id('country')} className="input" maxLength={2} value={f.country_code} onChange={(e) => set('country_code')(e.target.value.toUpperCase())} />
      </Field>
      <Field id={id('city')} label={t('co.f.city')}><input id={id('city')} className="input" value={f.city} onChange={set('city')} /></Field>
      <Field id={id('phone')} label={t('co.f.phone')}><input id={id('phone')} className="input" type="tel" value={f.phone} onChange={set('phone')} /></Field>
      <Field id={id('email')} label={t('co.f.email')}><input id={id('email')} className="input" type="email" value={f.email} onChange={set('email')} /></Field>
      <Field id={id('website')} label={t('co.f.website')}><input id={id('website')} className="input" type="url" placeholder="https://" value={f.website} onChange={set('website')} /></Field>
      <Field id={id('social')} label={t('co.f.social')}><input id={id('social')} className="input" placeholder="instagram.com/…" value={f.social} onChange={set('social')} /></Field>
      <Field id={id('address')} label={t('co.f.address')} wide><input id={id('address')} className="input" value={f.address} onChange={set('address')} /></Field>
      <Field id={id('source')} label={t('co.f.source')} hint={t('co.f.source_hint')}><input id={id('source')} className="input" value={f.source} onChange={set('source')} /></Field>
      <Field id={id('quality')} label={t('op.f.data_quality')}>
        <select id={id('quality')} className="input" value={f.data_quality} onChange={set('data_quality')}>{QUALITY.map((q) => <option key={q} value={q}>{t(`op.quality.${q}`)}</option>)}</select>
      </Field>
      {roles && (
        <fieldset className="field" style={{ gridColumn: '1 / -1', border: 0, padding: 0, margin: 0 }}>
          <legend>{t('co.f.roles')}</legend>
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
            {COMPANY_ROLES.map((r) => (
              <label key={r} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <input type="checkbox" checked={f.roles.includes(r)} onChange={(e) => set('roles')(e.target.checked ? [...f.roles, r] : f.roles.filter((x) => x !== r))} />
                {t(`dl.role.${r}`)}
              </label>
            ))}
          </div>
        </fieldset>
      )}
      <Field id={id('notes')} label={t('mp.o.note')} wide><textarea id={id('notes')} className="input" rows={2} value={f.notes} onChange={set('notes')} /></Field>
    </div>
  );
}

export const companyToForm = (c = {}) => ({
  name: c.name ?? '', legal_name: c.legal_name ?? '', roles: c.roles ?? [], country_code: c.country_code ?? 'AZ', city: c.city ?? '',
  phone: c.phone ?? '', email: c.email ?? '', website: c.website ?? '', social: c.social?.main ?? '', address: c.address ?? '',
  source: c.source ?? '', data_quality: c.data_quality ?? 'unverified', notes: c.notes ?? '', category: c.category ?? '',
});
export function formToCompany(f) {
  if (!f.name.trim()) throw new Error('co.err.name');
  if (f.country_code && !/^[A-Z]{2}$/.test(f.country_code)) throw new Error('co.err.country');
  if (f.website && !/^https?:\/\/\S+$/i.test(f.website.trim())) throw new Error('co.err.website');
  return {
    name: f.name.trim(), legal_name: f.legal_name.trim() || null, roles: f.roles, country_code: f.country_code || null, city: f.city.trim() || null,
    phone: f.phone.trim() || null, email: f.email.trim() || null, website: f.website.trim() || null, social: f.social.trim() ? { main: f.social.trim() } : {},
    address: f.address.trim() || null, source: f.source.trim() || null, data_quality: f.data_quality, notes: f.notes.trim() || null,
    category: f.category?.trim() || null,
  };
}

export function CompanyForm({ orgId, moduleKey, company, onClose, onSaved }) {
  const [f, setF] = useState(() => companyToForm(company));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const set = (k) => (v) => setF((s) => ({ ...s, [k]: v?.target ? v.target.value : v }));
  async function submit(e) {
    e.preventDefault(); setBusy(true); setMsg(null);
    try {
      const row = formToCompany(f);
      if (!row.roles.length) throw new Error('co.err.roles');
      await data.saveCompany(orgId, moduleKey, { ...row, id: company?.id });
      onSaved();
    } catch (err) { setMsg(errorText(err)); setBusy(false); }
  }
  return (
    <Modal title={company?.id ? t('co.edit') : t('co.new')} onClose={onClose} width={760}>
      <form className="stack" onSubmit={submit} style={{ gap: 14 }}>
        <CompanyFields f={f} set={set} />
        <div className="faint" style={{ fontSize: 12 }}>{t('co.legal_note')}</div>
        {msg && <Notice tone="error">{msg}</Notice>}
        <FormActions onCancel={onClose} busy={busy} />
      </form>
    </Modal>
  );
}
