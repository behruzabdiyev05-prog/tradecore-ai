/**
 * "Recently viewed" pages and recent searches — kept only in this browser and
 * separately per user AND organization, so switching company never mixes them
 * (scenario 44). Only registry paths are stored (no record data, no query text
 * of other organizations).
 */
const MAX_PAGES = 8;
const MAX_SEARCHES = 5;
const key = (kind, userId, orgId) => `tc.${kind}.${userId}.${orgId}`;

function read(k) {
  try {
    const v = JSON.parse(localStorage.getItem(k) || '[]');
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}
function push(k, value, max) {
  const list = [value, ...read(k).filter((x) => x !== value)].slice(0, max);
  try { localStorage.setItem(k, JSON.stringify(list)); } catch { /* storage unavailable */ }
  return list;
}

export const recentPages = {
  list: (userId, orgId) => read(key('recent', userId, orgId)),
  add: (userId, orgId, path) => push(key('recent', userId, orgId), path, MAX_PAGES),
};
export const recentSearches = {
  list: (userId, orgId) => read(key('recentq', userId, orgId)),
  add: (userId, orgId, q) => push(key('recentq', userId, orgId), q.slice(0, 100), MAX_SEARCHES),
};

/** Same folding as the database az_fold(): Azerbaijani letters → Latin, lower case. */
export function azFold(s) {
  const map = { Ə: 'e', ə: 'e', İ: 'i', ı: 'i', Ö: 'o', ö: 'o', Ü: 'u', ü: 'u', Ş: 's', ş: 's', Ç: 'c', ç: 'c', Ğ: 'g', ğ: 'g' };
  return String(s ?? '').replace(/[ƏəİıÖöÜüŞşÇçĞğ]/g, (c) => map[c]).toLowerCase();
}
