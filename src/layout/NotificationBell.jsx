import { useEffect, useRef, useState } from 'react';
import { LuBell, LuCheckCheck } from 'react-icons/lu';
import { useNotifications, notificationText } from '../core/notifications/NotificationsProvider.jsx';
import { useRouter, Link } from '../core/router/router.jsx';
import { formatRelative, t } from '../core/i18n/index.js';
import { INTERNAL_LINK } from './CommandPalette.jsx';

/** Internal links only (the database enforces the same rule). */
export const safeLink = (link) => (typeof link === 'string' && INTERNAL_LINK.test(link) ? link : '/notifications');

/** Bell with the unread count and the latest 10 notifications of the active organization. */
export default function NotificationBell() {
  const { available, unread, latest, markRead, markAllRead } = useNotifications();
  const { navigate } = useRouter();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const close = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, []);

  if (!available) return null;   // Phase 2B database objects not deployed

  const openItem = async (n) => {
    setOpen(false);
    if (!n.read_at) await markRead([n.id]).catch(() => {});
    navigate(safeLink(n.link));
  };

  return (
    <div className="notif-bell" ref={ref}>
      <button type="button" className="btn btn-icon" aria-haspopup="dialog" aria-expanded={open}
        aria-label={unread ? t('notif.bell.unread', { n: unread }) : t('notif.bell')} onClick={() => setOpen((v) => !v)}>
        <LuBell />
        {unread > 0 && <span className="notif-count num" aria-hidden>{unread > 99 ? '99+' : unread}</span>}
      </button>
      {open && (
        <div className="module-jump-list notif-menu" role="dialog" aria-label={t('nav.notifications')}>
          <div className="notif-menu-head">
            <strong>{t('nav.notifications')}</strong>
            {unread > 0 && (
              <button type="button" className="link-btn" onClick={() => markAllRead().catch(() => {})}>
                <LuCheckCheck aria-hidden /> {t('notif.mark_all')}
              </button>
            )}
          </div>
          {latest.length === 0 && <div className="notif-empty faint">{t('notif.empty')}</div>}
          {latest.map((n) => (
            <button key={n.id} type="button" className="notif-item" data-unread={!n.read_at} onClick={() => openItem(n)}>
              <span className="notif-dot" aria-hidden />
              <span className="notif-text">{notificationText(n)}<small className="faint">{formatRelative(n.created_at)}</small></span>
            </button>
          ))}
          <Link to="/notifications" className="notif-all" onClick={() => setOpen(false)}>{t('notif.see_all')}</Link>
        </div>
      )}
    </div>
  );
}
