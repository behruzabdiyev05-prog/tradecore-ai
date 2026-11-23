import { useCallback, useEffect, useState } from 'react';
import { LuRefreshCw } from 'react-icons/lu';
import { apiFetch } from '../core/api/client.js';
import { supabase } from '../core/auth/supabaseClient.js';
import { useAuth } from '../core/auth/AuthProvider.jsx';
import { useAres } from '../core/ares/AresProvider.jsx';
import { Badge, Card, Notice } from '../core/ui/components.jsx';
import { getModule } from '../../shared/modules.js';
import { useOrg } from '../core/org/OrgProvider.jsx';
import { errorText, t, tServerError } from '../core/i18n/index.js';

function useChecks() {
  const [checks, setChecks] = useState({});
  const run = useCallback(async () => {
    setChecks({ db: { state: 'checking' }, api: { state: 'checking' } });
    // Database: a real RLS-protected query.
    supabase.from('modules').select('key', { count: 'exact', head: true })
      .then(({ count, error }) => setChecks((c) => ({ ...c, db: error ? { state: 'error', text: errorText(error) } : { state: 'ok', text: t('system.db.modules', { n: count }) } })));
    apiFetch('/health')
      .then((h) => setChecks((c) => ({ ...c, api: { state: 'ok', text: `v${h.version}`, services: h.services } })))
      .catch((e) => setChecks((c) => ({ ...c, api: { state: 'error', text: errorText(e) } })));
  }, []);
  useEffect(() => { run(); }, [run]);
  return [checks, run];
}

function StateBadge({ state, okText = t('system.state.ok') }) {
  if (state === 'ok') return <Badge tone="ok">{okText}</Badge>;
  if (state === 'warn') return <Badge tone="warn">{t('system.state.not_connected')}</Badge>;
  if (state === 'error') return <Badge tone="err">{t('system.state.error')}</Badge>;
  return <Badge>{t('system.state.checking')}</Badge>;
}

export function SystemStatusCard() {
  const { user } = useAuth();
  const { status: ares, refreshStatus } = useAres();
  const [checks, rerun] = useChecks();
  const aresState = ares.state === 'ready' ? 'ok' : ares.state === 'not_configured' ? 'warn' : ares.state === 'checking' ? 'checking' : 'error';
  return (
    <Card title={t('system.status')} actions={
      <button className="btn btn-ghost btn-icon" aria-label={t('system.recheck')} onClick={() => { rerun(); refreshStatus(); }}><LuRefreshCw /></button>
    }>
      <div className="status-list">
        <div className="status-row"><span className="label">{t('system.auth')}<small>{user?.email}</small></span><StateBadge state="ok" okText={t('system.auth.ok')} /></div>
        <div className="status-row"><span className="label">{t('system.db')}<small>{checks.db?.text ?? 'Supabase / PostgreSQL'}</small></span><StateBadge state={checks.db?.state} /></div>
        <div className="status-row"><span className="label">{t('system.api')}<small>{checks.api?.text ?? 'Netlify Functions'}</small></span><StateBadge state={checks.api?.state} /></div>
        <div className="status-row"><span className="label">ARES AI<small>{tServerError(ares.reason) ?? (ares.message || t('system.ares.desc'))}</small></span><StateBadge state={aresState} okText={t('common.active')} /></div>
      </div>
    </Card>
  );
}

function IntegrationsCard() {
  const { accessToken } = useAuth();
  const { orgId } = useOrg();
  const [state, setState] = useState({ loading: true });
  useEffect(() => {
    apiFetch(`/integrations?orgId=${encodeURIComponent(orgId)}`, { token: accessToken })
      .then((d) => setState({ loading: false, list: d.integrations }))
      .catch((e) => setState({ loading: false, error: errorText(e) }));
  }, [accessToken, orgId]);

  return (
    <Card title={t('system.integrations')} actions={<Badge tone="warn">Phase 7</Badge>}>
      {state.error && <div className="card-pad"><Notice tone="error">{state.error}</Notice></div>}
      {state.loading && <div className="card-pad faint">{t('common.loading')}</div>}
      {state.list && (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>{t('system.col.source')}</th><th>{t('nav.modules')}</th><th>{t('system.col.keys')}</th><th>{t('plan.status')}</th></tr></thead>
            <tbody>
              {state.list.map((i) => (
                <tr key={i.key}>
                  <td>{t(`integration.${i.key}`) === `integration.${i.key}` ? i.name : t(`integration.${i.key}`)}</td>
                  <td className="muted">{i.modules.map((k) => getModule(k)?.code).join(', ') || '—'}</td>
                  <td>{i.credentials === 'present' ? <Badge tone="ok">{t('system.keys.present')}</Badge> : i.credentials === 'partial' ? <Badge tone="warn">{t('system.keys.partial')}</Badge> : <Badge>{t('system.keys.missing')}</Badge>}</td>
                  <td><Badge>{t('system.not_built')}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function IntegrationsGate() {
  const { can } = useOrg();
  if (!can('integrations.manage')) {
    return <Card title={t('system.integrations')}><div className="card-pad"><Notice>{t('system.integrations.forbidden')}</Notice></div></Card>;
  }
  return <IntegrationsCard />;
}

export default function SystemPage() {
  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">{t('system.eyebrow')}</div>
          <h1>{t('nav.system')}</h1>
          <p>{t('system.subtitle')}</p>
        </div>
      </div>
      <div className="stack">
        <SystemStatusCard />
        <IntegrationsGate />
      </div>
    </>
  );
}
