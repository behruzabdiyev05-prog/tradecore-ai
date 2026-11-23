import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { LuArrowUpRight, LuCircleAlert, LuCircleDashed, LuLock, LuX } from 'react-icons/lu';
import { intlLocale, t } from '../i18n/index.js';
import { CURRENCIES, BASE_CURRENCY, fromMinor } from '../../../shared/finance.js';
import { Link } from '../router/router.jsx';

export function Card({ title, sub, actions, children, pad = false, className = '', style }) {
  return (
    <section className={`card ${className}`} style={style}>
      {title && (
        <header className="card-head">
          <div><h2>{title}</h2>{sub && <div className="sub">{sub}</div>}</div>
          {actions}
        </header>
      )}
      {pad ? <div className="card-pad">{children}</div> : children}
    </section>
  );
}

/** "1 234,50" without symbol (symbol rendered separately, smaller). */
function moneyParts(minor, currency = BASE_CURRENCY) {
  const n = Number(fromMinor(minor, currency));
  const text = new Intl.NumberFormat(intlLocale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
  return { symbol: CURRENCIES[currency].symbol, text };
}

/**
 * Glass stat card. Give `money` (AZN minor units) or `value` (plain). null = unavailable.
 * `featured` renders the warm highlighted variant; `to` adds the corner link.
 */
export function Stat({ label, money, value, sub, signed = false, featured = false, to }) {
  const raw = money !== undefined ? money : value;
  const cls = signed && raw != null ? (raw > 0 ? 'pos' : raw < 0 ? 'neg' : '') : '';
  let body = '—';
  if (raw != null) {
    if (money !== undefined) {
      const p = moneyParts(raw);
      body = <><span className="cur">{p.symbol}</span>{p.text}</>;
    } else body = raw;
  }
  return (
    <div className={`card stat ${featured ? 'featured' : ''}`}>
      <div className="stat-top">
        <span className="stat-label">{label}</span>
        {to && <Link to={to} className="corner-btn" aria-label={t('common.details', { label })}><LuArrowUpRight /></Link>}
      </div>
      <div className={`stat-value num ${featured ? '' : cls}`}>{body}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

export function Badge({ tone, children }) {
  return <span className={`badge ${tone ? `badge-${tone}` : ''}`}>{children}</span>;
}

export function EmptyState({ icon: Icon = LuCircleDashed, title, children, action }) {
  return (
    <div className="empty">
      <Icon className="empty-icon" aria-hidden />
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

export function Notice({ tone = 'warn', children }) {
  return (
    <div className={`notice ${tone === 'error' ? 'notice-err' : ''}`} role={tone === 'error' ? 'alert' : 'status'}>
      <LuCircleAlert aria-hidden />
      <div>{children}</div>
    </div>
  );
}

export function Spinner({ label = t('common.loading') }) {
  return (
    <div className="center-screen">
      <div className="spinner" role="status" aria-label={label} />
    </div>
  );
}

/** Shown when a route needs a permission the user's role lacks (nothing is loaded). */
export function Forbidden() {
  return (
    <div className="card">
      <EmptyState icon={LuLock} title={t('forbidden.title')} action={<Link to="/" className="btn">{t('common.back_dashboard')}</Link>}>
        {t('forbidden.body')}
      </EmptyState>
    </div>
  );
}

/** Accessible modal dialog: Esc and the backdrop close it; focus moves into it. */
export function Modal({ title, onClose, children, width = 480 }) {
  const ref = useRef(null);
  useEffect(() => {
    const prev = document.activeElement;
    ref.current?.querySelector('input, select, textarea, button:not(.modal-close)')?.focus();
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', onKey, true);
    return () => { window.removeEventListener('keydown', onKey, true); prev?.focus?.(); };
  }, [onClose]);
  // Rendered at <body> level: a glass card (backdrop-filter) would otherwise trap the fixed
  // backdrop inside it and the top bar could cover the dialog's close button.
  return createPortal(
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="card modal" role="dialog" aria-modal="true" aria-label={title} ref={ref} style={{ width: `min(${width}px, 100%)` }}>
        <header className="card-head">
          <h2>{title}</h2>
          <button type="button" className="btn btn-ghost btn-icon modal-close" onClick={onClose} aria-label={t('common.close')}><LuX /></button>
        </header>
        <div className="card-pad">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

/** On/off switch (checkbox semantics). */
export function Toggle({ id, checked, onChange, disabled, label }) {
  return (
    <label className="toggle" htmlFor={id}>
      <input id={id} type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="toggle-track" aria-hidden><span className="toggle-thumb" /></span>
      {label && <span>{label}</span>}
    </label>
  );
}
