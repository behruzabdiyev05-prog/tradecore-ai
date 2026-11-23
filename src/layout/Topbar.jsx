import { useEffect, useRef, useState } from 'react';
import { LuChartNoAxesCombined, LuChevronDown, LuChevronRight, LuLogOut, LuMenu, LuMoon, LuSearch, LuSparkles, LuSun } from 'react-icons/lu';
import { useColorMode } from '../core/ui/mode.js';
import { useOrg } from '../core/org/OrgProvider.jsx';
import { formatDate, t, tMonth, tRole } from '../core/i18n/index.js';
import { BASE_CURRENCY } from '../../shared/finance.js';
import { Link, useRouter } from '../core/router/router.jsx';
import { useAuth } from '../core/auth/AuthProvider.jsx';
import { useAres } from '../core/ares/AresProvider.jsx';
import { useProfile } from '../core/profile/ProfileProvider.jsx';
import { breadcrumb } from '../core/navigation/registry.js';
import CommandPalette, { navLabel } from './CommandPalette.jsx';
import NotificationBell from './NotificationBell.jsx';
import NewMenu from './NewMenu.jsx';

/** Live local clock (real time, no data). */
function Clock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 20_000);
    return () => clearInterval(timer);
  }, []);
  return (
    <div className="pill clock-pill" aria-label={t('topbar.clock')} title={formatDate(now)}>
      <strong className="num">{String(now.getHours()).padStart(2, '0')}:{String(now.getMinutes()).padStart(2, '0')}</strong>
      <small>{now.getDate()} {tMonth(now.getMonth())} {now.getFullYear()}</small>
    </div>
  );
}

/** Active organization + switcher (replaces the static workspace pill). */
function OrgSwitcher() {
  const { org, role, orgs, switchOrg } = useOrg();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    const close = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);
  return (
    <div className="org-switcher" ref={ref}>
      <button type="button" className="pill workspace-pill" aria-haspopup="listbox" aria-expanded={open}
        aria-label={`${t('org.switcher.label')}: ${org?.name ?? ''}`} onClick={() => setOpen((v) => !v)}>
        <span className="ws-mark"><LuChartNoAxesCombined aria-hidden /></span>
        <span className="ws-text"><strong className="org-name">{org?.name ?? 'TRADECORE AI'}</strong><small>{role ? tRole(role.key, role.name) : ''}</small></span>
        <LuChevronDown className="faint" aria-hidden />
      </button>
      {open && (
        <div className="module-jump-list org-menu" role="listbox" aria-label={t('org.switcher.switch')}>
          {orgs.map((o) => (
            <button key={o.org_id} type="button" role="option" aria-selected={o.org_id === org?.org_id}
              data-active={o.org_id === org?.org_id}
              onClick={() => { setOpen(false); if (o.org_id !== org?.org_id) switchOrg(o.org_id); }}>
              <span style={{ flex: 1 }}>{o.name}</span><span className="faint">{tRole(o.role_key, o.role_name)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ModeToggle() {
  const [mode, setMode] = useColorMode();
  const { setPreference } = useProfile();
  const next = mode === 'light' ? 'dark' : 'light';
  return (
    <button className="btn btn-icon mode-toggle" onClick={() => { setMode(next); setPreference('theme', next); }}
      aria-label={next === 'dark' ? t('mode.to_dark') : t('mode.to_light')} title={next === 'dark' ? t('mode.dark') : t('mode.light')}>
      {mode === 'light' ? <LuMoon /> : <LuSun />}
    </button>
  );
}

/** Where am I: "Parametrlər › Bildirişlər" (from the navigation registry). */
function Breadcrumb({ title }) {
  const { pathname } = useRouter();
  const trail = breadcrumb(pathname);
  if (trail.length < 2) {
    return <div className="crumb"><LuChevronRight className="faint" aria-hidden /><span className="topbar-title">{title}</span></div>;
  }
  return (
    <nav className="crumb" aria-label={t('topbar.breadcrumb')}>
      {trail.map((item, i) => (
        <span key={item.key} className="crumb-part">
          <LuChevronRight className="faint" aria-hidden />
          {i < trail.length - 1
            ? <Link to={item.path} className="crumb-link">{navLabel(item)}</Link>
            : <span className="topbar-title" aria-current="page">{navLabel(item)}</span>}
        </span>
      ))}
    </nav>
  );
}

export default function Topbar({ title, onMenu }) {
  const { user, signOut } = useAuth();
  const { open, setOpen, openAres } = useAres();
  const { profile, avatarUrl } = useProfile();
  const email = user?.email ?? '';
  const name = profile?.full_name || user?.user_metadata?.full_name || email || '?';
  const initials = name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();

  return (
    <header className="topbar">
      <button className="btn btn-icon menu-btn" onClick={onMenu} aria-label={t('topbar.menu')}><LuMenu /></button>
      <OrgSwitcher />
      <Breadcrumb title={title} />
      <div className="topbar-spacer" />
      <CommandPalette />
      <Link to="/search" className="btn btn-icon mobile-search" aria-label={t('nav.search')}><LuSearch /></Link>
      <div className="topbar-spacer" />
      <NewMenu />
      <button className="btn btn-primary btn-lg ares-toggle" onClick={() => (open ? setOpen(false) : openAres(null))} aria-pressed={open}>
        <LuSparkles /> ARES
      </button>
      <Clock />
      <ModeToggle />
      <NotificationBell />
      <span className="pill currency-pill" title={t('topbar.base_currency')}>{BASE_CURRENCY}</span>
      <Link to="/profile" className="user-chip" title={email} aria-label={t('nav.profile')}>
        <span className="sr-only email">{email}</span>
        {avatarUrl ? <img className="avatar avatar-img" src={avatarUrl} alt="" /> : <span className="avatar" aria-hidden>{initials}</span>}
      </Link>
      <button className="btn btn-icon" onClick={signOut} aria-label={t('auth.signout')} title={t('auth.signout')}><LuLogOut /></button>
    </header>
  );
}
