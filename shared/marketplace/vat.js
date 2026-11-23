/**
 * D5 — standard VAT rates used by the Modul 03 calculator.
 *
 * These are ESTIMATES (standard rate only, no reduced rates or thresholds) and are
 * always shown with the "təxmini" label. Rates change: the user must check the
 * current rate for their case. `asOf` is when this table was last reviewed.
 * The user can always type their own rate instead.
 */
export const VAT_AS_OF = '2026-11';

export const VAT_RATES = Object.freeze([
  { code: 'NONE', percent: 0 },
  { code: 'AZ', percent: 18 },
  { code: 'TR', percent: 20 },
  { code: 'DE', percent: 19 },
  { code: 'FR', percent: 20 },
  { code: 'IT', percent: 22 },
  { code: 'ES', percent: 21 },
  { code: 'NL', percent: 21 },
  { code: 'PL', percent: 23 },
  { code: 'GB', percent: 20 },
  { code: 'US', percent: 0, note: 'sales_tax' },   // no federal VAT; state sales tax is not modelled
]);

export const VAT_CODES = Object.freeze(VAT_RATES.map((r) => r.code));

export function vatRate(code) {
  return VAT_RATES.find((r) => r.code === code) ?? null;
}
