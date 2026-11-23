/** Small helpers shared by the Modul 03 screens. */
import { useCallback, useEffect, useState } from 'react';
import { errorText, intlLocale, t } from '../../core/i18n/index.js';
import { formatMoney, fromMinor, toMinor } from '../../../shared/finance.js';

/** "12,50 ₼" from AZN minor units; '—' for null. */
export function money(minor) {
  if (minor == null || Number.isNaN(Number(minor))) return '—';
  return formatMoney(Number(minor), 'AZN', intlLocale());
}

/** Minor units → text for an input ("12.50"); '' for 0 when `blankZero`. */
export function minorToInput(minor, { blankZero = false } = {}) {
  if (minor == null) return '';
  if (blankZero && Number(minor) === 0) return '';
  return fromMinor(Number(minor));
}

/** Input text → minor units; '' → 0. Throws 'mp.err.amount' on bad input. */
export function inputToMinor(text) {
  const s = String(text ?? '').trim().replace(',', '.');
  if (s === '') return 0;
  if (!/^\d+(\.\d+)?$/.test(s)) throw new Error('mp.err.amount');
  return toMinor(s);
}

export function intOrNull(text, { min = 0 } = {}) {
  const s = String(text ?? '').trim();
  if (s === '') return null;
  if (!/^\d+$/.test(s) || Number(s) < min) throw new Error('mp.err.integer');
  return Number(s);
}

/** Load data for a screen: { data, error, loading, reload }. */
export function useLoad(fn, deps) {
  const [state, setState] = useState({ loading: true, data: null, error: null });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const load = useCallback(fn, deps);
  const reload = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const data = await load();
      setState({ loading: false, data, error: null });
    } catch (err) {
      setState({ loading: false, data: null, error: errorText(err) });
    }
  }, [load]);
  useEffect(() => { reload(); }, [reload]);
  return { ...state, reload };
}

export function Field({ id, label, hint, children, wide }) {
  return (
    <div className="field" style={wide ? { gridColumn: '1 / -1' } : undefined}>
      <label htmlFor={id}>{label}</label>
      {children}
      {hint && <div className="faint" style={{ fontSize: 12 }}>{hint}</div>}
    </div>
  );
}

export function MoneyInput({ id, value, onChange, disabled, required }) {
  return (
    <input id={id} className="input num" inputMode="decimal" placeholder="0.00" value={value} required={required}
      disabled={disabled} onChange={(e) => onChange(e.target.value)} />
  );
}

export const formGrid = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 };

export const statusTone = (s) => ({ active: 'ok', out_of_stock: 'warn', draft: undefined, processing: 'accent', transit: 'accent', complete: 'ok', problem: 'warn' }[s]);

export const pct = (n) => (n == null ? '—' : `${new Intl.NumberFormat(intlLocale(), { maximumFractionDigits: 1 }).format(n)} %`);

/** Read-only notice for users without write access. */
export const readOnlyText = () => t('mp.read_only');
