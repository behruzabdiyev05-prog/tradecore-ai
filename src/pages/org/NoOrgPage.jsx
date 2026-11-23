import { useState } from 'react';
import { errorText, t } from '../../core/i18n/index.js';
import { tenancy } from '../../core/data/tenancy.js';
import { useOrg } from '../../core/org/OrgProvider.jsx';
import { useAuth } from '../../core/auth/AuthProvider.jsx';
import { Brand } from '../../layout/Sidebar.jsx';
import { Notice } from '../../core/ui/components.jsx';

export function CreateOrgForm({ onCreated }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  async function submit(e) {
    e.preventDefault();
    if (!name.trim()) { setErr(t('signup.company.required')); return; }
    setBusy(true); setErr(null);
    try {
      const orgId = await tenancy.createOrganization(name.trim());
      await onCreated(orgId);
    } catch (error) {
      setErr(errorText(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="stack" onSubmit={submit} style={{ gap: 12 }}>
      <div className="field">
        <label htmlFor="new-org">{t('org.create.name')}</label>
        <input id="new-org" className="input" required maxLength={200} value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      {err && <Notice tone="error">{err}</Notice>}
      <button className="btn btn-primary" type="submit" disabled={busy}>{t('org.create.submit')}</button>
    </form>
  );
}

/** Shown when the signed-in user belongs to no active organization. */
export default function NoOrgPage() {
  const { reload, error } = useOrg();
  const { signOut } = useAuth();
  return (
    <div className="center-screen">
      <div className="card auth-card" style={{ width: 'min(480px, 100%)' }}>
        <Brand />
        <h1 style={{ fontSize: 20 }}>{t('org.none.title')}</h1>
        <p className="muted">{t('org.none.body')}</p>
        {error && <Notice tone="error">{error}</Notice>}
        <CreateOrgForm onCreated={reload} />
        <button className="btn btn-ghost" onClick={signOut}>{t('auth.signout')}</button>
      </div>
    </div>
  );
}
