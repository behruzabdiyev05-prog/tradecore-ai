/**
 * Module 10 · Financial Trading — independent from physical trade.
 * A JOURNAL and analysis tool: TRADECORE never sends an order to a broker or exchange and never
 * moves money. "Real" accounts record trades made elsewhere; "demo" accounts are practice.
 * Prices are typed in by the user (live market data needs an authorised provider — Phase 7).
 * Indicators describe the entered prices; they are analysis, not predictions or advice.
 */
import { useMemo, useState } from 'react';
import { LuBell, LuBellOff, LuChartCandlestick, LuDownload, LuPlus, LuTrash2, LuWallet } from 'react-icons/lu';
import ModuleWorkspace from '../_shared/ModuleWorkspace.jsx';
import { getModule } from '../../../shared/modules.js';
import { errorText, formatDateTime, t, tModule, tModuleFeatures } from '../../core/i18n/index.js';
import { useOrg } from '../../core/org/OrgProvider.jsx';
import { Badge, Card, EmptyState, Modal, Notice, Stat } from '../../core/ui/components.jsx';
import { dec, mul, num, positionSize, positions, rsi, sma, str, technicalReading, unrealized } from '../../../shared/modules/trading.js';
import { data } from '../_shared/data.js';
import { AresCard, Field, FormActions, Toolbar, downloadCsv, formGrid, numText, useLoad } from '../_shared/kit.jsx';

const MODULE = getModule('financial-trading');
const MARKETS = ['crypto', 'forex', 'stock', 'index', 'gold', 'commodity'];
const canWriteTrading = (can) => can('data.write') && can('module.financial-trading.write');
const nowLocal = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };
const amt = (big, places = 2) => (big == null ? '—' : numText(num(big), places));
const symbolOk = (s) => /^[A-Z0-9][A-Z0-9./:_-]{0,29}$/.test(s);

function useTradingData() {
  const { orgId } = useOrg();
  const accounts = useLoad(() => data.accounts(orgId), [orgId]);
  const trades = useLoad(() => data.trades(orgId), [orgId]);
  const prices = useLoad(() => data.prices(orgId), [orgId]);
  const lastPrice = useMemo(() => {
    const m = new Map();
    for (const p of prices.data ?? []) m.set(p.symbol, { price: dec(p.price), at: p.observed_at });
    return m;
  }, [prices.data]);
  return { accounts, trades, prices, lastPrice, reload: () => Promise.all([accounts.reload(), trades.reload(), prices.reload()]) };
}

function Disclaimer() {
  return <Notice>{t('ft.disclaimer')}</Notice>;
}

function AccountForm({ orgId, onClose, onSaved }) {
  const [f, setF] = useState({ name: '', kind: 'demo', currency: 'USD', balance: '10000', notes: '' });
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState(null);
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));
  async function submit(e) {
    e.preventDefault(); setBusy(true); setMsg(null);
    try {
      const cur = f.currency.trim().toUpperCase();
      if (!/^[A-Z0-9]{2,10}$/.test(cur)) throw new Error('ft.err.currency');
      await data.saveAccount(orgId, { name: f.name.trim(), kind: f.kind, currency: cur, starting_balance: str(dec(f.balance || '0')), notes: f.notes.trim() || null });
      onSaved();
    } catch (err) { setMsg(errorText(err.name === 'TypeError' ? new Error('mp.err.amount') : err)); setBusy(false); }
  }
  return (
    <Modal title={t('ft.acc.new')} onClose={onClose} width={560}>
      <form className="stack" onSubmit={submit} style={{ gap: 14 }}>
        <div style={formGrid}>
          <Field id="ac-name" label={t('ft.acc.name')} wide><input id="ac-name" className="input" required value={f.name} onChange={set('name')} /></Field>
          <Field id="ac-kind" label={t('ft.acc.kind')}><select id="ac-kind" className="input" value={f.kind} onChange={set('kind')}><option value="demo">{t('ft.acc.demo')}</option><option value="real">{t('ft.acc.real')}</option></select></Field>
          <Field id="ac-cur" label={t('ft.acc.currency')}><input id="ac-cur" className="input" value={f.currency} onChange={set('currency')} /></Field>
          <Field id="ac-bal" label={t('ft.acc.balance')}><input id="ac-bal" className="input num" inputMode="decimal" value={f.balance} onChange={set('balance')} /></Field>
        </div>
        {f.kind === 'real' && <Notice>{t('ft.acc.real_note')}</Notice>}
        {msg && <Notice tone="error">{msg}</Notice>}
        <FormActions onCancel={onClose} busy={busy} />
      </form>
    </Modal>
  );
}

function TradeForm({ orgId, accounts, onClose, onSaved }) {
  const [f, setF] = useState({ account_id: accounts[0]?.id ?? '', symbol: '', market: 'crypto', side: 'buy', quantity: '', price: '', fee: '', executed_at: nowLocal(), notes: '' });
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState(null);
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));
  async function submit(e) {
    e.preventDefault(); setBusy(true); setMsg(null);
    try {
      const symbol = f.symbol.trim().toUpperCase();
      if (!symbolOk(symbol)) throw new Error('ft.err.symbol');
      const q = dec(f.quantity); const p = dec(f.price); const fee = dec(f.fee || '0');
      if (q <= 0n || p <= 0n || fee < 0n) throw new Error('ft.err.positive');
      await data.saveTrade(orgId, { account_id: f.account_id, symbol, market: f.market, side: f.side, quantity: str(q), price: str(p), fee: str(fee),
        executed_at: new Date(f.executed_at).toISOString(), notes: f.notes.trim() || null });
      onSaved();
    } catch (err) { setMsg(errorText(err.name === 'TypeError' ? new Error('mp.err.amount') : err)); setBusy(false); }
  }
  let value = null; try { value = mul(dec(f.quantity), dec(f.price)); } catch { /* typing */ }
  return (
    <Modal title={t('ft.trade.new')} onClose={onClose} width={720}>
      <form className="stack" onSubmit={submit} style={{ gap: 14 }}>
        <div style={formGrid}>
          <Field id="tr-acc" label={t('ft.acc.title')}><select id="tr-acc" className="input" value={f.account_id} onChange={set('account_id')}>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name} · {t(`ft.acc.${a.kind}`)}</option>)}</select></Field>
          <Field id="tr-symbol" label={t('ft.f.symbol')} hint={t('ft.f.symbol_hint')}><input id="tr-symbol" className="input" required value={f.symbol} onChange={(e) => setF((s) => ({ ...s, symbol: e.target.value.toUpperCase() }))} /></Field>
          <Field id="tr-market" label={t('ft.f.market')}><select id="tr-market" className="input" value={f.market} onChange={set('market')}>{MARKETS.map((m) => <option key={m} value={m}>{t(`ft.market.${m}`)}</option>)}</select></Field>
          <Field id="tr-side" label={t('ft.f.side')}><select id="tr-side" className="input" value={f.side} onChange={set('side')}><option value="buy">{t('ft.side.buy')}</option><option value="sell">{t('ft.side.sell')}</option></select></Field>
          <Field id="tr-qty" label={t('ft.f.quantity')}><input id="tr-qty" className="input num" inputMode="decimal" required value={f.quantity} onChange={set('quantity')} /></Field>
          <Field id="tr-price" label={t('ft.f.price')}><input id="tr-price" className="input num" inputMode="decimal" required value={f.price} onChange={set('price')} /></Field>
          <Field id="tr-fee" label={t('ft.f.fee')}><input id="tr-fee" className="input num" inputMode="decimal" value={f.fee} onChange={set('fee')} /></Field>
          <Field id="tr-at" label={t('ft.f.executed_at')}><input id="tr-at" type="datetime-local" className="input" value={f.executed_at} onChange={set('executed_at')} /></Field>
          <Field id="tr-notes" label={t('ft.f.notes')} wide><input id="tr-notes" className="input" value={f.notes} onChange={set('notes')} /></Field>
        </div>
        {value != null && <div className="faint">{t('ft.f.value')}: <span className="num">{amt(value)}</span></div>}
        {msg && <Notice tone="error">{msg}</Notice>}
        <FormActions onCancel={onClose} busy={busy} />
      </form>
    </Modal>
  );
}

function Overview({ module, goTo }) {
  const { accounts, trades, lastPrice } = useTradingData();
  const ready = accounts.data && trades.data;
  const pos = positions(trades.data ?? []);
  const open = pos.filter((p) => p.qty > 0n);
  const realized = pos.reduce((s, p) => s + p.realized, 0n);
  let unreal = 0n; let missing = 0;
  for (const p of open) { const u = unrealized(p, lastPrice.get(p.symbol)?.price ?? null); if (u == null) missing += 1; else unreal += u; }
  return (
    <div className="stack">
      <Disclaimer />
      <div className="grid grid-stats">
        <Stat featured label={t('ft.ov.open_positions')} value={ready ? open.length : null} sub={ready ? t('ft.ov.trades_n', { n: trades.data.length }) : t('common.loading')} />
        <Stat label={t('ft.realized')} value={ready ? amt(realized) : null} />
        <Stat label={t('ft.unrealized')} value={ready ? amt(unreal) : null} sub={missing ? t('ft.ov.missing_prices', { n: missing }) : undefined} />
        <Stat label={t('ft.ov.accounts')} value={ready ? accounts.data.length : null} sub={ready ? t('ft.ov.demo_real', { d: accounts.data.filter((a) => a.kind === 'demo').length, r: accounts.data.filter((a) => a.kind === 'real').length }) : undefined} />
      </div>
      <div className="grid grid-2">
        <Card title={t('ft.ov.positions')} actions={<button className="btn btn-ghost" onClick={() => goTo('portfolio')}>{t('mp.ov.all')}</button>}>
          {!open.length ? <div className="card-pad faint">{t('ft.portfolio.empty')}</div> : (
            <div className="status-list card-pad">{open.slice(0, 8).map((p) => {
              const u = unrealized(p, lastPrice.get(p.symbol)?.price ?? null);
              return <div className="status-row" key={p.symbol}><span className="label">{p.symbol} · {amt(p.qty, 8)}</span><span className={`num ${u != null && u < 0n ? 'neg' : 'pos'}`}>{u == null ? t('ft.no_price') : amt(u)}</span></div>;
            })}</div>
          )}
        </Card>
        <div className="stack">
          <AresCard moduleKey={module.key} name={tModule(module, 'shortName')} />
          <Card title={t('mw.features')}><ul className="feature-list">{tModuleFeatures(module).map((x) => <li key={x}><LuChartCandlestick aria-hidden />{x}</li>)}</ul></Card>
        </div>
      </div>
      <div className="faint" style={{ fontSize: 12 }}>{t('ft.pnl_note')}</div>
    </div>
  );
}

function Journal() {
  const { orgId, can } = useOrg();
  const canWrite = canWriteTrading(can);
  const { accounts, trades, reload } = useTradingData();
  const [adding, setAdding] = useState(null);
  const [filter, setFilter] = useState({ account: '', symbol: '' });
  const [msg, setMsg] = useState(null);
  const accName = Object.fromEntries((accounts.data ?? []).map((a) => [a.id, a]));
  const list = (trades.data ?? []).filter((x) => (!filter.account || x.account_id === filter.account) && (!filter.symbol || x.symbol.includes(filter.symbol.toUpperCase())));
  return (
    <div className="stack">
      <Card title={t('ft.acc.title')} actions={canWrite && <button className="btn" onClick={() => setAdding('account')}><LuWallet /> {t('ft.acc.new')}</button>}>
        {!accounts.data?.length ? <div className="card-pad faint">{accounts.loading ? t('common.loading') : t('ft.acc.empty')}</div> : (
          <div className="table-wrap"><table className="table"><thead><tr><th>{t('ft.acc.name')}</th><th>{t('ft.acc.kind')}</th><th>{t('ft.acc.currency')}</th><th className="r">{t('ft.acc.balance')}</th><th className="r" /></tr></thead>
            <tbody>{accounts.data.map((a) => (
              <tr key={a.id} data-account={a.name}><td>{a.name}</td><td><Badge tone={a.kind === 'demo' ? 'accent' : 'warn'}>{t(`ft.acc.${a.kind}`)}</Badge></td><td>{a.currency}</td><td className="r num">{numText(a.starting_balance, 2)}</td>
                <td className="r">{canWrite && <button className="btn btn-ghost btn-icon" aria-label={t('ft.acc.delete_of', { name: a.name })} onClick={async () => {
                  if (!window.confirm(t('ft.acc.delete_confirm', { name: a.name }))) return;
                  try { await data.deleteAccount(orgId, a.id); reload(); } catch (err) { setMsg(errorText(err)); }
                }}><LuTrash2 /></button>}</td></tr>
            ))}</tbody></table></div>
        )}
      </Card>
      <Card title={t('ft.journal.title')} sub={t('ft.journal.sub')} actions={canWrite && accounts.data?.length > 0 && <button className="btn btn-primary" onClick={() => setAdding('trade')}><LuPlus /> {t('ft.trade.new')}</button>}>
        <Toolbar>
          <select className="input" style={{ width: 200 }} aria-label={t('ft.acc.title')} value={filter.account} onChange={(e) => setFilter((s) => ({ ...s, account: e.target.value }))}>
            <option value="">{t('mp.filter.all')}</option>{(accounts.data ?? []).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          <input className="input" style={{ width: 160 }} placeholder={t('ft.f.symbol')} aria-label={t('ft.f.symbol')} value={filter.symbol} onChange={(e) => setFilter((s) => ({ ...s, symbol: e.target.value }))} />
        </Toolbar>
        {!canWrite && <div className="card-pad" style={{ paddingBottom: 0 }}><Notice>{t('mp.read_only')}</Notice></div>}
        {(trades.error || accounts.error || msg) && <div className="card-pad" style={{ paddingBottom: 0 }}><Notice tone="error">{trades.error || accounts.error || msg}</Notice></div>}
        {!list.length ? <EmptyState icon={LuChartCandlestick} title={t('ft.journal.empty')}>{accounts.data?.length ? t('ft.journal.empty_body') : t('ft.acc.first')}</EmptyState> : (
          <div className="table-wrap"><table className="table ft-trades">
            <thead><tr><th>{t('ft.f.executed_at')}</th><th>{t('ft.acc.title')}</th><th>{t('ft.f.symbol')}</th><th>{t('ft.f.side')}</th><th className="r">{t('ft.f.quantity')}</th><th className="r">{t('ft.f.price')}</th><th className="r">{t('ft.f.fee')}</th><th className="r">{t('ft.f.value')}</th><th className="r" /></tr></thead>
            <tbody>{list.map((x) => (
              <tr key={x.id} data-trade={`${x.symbol}-${x.side}`}>
                <td className="faint">{formatDateTime(x.executed_at)}</td><td>{accName[x.account_id]?.name ?? '—'}</td><td>{x.symbol}<div className="faint" style={{ fontSize: 12 }}>{t(`ft.market.${x.market}`)}</div></td>
                <td><Badge tone={x.side === 'buy' ? 'ok' : 'warn'}>{t(`ft.side.${x.side}`)}</Badge></td>
                <td className="r num">{str(dec(x.quantity), 8)}</td><td className="r num">{str(dec(x.price), 8)}</td><td className="r num">{str(dec(x.fee), 8)}</td>
                <td className="r num">{amt(mul(dec(x.quantity), dec(x.price)))}</td>
                <td className="r">{canWrite && <button className="btn btn-ghost btn-icon" aria-label={t('ft.trade.delete')} onClick={async () => {
                  if (!window.confirm(t('ft.trade.delete_confirm'))) return;
                  try { await data.deleteTrade(orgId, x.id); reload(); } catch (err) { setMsg(errorText(err)); }
                }}><LuTrash2 /></button>}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Card>
      {adding === 'account' && <AccountForm orgId={orgId} onClose={() => setAdding(null)} onSaved={() => { setAdding(null); reload(); }} />}
      {adding === 'trade' && <TradeForm orgId={orgId} accounts={accounts.data ?? []} onClose={() => setAdding(null)} onSaved={() => { setAdding(null); reload(); }} />}
    </div>
  );
}

function Portfolio() {
  const { trades, lastPrice, accounts } = useTradingData();
  const [account, setAccount] = useState('');
  const pos = positions((trades.data ?? []).filter((x) => !account || x.account_id === account));
  return (
    <Card title={t('ft.portfolio.title')} sub={t('ft.portfolio.sub')}>
      <Toolbar>
        <select className="input" style={{ width: 220 }} aria-label={t('ft.acc.title')} value={account} onChange={(e) => setAccount(e.target.value)}>
          <option value="">{t('ft.portfolio.all_accounts')}</option>{(accounts.data ?? []).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      </Toolbar>
      {trades.error && <div className="card-pad"><Notice tone="error">{trades.error}</Notice></div>}
      {!pos.length ? <EmptyState icon={LuWallet} title={t('ft.portfolio.empty')} /> : (
        <div className="table-wrap"><table className="table ft-portfolio">
          <thead><tr><th>{t('ft.f.symbol')}</th><th className="r">{t('ft.f.quantity')}</th><th className="r">{t('ft.portfolio.avg')}</th><th className="r">{t('ft.portfolio.last')}</th><th className="r">{t('ft.portfolio.value')}</th><th className="r">{t('ft.unrealized')}</th><th className="r">{t('ft.realized')}</th></tr></thead>
          <tbody>{pos.map((p) => {
            const lp = lastPrice.get(p.symbol); const u = unrealized(p, lp?.price ?? null);
            return (
              <tr key={p.symbol} data-position={p.symbol}>
                <td>{p.symbol}{p.oversold && <div className="neg" style={{ fontSize: 12 }}>{t('ft.portfolio.oversold')}</div>}</td>
                <td className="r num">{str(p.qty, 8)}</td><td className="r num">{p.avgCost == null ? '—' : amt(p.avgCost, 4)}</td>
                <td className="r num">{lp ? <>{amt(lp.price, 4)}<div className="faint" style={{ fontSize: 11 }}>{formatDateTime(lp.at)}</div></> : t('ft.no_price')}</td>
                <td className="r num">{lp && p.qty > 0n ? amt(mul(p.qty, lp.price)) : '—'}</td>
                <td className={`r num ${u != null && u < 0n ? 'neg' : 'pos'}`}>{u == null ? '—' : amt(u)}</td>
                <td className={`r num ${p.realized < 0n ? 'neg' : 'pos'}`}>{amt(p.realized)}</td>
              </tr>
            );
          })}</tbody>
        </table></div>
      )}
      <div className="card-pad faint" style={{ fontSize: 12 }}>{t('ft.pnl_note')}</div>
    </Card>
  );
}

/** SVG price chart with SMA overlays (no external chart library; reads only entered prices). */
function PriceChart({ points }) {
  if (points.length < 2) return <div className="faint card-pad">{t('ft.chart.need_two')}</div>;
  const W = 760; const H = 260; const P = 36;
  const vals = points.map((p) => p.v);
  const s5 = sma(vals, 5); const s20 = sma(vals, 20);
  const all = [...vals, ...s5.filter((x) => x != null), ...s20.filter((x) => x != null)];
  const min = Math.min(...all); const max = Math.max(...all); const span = max - min || 1;
  const x = (i) => P + (i * (W - 2 * P)) / (points.length - 1);
  const y = (v) => H - P - ((v - min) * (H - 2 * P)) / span;
  const path = (arr) => arr.map((v, i) => (v == null ? null : `${x(i)},${y(v)}`)).filter(Boolean).join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t('ft.chart.label')} style={{ width: '100%', height: 'auto' }} className="ft-chart">
      {[0, 0.5, 1].map((f) => <g key={f}><line x1={P} x2={W - P} y1={y(min + span * f)} y2={y(min + span * f)} stroke="currentColor" opacity="0.12" />
        <text x={4} y={y(min + span * f) + 4} fontSize="11" fill="currentColor" opacity="0.6">{numText(min + span * f, 4)}</text></g>)}
      <polyline points={path(vals)} fill="none" stroke="var(--accent)" strokeWidth="2.2" />
      <polyline points={path(s5)} fill="none" stroke="var(--positive)" strokeWidth="1.4" strokeDasharray="4 3" />
      <polyline points={path(s20)} fill="none" stroke="var(--warning)" strokeWidth="1.4" strokeDasharray="6 4" />
      {points.map((p, i) => <circle key={i} cx={x(i)} cy={y(p.v)} r="2.2" fill="var(--accent)"><title>{`${formatDateTime(p.at)} · ${p.v}`}</title></circle>)}
    </svg>
  );
}

function Prices() {
  const { orgId, can } = useOrg();
  const canWrite = canWriteTrading(can);
  const { prices, trades } = useTradingData();
  const symbols = useMemo(() => [...new Set([...(prices.data ?? []).map((p) => p.symbol), ...(trades.data ?? []).map((x) => x.symbol)])].sort(), [prices.data, trades.data]);
  const [symbol, setSymbol] = useState('');
  const sym = symbol || symbols[0] || '';
  const series = (prices.data ?? []).filter((p) => p.symbol === sym).map((p) => ({ v: Number(p.price), at: p.observed_at, id: p.id }));
  const reading = technicalReading(series.map((p) => p.v));
  const r = rsi(series.map((p) => p.v), Math.min(14, Math.max(1, series.length - 1))).at(-1);
  const [f, setF] = useState({ symbol: '', market: 'crypto', price: '', at: nowLocal() });
  const [msg, setMsg] = useState(null);
  async function add(e) {
    e.preventDefault(); setMsg(null);
    try {
      const s = (f.symbol || sym).trim().toUpperCase();
      if (!symbolOk(s)) throw new Error('ft.err.symbol');
      const p = dec(f.price); if (p <= 0n) throw new Error('ft.err.positive');
      const market = (trades.data ?? []).find((x) => x.symbol === s)?.market ?? (prices.data ?? []).find((x) => x.symbol === s)?.market ?? f.market;
      await data.addPrice(orgId, { symbol: s, market, price: str(p), observed_at: new Date(f.at).toISOString(), source: 'manual' });
      setF((x) => ({ ...x, price: '', at: nowLocal() })); setSymbol(s); await prices.reload();
    } catch (err) { setMsg(errorText(err.name === 'TypeError' ? new Error('mp.err.amount') : err)); }
  }
  return (
    <div className="stack">
      <Disclaimer />
      <Card title={t('ft.prices.title')} sub={t('ft.prices.sub')}>
        {canWrite && (
          <form className="card-pad" onSubmit={add} style={{ ...formGrid, alignItems: 'end' }}>
            <Field id="pr-symbol" label={t('ft.f.symbol')}><input id="pr-symbol" className="input" list="ft-symbols" placeholder={sym} value={f.symbol} onChange={(e) => setF((s) => ({ ...s, symbol: e.target.value.toUpperCase() }))} /></Field>
            <datalist id="ft-symbols">{symbols.map((s) => <option key={s} value={s} />)}</datalist>
            <Field id="pr-market" label={t('ft.f.market')}><select id="pr-market" className="input" value={f.market} onChange={(e) => setF((s) => ({ ...s, market: e.target.value }))}>{MARKETS.map((m) => <option key={m} value={m}>{t(`ft.market.${m}`)}</option>)}</select></Field>
            <Field id="pr-price" label={t('ft.f.price')}><input id="pr-price" className="input num" inputMode="decimal" required value={f.price} onChange={(e) => setF((s) => ({ ...s, price: e.target.value }))} /></Field>
            <Field id="pr-at" label={t('ft.prices.at')}><input id="pr-at" type="datetime-local" className="input" value={f.at} onChange={(e) => setF((s) => ({ ...s, at: e.target.value }))} /></Field>
            <div><button type="submit" className="btn btn-primary"><LuPlus /> {t('ft.prices.add')}</button></div>
          </form>
        )}
        {(prices.error || msg) && <div className="card-pad" style={{ paddingTop: 0 }}><Notice tone="error">{prices.error || msg}</Notice></div>}
        <Toolbar>
          <select className="input" style={{ width: 200 }} aria-label={t('ft.f.symbol')} value={sym} onChange={(e) => setSymbol(e.target.value)}>{symbols.map((s) => <option key={s}>{s}</option>)}</select>
          <span className="faint" style={{ alignSelf: 'center' }}>{t('ft.chart.legend')}</span>
        </Toolbar>
        <div className="card-pad"><PriceChart points={series} /></div>
      </Card>
      <Card title={t('ft.analysis.title')} sub={t('ft.analysis.sub')} pad>
        <div className="status-list ft-analysis">
          <div className="status-row"><span className="label">{t('ft.analysis.reading')}</span><Badge tone={{ bullish: 'ok', bearish: 'warn', overbought: 'warn', oversold: 'accent' }[reading.reading]}>{t(`ft.reading.${reading.reading}`)}</Badge></div>
          <div className="status-row"><span className="label">SMA 5</span><span className="num">{reading.smaShort == null ? '—' : numText(reading.smaShort, 4)}</span></div>
          <div className="status-row"><span className="label">SMA 20</span><span className="num">{reading.smaLong == null ? '—' : numText(reading.smaLong, 4)}</span></div>
          <div className="status-row"><span className="label">RSI</span><span className="num">{r == null ? '—' : numText(r, 1)}</span></div>
          <div className="status-row"><span className="label">{t('ft.analysis.points')}</span><span className="num">{series.length}</span></div>
        </div>
        <p className="faint" style={{ fontSize: 12, marginTop: 10 }}>{t(`ft.reading_explain.${reading.reading}`)} {t('ft.analysis.not_advice')}</p>
      </Card>
    </div>
  );
}

function Alerts() {
  const { orgId, can } = useOrg();
  const canUse = can('module.financial-trading.read');
  const alerts = useLoad(() => data.alerts(orgId), [orgId]);
  const { lastPrice } = useTradingData();
  const [f, setF] = useState({ symbol: '', condition: 'above', price: '', note: '' });
  const [msg, setMsg] = useState(null);
  async function add(e) {
    e.preventDefault(); setMsg(null);
    try {
      const s = f.symbol.trim().toUpperCase(); if (!symbolOk(s)) throw new Error('ft.err.symbol');
      const p = dec(f.price); if (p <= 0n) throw new Error('ft.err.positive');
      await data.saveAlert(orgId, { symbol: s, condition: f.condition, price: str(p), note: f.note.trim() || null });
      setF({ symbol: '', condition: 'above', price: '', note: '' }); alerts.reload();
    } catch (err) { setMsg(errorText(err.name === 'TypeError' ? new Error('mp.err.amount') : err)); }
  }
  const act = async (fn) => { setMsg(null); try { await fn(); alerts.reload(); } catch (err) { setMsg(errorText(err)); } };
  return (
    <Card title={t('ft.alerts.title')} sub={t('ft.alerts.sub')}>
      {canUse && (
        <form className="card-pad" onSubmit={add} style={{ ...formGrid, alignItems: 'end' }}>
          <Field id="al-symbol" label={t('ft.f.symbol')}><input id="al-symbol" className="input" required value={f.symbol} onChange={(e) => setF((s) => ({ ...s, symbol: e.target.value.toUpperCase() }))} /></Field>
          <Field id="al-cond" label={t('ft.alerts.condition')}><select id="al-cond" className="input" value={f.condition} onChange={(e) => setF((s) => ({ ...s, condition: e.target.value }))}><option value="above">{t('ft.alerts.above')}</option><option value="below">{t('ft.alerts.below')}</option></select></Field>
          <Field id="al-price" label={t('ft.f.price')}><input id="al-price" className="input num" inputMode="decimal" required value={f.price} onChange={(e) => setF((s) => ({ ...s, price: e.target.value }))} /></Field>
          <Field id="al-note" label={t('ft.f.notes')}><input id="al-note" className="input" value={f.note} onChange={(e) => setF((s) => ({ ...s, note: e.target.value }))} /></Field>
          <div><button type="submit" className="btn btn-primary"><LuBell /> {t('ft.alerts.add')}</button></div>
        </form>
      )}
      {(alerts.error || msg) && <div className="card-pad" style={{ paddingTop: 0 }}><Notice tone="error">{alerts.error || msg}</Notice></div>}
      {!alerts.data?.length ? <EmptyState icon={LuBell} title={t('ft.alerts.empty')}>{t('ft.alerts.empty_body')}</EmptyState> : (
        <div className="table-wrap"><table className="table ft-alerts">
          <thead><tr><th>{t('ft.f.symbol')}</th><th>{t('ft.alerts.condition')}</th><th className="r">{t('ft.portfolio.last')}</th><th>{t('mp.f.status')}</th><th className="r" /></tr></thead>
          <tbody>{alerts.data.map((a) => (
            <tr key={a.id} data-alert={a.symbol}>
              <td>{a.symbol}{a.note && <div className="faint" style={{ fontSize: 12 }}>{a.note}</div>}</td>
              <td>{t(`ft.alerts.${a.condition}`)} {numText(a.price, 8)}</td>
              <td className="r num">{lastPrice.get(a.symbol) ? amt(lastPrice.get(a.symbol).price, 4) : '—'}</td>
              <td>{a.active ? <Badge tone="accent">{t('ft.alerts.active')}</Badge> : a.triggered_at ? <Badge tone="ok">{t('ft.alerts.triggered', { at: formatDateTime(a.triggered_at) })}</Badge> : <Badge>{t('ft.alerts.off')}</Badge>}</td>
              <td className="r" style={{ whiteSpace: 'nowrap' }}>
                <button className="btn btn-ghost btn-icon" aria-label={a.active ? t('ft.alerts.disable') : t('ft.alerts.enable')} onClick={() => act(() => data.setAlertActive(orgId, a.id, !a.active))}>{a.active ? <LuBellOff /> : <LuBell />}</button>
                <button className="btn btn-ghost btn-icon" aria-label={t('ft.alerts.delete')} onClick={() => act(() => data.deleteAlert(orgId, a.id))}><LuTrash2 /></button>
              </td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      <div className="card-pad faint" style={{ fontSize: 12 }}>{t('ft.alerts.note')}</div>
    </Card>
  );
}

function Risk() {
  const [f, setF] = useState({ balance: '10000', risk: '1', entry: '', stop: '', target: '' });
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));
  let r = null; let err = false;
  try { if (f.entry && f.stop) r = positionSize({ balance: f.balance, riskPercent: f.risk, entry: f.entry, stop: f.stop, target: f.target }); } catch { err = true; }
  return (
    <div className="stack">
      <Card title={t('ft.risk.title')} sub={t('ft.risk.sub')} pad>
        <div style={formGrid}>
          <Field id="rk-bal" label={t('ft.acc.balance')}><input id="rk-bal" className="input num" inputMode="decimal" value={f.balance} onChange={set('balance')} /></Field>
          <Field id="rk-risk" label={t('ft.risk.percent')}><input id="rk-risk" className="input num" inputMode="decimal" value={f.risk} onChange={set('risk')} /></Field>
          <Field id="rk-entry" label={t('ft.risk.entry')}><input id="rk-entry" className="input num" inputMode="decimal" value={f.entry} onChange={set('entry')} /></Field>
          <Field id="rk-stop" label={t('ft.risk.stop')}><input id="rk-stop" className="input num" inputMode="decimal" value={f.stop} onChange={set('stop')} /></Field>
          <Field id="rk-target" label={t('ft.risk.target')}><input id="rk-target" className="input num" inputMode="decimal" value={f.target} onChange={set('target')} /></Field>
        </div>
      </Card>
      {err ? <Notice tone="error">{t('mp.err.amount')}</Notice> : !r ? <Notice>{t('ft.risk.fill')}</Notice> : (
        <div className="grid grid-stats ft-risk">
          <Stat featured label={t('ft.risk.qty')} value={amt(r.qty, 6)} sub={t(`ft.risk.${r.direction}`)} />
          <Stat label={t('ft.risk.amount')} value={amt(r.riskAmount)} />
          <Stat label={t('ft.risk.position_value')} value={amt(r.positionValue)} />
          <Stat label={t('ft.risk.rr')} value={r.rewardRisk == null ? '—' : `1 : ${amt(r.rewardRisk)}`} />
        </div>
      )}
      <div className="faint" style={{ fontSize: 12 }}>{t('ft.risk.note')}</div>
    </div>
  );
}

function Reports() {
  const { trades, accounts } = useTradingData();
  const rows = trades.data ?? [];
  const byMarket = new Map();
  for (const p of positions(rows)) { const g = byMarket.get(p.market) ?? { realized: 0n, fees: 0n, n: 0 }; g.realized += p.realized; g.fees += p.fees; g.n += p.trades; byMarket.set(p.market, g); }
  const byMonth = new Map();
  for (const x of rows) { const k = String(x.executed_at).slice(0, 7); byMonth.set(k, (byMonth.get(k) ?? 0) + 1); }
  const accName = Object.fromEntries((accounts.data ?? []).map((a) => [a.id, a.name]));
  const exportCsv = () => downloadCsv(`trading-journal-${new Date().toISOString().slice(0, 10)}.csv`,
    [t('ft.f.executed_at'), t('ft.acc.title'), t('ft.f.symbol'), t('ft.f.market'), t('ft.f.side'), t('ft.f.quantity'), t('ft.f.price'), t('ft.f.fee'), t('ft.f.notes')],
    rows.map((x) => [x.executed_at, accName[x.account_id], x.symbol, t(`ft.market.${x.market}`), t(`ft.side.${x.side}`), str(dec(x.quantity)), str(dec(x.price)), str(dec(x.fee)), x.notes]));
  return (
    <div className="stack">
      {trades.error && <Notice tone="error">{trades.error}</Notice>}
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}><button className="btn" onClick={exportCsv} disabled={!rows.length}><LuDownload /> {t('op.rep.csv')}</button></div>
      <div className="grid grid-2">
        <Card title={t('ft.rep.by_market')}><div className="table-wrap"><table className="table">
          <thead><tr><th /><th className="r">{t('op.rep.count')}</th><th className="r">{t('ft.realized')}</th><th className="r">{t('ft.f.fee')}</th></tr></thead>
          <tbody>{[...byMarket.entries()].map(([k, g]) => <tr key={k}><td>{t(`ft.market.${k}`)}</td><td className="r num">{g.n}</td><td className={`r num ${g.realized < 0n ? 'neg' : ''}`}>{amt(g.realized)}</td><td className="r num">{amt(g.fees)}</td></tr>)}</tbody>
        </table></div></Card>
        <Card title={t('ft.rep.by_month')}><div className="table-wrap"><table className="table">
          <thead><tr><th /><th className="r">{t('op.rep.count')}</th></tr></thead>
          <tbody>{[...byMonth.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([k, n]) => <tr key={k}><td>{k}</td><td className="r num">{n}</td></tr>)}</tbody>
        </table></div></Card>
      </div>
      <div className="faint" style={{ fontSize: 12 }}>{t('ft.rep.note')}</div>
    </div>
  );
}

const SECTIONS = { overview: Overview, journal: Journal, portfolio: Portfolio, prices: Prices, alerts: Alerts, risk: Risk, reports: Reports };
const TABS = ['overview', 'journal', 'portfolio', 'prices', 'alerts', 'risk', 'reports', 'finance', 'ai'].map((id) => ({
  id, get label() { return ['finance', 'ai'].includes(id) ? t(`mw.tab.${id}`) : t(`ft.tab.${id}`); },
}));

export default function FinancialTradingModule() {
  return <ModuleWorkspace module={MODULE} sections={SECTIONS} tabs={TABS} />;
}
