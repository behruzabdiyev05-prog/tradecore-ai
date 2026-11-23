/**
 * Local E2E harness (no Vite/npm needed): bundles the app with esbuild,
 * serves it with the REAL Netlify function handlers under /api, mocks
 * Supabase, and drives Chromium with Playwright.
 *
 *   node tests/e2e/harness.mjs            (needs esbuild, react, react-dom, react-icons, playwright resolvable)
 */
import { createServer } from 'node:http';
import { readFile, mkdir, rm } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const NODE_PATHS = (process.env.E2E_NODE_PATH ?? '').split(':').filter(Boolean);
const require = createRequire(join(NODE_PATHS[0] ?? ROOT, 'x.js'));
const esbuild = require('esbuild');
const { chromium } = require('playwright');

const OUT = join(ROOT, '.tmp/e2e');
const { ROLE_MATRIX } = await import(join(ROOT, 'shared/permissions.js'));
const ORG_A = '0a000000-0000-4000-8000-00000000000a';
const ORG_B = '0b000000-0000-4000-8000-00000000000b';
const SHOTS = join(ROOT, '.tmp/screenshots');

async function build(dir, env) {
  await esbuild.build({
    entryPoints: [join(ROOT, 'src/main.jsx')],
    bundle: true, splitting: true, format: 'esm', outdir: dir, minify: true,
    jsx: 'automatic', loader: { '.js': 'jsx' }, nodePaths: NODE_PATHS, logLevel: 'error',
    alias: { '@supabase/supabase-js': join(ROOT, 'tests/e2e/supabase-mock.js') },
    define: { 'import.meta.env': JSON.stringify(env) },
  });
  const html = (await readFile(join(ROOT, 'index.html'), 'utf8'))
    .replace('<script type="module" src="/src/main.jsx"></script>', '<link rel="stylesheet" href="/main.css"><script type="module" src="/main.js"></script>');
  await (await import('node:fs/promises')).writeFile(join(dir, 'index.html'), html);
}

const TYPES = { '.jpg': 'image/jpeg', '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.svg': 'image/svg+xml' };

function serve(dir, port) {
  const handlers = {
    health: () => import(join(ROOT, 'netlify/functions/health.mjs')),
    ares: () => import(join(ROOT, 'netlify/functions/ares.mjs')),
    integrations: () => import(join(ROOT, 'netlify/functions/integrations.mjs')),
  };
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${port}`);
    // Mock Supabase Auth user endpoint (used by the real function auth check)
    if (url.pathname === '/auth/v1/user') {
      const tok = (req.headers.authorization ?? '').replace('Bearer ', '');
      const ok = tok.startsWith('mock-token');
      res.writeHead(ok ? 200 : 401, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(ok ? { id: tok === 'mock-token' ? 'u-e2e' : tok.split(':')[1], email: 'x@test.local' } : {}));
    }
    // Membership RPC used by requireMember (mirrors the mock DB: demo = Owner of A, Viewer of B)
    if (url.pathname === '/rest/v1/rpc/check_access') {
      const chunks = []; for await (const c of req) chunks.push(c);
      const { p_org, p_keys } = JSON.parse(Buffer.concat(chunks).toString() || '{}');
      const demo = req.headers.authorization === 'Bearer mock-token';
      const org = p_org ?? ORG_A;
      const role = demo ? { [ORG_A]: 'owner', [ORG_B]: 'viewer' }[org] : null;
      const status = !role ? 'not_member' : p_keys.every((k) => ROLE_MATRIX[role].includes(k)) ? 'ok' : 'forbidden';
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(status));
    }
    if (url.pathname.startsWith('/api/')) {
      const name = url.pathname.slice(5);
      if (!handlers[name]) { res.writeHead(404); return res.end(); }
      const chunks = []; for await (const c of req) chunks.push(c);
      const request = new Request(url, { method: req.method, headers: req.headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks) });
      const response = await (await handlers[name]()).default(request, {});
      res.writeHead(response.status, Object.fromEntries(response.headers));
      return res.end(Buffer.from(await response.arrayBuffer()));
    }
    let file = join(dir, url.pathname);
    if (!extname(url.pathname)) file = join(dir, 'index.html'); // SPA fallback
    if (url.pathname === '/favicon.svg' || url.pathname.startsWith('/backgrounds/')) file = join(ROOT, 'public', url.pathname);
    try {
      const body = await readFile(file);
      res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream' });
      res.end(body);
    } catch { res.writeHead(404); res.end(); }
  });
  return new Promise((r) => server.listen(port, () => r(server)));
}

const results = [];
function check(name, cond, detail = '') {
  results.push({ name, ok: Boolean(cond), detail });
}

async function main() {
  await rm(join(ROOT, '.tmp'), { recursive: true, force: true });
  await mkdir(SHOTS, { recursive: true });
  const PORT = 4789, PORT2 = 4790;
  process.env.SUPABASE_URL = `http://localhost:${PORT}`;
  process.env.SUPABASE_ANON_KEY = 'anon';

  await build(join(OUT, 'configured'), { VITE_SUPABASE_URL: 'https://mock.supabase.co', VITE_SUPABASE_ANON_KEY: 'anon' });
  await build(join(OUT, 'unconfigured'), {});
  const s1 = await serve(join(OUT, 'configured'), PORT);
  const s2 = await serve(join(OUT, 'unconfigured'), PORT2);

  const browser = await chromium.launch();
  const errors = [];
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !/503|401|Failed to load resource/.test(m.text()) && errors.push(m.text()));
  const base = `http://localhost:${PORT}`;

  // 1. Unconfigured → setup screen (no fake data)
  const p2 = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await p2.goto(`http://localhost:${PORT2}/`);
  check('Unconfigured build shows setup screen', await p2.getByText('Konfiqurasiya tələb olunur').isVisible());
  await p2.waitForTimeout(800);
  await p2.screenshot({ path: join(SHOTS, '01-setup-required.png') });

  // 2. Login: wrong password shows AZ error; correct signs in
  await page.goto(`${base}/`);
  check('Login page renders', await page.getByRole('heading', { name: 'Daxil ol' }).isVisible());
  await page.screenshot({ path: join(SHOTS, '02-login.png') });
  await page.fill('#email', 'demo@tradecore.test');
  await page.fill('#password', 'short');
  await page.click('button[type=submit]');
  await page.getByText('ən azı 8 simvol').waitFor({ timeout: 5000 });
  check('Short password rejected client-side (AZ message)', true);
  await page.fill('#password', 'wrong-password');
  await page.click('button[type=submit]');
  await page.getByText('E-poçt və ya şifrə yanlışdır.').waitFor();
  check('Wrong password → AZ error', true);
  await page.fill('#password', 'correct-password');
  await page.click('button[type=submit]');
  await page.getByText('Salam, Test!').waitFor();
  check('Sign-in → dashboard', true);
  check('Light mode is the default', (await page.evaluate(() => document.documentElement.dataset.mode)) === 'light');
  check('Light scene image used', (await page.locator('.scene-layer').last().getAttribute('style')).includes('/backgrounds/light/aurora.jpg'));

  // 3. Dashboard: navigation has 10 modules; finance shows real (empty) state
  const navModules = await page.locator('.sidebar .nav-code').count();
  check('Sidebar lists 10 modules', navModules === 10, `found ${navModules}`);
  check('Dashboard shows empty-ledger message (no fake numbers)', await page.getByText('Hələ əməliyyat qeyd olunmayıb').isVisible());
  await page.getByText('10 modul qeydiyyatda').waitFor();
  check('System status: DB check ok', true);
  await page.getByText('v0.1.0', { exact: true }).waitFor();
  check('System status: real /api/health reached', true);
  await page.getByText('Hələ satış qeyd olunmayıb').waitFor();
  check('Revenue capsule chart: honest empty state (no sample data)', (await page.locator('.chart-wrap svg rect[rx]').count()) >= 8);
  check('Rail collapsed by default (labels hidden)', !(await page.locator('.sidebar .nav-text').first().isVisible()));
  await page.waitForTimeout(900);
  await page.screenshot({ path: join(SHOTS, '03-dashboard.png') });
  await page.click('.rail-toggle');
  check('Rail expands with labels', await page.locator('.sidebar .nav-text', { hasText: 'Topdan Ticarət' }).isVisible());
  await page.screenshot({ path: join(SHOTS, '03b-dashboard-rail-open.png') });
  await page.click('.rail-toggle');
  await page.keyboard.press('Control+k');
  check('Ctrl+K focuses module search', await page.locator('.module-jump input').evaluate((el) => el === document.activeElement));
  await page.keyboard.press('Escape');

  // 4. Every module route loads its own lazy chunk
  for (const key of ['product-research', 'wholesale', 'marketplace', 'arbitrage', 'import-export', 'b2b-trading', 'used-goods', 'digital-products', 'b2b-client-finder', 'financial-trading']) {
    await page.locator(`.sidebar a[href="/m/${key}"]`).click();
    await page.locator('.eyebrow', { hasText: 'MODUL' }).waitFor();
    const url = page.url();
    check(`Module route /m/${key}`, url.endsWith(`/m/${key}`) && (await page.locator('.feature-list li').count()) >= 5);
  }
  check('Section scene switches (financial-trading → nebula)', (await page.locator('.scene').getAttribute('data-scene')) === 'nebula');
  check('Section accent switches', (await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim())) === '#facc15');
  await page.locator('.sidebar a[href="/m/b2b-client-finder"]').click();
  await page.locator('h1', { hasText: 'B2B Müştəri Axtarışı' }).waitFor();
  await page.waitForTimeout(800);
  await page.screenshot({ path: join(SHOTS, '04-module-b2b-client-finder.png') });
  // Phase 3: this module is built now, so the "not built yet" placeholder this check used is gone.
  // Updated (documented in CHANGELOG): a built module must show its own screen, never the placeholder.
  await page.getByRole('tab', { name: 'Potensial müştərilər' }).click();
  check('Unbuilt tab shows honest state', await page.getByText('Hələ potensial müştəri yoxdur').isVisible() && !(await page.getByText('hələ hazırlanmayıb').count()));

  // 5. Module assistant → ARES (real function → 503 not configured)
  await page.getByRole('tab', { name: 'İcmal' }).click();
  await page.getByRole('button', { name: 'Assistenti aç' }).click();
  check('ARES opened scoped to module', (await page.locator('#ares-scope').inputValue()) === 'b2b-client-finder');
  check('ARES status reports not configured', await page.locator('.ares .badge', { hasText: 'Qoşulmayıb' }).isVisible());
  await page.fill('.ares textarea', 'Bakıda potensial çap müştəriləri tap.');
  await page.click('.ares button[type=submit]');
  await page.locator('.msg-system', { hasText: 'Phase 6-da aktivləşdiriləcək' }).waitFor();
  check('ARES message → honest 503 from real handler (authenticated)', true);
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(SHOTS, '05-ares-panel.png') });

  // 6. Finance + System pages, deep link, 404
  await page.goto(`${base}/finance`);
  await page.getByText('Hələ maliyyə əməliyyatı yoxdur').waitFor();
  check('Finance page (deep link) empty state', true);
  check('Margin gauge shows no-data state', await page.getByText('Gəlir yoxdur').isVisible());
  await page.waitForTimeout(800);
  await page.screenshot({ path: join(SHOTS, '06-finance.png') });
  const bgOk = await page.evaluate(async () => (await fetch('/backgrounds/forest.jpg')).ok);
  check('Background image served', bgOk);
  await page.goto(`${base}/system`);
  await page.locator('td', { hasText: 'Amazon SP-API' }).waitFor();
  check('Integrations list from authenticated API', true);
  await page.goto(`${base}/m/does-not-exist`);
  await page.getByText('Səhifə tapılmadı').waitFor().catch(() => {});   // org data loads first (Phase 2A)
  check('Unknown route → 404 page', await page.getByText('Səhifə tapılmadı').isVisible());

  // 7. Module jump search
  await page.goto(`${base}/`);
  await page.fill('.module-jump input', 'arbitraj');
  await page.keyboard.press('Enter');
  await page.locator('h1', { hasText: 'Arbitraj Ticarəti' }).waitFor();
  check('Module jump search navigates', true);

  // 8. Mobile layout
  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
  mobile.on('pageerror', (e) => errors.push(e.message));
  await mobile.goto(`${base}/`);
  await mobile.fill('#email', 'm@tradecore.test');
  await mobile.fill('#password', 'correct-password');
  await mobile.click('button[type=submit]');
  await mobile.locator('.stat').first().waitFor();
  const overflow = await mobile.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  check('Mobile: no horizontal overflow', !overflow);
  check('Mobile: sidebar hidden by default', !(await mobile.locator('.sidebar').evaluate((el) => el.getBoundingClientRect().right > 0)));
  await mobile.screenshot({ path: join(SHOTS, '07-mobile-dashboard.png') });
  await mobile.click('.menu-btn');
  await mobile.waitForTimeout(300);
  check('Mobile: menu opens sidebar', await mobile.locator('.sidebar').evaluate((el) => el.getBoundingClientRect().left >= 0));
  await mobile.screenshot({ path: join(SHOTS, '08-mobile-nav.png') });

  // ══════════ Phase 2A ══════════
  // Organization switcher + permission-aware navigation (Owner of "Test Şirkəti")
  await page.goto(`${base}/`);
  await page.locator('.stat').first().waitFor();
  check('2A: topbar shows active organization', (await page.locator('.org-switcher .org-name').textContent()) === 'Test Şirkəti');
  check('2A: topbar shows role (Sahib)', (await page.locator('.org-switcher .ws-text small').textContent()) === 'Sahib');
  for (const href of ['/system/team', '/system/organization', '/system/audit', '/system/plan']) {
    check(`2A: owner sees nav ${href}`, (await page.locator(`.sidebar a[href="${href}"]`).count()) === 1);
  }

  // Team page: members + invite link (decision B: copy link, no e-mail)
  await page.goto(`${base}/system/team`);
  await page.locator('tr[data-member="aysel@test.local"]').waitFor();
  check('2A: team lists 3 members', (await page.locator('tr[data-member]').count()) === 3);
  check('2A: own role is not editable', (await page.locator('tr[data-member="demo@tradecore.test"] select').count()) === 0);
  await page.fill('#inv-email', 'yeni@test.local');
  await page.selectOption('#inv-role', 'manager');
  await page.click('button:has-text("Dəvət linki yarat")');
  await page.locator('.invite-link').waitFor();
  const inviteLink = await page.locator('.invite-link').inputValue();
  check('2A: invite link shown once (64-hex token)', /\/invite\/[0-9a-f]{64}$/.test(inviteLink), inviteLink);
  await page.locator('td', { hasText: 'yeni@test.local' }).waitFor();
  check('2A: pending invite listed', true);
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(SHOTS, '10-team.png') });

  // Organization settings → rename reflects in the switcher
  await page.goto(`${base}/system/organization`);
  await page.fill('#org-name', 'Test Şirkəti MMC');
  await page.click('button:has-text("Yadda saxla")');
  await page.getByText('Yadda saxlanıldı.').waitFor();
  check('2A: organization renamed', (await page.locator('.org-switcher .org-name').textContent()) === 'Test Şirkəti MMC');

  // Audit + plan pages
  await page.goto(`${base}/system/audit`);
  await page.locator('.audit-table tbody tr').first().waitFor();
  check('2A: audit log shows the invite and the rename',
    (await page.locator('.audit-table code', { hasText: 'organization_invites' }).count()) >= 1
    && (await page.locator('.audit-table code', { hasText: 'organizations' }).count()) >= 1);
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(SHOTS, '11-audit.png') });
  await page.goto(`${base}/system/plan`);
  await page.getByText('Daxili plan').waitFor();
  check('2A: plan page — internal plan, 10/10 modules', (await page.locator('.status-row', { hasText: 'Açıq' }).count()) === 10);

  // Scenario 22: switching organization leaves no data of the previous one on screen
  await page.goto(`${base}/`);
  await page.getByText('Hələ əməliyyat qeyd olunmayıb').waitFor();
  await page.click('.org-switcher .workspace-pill');
  await page.screenshot({ path: join(SHOTS, '12-org-switcher.png') });
  await page.click('.org-menu button:has-text("İkinci Şirkət")');
  await page.waitForFunction(() => document.querySelector('.org-switcher .org-name')?.textContent === 'İkinci Şirkət');
  await page.locator('.stat.featured .stat-value').waitFor();
  await page.waitForFunction(() => /1\D?000/.test(document.querySelector('.stat.featured .stat-value')?.textContent ?? ''));
  check('2A: org B data shown after switch (viewer)', (await page.locator('.org-switcher .ws-text small').textContent()) === 'Müşahidəçi');
  check('2A: viewer has no audit / organization nav', (await page.locator('.sidebar a[href="/system/audit"]').count()) === 0
    && (await page.locator('.sidebar a[href="/system/organization"]').count()) === 0);
  await page.click('.org-switcher .workspace-pill');
  await page.click('.org-menu button:has-text("Test Şirkəti MMC")');
  await page.getByText('Hələ əməliyyat qeyd olunmayıb').waitFor();
  const featured = await page.locator('.stat.featured .stat-value').textContent();
  check('22: no data of org B remains after switching back', !/1\D?000/.test(featured), featured);

  // Scenario 23: direct URL to a page the role may not open → Forbidden, nothing loaded
  await page.click('.org-switcher .workspace-pill');
  await page.click('.org-menu button:has-text("İkinci Şirkət")');
  await page.waitForFunction(() => document.querySelector('.org-switcher .org-name')?.textContent === 'İkinci Şirkət');
  for (const path of ['/system/audit', '/system/organization']) {
    await page.goto(`${base}${path}`);
    await page.getByText('İcazə yoxdur').first().waitFor();
    check(`23: viewer opening ${path} → İcazə yoxdur`, (await page.locator('.audit-table, #org-name').count()) === 0);
  }
  await page.screenshot({ path: join(SHOTS, '13-forbidden.png') });
  await page.goto(`${base}/system`);
  await page.getByText('İnteqrasiyaları idarə etmək üçün rolunuzda icazə yoxdur.').waitFor();
  check('2A: viewer sees no integrations list', (await page.locator('td', { hasText: 'Amazon SP-API' }).count()) === 0);
  await page.click('.org-switcher .workspace-pill');
  await page.click('.org-menu button:has-text("Test Şirkəti MMC")');
  await page.waitForFunction(() => document.querySelector('.org-switcher .org-name')?.textContent === 'Test Şirkəti MMC');

  // Signup requires a company name (decision D)
  const signup = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  await signup.goto(`${base}/`);
  await signup.click('button:has-text("Hesab yarat")');
  check('D: signup form has company name field', await signup.locator('#companyName').isVisible());
  await signup.fill('#email', 'new@test.local');
  await signup.fill('#password', 'correct-password');
  await signup.click('button[type=submit]');
  await signup.getByText('Şirkətin adı məcburidir.').waitFor({ timeout: 5000 });
  check('D: empty company name rejected', true);
  await signup.waitForTimeout(400);
  await signup.screenshot({ path: join(SHOTS, '14-signup-company.png') });
  await signup.close();

  // Invite acceptance: invited e-mail joins the existing organization with the invited role (decision 2)
  await page.click('button[aria-label="Çıxış"]');
  await page.getByRole('heading', { name: 'Daxil ol' }).waitFor();
  await page.goto(inviteLink);
  await page.getByText('dəvət göndərilən e-poçt ünvanı').waitFor();
  check('2A: invite link → sign-in with invite hint', true);
  await page.fill('#email', 'yeni@test.local');
  await page.fill('#password', 'correct-password');
  await page.click('button[type=submit]');
  await page.waitForFunction(() => document.querySelector('.org-switcher .org-name')?.textContent === 'Test Şirkəti MMC', null, { timeout: 15000 });
  check('2A: invited user joined existing org (no new org)', (await page.locator('.org-switcher .ws-text small').textContent()) === 'Menecer');
  await page.click('.org-switcher .workspace-pill');
  check('2A: invited user belongs to exactly one org', (await page.locator('.org-menu button').count()) === 1);
  await page.keyboard.press('Escape');
  await page.click('button[aria-label="Çıxış"]');
  await page.getByRole('heading', { name: 'Daxil ol' }).waitFor();
  await page.fill('#email', 'demo@tradecore.test');
  await page.fill('#password', 'correct-password');
  await page.click('button[type=submit]');
  await page.locator('.stat').first().waitFor();

  // 9. Dark/light toggle (persisted)
  await page.goto(`${base}/`);
  await page.locator('.stat').first().waitFor();
  await page.click('.mode-toggle');
  check('Toggle → dark mode', (await page.evaluate(() => document.documentElement.dataset.mode)) === 'dark');
  const darkScene = await page.waitForFunction(() => {
    const l = [...document.querySelectorAll('.scene-layer')].pop();
    return l && l.getAttribute('style').includes('/backgrounds/aurora.jpg');
  }, null, { timeout: 5000 }).then(() => true).catch(() => false);
  check('Dark scene image used', darkScene);
  await page.waitForTimeout(900);
  await page.screenshot({ path: join(SHOTS, '09-dashboard-dark.png') });
  await page.reload();
  await page.locator('.stat').first().waitFor();
  check('Mode persists after reload', (await page.evaluate(() => document.documentElement.dataset.mode)) === 'dark');
  await page.click('.mode-toggle');
  check('Toggle back → light', (await page.evaluate(() => document.documentElement.dataset.mode)) === 'light');

  // 10. Sign out
  await page.click('button[aria-label="Çıxış"]');
  check('Sign out → login page', await page.getByRole('heading', { name: 'Daxil ol' }).isVisible());

  check('No uncaught runtime errors', errors.length === 0, errors.join(' | '));

  await browser.close();
  s1.close(); s2.close();

  for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? `  (${r.detail})` : ''}`);
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} E2E checks passed`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
