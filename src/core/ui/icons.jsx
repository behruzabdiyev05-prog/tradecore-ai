import {
  LuSearch, LuBoxes, LuStore, LuArrowLeftRight, LuShip, LuHandshake, LuRecycle,
  LuMonitorSmartphone, LuTarget, LuChartCandlestick, LuLayoutDashboard, LuWallet, LuServer,
  LuBell, LuUser, LuSettings, LuPalette, LuBuilding2, LuUsers, LuShieldCheck, LuBadgeCheck, LuScrollText,
} from 'react-icons/lu';

/** Icon ids used in shared/modules.js → components. */
export const MODULE_ICONS = {
  search: LuSearch,
  boxes: LuBoxes,
  store: LuStore,
  arrows: LuArrowLeftRight,
  ship: LuShip,
  handshake: LuHandshake,
  recycle: LuRecycle,
  digital: LuMonitorSmartphone,
  target: LuTarget,
  chart: LuChartCandlestick,
};

export const NAV_ICONS = { dashboard: LuLayoutDashboard, finance: LuWallet, system: LuServer };

/** Icon ids used in the navigation registry (src/core/navigation/registry.js). */
export const REGISTRY_ICONS = {
  ...MODULE_ICONS,
  dashboard: LuLayoutDashboard, finance: LuWallet, server: LuServer, bell: LuBell, user: LuUser, settings: LuSettings,
  palette: LuPalette, building: LuBuilding2, users: LuUsers, shield: LuShieldCheck, badge: LuBadgeCheck, scroll: LuScrollText,
};

export function ModuleIcon({ icon, ...props }) {
  const Cmp = MODULE_ICONS[icon] ?? LuBoxes;
  return <Cmp {...props} />;
}

export function NavIcon({ icon, ...props }) {
  const Cmp = REGISTRY_ICONS[icon] ?? LuBoxes;
  return <Cmp {...props} />;
}
