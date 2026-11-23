import { formatDateTime, hasKey, t } from '../../core/i18n/index.js';
import { Modal, Notice } from '../../core/ui/components.jsx';
import { marketplace } from './api.js';
import { money, useLoad } from './ui.jsx';

const isMoney = (k) => k.endsWith('_azn_minor');

function show(k, v) {
  if (v == null) return '—';
  if (isMoney(k)) return money(v);
  if (k === 'supplier_order_status' && hasKey(`mp.sup.${v}`)) return t(`mp.sup.${v}`);
  if (k.endsWith('status') && hasKey(`mp.status.${v}`)) return t(`mp.status.${v}`);
  if (k.endsWith('_at')) return formatDateTime(v);
  if (typeof v === 'boolean') return v ? t('mp.yes') : t('mp.no');
  return String(v);
}

/** Price / status history from marketplace_history() (audit log, non-sensitive columns only). */
export function HistoryModal({ entity, id, title, onClose }) {
  const { data, error, loading } = useLoad(() => marketplace.history(entity, id), [entity, id]);
  return (
    <Modal title={t('mp.history.title', { name: title ?? '' })} onClose={onClose} width={640}>
      {error && <Notice tone="error">{error}</Notice>}
      {loading && !data ? <div className="faint">{t('common.loading')}</div>
        : !data?.length ? <div className="faint">{t('mp.history.empty')}</div> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>{t('mp.history.when')}</th><th>{t('mp.history.change')}</th></tr></thead>
              <tbody>
                {data.map((h, i) => (
                  <tr key={i}>
                    <td className="faint" style={{ whiteSpace: 'nowrap' }}>{formatDateTime(h.changed_at)}</td>
                    <td>
                      {Object.entries(h.changed ?? {}).map(([k, v]) => {
                        const pair = v && typeof v === 'object' && ('old' in v || 'new' in v);
                        return (
                          <div key={k}>
                            <span className="faint">{hasKey(`mp.col.${k}`) ? t(`mp.col.${k}`) : k}: </span>
                            {pair ? <>{show(k, v.old)} → <strong>{show(k, v.new)}</strong></> : <strong>{show(k, v)}</strong>}
                          </div>
                        );
                      })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
    </Modal>
  );
}
