import { useEffect, useRef, useState } from 'react';
import { LuImageUp, LuTrash2 } from 'react-icons/lu';
import { errorText, t, tCurrency } from '../../core/i18n/index.js';
import { tenancy } from '../../core/data/tenancy.js';
import { account, checkImage, features, LOGO_BUCKET } from '../../core/data/account.js';
import { useOrg } from '../../core/org/OrgProvider.jsx';
import { Card, Notice } from '../../core/ui/components.jsx';
import { CURRENCIES } from '../../../shared/finance.js';

const DETAILS = ['legal_name', 'tax_id', 'address', 'phone', 'email', 'website'];
const empty = () => Object.fromEntries(DETAILS.map((k) => [k, '']));

/** Same rules as the database checks (migration 0009) — shown before saving. */
export function validateOrgDetails(d) {
  if (d.tax_id && !/^[0-9]{10}$/.test(d.tax_id)) return 'orgpage.err.tax_id';
  if (d.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(d.email)) return 'orgpage.err.email';
  if (d.website && !/^https?:\/\/[^\s<>"]+$/.test(d.website)) return 'orgpage.err.website';
  if (d.phone && !/^\+?[0-9 ()-]{5,20}$/.test(d.phone)) return 'orgpage.err.phone';
  return null;
}

function LogoField({ orgId, path, onChange }) {
  const [url, setUrl] = useState(null);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    let alive = true;
    account.signedUrl(LOGO_BUCKET, path).then((u) => alive && setUrl(u)).catch(() => {});
    return () => { alive = false; };
  }, [path]);
  if (!features.storage()) return <p className="faint" style={{ fontSize: 12.5 }}>{t('storage.unavailable')}</p>;
  const upload = async (file) => {
    setMsg(null);
    const bad = checkImage(file);
    if (bad) { setMsg(t(bad)); return; }
    setBusy(true);
    try {
      const next = await account.uploadImage(LOGO_BUCKET, orgId, file, 'logo');
      await onChange(next);
      if (path) await account.removeImage(LOGO_BUCKET, path);
    } catch (e) { setMsg(errorText(e)); } finally { setBusy(false); if (ref.current) ref.current.value = ''; }
  };
  const remove = async () => {
    setBusy(true);
    try { await onChange(null); await account.removeImage(LOGO_BUCKET, path); } catch (e) { setMsg(errorText(e)); } finally { setBusy(false); }
  };
  return (
    <div className="field">
      <span className="field-label">{t('orgpage.logo')}</span>
      <div className="avatar-row">
        {url ? <img className="org-logo" src={url} alt={t('orgpage.logo')} /> : <span className="org-logo org-logo-empty" aria-hidden><LuImageUp /></span>}
        <div className="stack" style={{ gap: 6 }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <label className="btn" htmlFor="org-logo-file"><LuImageUp aria-hidden /> {t('orgpage.logo.upload')}</label>
            {path && <button type="button" className="btn btn-ghost" onClick={remove} disabled={busy}><LuTrash2 aria-hidden /> {t('common.remove')}</button>}
          </div>
          <input ref={ref} id="org-logo-file" type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={(e) => upload(e.target.files?.[0])} />
          <span className="faint" style={{ fontSize: 12 }}>{t('file.rules')}</span>
        </div>
      </div>
      {msg && <Notice tone="error">{msg}</Notice>}
    </div>
  );
}

export default function OrganizationPage() {
  const { org, orgId, reload } = useOrg();
  const [form, setForm] = useState({ name: org?.name ?? '', base_currency: org?.base_currency ?? 'AZN' });
  const [details, setDetails] = useState(null);   // null = details not available (2B not deployed)
  const [logoPath, setLogoPath] = useState(null);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setForm({ name: org?.name ?? '', base_currency: org?.base_currency ?? 'AZN' });
  }, [org?.name, org?.base_currency]);

  useEffect(() => {
    let alive = true;
    account.orgDetails(orgId).then((row) => {
      if (!alive || !row || !('legal_name' in row)) return;
      setDetails(Object.fromEntries(DETAILS.map((k) => [k, row[k] ?? ''])));
      setLogoPath(row.logo_path ?? null);
    }).catch(() => {});
    return () => { alive = false; };
  }, [orgId]);

  const setD = (k) => (e) => setDetails((d) => ({ ...(d ?? empty()), [k]: k === 'tax_id' ? e.target.value.replace(/\D/g, '').slice(0, 10) : e.target.value }));

  async function save(e) {
    e.preventDefault();
    if (!form.name.trim()) { setMsg({ tone: 'error', text: t('signup.company.required') }); return; }
    const patch = { name: form.name.trim(), base_currency: form.base_currency };
    if (details) {
      const clean = Object.fromEntries(DETAILS.map((k) => [k, details[k].trim() || null]));
      const bad = validateOrgDetails(Object.fromEntries(Object.entries(clean).map(([k, v]) => [k, v ?? ''])));
      if (bad) { setMsg({ tone: 'error', text: t(bad) }); return; }
      Object.assign(patch, clean);
    }
    setBusy(true); setMsg(null);
    try {
      await tenancy.updateOrganization(orgId, patch);
      await reload();
      setMsg({ tone: 'warn', text: t('orgpage.saved') });
    } catch (err) {
      setMsg({ tone: 'error', text: errorText(err) });
    } finally {
      setBusy(false);
    }
  }

  const saveLogo = async (path) => {
    await tenancy.updateOrganization(orgId, { logo_path: path });
    setLogoPath(path);
  };

  const field = (k, props = {}) => (
    <div className="field">
      <label htmlFor={`org-${k}`}>{t(`orgpage.${k}`)}</label>
      <input id={`org-${k}`} className="input" value={details?.[k] ?? ''} onChange={setD(k)} {...props} />
    </div>
  );

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">{t('nav.organization')}</div>
          <h1>{t('orgpage.title')}</h1>
          <p>{t('orgpage.subtitle')}</p>
        </div>
      </div>
      <Card pad>
        <form className="stack" onSubmit={save} style={{ maxWidth: 640, gap: 14 }}>
          <div className="field">
            <label htmlFor="org-name">{t('orgpage.name')}</label>
            <input id="org-name" className="input" required maxLength={200} value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          </div>
          <div className="field">
            <label htmlFor="org-cur">{t('orgpage.currency')}</label>
            <select id="org-cur" className="input" value={form.base_currency}
              onChange={(e) => setForm((f) => ({ ...f, base_currency: e.target.value }))}>
              {Object.values(CURRENCIES).map((c) => <option key={c.code} value={c.code}>{c.code} · {tCurrency(c.code)}</option>)}
            </select>
          </div>
          {details && (
            <>
              <h3 className="form-section">{t('orgpage.details')}</h3>
              {field('legal_name', { maxLength: 200 })}
              <div className="grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
                {field('tax_id', { inputMode: 'numeric', maxLength: 10, placeholder: '1234567890' })}
                {field('phone', { type: 'tel', maxLength: 20 })}
              </div>
              {field('address', { maxLength: 300 })}
              <div className="grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
                {field('email', { type: 'email', maxLength: 200 })}
                {field('website', { type: 'url', maxLength: 200, placeholder: 'https://' })}
              </div>
            </>
          )}
          {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
          <div><button className="btn btn-primary" type="submit" disabled={busy}>{t('orgpage.save')}</button></div>
        </form>
        {details && <div style={{ marginTop: 18, maxWidth: 640 }}><LogoField orgId={orgId} path={logoPath} onChange={saveLogo} /></div>}
      </Card>
    </>
  );
}
