/**
 * İ-4 browser tests: Modul 03 (Marketplace) screens. Same approach as
 * tests/e2e/phase2b-harness.mjs (unchanged): esbuild bundle, Supabase replaced by
 * tests/e2e/supabase-mock-mp.js (which wraps the 2B mock).
 *
 *   E2E_NODE_PATH=/opt/npm-tools/node_modules node tests/e2e/marketplace-harness.mjs
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
const OUT = join(ROOT, '.tmp/e2e-mp');
const SHOTS = join(ROOT, '.tmp/screenshots-mp');

async function build(dir) {
  await esbuild.build({
    entryPoints: [join(ROOT, 'src/main.jsx')], bundle: true, splitting: true, format: 'esm', outdir: dir, minify: true,
    jsx: 'automatic', loader: { '.js': 'jsx' }, nodePaths: NODE_PATHS, logLevel: 'error',
    alias: { '@supabase/supabase-js': join(ROOT, 'tests/e2e/supabase-mock-mp.js') },
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
  const PORT = 4793;
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
  const shot = (n) => page.waitForTimeout(400).then(() => page.screenshot({ path: join(SHOTS, `${n}.png`), fullPage: true }));
  const tab = (label) => page.click(`.tabs .tab:has-text("${label}")`);
  const row = (attr, name) => page.locator(`tr[${attr}="${name}"]`);
  const modal = () => page.locator('.modal');
  const N = (x) => String(x).replace(/(\d),(\d)/g, '$1.$2');   // decimal comma or point, depending on the browser's ICU data

  await page.goto(`${base}/`);
  await page.fill('#email', 'demo@tradecore.test'); await page.fill('#password', 'correct-password'); await page.click('button[type=submit]');
  await page.getByText('Salam, Test!').waitFor();

  // ── tabs ──
  await page.goto(`${base}/m/marketplace`);
  await page.locator('.tabs .tab').first().waitFor();
  const tabs = await page.locator('.tabs .tab').allTextContents();
  check('tabs: Modul 03 has its own 8 tabs', tabs.join('|') === 'İcmal|Məhsullar|Sifarişlər|Təchizatçılar|Kalkulyator|Mağaza və parametrlər|Maliyyə|AI assistent', tabs.join('|'));
  await shot('01-overview-empty');

  // ── products ──
  await tab('Məhsullar');
  await attempt('products: empty state', async () => { await page.getByText('Hələ məhsul yoxdur').waitFor({ timeout: 3000 }); check('products: empty state', true); });
  const addProduct = async (f) => {
    await page.click('button:has-text("Yeni məhsul")');
    await page.fill('#mp-name', f.name); await page.fill('#mp-sku', f.sku ?? '');
    await page.fill('#mp-purchase', f.purchase); await page.fill('#mp-shipping', f.shipping); await page.fill('#mp-other', f.other ?? '');
    await page.fill('#mp-sale', f.sale); await page.fill('#mp-stock', f.stock);
    await page.click('.modal button[type=submit]');
    await row('data-listing', f.name).waitFor({ timeout: 4000 });
  };
  await attempt('products: create', async () => {
    await addProduct({ name: 'Simsiz qulaqlıq', sku: 'SQ-1', purchase: '8', shipping: '3', other: '1', sale: '20', stock: '10' });
    await addProduct({ name: 'Telefon qabı', purchase: '2', shipping: '1', sale: '5', stock: '2' });
    check('products: create', (await page.locator('tr[data-listing]').count()) === 2);
  });
  await attempt('products: profit = sale − cost − 2.9 % fee (20 − 12 − 0.58 = 7.42)', async () => {
    const cells = (await row('data-listing', 'Simsiz qulaqlıq').locator('td').allTextContents()).map(N);
    check('products: profit = sale − cost − 2.9 % fee (20 − 12 − 0.58 = 7.42)', cells[3].includes('12.00') && cells[5].includes('7.42') && cells[6].includes('37.1'), cells.join(' | '));
  });
  await attempt('products: low-stock filter', async () => {
    await page.selectOption('select[aria-label="Status"]', 'low');
    const names = await page.locator('tr[data-listing]').evaluateAll((rs) => rs.map((r) => r.dataset.listing));
    check('products: low-stock filter', names.join() === 'Telefon qabı', names.join());
    await page.selectOption('select[aria-label="Status"]', 'all');
  });
  await attempt('products: wrong amount shows a clear message', async () => {
    await page.click('button:has-text("Yeni məhsul")');
    await page.fill('#mp-name', 'Səhv'); await page.fill('#mp-sale', 'on beş');
    await page.click('.modal button[type=submit]');
    await modal().getByText('Məbləği rəqəmlə yazın').waitFor({ timeout: 3000 });
    check('products: wrong amount shows a clear message', true);
    await page.click('.modal button:has-text("Ləğv et")');
  });
  await shot('02-products');

  // ── orders ──
  await tab('Sifarişlər');
  const newOrder = async (num, qty) => {
    await page.click('button:has-text("Yeni sifariş")');
    await page.fill('#o-num', num); await page.fill('#o-cust', 'Kamran');
    const value = await page.locator('#l-p-0 option').evaluateAll((os) => os.find((o) => o.textContent.startsWith('Simsiz qulaqlıq'))?.value);
    await page.selectOption('#l-p-0', value);
    await page.fill('#l-q-0', String(qty));
    await page.click('.modal button[type=submit]');
  };
  await attempt('orders: manual order created, totals and profit shown', async () => {
    await newOrder('M-1', 3);
    await row('data-order', 'M-1').waitFor({ timeout: 4000 });
    const cells = (await row('data-order', 'M-1').locator('td').allTextContents()).map(N);
    check('orders: manual order created, totals and profit shown', cells[3].includes('60.00') && cells[4].includes('24.00'), cells.join(' | '));
  });
  await attempt('orders: stock short → clear error, nothing written (D4)', async () => {
    await newOrder('M-2', 99);
    await modal().getByText('Stok kifayət etmir. Mövcud stok: 7').waitFor({ timeout: 3000 });
    await page.click('.modal button:has-text("Ləğv et")');
    check('orders: stock short → clear error, nothing written (D4)', (await row('data-order', 'M-2').count()) === 0);
  });
  await attempt('orders: duplicate number refused (D7)', async () => {
    await newOrder('M-1', 1);
    await modal().getByText('Bu nömrəli sifariş artıq var: M-1').waitFor({ timeout: 3000 });
    await page.click('.modal button:has-text("Ləğv et")');
    check('orders: duplicate number refused (D7)', true);
  });
  await attempt('orders: status + supplier status saved and visible in history', async () => {
    await row('data-order', 'M-1').locator('.link-btn').click();
    await page.selectOption('#d-status', 'transit');
    await page.fill('#d-track', 'AZ123');
    await page.locator('.modal select[aria-label="Təchizatçı statusu"]').selectOption('ordered');
    await page.click('.modal button[type=submit]');
    await row('data-order', 'M-1').getByText('Yoldadır').waitFor({ timeout: 3000 });
    await row('data-order', 'M-1').locator('button[aria-label^="Tarixçə"]').click();
    const text = await modal().textContent();
    check('orders: status + supplier status saved and visible in history', /Hazırlanır → Yoldadır/.test(text) && text.includes('AZ123'), text.slice(0, 200));
    await page.click('.modal .modal-close');
  });
  await shot('03-orders');
  await attempt('orders: archive hides, archive view shows', async () => {
    await row('data-order', 'M-1').locator('button[aria-label="Arxivə göndər"]').click();
    await page.getByText('Hələ sifariş yoxdur').waitFor({ timeout: 3000 });
    await page.click('button:has-text("Arxiv")');
    await row('data-order', 'M-1').waitFor({ timeout: 3000 });
    check('orders: archive hides, archive view shows', true);
    await row('data-order', 'M-1').locator('button[aria-label="Arxivdən çıxar"]').click();
    await page.click('button:has-text("Aktiv sifarişlər")');
    await row('data-order', 'M-1').waitFor({ timeout: 3000 });
  });

  // ── stock went down; product with orders cannot be deleted → draft (D6) ──
  await tab('Məhsullar');
  await attempt('products: stock reduced by the order (10 → 7)', async () => {
    const stock = await row('data-listing', 'Simsiz qulaqlıq').locator('td').nth(2).textContent();
    check('products: stock reduced by the order (10 → 7)', stock.trim().startsWith('7'), stock);
  });
  await attempt('products: product with orders → not deleted, offered as draft (D6)', async () => {
    dialogs.length = 0;
    await row('data-listing', 'Simsiz qulaqlıq').locator('button[aria-label^="Sil"]').click();
    await row('data-listing', 'Simsiz qulaqlıq').getByText('Qaralama').waitFor({ timeout: 3000 });
    check('products: product with orders → not deleted, offered as draft (D6)', dialogs.length === 2 && dialogs[1].includes('1 sifariş sətri var'), dialogs.join(' / '));
  });
  await attempt('products: product without orders is deleted', async () => {
    await row('data-listing', 'Telefon qabı').locator('button[aria-label^="Sil"]').click();
    await page.waitForFunction(() => !document.querySelector('tr[data-listing="Telefon qabı"]'), null, { timeout: 3000 });
    check('products: product without orders is deleted', true);
  });

  // ── supplier offers ──
  await tab('Təchizatçılar');
  const addOffer = async (o) => {
    await page.click('button:has-text("Yeni təklif")');
    await page.fill('#s-name', o.name); await page.selectOption('#s-cur', o.cur);
    await page.fill('#s-price', o.price); await page.fill('#s-ship', o.ship);
    if (o.fx) await page.fill('#s-fx', o.fx);
    await page.click('.modal button[type=submit]');
    await page.locator(`tr[data-offer="${o.name}"]`).waitFor({ timeout: 3000 });
  };
  await attempt('suppliers: foreign currency converted with the entered rate; cheapest first', async () => {
    await addOffer({ name: 'AliExpress', cur: 'USD', price: '5', ship: '1', fx: '1.7' });
    await addOffer({ name: 'Bakı topdan', cur: 'AZN', price: '9', ship: '0' });
    const rows = await page.locator('tr[data-offer]').evaluateAll((rs) => rs.map((r) => r.innerText.replace(/\s+/g, ' ')));
    check('suppliers: foreign currency converted with the entered rate; cheapest first',
      rows[0].startsWith('Bakı topdan') && rows[0].includes('Ən ucuz') && N(rows[1]).includes('10.20'), rows.join(' / '));
  });
  await attempt('suppliers: price change goes to the price log', async () => {
    await page.locator('tr[data-offer="AliExpress"] button[aria-label="Təklifi redaktə et"]').click();
    await page.fill('#s-price', '4'); await page.click('.modal button[type=submit]');
    await page.locator('tr[data-offer="AliExpress"] button[aria-label^="Qiymət tarixçəsi"]').click();
    const n = await modal().locator('tbody tr').count();
    check('suppliers: price change goes to the price log', n === 2, `${n} rows`);
    await page.click('.modal .modal-close');
  });
  await shot('04-suppliers');

  // ── calculator ──
  await tab('Kalkulyator');
  await attempt('calculator: 20 ₼ sale, 12 ₼ cost, 2.9 % fee, Azerbaijan 18 % VAT → 4.37 ₼ profit', async () => {
    await page.fill('#c-sale', '20'); await page.fill('#c-purchase', '8'); await page.fill('#c-shipping', '3'); await page.fill('#c-other', '1');
    await page.selectOption('#c-vat', 'AZ');
    await page.waitForTimeout(200);
    const t = N(await page.locator('.status-list').last().innerText());
    check('calculator: 20 ₼ sale, 12 ₼ cost, 2.9 % fee, Azerbaijan 18 % VAT → 4.37 ₼ profit', t.includes('3.05') && t.includes('0.58') && t.includes('4.37'), t.replace(/\s+/g, ' '));
    check('calculator: VAT is labelled as an estimate', (await page.getByText('təxmini').count()) > 0);
  });
  await shot('05-calculator');
  await attempt('calculator: inputs are remembered for this user', async () => {
    await page.waitForTimeout(1000);
    await page.reload();
    await tab('Kalkulyator');
    await page.waitForFunction(() => document.querySelector('#c-sale')?.value === '20', null, { timeout: 4000 });
    check('calculator: inputs are remembered for this user', true);
  });

  // ── settings ──
  await tab('Mağaza və parametrlər');
  await attempt('settings: owner saves fee; product profit follows (3 % → 7.40)', async () => {
    await page.fill('#st-fee', '3');
    await page.click('button:has-text("Yadda saxla")');
    await page.getByText('Yadda saxlanıldı').waitFor({ timeout: 3000 });
    await tab('Məhsullar');
    const cells = (await row('data-listing', 'Simsiz qulaqlıq').locator('td').allTextContents()).map(N);
    check('settings: owner saves fee; product profit follows (3 % → 7.40)', cells[5].includes('7.40'), cells.join(' | '));
  });
  await attempt('store: Shopify shown as not connected (İ-5)', async () => {
    await tab('Mağaza və parametrlər');
    await page.getByText('Qoşulmayıb').waitFor({ timeout: 3000 });
    check('store: Shopify shown as not connected (İ-5)', true);
  });

  // ── notification links open the right tab ──
  await attempt('link /m/marketplace?tab=orders opens Orders', async () => {
    await page.goto(`${base}/m/marketplace?tab=orders`);
    await row('data-order', 'M-1').waitFor({ timeout: 4000 });
    check('link /m/marketplace?tab=orders opens Orders', true);
  });

  // ── English ──
  await attempt('English: tabs and table headings translated', async () => {
    await page.goto(`${base}/profile`);
    await page.selectOption('#pf-locale', 'en');
    await page.getByRole('heading', { name: 'My profile' }).waitFor();
    await page.goto(`${base}/m/marketplace?tab=products`);
    await page.locator('tr[data-listing]').first().waitFor({ timeout: 4000 });
    const tabsEn = await page.locator('.tabs .tab').allTextContents();
    const head = await page.locator('table.mp-products thead').innerText();
    check('English: tabs and table headings translated', tabsEn.includes('Products') && tabsEn.includes('Suppliers') && /profit/i.test(head), `${tabsEn.join('|')} / ${head}`);
    await page.goto(`${base}/profile`);
    await page.selectOption('#pf-locale', 'az');
    await page.waitForFunction(() => document.documentElement.lang === 'az');
  });

  // ── viewer: read only ──
  await attempt('viewer (org B): read-only notice, no create buttons, no data of org A', async () => {
    await page.click('.org-switcher .workspace-pill');
    await page.click('.org-menu button:has-text("İkinci Şirkət")');
    await page.waitForFunction(() => document.querySelector('.org-switcher .org-name')?.textContent === 'İkinci Şirkət');
    await page.goto(`${base}/m/marketplace?tab=products`);
    await page.locator('.notice').first().waitFor({ timeout: 4000 });
    const txt = await page.locator('main').innerText();
    check('viewer (org B): read-only notice, no create buttons, no data of org A',
      txt.includes('yalnız baxa bilərsiniz') && (await page.locator('button:has-text("Yeni məhsul")').count()) === 0 && !txt.includes('Simsiz qulaqlıq'), txt.slice(0, 160));
  });
  await shot('06-viewer');

  // ── mobile ──
  await attempt('mobile: no horizontal overflow on Marketplace', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    let worst = 0;
    for (const t of ['products', 'orders', 'suppliers', 'calculator', 'store']) {
      await page.goto(`${base}/m/marketplace?tab=${t}`);
      await page.locator('.tabs .tab').first().waitFor({ timeout: 5000 });
      await page.waitForTimeout(300);
      worst = Math.max(worst, await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth));
    }
    check('mobile: no horizontal overflow on Marketplace', worst <= 1, `${worst}px`);
    await page.screenshot({ path: join(SHOTS, '07-mobile.png'), fullPage: true });
  });

  check('No uncaught runtime errors', errors.length === 0, errors.join(' | '));
  await browser.close(); srv.close();
  for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? `  (${r.detail})` : ''}`);
  const passed = results.filter((r) => r.ok).length;
  console.log(`\n${passed}/${results.length} İ-4 Marketplace E2E checks passed`);
  process.exit(passed === results.length ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
