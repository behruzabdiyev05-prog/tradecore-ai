import { Component, Suspense, useCallback, useEffect, useState } from 'react';
import { isSupabaseConfigured } from './core/config/env.js';
import { AuthProvider, useAuth } from './core/auth/AuthProvider.jsx';
import { AresProvider } from './core/ares/AresProvider.jsx';
import { RouterProvider, matchPath, useRouter, Link } from './core/router/router.jsx';
import { EmptyState, Forbidden, Notice, Spinner } from './core/ui/components.jsx';
import { OrgProvider, useOrg } from './core/org/OrgProvider.jsx';
import { ProfileProvider } from './core/profile/ProfileProvider.jsx';
import { NotificationsProvider } from './core/notifications/NotificationsProvider.jsx';
import { pendingInvite } from './core/data/tenancy.js';
import { account } from './core/data/account.js';
import { t, tModule, useLocale } from './core/i18n/index.js';
import { canAccess, itemForPath } from './core/navigation/registry.js';
import Scene from './core/ui/Scene.jsx';
import { sectionForPath } from './core/ui/themes.js';
import { getModule } from '../shared/modules.js';
import { getModuleComponent } from './modules/index.js';
import AppShell from './layout/AppShell.jsx';
import { navLabel } from './layout/CommandPalette.jsx';
import LoginPage from './pages/LoginPage.jsx';
import DashboardPage from './pages/DashboardPage.jsx';
import FinancePage from './pages/FinancePage.jsx';
import SystemPage from './pages/SystemPage.jsx';
import SetupRequiredPage from './pages/SetupRequiredPage.jsx';
import ProfilePage from './pages/ProfilePage.jsx';
import SettingsPage, { SETTINGS_SECTIONS } from './pages/SettingsPage.jsx';
import NotificationsPage from './pages/NotificationsPage.jsx';
import SearchPage from './pages/SearchPage.jsx';
import { MfaChallengePage, MfaRequiredPage } from './pages/MfaPages.jsx';
import TeamPage from './pages/org/TeamPage.jsx';
import OrganizationPage from './pages/org/OrganizationPage.jsx';
import AuditPage from './pages/org/AuditPage.jsx';
import PlanPage from './pages/org/PlanPage.jsx';
import InvitePage from './pages/org/InvitePage.jsx';
import NoOrgPage from './pages/org/NoOrgPage.jsx';

/** Isolates module crashes so one department cannot take down the platform. */
class ModuleBoundary extends Component {
  state = { error: null };
  static getDerivedStateFromError(error) { return { error }; }
  componentDidUpdate(prev) { if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null }); }
  render() {
    if (this.state.error) return <Notice tone="error">{t('app.section_error')}: {String(this.state.error.message)}</Notice>;
    return this.props.children;
  }
}

const PAGES = {
  dashboard: () => <DashboardPage />,
  finance: () => <FinancePage />,
  system: () => <SystemPage />,
  team: () => <TeamPage />,
  organization: () => <OrganizationPage />,
  audit: () => <AuditPage />,
  plan: () => <PlanPage />,
  profile: () => <ProfilePage />,
  notifications: () => <NotificationsPage />,
  search: () => <SearchPage />,
  settings: () => <SettingsPage section={SETTINGS_SECTIONS[0]} />,
};

function notFound() {
  return {
    title: t('app.not_found.short'),
    element: (
      <EmptyState title={t('app.not_found.title')} action={<Link to="/" className="btn">{t('common.back_dashboard')}</Link>}>
        {t('app.not_found.body')}
      </EmptyState>
    ),
  };
}

/**
 * Route table → { title, element }. Access comes from the navigation registry:
 * a page the role may not open renders <Forbidden/> and loads no data (scenarios 23, 43).
 */
export function resolveRoute(pathname, access = { can: () => true, canModule: () => true, isOwner: true }) {
  const item = itemForPath(pathname);
  if (item) {
    if (!canAccess(item, access)) return { title: t('forbidden.title'), element: <Forbidden /> };
    if (item.module) {
      const mod = getModule(item.module);
      const ModuleComponent = getModuleComponent(item.module);
      return { title: `${mod.code} · ${tModule(mod, 'name')}`, element: <ModuleComponent />, key: mod.key };
    }
    if (item.parent === 'settings') {
      return { title: navLabel(item), element: <SettingsPage section={item.key.replace('settings.', '')} /> };
    }
    const page = PAGES[item.key];
    if (page) return { title: navLabel(item), element: page() };
  }
  // unknown addresses (also /m/<unknown>, /settings/<unknown>) are 404 — never a blank page
  return notFound();
}

function AuthedApp() {
  const { pathname } = useRouter();
  const access = useOrg();
  const { orgId, mfaRequired } = access;
  let route = resolveRoute(pathname, access);
  // Organization requires 2FA for this role and the session has none: only the profile stays open
  if (mfaRequired && pathname !== '/profile') route = { title: t('mfa.required.title'), element: <MfaRequiredPage /> };
  // key={orgId}: switching organization remounts everything, so no data of the
  // previous organization can stay on screen (scenarios 22, 44).
  return (
    <AresProvider key={orgId}>
      <NotificationsProvider>
        <AppShell title={route.title}>
          <ModuleBoundary resetKey={pathname}>
            <Suspense fallback={<div className="faint">{t('app.module_loading')}</div>}>{route.element}</Suspense>
          </ModuleBoundary>
        </AppShell>
      </NotificationsProvider>
    </AresProvider>
  );
}

/** Organization-level gate: pending invite → no organization → the app. */
function OrgGate() {
  const { loading, orgs, switching } = useOrg();
  if (pendingInvite.get()) return <InvitePage />;
  if (loading && orgs.length === 0) return <Spinner label={t('org.loading')} />;
  if (switching) return <Spinner label={t('org.switching')} />;
  if (orgs.length === 0) return <NoOrgPage />;
  return <AuthedApp />;
}

/** Second sign-in step: a user with 2FA must enter the code before anything else (aal1 → aal2). */
function useNeedsMfaCode(userId) {
  const [state, setState] = useState({ checked: false, needed: false });
  const check = useCallback(async () => {
    try {
      const { currentLevel, nextLevel } = await account.mfaLevel();
      setState({ checked: true, needed: currentLevel === 'aal1' && nextLevel === 'aal2' });
    } catch {
      setState({ checked: true, needed: false });
    }
  }, []);
  // per signed-in user (a token refresh does not change the assurance level)
  useEffect(() => {
    setState({ checked: false, needed: false });
    if (userId) check();
  }, [userId, check]);
  return [state, check];
}

function Gate() {
  const { user, loading } = useAuth();
  const { pathname, navigate } = useRouter();
  const invite = matchPath('/invite/:token', pathname);
  const [mfa, recheckMfa] = useNeedsMfaCode(user?.id);

  // /invite/<token>: remember the token for this tab, then leave the URL (token not kept in history)
  useEffect(() => {
    if (invite?.token) {
      pendingInvite.set(invite.token);
      navigate('/', { replace: true });
    }
  }, [invite?.token, navigate]);

  const section = user ? sectionForPath(pathname) : 'auth';
  let body;
  if (loading || invite || (user && !mfa.checked)) body = <Spinner />;
  else if (!user) body = <LoginPage inviteToken={pendingInvite.get()} />;
  else if (mfa.needed) body = <MfaChallengePage onVerified={recheckMfa} />;
  else body = <OrgProvider key={user.id}><ProfileProvider><OrgGate /></ProfileProvider></OrgProvider>;
  return (
    <>
      <Scene section={section} />
      {body}
    </>
  );
}

export default function App() {
  const locale = useLocale();
  if (!isSupabaseConfigured) return <><Scene section="auth" /><SetupRequiredPage /></>;
  // key={locale}: a language change re-renders every screen in the new language
  return (
    <RouterProvider key={locale}>
      <AuthProvider>
        <Gate />
      </AuthProvider>
    </RouterProvider>
  );
}
