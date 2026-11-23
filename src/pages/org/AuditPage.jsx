import { useEffect, useState } from 'react';
import { errorText, formatDateTime, t } from '../../core/i18n/index.js';
import { tenancy } from '../../core/data/tenancy.js';
import { useOrg } from '../../core/org/OrgProvider.jsx';
import { Badge, Card, EmptyState, Notice } from '../../core/ui/components.jsx';

const TABLES = [
  'companies', 'products', 'saved_items', 'module_events', 'activity_log', 'financial_transactions', 'exchange_rates',
  'ares_conversations', 'ares_messages', 'integrations', 'organizations', 'organization_members',
  'organization_invites', 'organization_subscriptions',
];
const ACTION_TONE = { INSERT: 'ok', UPDATE: 'accent', DELETE: 'err' };

/** Short human summary of what changed (UPDATE: changed columns; INSERT/DELETE: a few fields). */
function summarize(row) {
  if (row.action === 'UPDATE') return Object.keys(row.changed ?? {}).join(', ');
  const c = row.changed ?? {};
  return ['name', 'title', 'email', 'kind', 'provider', 'action', 'role_id', 'status']
    .filter((k) => c[k] != null).slice(0, 3).map((k) => `${k}: ${String(c[k]).slice(0, 40)}`).join(' · ');
}

export default function AuditPage() {
  const { orgId } = useOrg();
  const [table, setTable] = useState('');
  const [state, setState] = useState({ loading: true });
  const [names, setNames] = useState({});

  useEffect(() => {
    let alive = true;
    setState({ loading: true });
    Promise.all([tenancy.auditLog(orgId, { table: table || undefined }), tenancy.listMembers(orgId).catch(() => [])])
      .then(([rows, members]) => {
        if (!alive) return;
        setNames(Object.fromEntries((members ?? []).map((m) => [m.user_id, m.full_name || m.email])));
        setState({ loading: false, rows: rows ?? [] });
      })
      .catch((err) => alive && setState({ loading: false, error: errorText(err) }));
    return () => { alive = false; };
  }, [orgId, table]);

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">{t('nav.audit')}</div>
          <h1>{t('audit.title')}</h1>
          <p>{t('audit.subtitle')}</p>
        </div>
        <div className="field" style={{ minWidth: 220 }}>
          <label htmlFor="audit-table">{t('audit.filter.table')}</label>
          <select id="audit-table" className="input" value={table} onChange={(e) => setTable(e.target.value)}>
            <option value="">{t('audit.filter.all')}</option>
            {TABLES.map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
        </div>
      </div>
      {state.error && <Notice tone="error">{state.error}</Notice>}
      <Card sub={t('audit.limit')} title={t('audit.title')}>
        {state.loading ? <div className="card-pad faint">{t('common.loading')}</div> : state.rows?.length === 0 ? <EmptyState title={t('audit.empty')} /> : (
          <div className="table-wrap">
            <table className="table audit-table">
              <thead><tr><th>{t('audit.col.time')}</th><th>{t('audit.col.actor')}</th><th>{t('audit.col.table')}</th><th>{t('audit.col.action')}</th><th>{t('audit.col.changes')}</th></tr></thead>
              <tbody>
                {state.rows?.map((r) => (
                  <tr key={r.id}>
                    <td className="num" style={{ whiteSpace: 'nowrap' }}>{formatDateTime(r.at)}</td>
                    <td>{r.actor_id ? (names[r.actor_id] ?? r.actor_id.slice(0, 8)) : <span className="faint">{t('audit.system')}</span>}</td>
                    <td><code>{r.table_name}</code></td>
                    <td><Badge tone={ACTION_TONE[r.action]}>{r.action}</Badge></td>
                    <td className="muted" style={{ fontSize: 12.5 }}>{summarize(r)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
