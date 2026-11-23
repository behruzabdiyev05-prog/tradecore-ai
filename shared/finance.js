/**
 * TRADECORE AI — Central finance math (shared by frontend, functions and tests).
 *
 * Rules:
 *  - Money is stored and computed as INTEGER MINOR UNITS (qəpik, cent) — never floats.
 *  - Base / reporting currency is AZN.
 *  - FX rates are "AZN per 1 unit of currency" and must come from a recorded
 *    source (user entry or an integration). No rates are hard-coded.
 *  - Rounding: half away from zero (identical to PostgreSQL `round(numeric)`),
 *    so app-side and DB-side conversions match exactly.
 *  - Definitions below are mirrored by the SQL view `finance_module_summary`.
 */

export const BASE_CURRENCY = 'AZN';

export const CURRENCIES = Object.freeze({
  AZN: { code: 'AZN', name: 'Azərbaycan manatı', symbol: '₼', minorUnits: 2 },
  USD: { code: 'USD', name: 'ABŞ dolları', symbol: '$', minorUnits: 2 },
  EUR: { code: 'EUR', name: 'Avro', symbol: '€', minorUnits: 2 },
  TRY: { code: 'TRY', name: 'Türk lirəsi', symbol: '₺', minorUnits: 2 },
  CNY: { code: 'CNY', name: 'Çin yuanı', symbol: '¥', minorUnits: 2 },
  GBP: { code: 'GBP', name: 'Britaniya funtu', symbol: '£', minorUnits: 2 },
});

export const CURRENCY_CODES = Object.freeze(Object.keys(CURRENCIES));

/**
 * Transaction kinds. `group` decides how a kind enters the P&L.
 *  - revenue:   sales income
 *  - cogs:      landed cost of goods (purchase + shipping + customs)
 *  - expense:   selling / operating costs (commission, tax, operational, other)
 *  - capital:   owner capital movements — affect cash flow, NOT profit
 */
export const TRANSACTION_KINDS = Object.freeze({
  sale: { label: 'Satış gəliri', group: 'revenue', direction: 1 },
  purchase: { label: 'Alış xərci', group: 'cogs', direction: -1 },
  shipping: { label: 'Daşıma xərci', group: 'cogs', direction: -1 },
  customs: { label: 'Gömrük xərci', group: 'cogs', direction: -1 },
  commission: { label: 'Marketplace komissiyası', group: 'expense', direction: -1 },
  tax: { label: 'Vergi', group: 'expense', direction: -1 },
  operational: { label: 'Əməliyyat xərci', group: 'expense', direction: -1 },
  other_expense: { label: 'Digər xərc', group: 'expense', direction: -1 },
  capital_in: { label: 'Kapital əlavəsi', group: 'capital', direction: 1 },
  capital_out: { label: 'Kapital çıxarışı', group: 'capital', direction: -1 },
});

export const TRANSACTION_KIND_KEYS = Object.freeze(Object.keys(TRANSACTION_KINDS));

const DECIMAL_RE = /^-?\d+(\.\d+)?$/;

/** Parse a decimal string/number into a BigInt scaled by 10^scale (exact, no floats). */
function toScaledBigInt(value, scale) {
  const s = typeof value === 'number' ? numberToPlainString(value) : String(value).trim().replace(',', '.');
  if (!DECIMAL_RE.test(s)) throw new TypeError(`Yanlış rəqəm formatı: "${value}"`);
  const negative = s.startsWith('-');
  const [intPart, frac = ''] = (negative ? s.slice(1) : s).split('.');
  if (frac.length > scale) {
    // Round half away from zero at `scale` digits.
    const kept = BigInt(intPart + frac.slice(0, scale));
    const roundUp = Number(frac[scale]) >= 5;
    const r = roundUp ? kept + 1n : kept;
    return negative ? -r : r;
  }
  const r = BigInt(intPart + frac.padEnd(scale, '0'));
  return negative ? -r : r;
}

function numberToPlainString(n) {
  if (!Number.isFinite(n)) throw new TypeError(`Yanlış rəqəm: ${n}`);
  // String(n) gives the shortest round-trip form; toFixed avoids exponent notation.
  const s = String(n);
  return s.includes('e') ? n.toFixed(12) : s;
}

/** Integer division of BigInts rounding half away from zero. */
function divRoundHalfAway(num, den) {
  const negative = (num < 0n) !== (den < 0n);
  const a = num < 0n ? -num : num;
  const b = den < 0n ? -den : den;
  let q = a / b;
  if ((a % b) * 2n >= b) q += 1n;
  return negative ? -q : q;
}

function assertCurrency(code) {
  if (!CURRENCIES[code]) throw new RangeError(`Dəstəklənməyən valyuta: ${code}`);
}

/**
 * "12.345" → 1235 (minor units, rounded half away from zero).
 * @returns {number} safe integer
 */
export function toMinor(amount, currency = BASE_CURRENCY) {
  assertCurrency(currency);
  const v = toScaledBigInt(amount, CURRENCIES[currency].minorUnits);
  if (v > BigInt(Number.MAX_SAFE_INTEGER) || v < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new RangeError('Məbləğ çox böyükdür');
  }
  return Number(v);
}

/** 1235 → "12.35" */
export function fromMinor(minor, currency = BASE_CURRENCY) {
  assertCurrency(currency);
  if (!Number.isSafeInteger(minor)) throw new TypeError('Minor məbləğ tam ədəd olmalıdır');
  const digits = CURRENCIES[currency].minorUnits;
  const neg = minor < 0;
  const s = String(Math.abs(minor)).padStart(digits + 1, '0');
  const out = `${s.slice(0, -digits)}.${s.slice(-digits)}`;
  return neg ? `-${out}` : out;
}

/** Display formatting, e.g. "1 234,50 ₼". */
export function formatMoney(minor, currency = BASE_CURRENCY, locale = 'az-AZ') {
  const value = Number(fromMinor(minor, currency));
  const formatted = new Intl.NumberFormat(locale, {
    minimumFractionDigits: CURRENCIES[currency].minorUnits,
    maximumFractionDigits: CURRENCIES[currency].minorUnits,
  }).format(value);
  return `${formatted} ${CURRENCIES[currency].symbol}`;
}

/**
 * Convert minor units of `currency` into AZN minor units.
 * @param {number} minor            amount in currency minor units
 * @param {string|number} rateToBase AZN per 1 unit of currency (e.g. "1.7")
 * Matches SQL: round(amount_minor * fx_rate_to_base)
 */
export function convertToBase(minor, rateToBase, currency) {
  assertCurrency(currency);
  if (!Number.isSafeInteger(minor)) throw new TypeError('Minor məbləğ tam ədəd olmalıdır');
  const RATE_SCALE = 8; // matches numeric(18,8) in DB
  const rate = toScaledBigInt(rateToBase, RATE_SCALE);
  if (rate <= 0n) throw new RangeError('Valyuta məzənnəsi müsbət olmalıdır');
  if (currency === BASE_CURRENCY && rate !== 10n ** BigInt(RATE_SCALE)) {
    throw new RangeError('AZN üçün məzənnə 1 olmalıdır');
  }
  // Both AZN and supported currencies use 2 minor digits, so minor→minor is a pure rate multiply.
  const diff = CURRENCIES[BASE_CURRENCY].minorUnits - CURRENCIES[currency].minorUnits;
  const num = BigInt(minor) * rate * 10n ** BigInt(Math.max(diff, 0));
  const den = 10n ** BigInt(RATE_SCALE) * 10n ** BigInt(Math.max(-diff, 0));
  return Number(divRoundHalfAway(num, den));
}

/**
 * Summarise transactions (amounts already in AZN minor units: `amountBaseMinor`).
 * All amounts are positive; `kind` determines the sign.
 *
 *   revenue      = Σ sale
 *   cogs         = Σ purchase + shipping + customs   (landed cost)
 *   grossProfit  = revenue − cogs
 *   expenses     = Σ commission + tax + operational + other_expense
 *   netProfit    = grossProfit − expenses
 *   cashFlow     = Σ (direction × amount) over ALL kinds, capital included
 *
 * Note: Phase 1 uses cash-basis accounting (costs counted when recorded,
 * not matched to units sold). Inventory matching is a Phase 4 topic.
 */
export function summarize(transactions) {
  const byKind = Object.fromEntries(TRANSACTION_KIND_KEYS.map((k) => [k, 0]));
  for (const t of transactions) {
    const def = TRANSACTION_KINDS[t.kind];
    if (!def) throw new RangeError(`Naməlum əməliyyat növü: ${t.kind}`);
    if (!Number.isSafeInteger(t.amountBaseMinor) || t.amountBaseMinor < 0) {
      throw new RangeError('amountBaseMinor müsbət tam ədəd olmalıdır');
    }
    byKind[t.kind] += t.amountBaseMinor;
  }
  const sumGroup = (g) =>
    TRANSACTION_KIND_KEYS.filter((k) => TRANSACTION_KINDS[k].group === g).reduce((s, k) => s + byKind[k], 0);

  const revenue = sumGroup('revenue');
  const cogs = sumGroup('cogs');
  const expenses = sumGroup('expense');
  const grossProfit = revenue - cogs;
  const netProfit = grossProfit - expenses;
  const cashFlow = TRANSACTION_KIND_KEYS.reduce((s, k) => s + TRANSACTION_KINDS[k].direction * byKind[k], 0);
  const capitalNet = byKind.capital_in - byKind.capital_out;

  return { byKind, revenue, cogs, grossProfit, expenses, netProfit, cashFlow, capitalNet, count: transactions.length };
}

/** Group transactions by module and summarise each, plus a consolidated total. */
export function summarizeByModule(transactions) {
  const groups = new Map();
  for (const t of transactions) {
    const key = t.moduleKey ?? 'core';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(t);
  }
  const modules = Object.fromEntries([...groups].map(([k, list]) => [k, summarize(list)]));
  return { modules, total: summarize(transactions) };
}

export const MONTH_LABELS_AZ = Object.freeze(['Yan', 'Fev', 'Mar', 'Apr', 'May', 'İyn', 'İyl', 'Avq', 'Sen', 'Okt', 'Noy', 'Dek']);

/** First day (YYYY-MM-DD) of the window covering the last `months` months incl. the current one. */
export function seriesStartDate(months, now = new Date()) {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (months - 1), 1));
  return d.toISOString().slice(0, 10);
}

/**
 * Monthly totals for one P&L group (default: revenue) over the last `months`
 * months, oldest first. Months with no records are 0 — never interpolated.
 * @param {{kind:string, amountBaseMinor:number, occurredOn:string}[]} transactions
 * @returns {{key:string,label:string,value:number}[]}
 */
export function monthlySeries(transactions, { months = 8, now = new Date(), group = 'revenue' } = {}) {
  const buckets = [];
  for (let i = months - 1; i >= 0; i -= 1) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const key = d.toISOString().slice(0, 7);
    buckets.push({ key, label: MONTH_LABELS_AZ[d.getUTCMonth()], value: 0 });
  }
  const index = new Map(buckets.map((b, i) => [b.key, i]));
  for (const t of transactions) {
    const def = TRANSACTION_KINDS[t.kind];
    if (!def) throw new RangeError(`Naməlum əməliyyat növü: ${t.kind}`);
    if (def.group !== group) continue;
    const i = index.get(String(t.occurredOn).slice(0, 7));
    if (i !== undefined) buckets[i].value += t.amountBaseMinor;
  }
  return buckets;
}

/** Net profit margin in percent (one decimal), or null when there is no revenue. */
export function netMarginPercent({ revenue, netProfit }) {
  if (!revenue) return null;
  return Math.round((netProfit / revenue) * 1000) / 10;
}
