/**
 * Phase 2B browser tests (scenarios 43, 44 + profile, settings, notifications,
 * search, navigation, languages, 2FA). Same approach as tests/e2e/harness.mjs
 * (which stays unchanged and still passes): esbuild bundle, the real Netlify
 * handlers under /api, Supabase replaced by tests/e2e/supabase-mock-2b.js.
 *
 *   E2E_NODE_PATH=/opt/npm-tools/node_modules node tests/e2e/phase2b-harness.mjs
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

const OUT = join(ROOT, '.tmp/e2e-2b');
const SHOTS = join(ROOT, '.tmp/screenshots-2b');
const ORG_A = '0a000000-0000-4000-8000-00000000000a';
const ORG_B = '0b000000-0000-4000-8000-00000000000b';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const { ROLE_MATRIX } = await import(join(ROOT, 'shared/permissions.js'));

async function build(dir) {
  await esbuild.build({
    entryPoints: [join(ROOT, 'src/main.jsx')], bundle: true, splitting: true, format: 'esm', outdir: dir, minify: true,
    jsx: 'automatic', loader: { '.js': 'jsx' }, nodePaths: NODE_PATHS, logLevel: 'error',
    alias: { '@supabase/supabase-js': join(ROOT, 'tests/e2e/supabase-mock-2b.js') },
    define: { 'import.meta.env': JSON.stringify({ VITE_SUPABASE_URL: 'https://mock.supabase.co', VITE_SUPABASE_ANON_KEY: 'anon' }) },
  });
  const html = (await readFile(join(ROOT, 'index.html'), 'utf8'))
    .replace('<script type="module" src="/src/main.jsx"></script>', '<link rel="stylesheet" href="/main.css"><script type="module" src="/main.js"></script>');
  await writeFile(join(dir, 'index.html'), html);
}

const TYPES = { '.jpg': 'image/jpeg', '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.svg': 'image/svg+xml' };
function serve(dir, port) {
  const handlers = { health: () => import(join(ROOT, 'netlify/functions/health.mjs')), ares: () => import(join(ROOT, 'netlify/functions/ares.mjs')),
    integrations: () => import(join(ROOT, 'netlify/functions/integrations.mjs')) };
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${port}`);
    if (url.pathname === '/auth/v1/user') {
      const tok = (req.headers.authorization ?? '').replace('Bearer ', '');
      const good = tok.startsWith('mock-token');
      res.writeHead(good ? 200 : 401, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(good ? { id: 'u-e2e', email: 'x@test.local' } : {}));
    }
    if (url.pathname === '/rest/v1/rpc/check_access') {
      const chunks = []; for await (const c of req) chunks.push(c);
      const { p_org, p_keys } = JSON.parse(Buffer.concat(chunks).toString() || '{}');
      const role = req.headers.authorization === 'Bearer mock-token' ? { [ORG_A]: 'owner', [ORG_B]: 'viewer' }[p_org ?? ORG_A] : null;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(!role ? 'not_member' : p_keys.every((k) => ROLE_MATRIX[role].includes(k)) ? 'ok' : 'forbidden'));
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
  const PORT = 4791;
  process.env.SUPABASE_URL = `http://localhost:${PORT}`;
  process.env.SUPABASE_ANON_KEY = 'anon';
  await build(OUT);
  const srv = await serve(OUT, PORT);
  const base = `http://localhost:${PORT}`;
  const browser = await chromium.launch();
  const errors = [];
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !/503|401|Failed to load resource/.test(m.text()) && errors.push(m.text()));
  const shot = (n) => page.waitForTimeout(500).then(() => page.screenshot({ path: join(SHOTS, `${n}.png`) }));
  const signIn = async (p = page, email = 'demo@tradecore.test') => {
    await p.fill('#email', email); await p.fill('#password', 'correct-password'); await p.click('button[type=submit]');
  };
  const orgName = () => page.locator('.org-switcher .org-name').textContent();
  const switchTo = async (name) => {
    await page.click('.org-switcher .workspace-pill');
    await page.click(`.org-menu button:has-text("${name}")`);
    await page.waitForFunction((n) => document.querySelector('.org-switcher .org-name')?.textContent === n, name);
  };
  const bellCount = async () => ((await page.locator('.notif-count').count()) ? (await page.locator('.notif-count').textContent()) : '0');

  // ── sign in, dashboard, first-steps card ────────────────
  await page.goto(`${base}/`);
  await signIn();
  await page.getByText('Salam, Test!').waitFor();
  await attempt('dashboard: first-steps card from real data', async () => {
    await page.locator('.onboarding').waitFor({ timeout: 5000 });
    check('dashboard: first-steps card from real data', (await page.locator('.onboarding li').count()) === 4
      && (await page.locator('.onboarding li[data-done="true"]').count()) === 1, 'team (3 members) already done');
  });
  await shot('20-dashboard-onboarding');

  // ── notifications: bell, own rows only, read state, realtime ──
  await page.locator('.notif-count').waitFor();
  check('bell: unread count = own notifications of org A (2)', (await bellCount()) === '2');
  await page.click('.notif-bell > button');
  await page.locator('.notif-menu .notif-item').first().waitFor();
  const items = await page.locator('.notif-menu .notif-item').allTextContents();
  check('bell: lists only my notifications of org A', items.length === 2 && items.some((x) => x.includes('Murad Əliyev dəvətinizi qəbul etdi'))
    && !items.some((x) => x.includes('Başqasının') || x.includes('İkinci Şirkət')), items.join(' | '));
  await shot('21-bell-open');
  await page.click('.notif-menu-head .link-btn');
  await page.waitForFunction(() => !document.querySelector('.notif-count'));
  check('bell: "mark all read" clears the count', (await bellCount()) === '0');
  await page.keyboard.press('Escape');
  const t0 = Date.now();
  await page.evaluate((org) => window.__e2eNotify({ org_id: org, type: 'member.joined', title: 'Yeni Üzv komandaya qoşuldu', data: { name: 'Yeni Üzv' } }), ORG_A);
  await page.locator('.notif-count').waitFor({ timeout: 3000 });
  check('realtime: a new notification appears without reload (< 3 s)', (await bellCount()) === '1', `${Date.now() - t0} ms`);

  // ── scenario 44: switching organization clears bell, search, recent pages ──
  await page.goto(`${base}/finance`); await page.getByText('Hələ maliyyə əməliyyatı yoxdur').waitFor();
  await page.goto(`${base}/settings/team`); await page.locator('tr[data-member]').first().waitFor();
  await switchTo('İkinci Şirkət');
  await page.locator('.notif-count').waitFor();
  check('44: bell shows org B count only (1)', (await bellCount()) === '1');
  await page.click('.notif-bell > button');
  const bItems = await page.locator('.notif-menu .notif-item').allTextContents();
  check('44: no notification of org A in the bell', bItems.length === 1 && !bItems.some((x) => /Murad|Aysel|Yeni Üzv/.test(x)), bItems.join(' | '));
  await page.keyboard.press('Escape');
  await page.click('.module-jump input');
  // "Maliyyə mərkəzi" was viewed only in org A (the viewer could open it in B too, so it would show if lists mixed)
  check('44: no "recently viewed" pages of org A', (await page.locator('.palette-list button', { hasText: 'Maliyyə mərkəzi' }).count()) === 0);
  await page.fill('.module-jump input', 'Aysel');
  await page.waitForTimeout(700);
  check('44: search in org B does not find org A members', (await page.locator('.palette-list [data-kind="member"]').count()) === 0);
  await page.fill('.module-jump input', 'Market');
  await page.locator('.palette-list [data-kind="company"]').first().waitFor();
  const bCompanies = await page.locator('.palette-list [data-kind="company"]').allTextContents();
  check('44: search in org B finds only org B records', bCompanies.length === 1 && bCompanies[0].includes('Gizli B Market'), bCompanies.join(' | '));
  await page.keyboard.press('Escape');

  // ── scenario 43: hidden pages are refused by address too (viewer in B) ──
  for (const path of ['/settings/security', '/settings/audit', '/settings/organization', '/system/audit']) {
    await page.goto(`${base}${path}`);
    await page.getByText('İcazə yoxdur').first().waitFor();
    check(`43: viewer opening ${path} → İcazə yoxdur`, (await page.locator('.settings-body #org-name, .audit-table, #mfa-role-owner').count()) === 0);
  }
  await page.goto(`${base}/settings`);
  await page.locator('.settings-nav').waitFor();
  const navB = await page.locator('.settings-nav-item').allTextContents();
  check('43: viewer settings menu has no security / organization / audit', !navB.some((x) => /Təhlükəsizlik|Audit|^\s*Şirkət$/.test(x.trim())), navB.join(' | '));
  await shot('22-settings-viewer');
  await switchTo('Test Şirkəti');
  check('44: back in org A — recently viewed shows A pages', await (async () => {
    await page.click('.module-jump input');
    const ok = (await page.locator('.palette-group-label', { hasText: 'Son baxılanlar' }).count()) === 1
      && (await page.locator('.palette-list button', { hasText: 'Maliyyə mərkəzi' }).count()) === 1;
    await page.keyboard.press('Escape');
    return ok;
  })());

  // ── command palette: pages, members, Enter, "all results" ──
  await page.fill('.module-jump input', 'aysel');
  await page.locator('.palette-list [data-kind="member"]').waitFor();
  check('search: member found by name (members.read)', (await page.locator('.palette-list [data-kind="member"]').count()) === 1);
  await page.fill('.module-jump input', 'seher');
  await page.locator('.palette-list [data-kind="company"]').waitFor();
  check('search: "seher" finds "Şəhər Market" (Azerbaijani letters folded)', (await page.locator('.palette-list [data-kind="company"]').textContent()).includes('Şəhər Market'));
  await shot('23-palette');
  await page.fill('.module-jump input', 'komanda');
  await page.locator('.palette-list [data-kind="page"]').first().waitFor();
  await page.keyboard.press('Enter');
  await page.waitForURL(/\/settings\/team$|\/system\/team$/);
  check('search: Enter opens the first page result', true);
  await page.fill('.module-jump input', 'Vizit');
  await page.locator('.palette-list [data-kind="all"]').waitFor();
  await page.click('.palette-list [data-kind="all"]');
  await page.getByRole('heading', { name: 'Axtarış', exact: true }).waitFor();
  await page.getByText('Vizit kartı 90x50').waitFor();
  check('search page: /search?q= shows grouped results', page.url().includes('/search?q=Vizit'));

  // ── breadcrumb, shortcuts, "+ New" ─────────────────────
  await page.goto(`${base}/settings/notifications`);
  await page.locator('.crumb-link', { hasText: 'Parametrlər' }).waitFor();
  check('breadcrumb: Parametrlər › Bildirişlər', (await page.locator('.crumb .topbar-title').textContent()) === 'Bildirişlər');
  await page.click('body', { position: { x: 700, y: 600 } });
  await page.keyboard.press('g'); await page.keyboard.press('d');
  await page.getByText('Salam, Test!').waitFor();
  check('shortcut: G then D → dashboard', new URL(page.url()).pathname === '/');
  await page.keyboard.press('g'); await page.keyboard.press('s');
  await page.waitForURL(/\/settings$/);
  check('shortcut: G then S → settings', true);
  await page.keyboard.press('?');
  await page.getByRole('dialog', { name: 'Klaviatura qısayolları' }).waitFor();
  await shot('24-shortcuts');
  await page.keyboard.press('Escape');
  check('shortcut: ? opens the list, Esc closes it', (await page.getByRole('dialog').count()) === 0);
  await page.click('.new-menu-btn');
  const newItems = await page.locator('.new-menu-list button').allTextContents();
  check('+ New: only working actions (invite, new company)', newItems.length === 2, newItems.join(' | '));
  await page.click('.new-menu-list button:has-text("Üzv dəvət et")');
  await page.waitForURL(/\/settings\/team#invite$/);
  await page.waitForFunction(() => document.activeElement?.id === 'inv-email');
  check('+ New → invite: team page with the e-mail field focused', true);

  // ── settings: notification types, persisted ─────────────
  await page.goto(`${base}/settings/notifications`);
  await page.locator('#np-member\\.joined').waitFor({ state: 'attached' });
  await page.locator('label[for="np-member.joined"]').click();
  await page.waitForTimeout(300);
  await page.reload();
  await page.locator('#np-member\\.joined').waitFor({ state: 'attached' });
  check('settings: switching a notification type off is saved', !(await page.locator('#np-member\\.joined').isChecked())
    && await page.locator('#np-invite\\.accepted').isChecked());
  await shot('25-settings-notifications');

  // ── organization details: VÖEN rule, save, logo ─────────
  await page.goto(`${base}/settings/organization`);
  await page.locator('#org-legal_name').waitFor();
  await page.fill('#org-legal_name', 'Test Şirkəti MMC');
  await page.fill('#org-tax_id', '123456789');
  await page.click('button:has-text("Yadda saxla")');
  await page.getByText('VÖEN 10 rəqəmdən ibarət olmalıdır.').waitFor();
  check('org details: 9-digit VÖEN rejected before saving', true);
  await page.fill('#org-tax_id', '1234567890');
  await page.fill('#org-website', 'javascript:alert(1)');
  await page.click('button:has-text("Yadda saxla")');
  await page.getByText('http:// və ya https://').waitFor();
  check('org details: javascript: website rejected', true);
  await page.fill('#org-website', 'https://test.az');
  await page.click('button:has-text("Yadda saxla")');
  await page.getByText('Yadda saxlanıldı.').waitFor();
  await page.setInputFiles('#org-logo-file', { name: 'logo.png', mimeType: 'image/png', buffer: PNG });
  await page.locator('img.org-logo').waitFor();
  check('org details + logo saved', await page.locator('img.org-logo').isVisible());
  await page.setInputFiles('#org-logo-file', { name: 'logo.gif', mimeType: 'image/gif', buffer: PNG });
  await page.getByText('Yalnız PNG, JPEG və ya WebP').waitFor();
  check('logo: other file types refused', true);
  await shot('26-settings-organization');

  // ── profile: personal data, avatar, password, language ──
  await page.goto(`${base}/profile`);
  await page.locator('#pf-name').waitFor();
  await page.fill('#pf-name', 'Test Sahib');
  await page.fill('#pf-phone', '+994 50 123 45 67');
  await page.fill('#pf-job', 'Direktor');
  await page.locator('#pf-job').press('Enter');
  await page.getByText('Yadda saxlanıldı.').waitFor();
  await page.setInputFiles('#avatar-file', { name: 'a.png', mimeType: 'image/png', buffer: PNG });
  await page.locator('.topbar img.avatar-img').waitFor();
  check('profile: data and avatar saved (avatar in the top bar)', true);
  await page.fill('#pw-current', 'wrong'); await page.fill('#pw-new', 'new-password-1'); await page.fill('#pw-repeat', 'new-password-1');
  await page.click('button:has-text("Şifrəni dəyiş")');
  await page.getByText('Cari şifrə yanlışdır.').waitFor();
  check('password: wrong current password refused', true);
  await page.fill('#pw-current', 'correct-password');
  await page.click('button:has-text("Şifrəni dəyiş")');
  await page.getByText('Şifrə dəyişdirildi.').waitFor();
  check('password: changed after re-authentication', true);
  await page.click('button:has-text("Digər cihazlardan çıxış et")');
  await page.getByText('Digər cihazlardakı sessiyalar bağlandı.').waitFor();
  check('sessions: sign out other devices', true);
  await shot('27-profile');

  // ── languages: AZ → EN → RU → AZ, saved in the profile ──
  await page.selectOption('#pf-locale', 'en');
  await page.getByRole('heading', { name: 'My profile' }).waitFor();
  check('language: English applied immediately', (await page.locator('html').getAttribute('lang')) === 'en'
    && (await page.locator('.sidebar a[href="/"]').getAttribute('aria-label')) === 'Dashboard');
  await page.goto(`${base}/`);
  await page.getByText('Hello, Test!').waitFor();
  check('language: dashboard in English', await page.getByText('Total revenue').isVisible());
  await shot('28-dashboard-en');
  await page.evaluate(() => localStorage.removeItem('tc.locale'));   // the profile, not the browser, must decide
  await page.reload();
  await page.getByText('Hello, Test!').waitFor();
  check('language: kept after reload (from the profile)', true);
  await page.goto(`${base}/settings/appearance`);
  await page.selectOption('#st-locale', 'ru');
  await page.getByRole('heading', { name: 'Настройки' }).waitFor();
  check('language: Russian', (await page.locator('.org-switcher .ws-text small').textContent()) === 'Владелец');
  await shot('29-settings-ru');
  await page.selectOption('#st-locale', 'az');
  await page.getByRole('heading', { name: 'Parametrlər' }).waitFor();
  check('language: back to Azerbaijani', (await page.locator('.org-switcher .ws-text small').textContent()) === 'Sahib');

  // ── 2FA: lock-out guard, organization gate, enrolment, sign-in code ──
  await page.goto(`${base}/settings/security`);
  await page.locator('label[for="mfa-role-owner"]').click();
  await page.click('.settings-body button:has-text("Yadda saxla")');
  await page.getByText('Əvvəlcə özünüz üçün iki addımlı girişi aktivləşdirin').waitFor();
  check('G: owner without 2FA cannot require 2FA for owners (lock-out guard)', true);
  await page.locator('label[for="mfa-role-owner"]').click();
  await page.locator('label[for="mfa-role-employee"]').click();
  await page.click('.settings-body button:has-text("Yadda saxla")');
  await page.getByText('Yadda saxlanıldı.').waitFor();
  check('G: owner requires 2FA for employees', true);
  await shot('30-settings-security');
  await page.evaluate((org) => window.__e2eSetPolicy(org, ['viewer']), ORG_B);   // B's owner requires 2FA for viewers
  await page.goto(`${base}/`);
  await page.getByText('Salam, Test!').waitFor();
  await switchTo('İkinci Şirkət');
  await page.getByText('İki addımlı giriş tələb olunur').first().waitFor();
  check('G: org B requires 2FA → data closed, setup offered', (await page.locator('.stat').count()) === 0);
  await shot('31-mfa-required');
  await page.click('button:has-text("Aktivləşdir")');
  await page.locator('img.mfa-qr').waitFor();
  await page.fill('#mfa-enroll-code', '000000');
  await page.click('button:has-text("Təsdiqlə")');
  await page.getByText('Kod yanlışdır və ya vaxtı bitib.').waitFor();
  check('2FA: wrong code refused', true);
  await page.fill('#mfa-enroll-code', '123456');
  await page.click('button:has-text("Təsdiqlə")');
  await page.locator('.stat').first().waitFor({ timeout: 8000 });
  check('2FA: enrolled → org B opens (session aal2)', true);
  await switchTo('Test Şirkəti');
  await page.click('button[aria-label="Çıxış"]');
  await page.getByRole('heading', { name: 'Daxil ol' }).waitFor();
  await signIn();
  await page.getByRole('heading', { name: 'İki addımlı giriş' }).waitFor();
  check('2FA: sign-in asks for the code', (await page.locator('.sidebar').count()) === 0);
  await shot('32-mfa-challenge');
  await page.fill('#mfa-code', '123456');
  await page.click('button:has-text("Təsdiqlə")');
  await page.getByText('Salam, Test!').waitFor();
  check('2FA: correct code → dashboard', true);

  // ── notifications page: filter + my activity ────────────
  await page.goto(`${base}/notifications`);
  await page.locator('.notif-page-list .notif-item').first().waitFor();
  const all = await page.locator('.notif-page-list .notif-item').count();
  await page.getByRole('tab', { name: 'Oxunmamış' }).click();
  await page.waitForTimeout(300);
  check('notifications page: list + unread filter', all >= 3 && (await page.locator('.notif-page-list .notif-item').count()) < all, `all=${all}`);
  await page.getByRole('tab', { name: 'Mənim fəaliyyətim' }).click();
  await page.locator('.activity-table tbody tr').first().waitFor();
  check('my activity: own audit rows', (await page.locator('.activity-table tbody tr').count()) >= 1);
  await shot('33-notifications');

  // ── mobile ──────────────────────────────────────────────
  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
  mobile.on('pageerror', (e) => errors.push(e.message));
  await mobile.goto(`${base}/`);
  await signIn(mobile, 'mobil@test.local');
  await mobile.locator('.stat').first().waitFor();
  for (const path of ['/settings/notifications', '/notifications', '/profile']) {
    await mobile.goto(`${base}${path}`);
    await mobile.locator('.page-head h1').waitFor();
    const wide = await mobile.evaluate(() => [...document.querySelectorAll('body *')]
      .filter((el) => el.getBoundingClientRect().right > window.innerWidth + 1 && getComputedStyle(el).position !== 'fixed')
      .slice(0, 4).map((el) => `${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]}:${Math.round(el.getBoundingClientRect().right)}`));
    check(`mobile: no horizontal overflow on ${path}`, !(await mobile.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)), wide.join(' '));
  }
  check('mobile: bell and search button visible', await mobile.locator('.notif-bell > button').isVisible() && await mobile.locator('.mobile-search').isVisible());
  await mobile.screenshot({ path: join(SHOTS, '34-mobile-settings.png') });

  check('No uncaught runtime errors', errors.length === 0, errors.join(' | '));
  await browser.close();
  srv.close();
  for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? `  (${r.detail})` : ''}`);
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} Phase 2B E2E checks passed`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
