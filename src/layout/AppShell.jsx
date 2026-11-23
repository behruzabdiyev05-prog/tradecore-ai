import { useEffect, useState } from 'react';
import { LuSparkles } from 'react-icons/lu';
import Sidebar from './Sidebar.jsx';
import Topbar from './Topbar.jsx';
import AresPanel from './AresPanel.jsx';
import Shortcuts from './Shortcuts.jsx';
import { useAres } from '../core/ares/AresProvider.jsx';
import { useRouter } from '../core/router/router.jsx';
import { useAuth } from '../core/auth/AuthProvider.jsx';
import { useOrg } from '../core/org/OrgProvider.jsx';
import { useProfile } from '../core/profile/ProfileProvider.jsx';
import { useRail } from '../core/ui/rail.js';
import { itemForPath } from '../core/navigation/registry.js';
import { recentPages } from '../core/navigation/recent.js';

export default function AppShell({ title, children }) {
  const [navOpen, setNavOpen] = useState(false); // mobile drawer
  const [railExpanded, setRailExpanded] = useRail(); // desktop rail (browser + profile)
  const { open: aresOpen, setOpen: setAresOpen, openAres } = useAres();
  const { pathname } = useRouter();
  const { user } = useAuth();
  const { orgId } = useOrg();
  const { setPreference } = useProfile();

  useEffect(() => setNavOpen(false), [pathname]);
  useEffect(() => {
    document.title = title ? `${title} · TRADECORE AI` : 'TRADECORE AI';
  }, [title]);
  // "recently viewed": registry pages only, per user + organization
  useEffect(() => {
    const item = itemForPath(pathname);
    if (item && !item.hidden && user && orgId) recentPages.add(user.id, orgId, item.path);
  }, [pathname, user, orgId]);

  const toggleRail = () => {
    const next = !railExpanded;
    setRailExpanded(next);
    setPreference('sidebar', next ? 'expanded' : 'collapsed');
  };

  const cls = ['shell', railExpanded ? 'rail-open' : 'rail-collapsed', aresOpen ? 'ares-docked' : ''].join(' ');

  return (
    <div className={cls}>
      <Sidebar open={navOpen} expanded={railExpanded} onToggle={toggleRail} onNavigate={() => setNavOpen(false)} />
      <div className={`backdrop ${navOpen ? 'nav-open' : ''}`} onClick={() => setNavOpen(false)} />
      <div className="main">
        <Topbar title={title} onMenu={() => setNavOpen(true)} />
        <main className="content" id="main">{children}</main>
      </div>
      {aresOpen && (
        <>
          <div className="backdrop ares-open" onClick={() => setAresOpen(false)} />
          <AresPanel />
        </>
      )}
      {!aresOpen && (
        <button className="btn btn-primary ares-fab" onClick={() => openAres(null)}><LuSparkles /> ARES</button>
      )}
      <Shortcuts />
    </div>
  );
}
