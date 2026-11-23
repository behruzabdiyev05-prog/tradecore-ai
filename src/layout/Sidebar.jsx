import { LuChartNoAxesCombined, LuPanelLeftClose, LuPanelLeftOpen } from 'react-icons/lu';
import { Link } from '../core/router/router.jsx';
import { NavIcon } from '../core/ui/icons.jsx';
import { config } from '../core/config/env.js';
import { useOrg } from '../core/org/OrgProvider.jsx';
import { t, tModule } from '../core/i18n/index.js';
import { visibleItems } from '../core/navigation/registry.js';

export function moduleHref(key) {
  return `/m/${key}`;
}

export function Brand() {
  return (
    <div className="brand">
      <div className="brand-mark"><LuChartNoAxesCombined aria-hidden /></div>
      <div className="brand-name">TRADECORE <span>AI</span></div>
    </div>
  );
}

function NavItem({ to, label, icon, code }) {
  return (
    <Link to={to} className="nav-item" data-label={code ? `${code} · ${label}` : label} aria-label={label}>
      {code && <span className="nav-code">{code}</span>}
      <NavIcon icon={icon} className="nav-icon" aria-hidden />
      <span className="nav-text">{label}</span>
    </Link>
  );
}

/** Label of a registry item (modules: short name, as in Phase 1). */
const itemLabel = (i) => (i.module ? tModule(i.module, 'shortName') : t(i.labelKey));

export default function Sidebar({ open, expanded, onToggle, onNavigate }) {
  const access = useOrg();
  const group = (section) => visibleItems(access, section).map((i) => (
    <NavItem key={i.key} to={i.path} label={itemLabel(i)} icon={i.icon} code={i.code} />
  ));
  // order of the "Sistem" group as in Phase 2A, settings centre added at the end
  const system = visibleItems(access, 'system');
  const sysOrder = ['team', 'organization', 'audit', 'plan', 'system', 'settings'];
  system.sort((a, b) => sysOrder.indexOf(a.key) - sysOrder.indexOf(b.key));
  const toggleLabel = expanded ? t('nav.rail.collapse') : t('nav.rail.expand');
  return (
    <aside className={`sidebar ${open ? 'open' : ''}`} aria-label={t('nav.main')}>
      <Brand />
      <nav className="nav" onClick={(e) => e.target.closest('a') && onNavigate?.()}>
        {group('work')}

        <div className="nav-label">{t('nav.modules')}</div>
        {group('modules')}

        <div className="nav-label">{t('nav.system.group')}</div>
        {system.map((i) => <NavItem key={i.key} to={i.path} label={t(i.labelKey)} icon={i.icon} />)}
      </nav>
      <div className="sidebar-foot">
        <button type="button" className="nav-item rail-toggle btn-ghost" style={{ border: 0, background: 'none', cursor: 'pointer' }}
          onClick={onToggle} aria-label={toggleLabel} data-label={toggleLabel} aria-expanded={expanded}>
          {expanded ? <LuPanelLeftClose className="nav-icon" /> : <LuPanelLeftOpen className="nav-icon" />}
          <span className="nav-text">{t('nav.rail.collapse')}</span>
        </button>
        <div className="sidebar-version">v{config.appVersion} · {config.phase}</div>
      </div>
    </aside>
  );
}
