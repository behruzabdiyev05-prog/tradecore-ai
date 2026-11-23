/**
 * Phase 3 browser tests: Modules 01, 02, 04–10. Same approach as the earlier harnesses
 * (unchanged): esbuild bundle, Supabase replaced by tests/e2e/supabase-mock-p3.js.
 *
 *   E2E_NODE_PATH=/opt/npm-tools/node_modules node tests/e2e/modules-harness.mjs
 */
import { createServer } from 'node:http';
import { readFile, mkdir, rm, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const NODE_PATHS = (process.env.E2E_NODE_PATH ?? '').split(':').filter(Boolean);
const require = createRequire(join(NODE_PATHS[0] ?? ROOT, 'x.js'));
const esbuild = require('esbuild');
const { chromium } = require('playwright');
const OUT = join(ROOT, '.tmp/e2e-p3');
const SHOTS = join(ROOT, '.tmp/screenshots-p3');

async function build(dir) {
  await esbuild.build({
    entryPoints: [join(ROOT, 'src/main.jsx')], bundle: true, splitting: true, format: 'esm', outdir: dir, minify: true,
    jsx: 'automatic', loader: { '.js': 'jsx' }, nodePaths: NODE_PATHS, logLevel: 'error',
    alias: { '@supabase/supabase-js': join(ROOT, 'tests/e2e/supabase-mock-p3.js') },
    define: { 'import.meta.env': JSON.stringify({ VITE_SUPABASE_URL: 'https://mock.supabase.co', VITE_SUPABASE_ANON_KEY: 'anon' }) },
  });
  const html = (await readFile(join(ROOT, 'index.html'), 'utf8'))
    .replace('<script type="module" src="/src/main.jsx"></script>', '<link rel="stylesheet" href="/main.css"><script type="module" src="/main.js"></script>');
  await writeFile(join(dir, 'index.html'), html);
}

const TYPES = { '.jpg': 'image/jpeg', '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.svg': 'image/svg+xml' };
function serve(dir, port) {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${port}`);
    if (url.pathname.startsWith('/api/')) { res.writeHead(503, { 'Content-Type': 'application/json' }); return res.end('{}'); }
    let file = join(dir, url.pathname);
    if (!extname(url.pathname)) file = join(dir, 'index.html');
    if (url.pathname === '/favicon.svg' || url.pathname.startsWith('/backgrounds/')) file = join(ROOT, 'public', url.pathname);
    try { const body = await readFile(file); res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream' }); res.end(body); }
    catch { res.writeHead(404); res.end(); }
  });
  return new Promise((r) => server.listen(port, () => r(server)));
}

const results = [];
const check = (name, cond, detail = '') => results.push({ name, ok: Boolean(cond), detail });
const attempt = async (name, fn) => { try { await fn(); } catch (e) { check(name, false, e.message.split('\n')[0]); } };

async function main() {
  await rm(OUT, { recursive: true, force: true });
  await rm(SHOTS, { recursive: true, force: true });
  await mkdir(SHOTS, { recursive: true });
  const PORT = 4797;
  await build(OUT);
  const srv = await serve(OUT, PORT);
  const base = `http://localhost:${PORT}`;
  const browser = await chromium.launch();
  const errors = [];
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !/503|401|Failed to load resource/.test(m.text()) && errors.push(m.text()));
  const dialogs = [];
  page.on('dialog', (d) => { dialogs.push(d.message()); d.accept(); });
  const shot = (n) => page.waitForTimeout(300).then(() => page.screenshot({ path: join(SHOTS, `${n}.png`), fullPage: true }));
  const N = (x) => String(x).replace(/(\d),(\d)/g, '$1.$2').replace(/ | (?=\d{3}\b)/g, '');
  const D = (x) => String(x).replace(/[^\d-]/g, '');   // digits only: ignores thousands and decimal separators
  const tab = (label) => page.click(`.tabs .tab:has-text("${label}")`);
  const modal = () => page.locator('.modal');
  const go = async (key, t) => { await page.goto(`${base}/m/${key}${t ? `?tab=${t}` : ''}`); await page.locator('.tabs .tab').first().waitFor(); };

  await page.goto(`${base}/`);
  await page.fill('#email', 'demo@tradecore.test'); await page.fill('#password', 'correct-password'); await page.click('button[type=submit]');
  await page.getByText('Salam, Test!').waitFor();

  // ── every module opens with its own tabs, no "not built" placeholder ──
  const expectTabs = {
    'product-research': 'Məhsullar', wholesale: 'Sənədlər', arbitrage: 'Fürsətlər', 'import-export': 'Fürsətlər', 'b2b-trading': 'Sənədlər',
    'used-goods': 'Mallar', 'digital-products': 'Məhsullar', 'b2b-client-finder': 'Potensial müştərilər', 'financial-trading': 'Jurnal',
  };
  for (const [key, label] of Object.entries(expectTabs)) {
    await attempt(`module ${key}: opens with its own tabs`, async () => {
      await go(key);
      const tabs = await page.locator('.tabs .tab').allTextContents();
      const placeholder = await page.getByText('hələ hazırlanmayıb').count();
      check(`module ${key}: opens with its own tabs`, tabs.includes(label) && placeholder === 0, tabs.join('|'));
    });
  }

  // ── 01 Product research: record, profit + score, compare, calculator ──
  const addOpp = async (key, f) => {
    await go(key, 'records');
    await page.click(`button:has-text("${f.newLabel}")`);
    await page.fill('#op-title', f.title);
    if (f.currency) { await page.selectOption('#op-currency', f.currency); await page.fill('#op-fx', f.fx); }
    for (const [id, v] of Object.entries(f.fields ?? {})) await page.fill(`#op-${id}`, v);
    for (const [id, v] of Object.entries(f.selects ?? {})) await page.selectOption(`#op-${id}`, v);
    await page.click('.modal button[type=submit]');
    await page.locator(`tr[data-opp="${f.title}"]`).waitFor({ timeout: 4000 });
    return (await page.locator(`tr[data-opp="${f.title}"] td`).allTextContents()).map(N);
  };
  await attempt('01: USD purchase → profit 12.81 ₼/unit, score 80', async () => {
    const cells = await addOpp('product-research', { newLabel: 'Yeni məhsul araşdırması', title: 'Termos 500 ml', currency: 'USD', fx: '1.7',
      fields: { buy: '4.50', shipping: '1.20', sell: '25', feePercent: '10' } });
    check('01: USD purchase → profit 12.81 ₼/unit, score 80', cells[3].includes('9.69') && cells[5].includes('12.81') && cells[7].includes('80'), cells.join(' | '));
  });
  await attempt('01: second record; compare shows both side by side', async () => {
    await addOpp('product-research', { newLabel: 'Yeni məhsul araşdırması', title: 'Kupa', fields: { buy: '3', sell: '6' }, selects: { demand: '1', risk: '5' } });   // score 65
    await page.locator('tr[data-opp="Termos 500 ml"] input[type=checkbox]').check();
    await page.locator('tr[data-opp="Kupa"] input[type=checkbox]').check();
    await page.click('button:has-text("Müqayisə et (2)")');
    const txt = await modal().textContent();
    check('01: second record; compare shows both side by side', txt.includes('Termos 500 ml') && txt.includes('Kupa') && txt.includes('★'), txt.replace(/\s+/g, ' ').slice(-200));
    await page.click('.modal .modal-close');
  });
  await attempt('01: filter by minimum score', async () => {
    await page.selectOption('select[aria-label="Minimum xal"]', '70');
    const n = await page.locator('tr[data-opp]').count();
    check('01: filter by minimum score', n === 1, `${n} rows`);
    await page.selectOption('select[aria-label="Minimum xal"]', '');
  });
  await attempt('01: calculator gives the same result without saving', async () => {
    await tab('Kalkulyator');
    await page.fill('#op-buy', '10'); await page.fill('#op-sell', '20'); await page.fill('#op-feePercent', '5');
    const t = N(await page.locator('.op-result').innerText());
    check('01: calculator gives the same result without saving', t.includes('9.00'), t.replace(/\s+/g, ' '));   // 20 − 1 − 10
  });
  await shot('01-product-research');
  await attempt('01: overview + reports from the records', async () => {
    await tab('İcmal');
    await page.getByText('Ən yaxşı açıq fürsətlər').waitFor();
    const ov = await page.locator('main').innerText();
    await tab('Hesabatlar');
    const csvEnabled = await page.locator('button:has-text("CSV yüklə")').isEnabled();
    check('01: overview + reports from the records', ov.includes('Termos 500 ml') && csvEnabled);
  });

  // ── 05 Import/export: duty + import VAT in the result ──
  await attempt('05: landed cost with duty and import VAT', async () => {
    await go('import-export', 'calculator');
    await page.selectOption('#op-currency', 'USD'); await page.fill('#op-fx', '1.7');
    await page.fill('#op-buy', '100'); await page.fill('#op-shipping', '20'); await page.fill('#op-duty', '15'); await page.fill('#op-importVat', '18'); await page.fill('#op-sell', '400');
    const t = N(await page.locator('.op-result').innerText());
    check('05: landed cost with duty and import VAT', t.includes('204.00') && t.includes('30.60') && t.includes('42.23') && t.includes('276.83'), t.replace(/\s+/g, ' '));
  });
  await attempt('05/04/07/08: records save in each research module', async () => {
    await addOpp('import-export', { newLabel: 'Yeni idxal / ixrac fürsəti', title: 'Fındıq ixracı', fields: { buy: '9', sell: '15' }, selects: { direction: 'export' } });
    await addOpp('arbitrage', { newLabel: 'Yeni arbitraj fürsəti', title: 'Qulaqlıq TR→AZ', currency: 'TRY', fx: '0.05', fields: { buy: '300', sell: '25', origin: 'Trendyol', target: 'Tap.az' } });
    const used = await addOpp('used-goods', { newLabel: 'Yeni işlənmiş mal', title: 'ThinkPad T480', fields: { buy: '300', repair: '40', sell: '450' }, selects: { condition: 'good' } });
    await addOpp('digital-products', { newLabel: 'Yeni rəqəmsal məhsul', title: 'Menyu şablonu', fields: { sell: '15', feePercent: '10', sold: '12' } });
    check('05/04/07/08: records save in each research module', used[1].includes('Yaxşı') && used[5].includes('110.00'), used.join(' | '));
  });
  await shot('02-used-goods');

  // ── 02 Wholesale: supplier, catalogue + MOQ, purchase, posting, bulk calculator ──
  await attempt('02: supplier, product and offer with MOQ in the catalogue', async () => {
    await go('wholesale', 'parties');
    await page.click('button:has-text("Yeni təchizatçı")');
    await page.fill('#co-name', 'Çin Fabriki'); await page.fill('#co-country', 'CN'); await page.fill('#co-city', 'Guangzhou');
    await page.click('.modal button[type=submit]');
    await page.locator('tr[data-company="Çin Fabriki"]').waitFor({ timeout: 4000 });
    await tab('Kataloq');
    await page.click('button:has-text("Yeni məhsul")');
    await page.fill('#cat-name', 'Kağız stəkan 250 ml'); await page.click('form button[type=submit]');
    await page.locator('tr[data-product="Kağız stəkan 250 ml"]').waitFor({ timeout: 4000 });
    await page.click('button:has-text("Yeni təklif")');
    await page.selectOption('#so-sup', { label: 'Çin Fabriki' }); await page.selectOption('#so-cur', 'USD');
    await page.fill('#so-price', '0.04'); await page.fill('#so-fx', '1.7'); await page.fill('#so-moq', '1000');
    await page.click('.modal button[type=submit]');
    await page.waitForTimeout(500);
    const cells = (await page.locator('tr[data-product="Kağız stəkan 250 ml"] td').allTextContents()).map(N);
    check('02: supplier, product and offer with MOQ in the catalogue', cells[2].includes('Çin Fabriki') && cells[2].includes('0.07') && cells[3].includes('1000'), cells.join(' | '));
  });
  await attempt('02: purchase document with lines and total', async () => {
    await tab('Sənədlər');
    await page.click('.tabs[role=tablist] .tab:has-text("Alışlar")').catch(() => {});
    await page.click('button:has-text("Yeni alış")');
    await page.selectOption('#d-company', { label: 'Çin Fabriki' });
    await page.selectOption('.dl-lines select[aria-label="Məhsul"]', { label: 'Kağız stəkan 250 ml' });
    await page.fill('#dl-qty-0', '1000'); await page.fill('#dl-price-0', '0.07');
    await page.click('.modal button[type=submit]');
    await page.locator('tr[data-doc="P-001"]').waitFor({ timeout: 4000 });
    const cells = (await page.locator('tr[data-doc="P-001"] td').allTextContents()).map(N);
    check('02: purchase document with lines and total', cells[1].includes('Çin Fabriki') && cells[4].includes('70.00'), cells.join(' | '));
  });
  await attempt('02: post to finance once; editing is locked afterwards', async () => {
    await page.click('tr[data-doc="P-001"] button:has-text("Maliyyəyə yaz")');
    await page.locator('tr[data-doc="P-001"]').getByText('Yazılıb').waitFor({ timeout: 4000 });
    const editBtns = await page.locator('tr[data-doc="P-001"] button[aria-label^="Sənəd"]').count();
    check('02: post to finance once; editing is locked afterwards', editBtns === 0 && dialogs.some((d) => d.includes('P-001')));
  });
  await attempt('02: bulk calculator warns below MOQ', async () => {
    await tab('Kalkulyator');
    await page.fill('#bc-price', '0.07'); await page.fill('#bc-qty', '500'); await page.fill('#bc-moq', '1000'); await page.fill('#bc-sell', '0.15');
    await page.getByText('minimum sifarişdən (1000) azdır').waitFor({ timeout: 3000 });
    const t = N(await page.locator('main').innerText());
    check('02: bulk calculator warns below MOQ', t.includes('40.00'), 'profit 500 × (0.15 − 0.07) = 40');
  });
  await shot('03-wholesale');

  // ── 06 B2B trading: offer with discount, print view, markup calculator ──
  await attempt('06: commercial offer with discount and printable view', async () => {
    await go('b2b-trading', 'documents');
    await page.click('button:has-text("Yeni təklif")');
    await page.fill('#d-party', 'Şirin Kafe');
    await page.fill('#dl-desc-0', 'Menyu çapı A4'); await page.fill('#dl-qty-0', '3'); await page.fill('#dl-price-0', '10'); await page.fill('.dl-lines input[aria-label="Endirim %"]', '10'); await page.fill('#dl-cost-0', '6');
    await page.click('.modal button[type=submit]');
    await page.locator('tr[data-doc="T-001"]').waitFor({ timeout: 4000 });
    const cells = (await page.locator('tr[data-doc="T-001"] td').allTextContents()).map(N);
    await page.click('tr[data-doc="T-001"] button[aria-label="Çap: T-001"]');
    const pv = N(await page.locator('.print-area').innerText());
    check('06: commercial offer with discount and printable view', cells[4].includes('27.00') && cells[5].includes('33.3') && pv.includes('Şirin Kafe') && pv.includes('27.00'), `${cells.join(' | ')} / ${pv.slice(0, 80)}`);
    await page.click('.modal .modal-close');
  });
  await attempt('06: offers are never posted to finance', async () => {
    const n = await page.locator('tr[data-doc="T-001"] button:has-text("Maliyyəyə yaz")').count();
    check('06: offers are never posted to finance', n === 0);
  });
  await attempt('06: markup calculator', async () => {
    await tab('Kalkulyator');
    await page.fill('#bc-cost', '100'); await page.fill('#bc-markup', '25');
    const t = N(await page.locator('main').innerText());
    check('06: markup calculator', t.includes('125.00') && t.includes('20 %'), 'price 125, margin 20 %');
  });

  // ── 09 B2B Client Finder: lead, score, duplicate warning, history, offer, pipeline ──
  await attempt('09: lead with recommended services and a score', async () => {
    await go('b2b-client-finder', 'leads');
    await page.click('button:has-text("Yeni potensial müştəri")');
    await page.fill('#lf-name', 'Şirin Kafe'); await page.fill('#lf-city', 'Bakı'); await page.fill('#lf-phone', '+994 12 000 00 00');
    await page.selectOption('#lf-segment', 'cafe'); await page.selectOption('#lf-size', 'small');
    await page.click('.modal button[type=submit]');
    await page.locator('tr[data-lead="Şirin Kafe"]').waitFor({ timeout: 4000 });
    const cells = await page.locator('tr[data-lead="Şirin Kafe"] td').allTextContents();
    check('09: lead with recommended services and a score', cells[0].includes('Menyular') && cells[1] === 'Kafe' && /\d+/.test(cells[5]), cells.join(' | '));
  });
  await attempt('09: duplicate business is flagged', async () => {
    await page.click('button:has-text("Yeni potensial müştəri")');
    await page.fill('#lf-name', 'Şirin Kafe'); await page.fill('#lf-city', 'Bakı');
    await modal().getByText('artıq siyahıdadır').waitFor({ timeout: 3000 });
    check('09: duplicate business is flagged', true);
    await page.click('.modal button:has-text("Ləğv et")');
  });
  await attempt('09: contact history moves "new" to "contacted"', async () => {
    await page.click('tr[data-lead="Şirin Kafe"] .link-btn');
    await page.fill('#la-summary', 'Menyu çapı ilə maraqlandılar'); await page.click('.modal button:has-text("Qeyd et")');
    await modal().getByText('Menyu çapı ilə maraqlandılar').waitFor({ timeout: 3000 });
    await page.click('.modal .modal-close');
    await page.locator('tr[data-lead="Şirin Kafe"]').getByText('Əlaqə saxlanılıb').waitFor({ timeout: 3000 });
    check('09: contact history moves "new" to "contacted"', true);
  });
  await attempt('09: offer generator → text with prices, stage "offer sent"', async () => {
    await page.click('tr[data-lead="Şirin Kafe"] button[aria-label^="Təklif hazırla"]');
    await page.fill('#price-menus', '120');
    const text = await page.locator('.lf-offer-text').inputValue();
    await page.click('.modal button:has-text("Saxla")');
    await page.locator('tr[data-lead="Şirin Kafe"]').getByText('Təklif göndərilib').waitFor({ timeout: 4000 });
    check('09: offer generator → text with prices, stage "offer sent"', text.includes('Şirin Kafe') && text.includes('Menyular') && N(text).includes('120.00'), text.slice(0, 120));
  });
  await attempt('09: pipeline moves a lead forward', async () => {
    await tab('Satış mərhələləri');
    await page.click('[data-card="Şirin Kafe"] button[aria-label^="Növbəti mərhələ"]');
    await page.locator('[data-stage="negotiation"] [data-card="Şirin Kafe"]').waitFor({ timeout: 3000 });
    check('09: pipeline moves a lead forward', true);
  });
  await attempt('09: follow-ups and reports', async () => {
    await tab('Növbəti əlaqələr');
    const fu = await page.locator('[data-followup="Şirin Kafe"]').count();
    await tab('Hesabatlar');
    const rep = await page.locator('main').innerText();
    check('09: follow-ups and reports', fu === 1 && rep.includes('Kafe') && rep.includes('Menyular'), `${fu}`);
  });
  await shot('04-client-finder');

  // ── 10 Financial trading: account, trades, portfolio P&L, prices, alert, risk ──
  await attempt('10: demo account and three trades', async () => {
    await go('financial-trading', 'journal');
    await page.click('button:has-text("Yeni hesab")');
    await page.fill('#ac-name', 'Demo'); await page.fill('#ac-cur', 'USDT'); await page.click('.modal button[type=submit]');
    await page.locator('tr[data-account="Demo"]').waitFor({ timeout: 4000 });
    const trade = async (side, q, p, fee, at) => {
      await page.click('button:has-text("Yeni əməliyyat")');
      await page.fill('#tr-symbol', 'BTC/USDT'); await page.selectOption('#tr-side', side);
      await page.fill('#tr-qty', q); await page.fill('#tr-price', p); await page.fill('#tr-fee', fee); await page.fill('#tr-at', at);
      await page.click('.modal button[type=submit]');
      await page.waitForFunction(() => !document.querySelector('.modal'));
    };
    await trade('buy', '0.015', '60000', '0.9', '2026-11-01T10:00');
    await trade('buy', '0.005', '62000', '0.31', '2026-11-02T10:00');
    await trade('sell', '0.01', '65000', '0.65', '2026-11-03T10:00');
    check('10: demo account and three trades', (await page.locator('tr[data-trade]').count()) === 3);
  });
  await attempt('10: portfolio average cost and realized P&L (43.745)', async () => {
    await tab('Portfel');
    const cells = (await page.locator('tr[data-position="BTC/USDT"] td').allTextContents()).map(N);
    check('10: portfolio average cost and realized P&L (43.745)', cells[1].includes('0.01') && D(cells[2]) === '605605' && /^437[45]$/.test(D(cells[6])), cells.join(' | '));
  });
  await attempt('10: alert fires when an entered price crosses it', async () => {
    await tab('Xəbərdarlıqlar');
    await page.fill('#al-symbol', 'BTC/USDT'); await page.fill('#al-price', '65000'); await page.click('button:has-text("Xəbərdarlıq qur")');
    await page.locator('tr[data-alert="BTC/USDT"]').getByText('Aktiv').waitFor({ timeout: 3000 });
    await tab('Qiymət və analiz');
    for (let i = 0; i < 21; i += 1) {
      await page.fill('#pr-symbol', 'BTC/USDT'); await page.fill('#pr-price', String(60000 + i * 250));
      await page.fill('#pr-at', `2026-11-${String(4 + Math.floor(i / 4)).padStart(2, '0')}T${String(8 + (i % 4) * 3).padStart(2, '0')}:00`);
      await page.click('button:has-text("Qiyməti yaz")'); await page.waitForTimeout(60);
    }
    const reading = await page.locator('.ft-analysis').innerText();
    await tab('Xəbərdarlıqlar');
    await page.locator('tr[data-alert="BTC/USDT"]').getByText('İşə düşüb').waitFor({ timeout: 3000 });
    check('10: alert fires when an entered price crosses it', /Yüksələn meyl|Həddən artıq alınıb/.test(reading), reading.replace(/\s+/g, ' '));
  });
  await attempt('10: chart drawn from entered prices + unrealized P&L', async () => {
    await tab('Qiymət və analiz');
    const pts = await page.locator('.ft-chart circle').count();
    await tab('Portfel');
    const cells = (await page.locator('tr[data-position="BTC/USDT"] td').allTextContents()).map(N);
    check('10: chart drawn from entered prices + unrealized P&L', pts === 21 && /^(444|4439|4440)$/.test(D(cells[5])), `${pts} points · ${cells.join(' | ')}`);   // 0.01 × 65000 − 605.605
  });
  await attempt('10: position size from risk (qty 20, R:R 1:3)', async () => {
    await tab('Risk kalkulyatoru');
    await page.fill('#rk-entry', '100'); await page.fill('#rk-stop', '95'); await page.fill('#rk-target', '115');
    const t = N(await page.locator('.ft-risk').innerText());
    check('10: position size from risk (qty 20, R:R 1:3)', /Mövqe ölçüsü\s+20\b/.test(t) && t.includes('1 : 3') && /2[.,]?000/.test(t), t.replace(/\s+/g, ' '));
  });
  await attempt('10: disclaimer — no orders, no advice', async () => {
    await tab('İcmal');
    check('10: disclaimer — no orders, no advice', (await page.getByText('heç bir birjaya və ya brokerə əmr göndərmir').count()) > 0);
  });
  await shot('05-trading');

  // ── English ──
  await attempt('English: Phase 3 screens translated', async () => {
    await page.goto(`${base}/profile`); await page.selectOption('#pf-locale', 'en');
    await page.getByRole('heading', { name: 'My profile' }).waitFor();
    await go('b2b-client-finder', 'leads');
    await page.locator('tr[data-lead]').first().waitFor({ timeout: 4000 });
    const t1 = await page.locator('main').innerText();
    await go('wholesale', 'documents');
    await page.locator('tr[data-doc="P-001"]').waitFor({ timeout: 4000 });
    const t2 = await page.locator('main').innerText();
    check('English: Phase 3 screens translated', t1.includes('Leads') && t1.includes('Cafe') && t2.includes('Purchases') && t2.includes('Posted'), `${t1.slice(0, 80)} / ${t2.slice(0, 80)}`);
    await page.goto(`${base}/profile`); await page.selectOption('#pf-locale', 'az');
    await page.waitForFunction(() => document.documentElement.lang === 'az');
  });

  // ── viewer (org B): read only, no data of org A ──
  await attempt('viewer: read-only in Phase 3 modules, org A data invisible', async () => {
    await page.click('.org-switcher .workspace-pill');
    await page.click('.org-menu button:has-text("İkinci Şirkət")');
    await page.waitForFunction(() => document.querySelector('.org-switcher .org-name')?.textContent === 'İkinci Şirkət');
    await go('product-research', 'records');
    await page.getByText('yalnız baxa bilərsiniz').first().waitFor({ timeout: 4000 });
    const t1 = await page.locator('main').innerText();
    const btn = await page.locator('button:has-text("Yeni məhsul araşdırması")').count();
    await go('b2b-client-finder', 'leads');
    await page.getByText('yalnız baxa bilərsiniz').first().waitFor({ timeout: 4000 });
    const t2 = await page.locator('main').innerText();
    check('viewer: read-only in Phase 3 modules, org A data invisible', btn === 0 && t1.includes('yalnız baxa bilərsiniz') && !t1.includes('Termos') && !t2.includes('Şirin Kafe'), t1.slice(0, 100));
  });

  // ── mobile ──
  await attempt('mobile: no horizontal overflow in the new modules', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    let worst = 0; let where = '';
    for (const [key, t] of [['product-research', 'records'], ['wholesale', 'documents'], ['b2b-client-finder', 'leads'], ['b2b-client-finder', 'pipeline'], ['financial-trading', 'portfolio'], ['financial-trading', 'prices']]) {
      await go(key, t); await page.waitForTimeout(250);
      const o = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      if (o > worst) { worst = o; where = `${key}/${t}`; }
    }
    check('mobile: no horizontal overflow in the new modules', worst <= 1, `${worst}px ${where}`);
  });

  check('No uncaught runtime errors', errors.length === 0, errors.join(' | '));
  await browser.close(); srv.close();
  for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? `  (${r.detail})` : ''}`);
  const passed = results.filter((r) => r.ok).length;
  console.log(`\n${passed}/${results.length} Phase 3 module E2E checks passed`);
  process.exit(passed === results.length ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
