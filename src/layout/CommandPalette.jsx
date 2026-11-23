/**
 * Command palette / global search (Ctrl+K). Replaces the Phase 1 module jump and keeps
 * its behaviour: pages and modules (from the navigation registry, filtered by the role)
 * appear instantly; records of the ACTIVE organization come from global_search()
 * (250 ms debounce; an older answer never replaces a newer one).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { LuSearch } from 'react-icons/lu';
import { useRouter } from '../core/router/router.jsx';
import { useOrg } from '../core/org/OrgProvider.jsx';
import { useAuth } from '../core/auth/AuthProvider.jsx';
import { t, tModule } from '../core/i18n/index.js';
import { NAV_ITEMS, canAccess } from '../core/navigation/registry.js';
import { azFold, recentPages, recentSearches } from '../core/navigation/recent.js';
import { account } from '../core/data/account.js';

const KIND_GROUP = { company: 'search.group.company', product: 'search.group.product', saved_item: 'search.group.saved_item',
  member: 'search.group.member', notification: 'search.group.notification' };

/** Display label of a registry item. */
export function navLabel(item) {
  return item.module ? tModule(item.module, 'name') : t(item.labelKey);
}

/** Pages and modules matching the query (same folding as the database search). */
export function searchPages(query, access) {
  const q = azFold(query.trim());
  if (!q) return [];
  return NAV_ITEMS.filter((i) => !i.hidden && !i.alias && canAccess(i, access)).filter((i) => {
    const hay = i.module
      ? `${i.code} ${tModule(i.module, 'name')} ${tModule(i.module, 'shortName')} ${tModule(i.module, 'summary')}`
      : `${t(i.labelKey)} ${i.path}`;
    return azFold(hay).includes(q);
  }).map((i) => ({ kind: i.module ? 'module' : 'page', id: i.key, title: navLabel(i), subtitle: i.code ?? '', to: i.path }));
}

/** Internal addresses only: "/path…", never "//host", a scheme or a backslash (same rule as the database). */
export const INTERNAL_LINK = /^\/(?!\/)[A-Za-z0-9/_?=&.%#-]*$/;

/** Where a database search result opens. */
export function resultHref(r) {
  if (r.link === '/search') return `/search?q=${encodeURIComponent(r.title)}`;
  return INTERNAL_LINK.test(r.link ?? '') ? r.link : '/';
}

export default function CommandPalette() {
  const { navigate } = useRouter();
  const access = useOrg();
  const { orgId } = access;
  const { user } = useAuth();
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const [focused, setFocused] = useState(false);
  const [remote, setRemote] = useState({ q: '', items: [], loading: false });
  const blurTimer = useRef();
  const inputRef = useRef(null);
  const seq = useRef(0);

  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // database search, debounced; stale answers are ignored
  useEffect(() => {
    const query = q.trim();
    const my = ++seq.current;
    if (query.length < 2 || !orgId) { setRemote({ q: query, items: [], loading: false }); return undefined; }
    setRemote((r) => ({ ...r, loading: true }));
    const timer = setTimeout(() => {
      account.search(orgId, query, 20)
        .then((items) => { if (seq.current === my) setRemote({ q: query, items: items ?? [], loading: false }); })
        .catch(() => { if (seq.current === my) setRemote({ q: query, items: [], loading: false }); });
    }, 250);
    return () => clearTimeout(timer);
  }, [q, orgId]);

  const pages = useMemo(() => searchPages(q, access).slice(0, 6), [q, access]);

  const groups = useMemo(() => {
    const query = q.trim();
    if (!query) {
      const recent = recentPages.list(user.id, orgId)
        .map((p) => NAV_ITEMS.find((i) => i.path === p)).filter((i) => i && canAccess(i, access))
        .map((i) => ({ kind: 'page', id: `r:${i.key}`, title: navLabel(i), subtitle: i.code ?? '', to: i.path }));
      const searches = recentSearches.list(user.id, orgId).map((s) => ({ kind: 'recent_search', id: `q:${s}`, title: s, query: s }));
      return [
        recent.length ? { key: 'recent', label: t('search.recent_pages'), items: recent } : null,
        searches.length ? { key: 'recentq', label: t('search.recent_searches'), items: searches } : null,
      ].filter(Boolean);
    }
    const out = [];
    if (pages.length) out.push({ key: 'pages', label: t('search.group.pages'), items: pages });
    const byKind = {};
    for (const r of remote.q === query ? remote.items : []) {
      const subtitle = r.kind === 'saved_item' ? tModule(r.subtitle, 'shortName') : r.kind === 'notification' ? '' : r.subtitle;
      (byKind[r.kind] ??= []).push({ ...r, subtitle, to: resultHref(r) });
    }
    for (const kind of Object.keys(KIND_GROUP)) if (byKind[kind]) out.push({ key: kind, label: t(KIND_GROUP[kind]), items: byKind[kind].slice(0, 5) });
    if (query.length >= 2) out.push({ key: 'all', label: '', items: [{ kind: 'all', id: 'all', title: t('search.all_results', { q: query }), to: `/search?q=${encodeURIComponent(query)}` }] });
    return out;
  }, [q, pages, remote, access, orgId, user.id]);

  const flat = groups.flatMap((g) => g.items);
  const go = (item) => {
    if (!item) return;
    if (item.kind === 'recent_search') { setQ(item.query); setActive(0); return; }
    if (q.trim().length >= 2 && item.kind !== 'page' && item.kind !== 'module') recentSearches.add(user.id, orgId, q.trim());
    navigate(item.to);
    setQ('');
    inputRef.current?.blur();
  };

  return (
    <div className="module-jump">
      <LuSearch className="module-jump-icon" aria-hidden />
      <input
        ref={inputRef}
        className="input"
        placeholder={t('search.placeholder')}
        aria-label={t('search.label')}
        role="combobox"
        aria-expanded={focused && flat.length > 0}
        aria-controls="palette-list"
        value={q}
        onChange={(e) => { setQ(e.target.value); setActive(0); }}
        onFocus={() => { clearTimeout(blurTimer.current); setFocused(true); }}
        onBlur={() => { blurTimer.current = setTimeout(() => setFocused(false), 120); }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, flat.length - 1)); }
          if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
          if (e.key === 'Enter' && flat[active]) go(flat[active]);
          if (e.key === 'Escape') { setQ(''); inputRef.current?.blur(); }
        }}
      />
      <span className="kbd" aria-hidden>Ctrl K</span>
      {focused && flat.length > 0 && (
        <div className="module-jump-list palette-list" role="listbox" id="palette-list">
          {groups.map((g) => (
            <div key={g.key} className="palette-group" role="group" aria-label={g.label || undefined}>
              {g.label && <div className="palette-group-label">{g.label}</div>}
              {g.items.map((item) => {
                const i = flat.indexOf(item);
                return (
                  <button key={`${g.key}:${item.id}`} type="button" role="option" aria-selected={i === active}
                    data-active={i === active} data-kind={item.kind} onMouseDown={(e) => e.preventDefault()} onClick={() => go(item)}>
                    {item.kind === 'module' && <span className="nav-code">{item.subtitle}</span>}
                    <span className="palette-title">{item.title}</span>
                    {item.kind !== 'module' && item.subtitle && <span className="faint palette-sub">{item.subtitle}</span>}
                  </button>
                );
              })}
            </div>
          ))}
          {remote.loading && <div className="palette-group-label faint">{t('search.loading')}</div>}
        </div>
      )}
    </div>
  );
}

