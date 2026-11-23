/**
 * /profile — the user's own profile (same profile in every company).
 * Personal data, avatar (private bucket), e-mail, password, 2FA, sessions, language.
 */
import { useEffect, useRef, useState } from 'react';
import { LuCamera, LuTrash2 } from 'react-icons/lu';
import { useAuth } from '../core/auth/AuthProvider.jsx';
import { useProfile } from '../core/profile/ProfileProvider.jsx';
import { account, AVATAR_BUCKET, checkImage, features } from '../core/data/account.js';
import { errorText, getLocale, LOCALES, setLocale, t } from '../core/i18n/index.js';
import { Card, Notice } from '../core/ui/components.jsx';
import { MfaSetup } from './MfaPages.jsx';

function useMessage() {
  const [msg, setMsg] = useState(null);
  return [msg, (tone, text) => setMsg(text ? { tone, text } : null)];
}

function PersonalCard() {
  const { user } = useAuth();
  const { profile, update, avatarUrl } = useProfile();
  const [form, setForm] = useState({ full_name: '', phone: '', job_title: '' });
  const [msg, say] = useMessage();
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);

  useEffect(() => {
    setForm({ full_name: profile?.full_name ?? '', phone: profile?.phone ?? '', job_title: profile?.job_title ?? '' });
  }, [profile?.full_name, profile?.phone, profile?.job_title]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  async function save(e) {
    e.preventDefault(); say(); setBusy(true);
    try {
      await update({ full_name: form.full_name.trim() || null, phone: form.phone.trim() || null, job_title: form.job_title.trim() || null });
      say('warn', t('common.saved'));
    } catch (err) { say('error', errorText(err)); } finally { setBusy(false); }
  }
  async function upload(file) {
    say();
    const bad = checkImage(file);
    if (bad) { say('error', t(bad)); return; }
    setBusy(true);
    try {
      const old = profile?.avatar_path;
      const path = await account.uploadImage(AVATAR_BUCKET, user.id, file, 'avatar');
      await update({ avatar_path: path });
      if (old) await account.removeImage(AVATAR_BUCKET, old);
      say('warn', t('profile.avatar.saved'));
    } catch (err) { say('error', errorText(err)); } finally { setBusy(false); if (fileRef.current) fileRef.current.value = ''; }
  }
  async function removeAvatar() {
    setBusy(true); say();
    try {
      const old = profile?.avatar_path;
      await update({ avatar_path: null });
      await account.removeImage(AVATAR_BUCKET, old);
    } catch (err) { say('error', errorText(err)); } finally { setBusy(false); }
  }

  const initials = (form.full_name || user?.email || '?').split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  return (
    <Card title={t('profile.personal')} pad>
      <form className="stack" onSubmit={save} style={{ gap: 14, maxWidth: 560 }}>
        <div className="avatar-row">
          {avatarUrl ? <img className="avatar avatar-lg avatar-img" src={avatarUrl} alt={t('profile.avatar')} /> : <span className="avatar avatar-lg" aria-hidden>{initials}</span>}
          {features.storage() ? (
            <div className="stack" style={{ gap: 6 }}>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <label className="btn" htmlFor="avatar-file"><LuCamera aria-hidden /> {t('profile.avatar.upload')}</label>
                {profile?.avatar_path && <button type="button" className="btn btn-ghost" onClick={removeAvatar} disabled={busy}><LuTrash2 aria-hidden /> {t('common.remove')}</button>}
              </div>
              <input ref={fileRef} id="avatar-file" type="file" accept="image/png,image/jpeg,image/webp" className="sr-only"
                onChange={(e) => upload(e.target.files?.[0])} />
              <span className="faint" style={{ fontSize: 12 }}>{t('file.rules')}</span>
            </div>
          ) : <span className="faint" style={{ fontSize: 12.5 }}>{t('storage.unavailable')}</span>}
        </div>
        <div className="field">
          <label htmlFor="pf-name">{t('profile.full_name')}</label>
          <input id="pf-name" className="input" maxLength={200} value={form.full_name} onChange={set('full_name')} autoComplete="name" />
        </div>
        <div className="grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <div className="field">
            <label htmlFor="pf-phone">{t('profile.phone')}</label>
            <input id="pf-phone" className="input" type="tel" maxLength={20} value={form.phone} onChange={set('phone')} autoComplete="tel" placeholder="+994 50 000 00 00" />
          </div>
          <div className="field">
            <label htmlFor="pf-job">{t('profile.job_title')}</label>
            <input id="pf-job" className="input" maxLength={100} value={form.job_title} onChange={set('job_title')} autoComplete="organization-title" />
          </div>
        </div>
        {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
        <div><button className="btn btn-primary" type="submit" disabled={busy || !profile}>{t('common.save')}</button></div>
      </form>
    </Card>
  );
}

function EmailCard() {
  const { user } = useAuth();
  const [email, setEmail] = useState('');
  const [msg, say] = useMessage();
  const submit = async (e) => {
    e.preventDefault(); say();
    try { await account.changeEmail(email.trim()); setEmail(''); say('warn', t('profile.email.sent')); } catch (err) { say('error', errorText(err)); }
  };
  return (
    <Card title={t('profile.email')} pad>
      <form className="stack" onSubmit={submit} style={{ gap: 12, maxWidth: 560 }}>
        <div className="status-row" style={{ padding: 0 }}><span className="label">{t('profile.email.current')}</span><strong>{user?.email}</strong></div>
        <div className="field">
          <label htmlFor="pf-email">{t('profile.email.new')}</label>
          <input id="pf-email" className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
        </div>
        <p className="faint" style={{ fontSize: 12.5 }}>{t('profile.email.note')}</p>
        {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
        <div><button className="btn" type="submit">{t('profile.email.change')}</button></div>
      </form>
    </Card>
  );
}

function PasswordCard() {
  const { user } = useAuth();
  const [form, setForm] = useState({ current: '', next: '', repeat: '', code: '' });
  const [msg, say] = useMessage();
  const [busy, setBusy] = useState(false);
  const [has2fa, setHas2fa] = useState(false);
  useEffect(() => { account.mfaFactors().then((f) => setHas2fa(f.totp.length > 0)).catch(() => {}); }, []);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  async function submit(e) {
    e.preventDefault(); say();
    if (form.next.length < 8) { say('error', t('auth.err.short')); return; }
    if (form.next !== form.repeat) { say('error', t('profile.password.mismatch')); return; }
    if (form.next === form.current) { say('error', t('profile.password.same')); return; }
    setBusy(true);
    try {
      await account.changePassword(user.email, form.current, form.next, form.code || null);
      setForm({ current: '', next: '', repeat: '', code: '' });
      say('warn', t('profile.password.changed'));
    } catch (err) { say('error', errorText(err)); } finally { setBusy(false); }
  }
  return (
    <Card title={t('profile.password')} pad>
      <form className="stack" onSubmit={submit} style={{ gap: 12, maxWidth: 560 }}>
        <div className="field"><label htmlFor="pw-current">{t('profile.password.current')}</label>
          <input id="pw-current" className="input" type="password" required value={form.current} onChange={set('current')} autoComplete="current-password" /></div>
        <div className="grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <div className="field"><label htmlFor="pw-new">{t('profile.password.new')}</label>
            <input id="pw-new" className="input" type="password" required minLength={8} value={form.next} onChange={set('next')} autoComplete="new-password" /></div>
          <div className="field"><label htmlFor="pw-repeat">{t('profile.password.repeat')}</label>
            <input id="pw-repeat" className="input" type="password" required minLength={8} value={form.repeat} onChange={set('repeat')} autoComplete="new-password" /></div>
        </div>
        {has2fa && (
          <div className="field" style={{ maxWidth: 220 }}><label htmlFor="pw-code">{t('mfa.code')}</label>
            <input id="pw-code" className="input mfa-code num" inputMode="numeric" autoComplete="one-time-code" maxLength={6} required
              value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value.replace(/\D/g, '').slice(0, 6) }))} /></div>
        )}
        {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
        <div><button className="btn" type="submit" disabled={busy}>{t('profile.password.change')}</button></div>
      </form>
    </Card>
  );
}

function SessionsCard() {
  const [msg, say] = useMessage();
  const run = async () => {
    say();
    try { await account.signOutOthers(); say('warn', t('profile.sessions.done')); } catch (err) { say('error', errorText(err)); }
  };
  return (
    <Card title={t('profile.sessions')} pad>
      <div className="stack" style={{ gap: 12 }}>
        <p className="muted">{t('profile.sessions.body')}</p>
        {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
        <div><button className="btn" type="button" onClick={run}>{t('profile.sessions.signout_others')}</button></div>
      </div>
    </Card>
  );
}

export function LanguageSelect({ id = 'pf-locale' }) {
  const { profile, update } = useProfile();
  const [msg, setMsg] = useState(null);
  const change = async (code) => {
    setMsg(null);
    try {
      if (profile) await update({ locale: code });
      setLocale(code);
    } catch (err) { setMsg(errorText(err)); }
  };
  return (
    <div className="field" style={{ maxWidth: 280 }}>
      <label htmlFor={id}>{t('profile.language')}</label>
      <select id={id} className="input" value={profile?.locale ?? getLocale()} onChange={(e) => change(e.target.value)}>
        {LOCALES.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
      </select>
      {msg && <Notice tone="error">{msg}</Notice>}
    </div>
  );
}

export default function ProfilePage() {
  const { error, available } = useProfile();
  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">{t('nav.profile')}</div>
          <h1>{t('profile.title')}</h1>
          <p>{t('profile.subtitle')}</p>
        </div>
      </div>
      {!available && error && <div style={{ marginBottom: 16 }}><Notice tone="error">{error}</Notice></div>}
      <div className="grid grid-2 profile-grid">
        <div className="stack">
          <PersonalCard />
          <Card title={t('profile.language')} pad><LanguageSelect /></Card>
        </div>
        <div className="stack">
          <Card title={t('mfa.title')} pad><MfaSetup /></Card>
          <PasswordCard />
          <EmailCard />
          <SessionsCard />
        </div>
      </div>
    </>
  );
}
