/**
 * Navigation registry (Phase 2B): ONE list of every page. The sidebar, mobile menu,
 * command palette, breadcrumb, "+ New" menu and the route guard all read it, so a
 * page hidden from the menu can never be opened by typing its address (scenario 43).
 *
 * `access` is { can(permission), canModule(key), isOwner }. Items without a
 * requirement are open to every active member. UI hiding is convenience only:
 * RLS and the server checks are the real gate.
 */
import { MODULES } from '../../../shared/modules.js';
import { matchPath } from '../router/matchPath.js';

/** @typedef {{ key:string, path:string, labelKey:string, icon:string, section:string,
 *              permission?:string, module?:string, ownerOnly?:boolean, parent?:string,
 *              keywords?:string, code?:string, hidden?:boolean }} NavItem */

/** @type {ReadonlyArray<NavItem>} */
export const NAV_ITEMS = Object.freeze([
  { key: 'dashboard', path: '/', labelKey: 'nav.dashboard', icon: 'dashboard', section: 'work' },
  { key: 'finance', path: '/finance', labelKey: 'nav.finance', icon: 'finance', section: 'work', permission: 'finance.read' },
  ...MODULES.map((m) => ({
    key: `module:${m.key}`, path: `/m/${m.key}`, labelKey: `mod.${m.key}.name`, icon: m.icon, section: 'modules',
    module: m.key, code: m.code,
  })),
  { key: 'notifications', path: '/notifications', labelKey: 'nav.notifications', icon: 'bell', section: 'account' },
  { key: 'profile', path: '/profile', labelKey: 'nav.profile', icon: 'user', section: 'account' },
  { key: 'search', path: '/search', labelKey: 'nav.search', icon: 'search', section: 'account', hidden: true },

  // Settings centre (sections). Phase 2A pages are reused as sections.
  { key: 'settings', path: '/settings', labelKey: 'nav.settings', icon: 'settings', section: 'system' },
  { key: 'settings.appearance', path: '/settings/appearance', labelKey: 'settings.appearance', icon: 'palette', section: 'settings', parent: 'settings', group: 'personal' },
  { key: 'settings.notifications', path: '/settings/notifications', labelKey: 'settings.notifications', icon: 'bell', section: 'settings', parent: 'settings', group: 'personal' },
  { key: 'settings.organization', path: '/settings/organization', labelKey: 'nav.organization', icon: 'building', section: 'settings', parent: 'settings', group: 'org', permission: 'org.manage' },
  { key: 'settings.team', path: '/settings/team', labelKey: 'nav.team', icon: 'users', section: 'settings', parent: 'settings', group: 'org', permission: 'members.read' },
  { key: 'settings.security', path: '/settings/security', labelKey: 'settings.security', icon: 'shield', section: 'settings', parent: 'settings', group: 'org', ownerOnly: true },
  { key: 'settings.plan', path: '/settings/plan', labelKey: 'nav.plan', icon: 'badge', section: 'settings', parent: 'settings', group: 'org' },
  { key: 'settings.audit', path: '/settings/audit', labelKey: 'nav.audit', icon: 'scroll', section: 'settings', parent: 'settings', group: 'org', permission: 'audit.read' },
  { key: 'settings.integrations', path: '/settings/integrations', labelKey: 'nav.system', icon: 'server', section: 'settings', parent: 'settings', group: 'org' },

  // Phase 2A addresses (kept working; still in the sidebar)
  { key: 'team', path: '/system/team', labelKey: 'nav.team', icon: 'users', section: 'system', permission: 'members.read', alias: 'settings.team' },
  { key: 'organization', path: '/system/organization', labelKey: 'nav.organization', icon: 'building', section: 'system', permission: 'org.manage', alias: 'settings.organization' },
  { key: 'audit', path: '/system/audit', labelKey: 'nav.audit', icon: 'scroll', section: 'system', permission: 'audit.read', alias: 'settings.audit' },
  { key: 'plan', path: '/system/plan', labelKey: 'nav.plan', icon: 'badge', section: 'system', alias: 'settings.plan' },
  { key: 'system', path: '/system', labelKey: 'nav.system', icon: 'server', section: 'system', alias: 'settings.integrations' },
]);

const BY_KEY = new Map(NAV_ITEMS.map((i) => [i.key, i]));
export const navItem = (key) => BY_KEY.get(key);

export const ALL_ACCESS = Object.freeze({ can: () => true, canModule: () => true, isOwner: true });

export function canAccess(item, access = ALL_ACCESS) {
  if (!item) return false;
  if (item.permission && !access.can(item.permission)) return false;
  if (item.module && !access.canModule(item.module)) return false;
  if (item.ownerOnly && !access.isOwner) return false;
  return true;
}

/** The registry item for a pathname (exact path match). */
export function itemForPath(pathname) {
  const clean = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  return NAV_ITEMS.find((i) => matchPath(i.path, clean)) ?? null;
}

/** Breadcrumb trail, e.g. Parametrlər › Bildirişlər. */
export function breadcrumb(pathname) {
  const item = itemForPath(pathname);
  if (!item) return [];
  const trail = [item];
  let p = item.parent ? navItem(item.parent) : null;
  while (p) { trail.unshift(p); p = p.parent ? navItem(p.parent) : null; }
  return trail;
}

export const visibleItems = (access, section) =>
  NAV_ITEMS.filter((i) => !i.hidden && (!section || i.section === section) && canAccess(i, access));

/** Keyboard shortcuts ("G then D" …) — also listed in the "?" dialog. */
export const SHORTCUTS = Object.freeze([
  { keys: ['Ctrl', 'K'], labelKey: 'shortcuts.palette' },
  { keys: ['G', 'D'], to: '/', labelKey: 'shortcuts.dashboard' },
  { keys: ['G', 'S'], to: '/settings', labelKey: 'shortcuts.settings' },
  { keys: ['G', 'N'], to: '/notifications', labelKey: 'shortcuts.notifications' },
  { keys: ['G', 'P'], to: '/profile', labelKey: 'shortcuts.profile' },
  { keys: ['?'], labelKey: 'shortcuts.help' },
]);
