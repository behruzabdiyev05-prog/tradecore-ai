/**
 * /settings — one place for every setting. Personal sections belong to the user;
 * company sections belong to the active organization and need a permission
 * (the registry decides; the database enforces). Phase 2A pages are reused as sections.
 */
import { useEffect, useState } from 'react';
import { Link, useRouter } from '../core/router/router.jsx';
import { useOrg } from '../core/org/OrgProvider.jsx';
import { useAuth } from '../core/auth/AuthProvider.jsx';
import { useProfile } from '../core/profile/ProfileProvider.jsx';
import { useColorMode } from '../core/ui/mode.js';
import { useRail } from '../core/ui/rail.js';
import { account, NOTIFICATION_TYPES } from '../core/data/account.js';
import { errorText, t, tRole } from '../core/i18n/index.js';
import { NavIcon } from '../core/ui/icons.jsx';
import { visibleItems } from '../core/navigation/registry.js';
import { ROLES } from '../../shared/permissions.js';
import { Card, Notice, Toggle } from '../core/ui/components.jsx';
import { LanguageSelect } from './ProfilePage.jsx';
import OrganizationPage from './org/OrganizationPage.jsx';
import TeamPage from './org/TeamPage.jsx';
import PlanPage from './org/PlanPage.jsx';
import AuditPage from './org/AuditPage.jsx';
import SystemPage from './SystemPage.jsx';

export const SETTINGS_SECTIONS = ['appearance', 'notifications', 'organization', 'team', 'security', 'plan', 'audit', 'integrations'];

function AppearanceSection() {
  const [mode, setMode] = useColorMode();
  const [rail, setRail] = useRail();
  const { setPreference, available } = useProfile();
  return (
    <Card title={t('settings.appearance')} pad>
      <div className="stack" style={{ gap: 16, maxWidth: 560 }}>
        <LanguageSelect id="st-locale" />
        <div className="field" style={{ maxWidth: 280 }}>
          <label htmlFor="st-mode">{t('settings.theme')}</label>
          <select id="st-mode" className="input" value={mode} onChange={(e) => { setMode(e.target.value); setPreference('theme', e.target.value); }}>
            <option value="light">{t('mode.light')}</option>
            <option value="dark">{t('mode.dark')}</option>
          </select>
        </div>
        <Toggle id="st-rail" checked={rail} label={t('settings.sidebar_expanded')}
          onChange={(v) => { setRail(v); setPreference('sidebar', v ? 'expanded' : 'collapsed'); }} />
        <p className="faint" style={{ fontSize: 12.5 }}>{available ? t('settings.synced') : t('settings.local_only')}</p>
      </div>
    </Card>
  );
}

function NotificationSettingsSection() {
  const { orgId, org } = useOrg();
  const { user } = useAuth();
  const [off, setOff] = useState(null);   // Set of disabled types
  const [msg, setMsg] = useState(null);
  useEffect(() => {
    account.notificationPrefs(orgId)
      .then((rows) => setOff(new Set((rows ?? []).filter((r) => !r.enabled).map((r) => r.type))))
      .catch((e) => { setOff(new Set()); setMsg(errorText(e)); });
  }, [orgId]);
  const change = async (type, enabled) => {
    setMsg(null);
    try {
      await account.setNotificationEnabled(user.id, orgId, type, enabled);
      setOff((s) => { const n = new Set(s); if (enabled) n.delete(type); else n.add(type); return n; });
    } catch (e) { setMsg(errorText(e)); }
  };
  return (
    <Card title={t('settings.notifications')} sub={t('settings.notifications.sub', { org: org?.name ?? '' })} pad>
      <div className="stack" style={{ gap: 14 }}>
        {off === null ? <div className="faint">{t('common.loading')}</div> : NOTIFICATION_TYPES.map((type) => (
          <div key={type} className="status-row" style={{ padding: 0 }}>
            <span className="label">{t(`notif.type.${type}`)}<small>{t(`notif.type.${type}.hint`)}</small></span>
            <Toggle id={`np-${type}`} checked={!off.has(type)} onChange={(v) => change(type, v)} label={<span className="sr-only">{t(`notif.type.${type}`)}</span>} />
          </div>
        ))}
        <p className="faint" style={{ fontSize: 12.5 }}>{t('settings.notifications.note')}</p>
        {msg && <Notice tone="error">{msg}</Notice>}
      </div>
    </Card>
  );
}

function SecuritySection() {
  const { orgId, reload } = useOrg();
  const [roles, setRoles] = useState(null);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    account.orgDetails(orgId).then((o) => setRoles(new Set(o?.mfa_required_roles ?? []))).catch((e) => { setRoles(new Set()); setMsg({ tone: 'error', text: errorText(e) }); });
  }, [orgId]);
  const save = async (e) => {
    e.preventDefault(); setBusy(true); setMsg(null);
    try {
      await account.setSecurityPolicy(orgId, [...roles]);
      await reload();
      setMsg({ tone: 'warn', text: t('common.saved') });
    } catch (err) { setMsg({ tone: 'error', text: errorText(err) }); } finally { setBusy(false); }
  };
  return (
    <Card title={t('settings.security')} sub={t('settings.security.sub')} pad>
      {roles === null ? <div className="faint">{t('common.loading')}</div> : (
        <form className="stack" onSubmit={save} style={{ gap: 14, maxWidth: 560 }}>
          <p className="muted">{t('settings.security.body')}</p>
          {ROLES.map((r) => (
            <Toggle key={r.key} id={`mfa-role-${r.key}`} checked={roles.has(r.key)} label={tRole(r.key)}
              onChange={(v) => setRoles((s) => { const n = new Set(s); if (v) n.add(r.key); else n.delete(r.key); return n; })} />
          ))}
          <Notice>{t('settings.security.warning')}</Notice>
          {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
          <div><button className="btn btn-primary" type="submit" disabled={busy}>{t('common.save')}</button></div>
        </form>
      )}
    </Card>
  );
}

const SECTION_COMPONENTS = {
  appearance: AppearanceSection,
  notifications: NotificationSettingsSection,
  organization: OrganizationPage,
  team: TeamPage,
  security: SecuritySection,
  plan: PlanPage,
  audit: AuditPage,
  integrations: SystemPage,
};

export default function SettingsPage({ section = 'appearance' }) {
  const access = useOrg();
  const { pathname } = useRouter();
  const items = visibleItems(access, 'settings');
  const Section = SECTION_COMPONENTS[section] ?? AppearanceSection;
  const groups = [['personal', t('settings.group.personal')], ['org', t('settings.group.org')]];
  const current = pathname === '/settings' ? '/settings/appearance' : pathname;
  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">{t('nav.settings')}</div>
          <h1>{t('settings.title')}</h1>
          <p>{t('settings.subtitle')}</p>
        </div>
      </div>
      <div className="settings-layout">
        <nav className="card settings-nav" aria-label={t('nav.settings')}>
          {groups.map(([g, label]) => (
            <div key={g} className="settings-nav-group">
              <div className="settings-nav-label">{label}</div>
              {items.filter((i) => i.group === g).map((i) => (
                <Link key={i.key} to={i.path} className="settings-nav-item" aria-current={current === i.path ? 'page' : undefined}>
                  <NavIcon icon={i.icon} aria-hidden /> {t(i.labelKey)}
                </Link>
              ))}
            </div>
          ))}
        </nav>
        <div className="settings-body"><Section /></div>
      </div>
    </>
  );
}
