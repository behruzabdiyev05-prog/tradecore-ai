import { useState } from 'react';
import { useAuth } from '../core/auth/AuthProvider.jsx';
import { Brand } from '../layout/Sidebar.jsx';
import { Notice } from '../core/ui/components.jsx';
import { errorText, LOCALES, setLocale, t, useLocale } from '../core/i18n/index.js';

const MODES = {
  signin: { title: 'auth.signin', submit: 'auth.signin' },
  signup: { title: 'auth.signup', submit: 'auth.signup.submit' },
  reset: { title: 'auth.reset', submit: 'auth.reset.submit' },
};

/** Language choice before sign-in (saved in this browser; after sign-in the profile decides). */
function LoginLanguage() {
  const locale = useLocale();
  return (
    <div className="login-lang" role="group" aria-label={t('profile.language')}>
      {LOCALES.map((l) => (
        <button key={l.code} type="button" className="link-btn" aria-pressed={locale === l.code} onClick={() => setLocale(l.code)}>
          {l.code.toUpperCase()}
        </button>
      ))}
    </div>
  );
}

export default function LoginPage({ inviteToken = null }) {
  const { signIn, signUp, resetPassword } = useAuth();
  const [mode, setMode] = useState('signin');
  const [form, setForm] = useState({ email: '', password: '', fullName: '', companyName: '' });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null); // { tone, text }

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const switchMode = (m) => { setMode(m); setMsg(null); };

  async function onSubmit(e) {
    e.preventDefault();
    setMsg(null);
    if (mode === 'signup' && !inviteToken && !form.companyName.trim()) {
      setMsg({ tone: 'error', text: t('signup.company.required') });
      return;
    }
    if (mode !== 'reset' && form.password.length < 8) {
      setMsg({ tone: 'error', text: t('auth.err.short') });
      return;
    }
    setBusy(true);
    try {
      if (mode === 'signin') await signIn(form.email.trim(), form.password);
      if (mode === 'signup') {
        const { needsConfirmation } = await signUp(form.email.trim(), form.password, form.fullName.trim(),
          { companyName: form.companyName.trim(), inviteToken });
        if (needsConfirmation) setMsg({ tone: 'warn', text: t('auth.signup.done') });
      }
      if (mode === 'reset') {
        await resetPassword(form.email.trim());
        setMsg({ tone: 'warn', text: t('auth.reset.sent') });
      }
    } catch (err) {
      setMsg({ tone: 'error', text: errorText(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="center-screen">
      <form className="card auth-card" onSubmit={onSubmit}>
        <div className="login-top"><Brand /><LoginLanguage /></div>
        <div>
          <h1 style={{ fontSize: 20 }}>{t(MODES[mode].title)}</h1>
          <p className="muted" style={{ marginTop: 4 }}>{t('auth.tagline')}</p>
        </div>

        {inviteToken && <Notice>{t('invite.signin_hint')}</Notice>}
        {mode === 'signup' && (
          <div className="field">
            <label htmlFor="fullName">{t('auth.full_name')}</label>
            <input id="fullName" className="input" value={form.fullName} onChange={set('fullName')} autoComplete="name" />
          </div>
        )}
        {mode === 'signup' && !inviteToken && (
          <div className="field">
            <label htmlFor="companyName">{t('signup.company')} *</label>
            <input id="companyName" className="input" aria-required="true" maxLength={200} value={form.companyName}
              onChange={set('companyName')} autoComplete="organization" />
          </div>
        )}
        <div className="field">
          <label htmlFor="email">{t('auth.email')}</label>
          <input id="email" type="email" required className="input" value={form.email} onChange={set('email')} autoComplete="email" />
        </div>
        {mode !== 'reset' && (
          <div className="field">
            <label htmlFor="password">{t('auth.password')}</label>
            <input id="password" type="password" required className="input" value={form.password}
              onChange={set('password')} autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} />
          </div>
        )}

        {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}

        <button className="btn btn-primary btn-block" type="submit" disabled={busy}>
          {busy ? t('common.wait') : t(MODES[mode].submit)}
        </button>

        <div className="auth-switch">
          {mode !== 'signin' && <button type="button" className="link-btn" onClick={() => switchMode('signin')}>{t('auth.signin')}</button>}
          {mode !== 'signup' && <button type="button" className="link-btn" onClick={() => switchMode('signup')}>{t('auth.signup')}</button>}
          {mode !== 'reset' && <button type="button" className="link-btn" onClick={() => switchMode('reset')}>{t('auth.forgot')}</button>}
        </div>
      </form>
    </div>
  );
}
