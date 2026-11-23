import { useEffect, useMemo, useRef, useState } from 'react';
import { useOrg } from '../../core/org/OrgProvider.jsx';
import { useAuth } from '../../core/auth/AuthProvider.jsx';
import { t } from '../../core/i18n/index.js';
import { Badge, Card, Notice, Stat } from '../../core/ui/components.jsx';
import { breakEvenPrice, listingProfit, priceForMargin } from '../../../shared/marketplace/calc.js';
import { VAT_AS_OF, VAT_RATES, vatRate } from '../../../shared/marketplace/vat.js';
import { marketplace } from './api.js';
import { Field, MoneyInput, formGrid, inputToMinor, minorToInput, money, pct } from './ui.jsx';

const num = (s) => Number(String(s ?? '').replace(',', '.'));

/** Per-user calculator; inputs are remembered in marketplace_calc_prefs. Nothing here is written to orders or finance. */
export default function Calculator({ settings }) {
  const { orgId } = useOrg();
  const { user } = useAuth();
  const [f, setF] = useState({
    sale: '', purchase: '', shipping: '', other: '',
    feePercent: String(settings.payment_fee_percent), feeFixed: minorToInput(settings.payment_fee_fixed_azn_minor, { blankZero: true }),
    vatCode: 'NONE', vatPercent: '0', targetMargin: '30',
  });
  const loaded = useRef(false);
  const set = (k) => (v) => setF((s) => ({ ...s, [k]: typeof v === 'string' ? v : v.target.value }));

  useEffect(() => {
    let alive = true;
    marketplace.calcPrefs(orgId, user?.id).then((p) => {
      if (alive && p && typeof p === 'object') setF((s) => ({ ...s, ...Object.fromEntries(Object.entries(p).filter(([k, v]) => k in s && typeof v === 'string')) }));
    }).catch(() => { /* preferences are optional */ }).finally(() => { loaded.current = true; });
    return () => { alive = false; };
  }, [orgId, user?.id]);

  // remember the inputs (debounced), only after the saved ones were read
  useEffect(() => {
    if (!loaded.current) return undefined;
    const id = setTimeout(() => { marketplace.saveCalcPrefs(orgId, f).catch(() => {}); }, 800);
    return () => clearTimeout(id);
  }, [f, orgId]);

  const result = useMemo(() => {
    try {
      const costs = { purchase: inputToMinor(f.purchase), shipping: inputToMinor(f.shipping), other: inputToMinor(f.other) };
      const opts = { feePercent: num(f.feePercent) || 0, feeFixed: inputToMinor(f.feeFixed), vatPercent: num(f.vatPercent) || 0 };
      const target = num(f.targetMargin);
      return {
        p: listingProfit({ sale: inputToMinor(f.sale), ...costs }, opts),
        breakEven: breakEvenPrice(costs, opts),
        forMargin: target > 0 && target < 100 ? priceForMargin(costs, opts, target) : null,
      };
    } catch (err) {
      return { error: t(err.message?.startsWith('mp.') ? err.message : 'mp.err.calc') };
    }
  }, [f]);

  const chooseVat = (code) => {
    const r = vatRate(code);
    setF((s) => ({ ...s, vatCode: code, vatPercent: code === 'CUSTOM' ? s.vatPercent : String(r?.percent ?? 0) }));
  };
  const vatNote = vatRate(f.vatCode)?.note;

  return (
    <div className="stack">
      <Card title={t('mp.calc.title')} sub={t('mp.calc.sub')} pad>
        <div className="stack" style={{ gap: 14 }}>
          <div style={formGrid}>
            <Field id="c-sale" label={t('mp.f.sale')}><MoneyInput id="c-sale" value={f.sale} onChange={set('sale')} /></Field>
            <Field id="c-purchase" label={t('mp.f.purchase')}><MoneyInput id="c-purchase" value={f.purchase} onChange={set('purchase')} /></Field>
            <Field id="c-shipping" label={t('mp.f.shipping')}><MoneyInput id="c-shipping" value={f.shipping} onChange={set('shipping')} /></Field>
            <Field id="c-other" label={t('mp.f.other')}><MoneyInput id="c-other" value={f.other} onChange={set('other')} /></Field>
            <Field id="c-fee" label={t('mp.set.fee_percent')}><input id="c-fee" className="input num" inputMode="decimal" value={f.feePercent} onChange={set('feePercent')} /></Field>
            <Field id="c-feefix" label={t('mp.set.fee_fixed')}><MoneyInput id="c-feefix" value={f.feeFixed} onChange={set('feeFixed')} /></Field>
            <Field id="c-vat" label={<>{t('mp.calc.vat')} <Badge tone="warn">{t('mp.estimated')}</Badge></>}>
              <select id="c-vat" className="input" value={f.vatCode} onChange={(e) => chooseVat(e.target.value)}>
                {VAT_RATES.map((r) => <option key={r.code} value={r.code}>{t(`mp.vat.${r.code}`)} — {r.percent} %</option>)}
                <option value="CUSTOM">{t('mp.vat.CUSTOM')}</option>
              </select>
            </Field>
            {f.vatCode === 'CUSTOM' && <Field id="c-vatp" label={t('mp.calc.vat_percent')}><input id="c-vatp" className="input num" inputMode="decimal" value={f.vatPercent} onChange={set('vatPercent')} /></Field>}
            <Field id="c-target" label={t('mp.calc.target_margin')}><input id="c-target" className="input num" inputMode="decimal" value={f.targetMargin} onChange={set('targetMargin')} /></Field>
          </div>
          <div className="faint" style={{ fontSize: 12 }}>
            {t('mp.calc.vat_note', { date: VAT_AS_OF })}{vatNote === 'sales_tax' ? ` ${t('mp.vat.us_note')}` : ''}
          </div>
        </div>
      </Card>

      {result.error ? <Notice tone="error">{result.error}</Notice> : (
        <>
          <div className="grid grid-stats">
            <Stat featured label={t('mp.col.profit')} money={result.p.profit} sub={t('mp.calc.per_unit')} />
            <Stat label={t('mp.col.margin')} value={pct(result.p.marginPercent)} />
            <Stat label={t('mp.calc.roi')} value={pct(result.p.roiPercent)} />
            <Stat label={t('mp.calc.break_even')} money={result.breakEven} />
          </div>
          <Card title={t('mp.calc.breakdown')} pad>
            <div className="status-list">
              <div className="status-row"><span className="label">{t('mp.f.sale')}</span><span className="num">{money(result.p.sale)}</span></div>
              <div className="status-row"><span className="label">{t('mp.calc.vat_in_price')}</span><span className="num">−{money(result.p.vat)}</span></div>
              <div className="status-row"><span className="label">{t('mp.calc.fee')}</span><span className="num">−{money(result.p.fee)}</span></div>
              <div className="status-row"><span className="label">{t('mp.col.cost')}</span><span className="num">−{money(result.p.cost)}</span></div>
              <div className="status-row"><span className="label"><strong>{t('mp.col.profit')}</strong></span><strong className={`num ${result.p.profit < 0 ? 'neg' : 'pos'}`}>{money(result.p.profit)}</strong></div>
              <div className="status-row"><span className="label">{t('mp.calc.price_for', { m: f.targetMargin })}</span><span className="num">{result.forMargin == null ? '—' : money(result.forMargin)}</span></div>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
