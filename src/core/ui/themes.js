/**
 * Section themes: every section keeps the same glass UI, but has its own
 * background scene and accent colour. Scenes are original artwork generated
 * by scripts/generate-backgrounds.py (public/backgrounds/*.jpg).
 */
export const SCENES = ['aurora', 'ocean', 'mountains', 'forest', 'city', 'desert', 'nebula'];

/** accent = main colour, accent2 = gradient end, ink = text on accent */
export const THEMES = {
  dashboard: { scene: 'aurora', accent: '#3ee0c5', accent2: '#7c6cff', ink: '#04201b', name: 'Aurora' },
  finance: { scene: 'forest', accent: '#4ade80', accent2: '#14b8a6', ink: '#052014', name: 'Meşə' },
  system: { scene: 'ocean', accent: '#60a5fa', accent2: '#22d3ee', ink: '#04162b', name: 'Okean' },
  'product-research': { scene: 'nebula', accent: '#a78bfa', accent2: '#f472b6', ink: '#160a2e', name: 'Dumanlıq' },
  wholesale: { scene: 'desert', accent: '#fbbf24', accent2: '#fb7185', ink: '#2a1603', name: 'Səhra' },
  marketplace: { scene: 'city', accent: '#f472b6', accent2: '#818cf8', ink: '#2a0618', name: 'Şəhər' },
  arbitrage: { scene: 'ocean', accent: '#38bdf8', accent2: '#818cf8', ink: '#03182a', name: 'Okean' },
  'import-export': { scene: 'mountains', accent: '#fb923c', accent2: '#f472b6', ink: '#2a1004', name: 'Dağlar' },
  'b2b-trading': { scene: 'aurora', accent: '#2dd4bf', accent2: '#60a5fa', ink: '#03201c', name: 'Aurora' },
  'used-goods': { scene: 'forest', accent: '#a3e635', accent2: '#34d399', ink: '#152003', name: 'Meşə' },
  'digital-products': { scene: 'city', accent: '#818cf8', accent2: '#22d3ee', ink: '#0d0a2e', name: 'Şəhər' },
  'b2b-client-finder': { scene: 'mountains', accent: '#f9a8d4', accent2: '#c084fc', ink: '#2a0a1e', name: 'Dağlar' },
  'financial-trading': { scene: 'nebula', accent: '#facc15', accent2: '#a78bfa', ink: '#241c02', name: 'Dumanlıq' },
  auth: { scene: 'aurora', accent: '#3ee0c5', accent2: '#7c6cff', ink: '#04201b', name: 'Aurora' },
};

export function getTheme(sectionKey) {
  return THEMES[sectionKey] ?? THEMES.dashboard;
}

/** Section key for a pathname: '/', '/finance', '/system', '/m/<module>'. */
export function sectionForPath(pathname) {
  if (pathname.startsWith('/m/')) return decodeURIComponent(pathname.slice(3).split('/')[0]);
  if (pathname.startsWith('/finance')) return 'finance';
  if (pathname.startsWith('/system')) return 'system';
  return 'dashboard';
}

/** CSS custom properties for a theme (applied on the shell root). */
export function themeVars(theme) {
  return {
    '--accent': theme.accent,
    '--accent-2': theme.accent2,
    '--on-accent': theme.ink,
  };
}
