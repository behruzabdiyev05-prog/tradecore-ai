import { useState } from 'react';
import { errorText, formatDateTime, t } from '../../core/i18n/index.js';
import { useOrg } from '../../core/org/OrgProvider.jsx';
import { Badge, Card, Notice } from '../../core/ui/components.jsx';
import { marketplace } from './api.js';
import { Field, MoneyInput, formGrid, inputToMinor, intOrNull, minorToInput, useLoad } from './ui.jsx';

/** Organization settings of Modul 03 (needs integrations.manage to change) + Shopify store status (Y7). */
export default function Settings({ settings, saved, onSaved }) {
  const { orgId, can } = useOrg();
  const canManage = can('integrations.manage');
  const store = useLoad(() => marketplace.storeStatus(orgId), [orgId]);
  const [f, setF] = useState({
    fee: String(settings.payment_fee_percent), fixed: minorToInput(settings.payment_fee_fixed_azn_minor, { blankZero: true }),
    low: String(settings.low_stock_threshold),
  });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const set = (k) => (v) => setF((s) => ({ ...s, [k]: typeof v === 'string' ? v : v.target.value }));

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setMsg(null);
    try {
      const fee = Number(String(f.fee).replace(',', '.'));
      if (!(fee >= 0 && fee < 100)) throw new Error('mp.err.percent');
      await marketplace.saveSettings(orgId, {
        payment_fee_percent: fee, payment_fee_fixed_azn_minor: inputToMinor(f.fixed), low_stock_threshold: intOrNull(f.low) ?? 0,
      }, Boolean(saved));
      setMsg({ ok: t('mp.set.saved') });
      onSaved();
    } catch (err) {
      setMsg({ error: errorText(err) });
    } finally {
      setBusy(false);
    }
  }

  const s = store.data;
  return (
    <div className="grid grid-2">
      <Card title={t('mp.set.title')} sub={saved?.updated_at ? t('mp.set.updated', { at: formatDateTime(saved.updated_at) }) : t('mp.set.defaults')} pad>
        <form className="stack" onSubmit={submit} style={{ gap: 14 }}>
          {!canManage && <Notice>{t('mp.set.no_permission')}</Notice>}
          <div style={formGrid}>
            <Field id="st-fee" label={t('mp.set.fee_percent')}><input id="st-fee" className="input num" inputMode="decimal" value={f.fee} onChange={set('fee')} disabled={!canManage} /></Field>
            <Field id="st-fixed" label={t('mp.set.fee_fixed')}><MoneyInput id="st-fixed" value={f.fixed} onChange={set('fixed')} disabled={!canManage} /></Field>
            <Field id="st-low" label={t('mp.set.low_stock')} hint={t('mp.set.low_stock_hint')}><input id="st-low" className="input num" inputMode="numeric" value={f.low} onChange={set('low')} disabled={!canManage} /></Field>
          </div>
          {msg?.error && <Notice tone="error">{msg.error}</Notice>}
          {msg?.ok && <Notice>{msg.ok}</Notice>}
          {canManage && <div><button type="submit" className="btn btn-primary" disabled={busy}>{t('common.save')}</button></div>}
        </form>
      </Card>
      <Card title={t('mp.store.title')} pad>
        {store.error ? <Notice tone="error">{store.error}</Notice> : !s ? <div className="faint">{t('common.loading')}</div> : (
          <div className="stack" style={{ gap: 12 }}>
            <div className="status-list">
              <div className="status-row"><span className="label">Shopify</span>{s.connected ? <Badge tone="ok">{t('mp.store.connected')}</Badge> : <Badge>{t('mp.store.not_connected')}</Badge>}</div>
              <div className="status-row"><span className="label">{t('mp.store.last_event')}</span><span>{s.last_event_at ? formatDateTime(s.last_event_at) : '—'}</span></div>
              <div className="status-row"><span className="label">{t('mp.store.failed')}</span><span className={`num ${s.failed_events > 0 ? 'neg' : ''}`}>{s.failed_events ?? 0}</span></div>
            </div>
            <div className="faint" style={{ fontSize: 12 }}>{t('mp.store.later')}</div>
          </div>
        )}
      </Card>
    </div>
  );
}
