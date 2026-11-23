/**
 * /notifications — all notifications of the active organization (newest first,
 * filter, "load more") and "My activity": the user's OWN changes from the audit log.
 */
import { useCallback, useEffect, useState } from 'react';
import { LuCheckCheck } from 'react-icons/lu';
import { account, NOTIFICATION_TYPES } from '../core/data/account.js';
import { useOrg } from '../core/org/OrgProvider.jsx';
import { useNotifications, notificationText } from '../core/notifications/NotificationsProvider.jsx';
import { useRouter } from '../core/router/router.jsx';
import { errorText, formatDateTime, formatRelative, t } from '../core/i18n/index.js';
import { Badge, Card, EmptyState, Notice } from '../core/ui/components.jsx';
import { safeLink } from '../layout/NotificationBell.jsx';

const PAGE = 20;
const ACTION_TONE = { INSERT: 'ok', UPDATE: 'accent', DELETE: 'err' };

function NotificationList() {
  const { orgId } = useOrg();
  const { navigate } = useRouter();
  const bell = useNotifications();
  const [filter, setFilter] = useState({ unreadOnly: false, type: '' });
  const [state, setState] = useState({ loading: true, rows: [], more: false });

  const load = useCallback(async (before = null) => {
    try {
      const rows = (await account.notifications(orgId, { ...filter, limit: PAGE, before })) ?? [];
      setState((s) => ({ loading: false, rows: before ? [...s.rows, ...rows] : rows, more: rows.length === PAGE }));
    } catch (e) { setState({ loading: false, rows: [], more: false, error: errorText(e) }); }
  }, [orgId, filter]);
  useEffect(() => { setState({ loading: true, rows: [], more: false }); load(); }, [load]);

  const open = async (n) => {
    if (!n.read_at) await bell.markRead([n.id]).catch(() => {});
    navigate(safeLink(n.link));
  };
  const markAll = async () => { await bell.markAllRead().catch(() => {}); await load(); };

  return (
    <Card title={t('nav.notifications')} actions={
      <button type="button" className="btn btn-ghost" onClick={markAll} disabled={!bell.unread}><LuCheckCheck aria-hidden /> {t('notif.mark_all')}</button>
    }>
      <div className="card-pad notif-filters">
        <div className="tabs" role="tablist" style={{ margin: 0 }}>
          <button role="tab" className="tab" aria-selected={!filter.unreadOnly} onClick={() => setFilter((f) => ({ ...f, unreadOnly: false }))}>{t('notif.filter.all')}</button>
          <button role="tab" className="tab" aria-selected={filter.unreadOnly} onClick={() => setFilter((f) => ({ ...f, unreadOnly: true }))}>{t('notif.filter.unread')}</button>
        </div>
        <div className="field" style={{ minWidth: 220 }}>
          <label htmlFor="notif-type" className="sr-only">{t('notif.filter.type')}</label>
          <select id="notif-type" className="input" value={filter.type} onChange={(e) => setFilter((f) => ({ ...f, type: e.target.value }))}>
            <option value="">{t('notif.filter.all_types')}</option>
            {NOTIFICATION_TYPES.map((x) => <option key={x} value={x}>{t(`notif.type.${x}`)}</option>)}
          </select>
        </div>
      </div>
      {state.error && <div className="card-pad"><Notice tone="error">{state.error}</Notice></div>}
      {state.loading ? <div className="card-pad faint">{t('common.loading')}</div>
        : state.rows.length === 0 ? <EmptyState title={t('notif.empty')} />
          : (
            <ul className="notif-page-list">
              {state.rows.map((n) => (
                <li key={n.id}>
                  <button type="button" className="notif-item" data-unread={!n.read_at} onClick={() => open(n)}>
                    <span className="notif-dot" aria-hidden />
                    <span className="notif-text">{notificationText(n)}
                      <small className="faint" title={formatDateTime(n.created_at)}>{formatRelative(n.created_at)} · {t(`notif.type.${n.type}`)}</small>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
      {state.more && <div className="card-pad"><button type="button" className="btn" onClick={() => load(state.rows.at(-1)?.created_at)}>{t('common.load_more')}</button></div>}
    </Card>
  );
}

/** Short summary of the user's own change (no other user's data is ever returned by my_activity). */
function summarize(row) {
  if (row.action === 'UPDATE') return Object.keys(row.changed ?? {}).join(', ');
  const c = row.changed ?? {};
  return ['name', 'title', 'email', 'kind', 'provider'].filter((k) => c[k] != null).slice(0, 2).map((k) => `${k}: ${String(c[k]).slice(0, 40)}`).join(' · ');
}

function MyActivity() {
  const { orgId } = useOrg();
  const [state, setState] = useState({ loading: true, rows: [] });
  const load = useCallback(async (before = null) => {
    try {
      const rows = (await account.myActivity(orgId, { limit: 50, before })) ?? [];
      setState((s) => ({ loading: false, rows: before ? [...s.rows, ...rows] : rows, more: rows.length === 50 }));
    } catch (e) { setState({ loading: false, rows: [], error: errorText(e) }); }
  }, [orgId]);
  useEffect(() => { load(); }, [load]);
  return (
    <Card title={t('activity.title')} sub={t('activity.sub')}>
      {state.error && <div className="card-pad"><Notice tone="error">{state.error}</Notice></div>}
      {state.loading ? <div className="card-pad faint">{t('common.loading')}</div> : state.rows.length === 0 ? <EmptyState title={t('activity.empty')} /> : (
        <div className="table-wrap">
          <table className="table activity-table">
            <thead><tr><th>{t('audit.col.time')}</th><th>{t('audit.col.table')}</th><th>{t('audit.col.action')}</th><th>{t('audit.col.changes')}</th></tr></thead>
            <tbody>
              {state.rows.map((r) => (
                <tr key={r.id}>
                  <td className="num" style={{ whiteSpace: 'nowrap' }}>{formatDateTime(r.at)}</td>
                  <td><code>{r.table_name}</code></td>
                  <td><Badge tone={ACTION_TONE[r.action]}>{r.action}</Badge></td>
                  <td className="muted" style={{ fontSize: 12.5 }}>{summarize(r)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {state.more && <div className="card-pad"><button type="button" className="btn" onClick={() => load(state.rows.at(-1)?.id)}>{t('common.load_more')}</button></div>}
    </Card>
  );
}

export default function NotificationsPage() {
  const [tab, setTab] = useState('notifications');
  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">{t('nav.notifications')}</div>
          <h1>{t('notif.title')}</h1>
          <p>{t('notif.subtitle')}</p>
        </div>
      </div>
      <div className="tabs" role="tablist">
        <button role="tab" className="tab" aria-selected={tab === 'notifications'} onClick={() => setTab('notifications')}>{t('nav.notifications')}</button>
        <button role="tab" className="tab" aria-selected={tab === 'activity'} onClick={() => setTab('activity')}>{t('activity.title')}</button>
      </div>
      {tab === 'notifications' ? <NotificationList /> : <MyActivity />}
    </>
  );
}
