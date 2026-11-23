/**
 * Match "/m/:moduleKey" against "/m/wholesale" → { moduleKey: 'wholesale' }.
 * Returns null when it doesn't match.
 */
export function matchPath(pattern, pathname) {
  const clean = (p) => p.replace(/\/+$/, '') || '/';
  const pp = clean(pattern).split('/');
  const sp = clean(pathname).split('/');
  if (pp.length !== sp.length) return null;
  const params = {};
  for (let i = 0; i < pp.length; i += 1) {
    if (pp[i].startsWith(':')) {
      if (!sp[i]) return null;
      params[pp[i].slice(1)] = decodeURIComponent(sp[i]);
    } else if (pp[i] !== sp[i]) {
      return null;
    }
  }
  return params;
}
