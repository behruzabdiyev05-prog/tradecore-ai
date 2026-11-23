/**
 * Module 10 (Financial Trading) math: exact decimals, positions (average cost),
 * realized / unrealized P&L, indicators (SMA, RSI) and a position-size calculator.
 *
 * Decimals are BigInt scaled by 10^10 (the database stores numeric(28,10)), so
 * 0.1 + 0.2 is exactly 0.3 and crypto quantities keep every digit.
 * Indicators are ANALYSIS of the prices the user entered — never a prediction or advice.
 */

export const SCALE = 10n ** 10n;

/** "12.345" / 12.345 → BigInt × 10^10 (rounded half away from zero at 10 decimals). */
export function dec(v) {
  if (typeof v === 'bigint') return v;
  const s = typeof v === 'number' ? v.toFixed(12) : String(v ?? '0').trim().replace(',', '.');
  if (!/^-?\d+(\.\d+)?$/.test(s)) throw new TypeError(`Yanlış rəqəm: "${v}"`);
  const neg = s.startsWith('-');
  const [i, f = ''] = (neg ? s.slice(1) : s).split('.');
  let n = BigInt(i) * SCALE + BigInt((f + '0000000000').slice(0, 10));
  if (f.length > 10 && Number(f[10]) >= 5) n += 1n;
  return neg ? -n : n;
}
export const mul = (a, b) => divRound(a * b, SCALE);
export const div = (a, b) => (b === 0n ? null : divRound(a * SCALE, b));
function divRound(n, d) {
  const q = n / d; const r = n % d;
  if (r === 0n) return q;
  const up = (r < 0n ? -r : r) * 2n >= (d < 0n ? -d : d);
  return up ? q + ((n < 0n) !== (d < 0n) ? -1n : 1n) : q;
}
/** BigInt × 10^10 → "1234.5" (trailing zeros removed, up to `places` decimals). */
export function str(n, places = 10) {
  if (n == null) return null;
  let v = n;
  if (places < 10) { const f = 10n ** BigInt(10 - places); v = divRound(v, f) * f; }
  const neg = v < 0n; const a = neg ? -v : v;
  const i = a / SCALE; let f = String(a % SCALE).padStart(10, '0').replace(/0+$/, '');
  return `${neg ? '-' : ''}${i}${f ? `.${f}` : ''}`;
}
export const num = (n) => (n == null ? null : Number(str(n)));

/**
 * Positions per symbol from trades (sorted by time). Average-cost method:
 *  buy: qty += q; cost += q × price + fee
 *  sell: realized += q × price − fee − q × avgCost; qty −= q (short selling is refused)
 */
export function positions(trades) {
  const map = new Map();
  const sorted = [...trades].sort((a, b) => String(a.executed_at).localeCompare(String(b.executed_at)));
  for (const t of sorted) {
    const p = map.get(t.symbol) ?? { symbol: t.symbol, market: t.market, qty: 0n, cost: 0n, realized: 0n, fees: 0n, trades: 0, oversold: false };
    const q = dec(t.quantity); const price = dec(t.price); const fee = dec(t.fee ?? 0);
    p.trades += 1; p.fees += fee;
    if (t.side === 'buy') {
      p.qty += q; p.cost += mul(q, price) + fee;
    } else {
      const sellQ = q > p.qty ? p.qty : q;
      if (q > p.qty) p.oversold = true;
      const avg = p.qty > 0n ? div(p.cost, p.qty) : 0n;
      const costOut = mul(sellQ, avg);
      p.realized += mul(sellQ, price) - fee - costOut;
      p.qty -= sellQ; p.cost -= costOut;
      if (p.qty === 0n) p.cost = 0n;
    }
    map.set(t.symbol, p);
  }
  return [...map.values()].map((p) => ({ ...p, avgCost: p.qty > 0n ? div(p.cost, p.qty) : null }));
}

/** Unrealized P&L of a position at `last` price (BigInt), or null without a price. */
export function unrealized(p, last) {
  if (last == null || p.qty === 0n) return p.qty === 0n ? 0n : null;
  return mul(p.qty, last) - p.cost;
}

/** Simple moving average of the last `n` values for every index (null until enough data). */
export function sma(values, n) {
  const out = []; let sum = 0;
  values.forEach((v, i) => { sum += v; if (i >= n) sum -= values[i - n]; out.push(i >= n - 1 ? sum / n : null); });
  return out;
}

/** RSI (Wilder) over `n` periods; null until n + 1 prices. */
export function rsi(values, n = 14) {
  const out = values.map(() => null);
  if (values.length <= n) return out;
  let gain = 0; let loss = 0;
  for (let i = 1; i <= n; i += 1) { const d = values[i] - values[i - 1]; if (d >= 0) gain += d; else loss -= d; }
  gain /= n; loss /= n;
  out[n] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  for (let i = n + 1; i < values.length; i += 1) {
    const d = values[i] - values[i - 1];
    gain = (gain * (n - 1) + Math.max(d, 0)) / n;
    loss = (loss * (n - 1) + Math.max(-d, 0)) / n;
    out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  }
  return out;
}

/**
 * Technical reading of the entered prices — wording keys only, never advice:
 *  'insufficient' (< 20 prices), 'bullish' (short SMA above long and RSI < 70),
 *  'bearish' (short below long and RSI > 30), 'overbought' (RSI ≥ 70), 'oversold' (RSI ≤ 30), 'neutral'.
 */
export function technicalReading(prices, { short = 5, long = 20 } = {}) {
  if (prices.length < long) return { reading: 'insufficient', smaShort: null, smaLong: null, rsi: null };
  const s = sma(prices, short).at(-1); const l = sma(prices, long).at(-1); const r = rsi(prices, Math.min(14, prices.length - 1)).at(-1);
  let reading = 'neutral';
  if (r != null && r >= 70) reading = 'overbought';
  else if (r != null && r <= 30) reading = 'oversold';
  else if (s > l) reading = 'bullish';
  else if (s < l) reading = 'bearish';
  return { reading, smaShort: s, smaLong: l, rsi: r };
}

/**
 * Position size: risk `riskPercent` of `balance` between entry and stop.
 * qty = balance × risk% / |entry − stop|; reward/risk from the target.
 */
export function positionSize({ balance, riskPercent, entry, stop, target }) {
  const b = dec(balance); const e = dec(entry); const s = dec(stop);
  const rp = dec(riskPercent);
  if (b <= 0n || e <= 0n || s <= 0n || rp <= 0n || rp > dec(100)) return null;
  const perUnit = e > s ? e - s : s - e;
  if (perUnit === 0n) return null;
  const riskAmount = div(mul(b, rp), dec(100));
  const qty = div(riskAmount, perUnit);
  const t = target == null || target === '' ? null : dec(target);
  const rr = t == null ? null : div(t > e ? t - e : e - t, perUnit);
  return { riskAmount, qty, positionValue: mul(qty, e), rewardRisk: rr, direction: s < e ? 'long' : 'short' };
}
