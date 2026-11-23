/**
 * /search?q=… — all results of the global search in the active organization
 * (pages and modules + records the role may see).
 */
import { useEffect, useMemo, useState } from 'react';
import { useOrg } from '../core/org/OrgProvider.jsx';
import { useRouter, Link } from '../core/router/router.jsx';
import { account } from '../core/data/account.js';
import { errorText, t, tModule } from '../core/i18n/index.js';
import { Card, EmptyState, Notice } from '../core/ui/components.jsx';
import { resultHref, searchPages } from '../layout/CommandPalette.jsx';

const KINDS = ['company', 'product', 'saved_item', 'member', 'notification'];

export default function SearchPage() {
  const access = useOrg();
  const { pathname } = useRouter();
  const initial = useMemo(() => new URLSearchParams(window.location.search).get('q') ?? '', [pathname]);   // eslint-disable-line react-hooks/exhaustive-deps
  const [q, setQ] = useState(initial);
  const [state, setState] = useState({ loading: false, rows: [] });

  useEffect(() => setQ(initial), [initial]);
  useEffect(() => {
    const query = q.trim();
    if (query.length < 2) { setState({ loading: false, rows: [] }); return undefined; }
    let alive = true;
    setState((s) => ({ ...s, loading: true }));
    const timer = setTimeout(() => {
      account.search(access.orgId, query, 50)
        .then((rows) => alive && setState({ loading: false, rows: rows ?? [] }))
        .catch((e) => alive && setState({ loading: false, rows: [], error: errorText(e) }));
      try { window.history.replaceState({}, '', `/search?q=${encodeURIComponent(query)}`); } catch { /* ignore */ }
    }, 250);
    return () => { alive = false; clearTimeout(timer); };
  }, [q, access.orgId]);

  const pages = searchPages(q, access);
  const total = pages.length + state.rows.length;
  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">{t('nav.search')}</div>
          <h1>{t('search.title')}</h1>
          <p>{t('search.subtitle')}</p>
        </div>
      </div>
      <div className="field" style={{ maxWidth: 560, marginBottom: 16 }}>
        <label htmlFor="search-q" className="sr-only">{t('search.label')}</label>
        <input id="search-q" className="input" autoFocus maxLength={100} value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('search.placeholder')} />
      </div>
      {state.error && <Notice tone="error">{state.error}</Notice>}
      {q.trim().length >= 2 && !state.loading && total === 0 && <Card><EmptyState title={t('search.none', { q: q.trim() })} /></Card>}
      <div className="stack">
        {pages.length > 0 && (
          <Card title={t('search.group.pages')}>
            <div className="status-list">
              {pages.map((p) => <div className="status-row" key={p.id}><Link to={p.to}>{p.subtitle ? `${p.subtitle} · ` : ''}{p.title}</Link></div>)}
            </div>
          </Card>
        )}
        {KINDS.map((kind) => {
          const rows = state.rows.filter((r) => r.kind === kind);
          if (!rows.length) return null;
          return (
            <Card key={kind} title={t(`search.group.${kind}`)} sub={String(rows.length)}>
              <div className="status-list">
                {rows.map((r) => (
                  <div className="status-row" key={r.id}>
                    <span className="label"><Link to={resultHref(r)}>{r.title}</Link>
                      {r.subtitle && kind !== 'notification' && <small>{kind === 'saved_item' ? tModule(r.subtitle, 'shortName') : r.subtitle}</small>}</span>
                  </div>
                ))}
              </div>
            </Card>
          );
        })}
        {state.loading && <div className="faint">{t('search.loading')}</div>}
      </div>
    </>
  );
}
