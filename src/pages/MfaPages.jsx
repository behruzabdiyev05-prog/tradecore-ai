/**
 * Two-step sign-in (Supabase Auth MFA, TOTP): set-up with a QR code, the code step
 * after password sign-in (aal1 → aal2), and the screen shown when an organization
 * requires 2FA for the user's role (decision G — enforced by RLS, migration 0012).
 */
import { useCallback, useEffect, useState } from 'react';
import { LuShieldCheck } from 'react-icons/lu';
import { account } from '../core/data/account.js';
import { errorText, t } from '../core/i18n/index.js';
import { useAuth } from '../core/auth/AuthProvider.jsx';
import { useOrg } from '../core/org/OrgProvider.jsx';
import { Link } from '../core/router/router.jsx';
import { Brand } from '../layout/Sidebar.jsx';
import { Card, EmptyState, Notice } from '../core/ui/components.jsx';

function CodeInput({ id, value, onChange }) {
  return (
    <input id={id} className="input mfa-code num" inputMode="numeric" autoComplete="one-time-code" maxLength={6}
      pattern="[0-9]{6}" required value={value} onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 6))} />
  );
}

/** Enrol / remove an authenticator app. `onChange` runs after every change. */
export function MfaSetup({ onChange }) {
  const [state, setState] = useState({ loading: true });
  const [enroll, setEnroll] = useState(null);      // { factorId, qr, secret }
  const [code, setCode] = useState('');
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { setState({ loading: false, ...(await account.mfaFactors()) }); } catch (e) { setState({ loading: false, error: errorText(e), totp: [] }); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const start = async () => {
    setMsg(null); setBusy(true);
    try { setEnroll(await account.mfaEnroll()); } catch (e) { setMsg({ tone: 'error', text: errorText(e) }); } finally { setBusy(false); }
  };
  const verify = async (e) => {
    e.preventDefault(); setMsg(null); setBusy(true);
    try {
      await account.mfaVerify(enroll.factorId, code);
      setEnroll(null); setCode('');
      setMsg({ tone: 'warn', text: t('mfa.enabled') });
      await load(); await onChange?.();
    } catch (err) { setMsg({ tone: 'error', text: errorText(err) }); } finally { setBusy(false); }
  };
  const cancel = async () => {
    if (enroll) await account.mfaUnenroll(enroll.factorId).catch(() => {});
    setEnroll(null); setCode('');
  };
  const remove = async (factorId) => {
    if (!window.confirm(t('mfa.confirm_disable'))) return;
    setMsg(null); setBusy(true);
    try { await account.mfaUnenroll(factorId); setMsg({ tone: 'warn', text: t('mfa.disabled') }); await load(); await onChange?.(); }
    catch (e) { setMsg({ tone: 'error', text: errorText(e) }); } finally { setBusy(false); }
  };

  if (state.loading) return <div className="faint">{t('common.loading')}</div>;
  if (!state.available) return <Notice>{t('mfa.unavailable')}</Notice>;
  const active = state.totp?.[0];
  return (
    <div className="stack" style={{ gap: 12 }}>
      {state.error && <Notice tone="error">{state.error}</Notice>}
      {active && !enroll && (
        <div className="status-row" style={{ padding: 0 }}>
          <span className="label"><span><LuShieldCheck aria-hidden /> {t('mfa.status.on')}</span><small>{active.friendly_name ?? 'TOTP'}</small></span>
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => remove(active.id)}>{t('mfa.disable')}</button>
        </div>
      )}
      {!active && !enroll && (
        <>
          <p className="muted">{t('mfa.intro')}</p>
          <div><button type="button" className="btn btn-primary" disabled={busy} onClick={start}>{t('mfa.enable')}</button></div>
        </>
      )}
      {enroll && (
        <form className="stack mfa-enroll" onSubmit={verify} style={{ gap: 12 }}>
          <p className="muted">{t('mfa.scan')}</p>
          {enroll.qr && <img className="mfa-qr" src={enroll.qr} alt={t('mfa.qr_alt')} width={180} height={180} />}
          {enroll.secret && <p className="faint" style={{ fontSize: 12.5 }}>{t('mfa.secret')}: <code className="mfa-secret">{enroll.secret}</code></p>}
          <div className="field" style={{ maxWidth: 220 }}>
            <label htmlFor="mfa-enroll-code">{t('mfa.code')}</label>
            <CodeInput id="mfa-enroll-code" value={code} onChange={setCode} />
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-primary" type="submit" disabled={busy || code.length !== 6}>{t('mfa.confirm')}</button>
            <button className="btn btn-ghost" type="button" onClick={cancel}>{t('common.cancel')}</button>
          </div>
        </form>
      )}
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
    </div>
  );
}

/** After password sign-in: enter the 6-digit code to reach aal2. */
export function MfaChallengePage({ onVerified }) {
  const { signOut } = useAuth();
  const [code, setCode] = useState('');
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setMsg(null);
    try {
      const { totp } = await account.mfaFactors();
      if (!totp[0]) throw new Error('mfa.no_factor');
      await account.mfaVerify(totp[0].id, code);
      await onVerified();
    } catch (err) { setMsg(errorText(err)); setCode(''); } finally { setBusy(false); }
  };
  return (
    <div className="center-screen">
      <form className="card auth-card" onSubmit={submit}>
        <Brand />
        <div>
          <h1 style={{ fontSize: 20 }}>{t('mfa.challenge.title')}</h1>
          <p className="muted" style={{ marginTop: 4 }}>{t('mfa.challenge.body')}</p>
        </div>
        <div className="field">
          <label htmlFor="mfa-code">{t('mfa.code')}</label>
          <CodeInput id="mfa-code" value={code} onChange={setCode} />
        </div>
        {msg && <Notice tone="error">{msg}</Notice>}
        <button className="btn btn-primary btn-block" type="submit" disabled={busy || code.length !== 6}>{busy ? t('common.wait') : t('mfa.confirm')}</button>
        <div className="auth-switch"><button type="button" className="link-btn" onClick={signOut}>{t('auth.signout')}</button></div>
      </form>
    </div>
  );
}

/** The active organization requires 2FA for this role; its data stays closed until then. */
export function MfaRequiredPage() {
  const { org, reload } = useOrg();
  const [hasFactor, setHasFactor] = useState(null);
  const [code, setCode] = useState('');
  const [msg, setMsg] = useState(null);
  useEffect(() => { account.mfaFactors().then((f) => setHasFactor(Boolean(f.totp[0]))).catch(() => setHasFactor(false)); }, []);
  const verify = async (e) => {
    e.preventDefault(); setMsg(null);
    try {
      const { totp } = await account.mfaFactors();
      await account.mfaVerify(totp[0].id, code);
      await reload();
    } catch (err) { setMsg(errorText(err)); setCode(''); }
  };
  return (
    <Card>
      <EmptyState icon={LuShieldCheck} title={t('mfa.required.title')}>
        {t('mfa.required.body', { org: org?.name ?? '' })}
      </EmptyState>
      <div className="card-pad" style={{ maxWidth: 520, margin: '0 auto' }}>
        {hasFactor === true && (
          <form className="stack" onSubmit={verify} style={{ gap: 12 }}>
            <div className="field"><label htmlFor="mfa-gate-code">{t('mfa.code')}</label><CodeInput id="mfa-gate-code" value={code} onChange={setCode} /></div>
            {msg && <Notice tone="error">{msg}</Notice>}
            <div><button className="btn btn-primary" type="submit" disabled={code.length !== 6}>{t('mfa.confirm')}</button></div>
          </form>
        )}
        {hasFactor === false && <MfaSetup onChange={reload} />}
        <p className="faint" style={{ fontSize: 12.5, marginTop: 12 }}>
          {t('mfa.required.other')} <Link to="/profile">{t('nav.profile')}</Link>
        </p>
      </div>
    </Card>
  );
}
