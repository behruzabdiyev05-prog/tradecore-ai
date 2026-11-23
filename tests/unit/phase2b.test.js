// Phase 2B unit tests: dictionaries (F/K), navigation registry (43), preferences rule,
// Azerbaijani folding (search), server answer for organizations that require 2FA (G).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import az from '../../src/core/i18n/az.js';
import en from '../../src/core/i18n/en.js';
import ru from '../../src/core/i18n/ru.js';
import { MODULES } from '../../shared/modules.js';
import { ROLES, ROLE_MATRIX } from '../../shared/permissions.js';
import { CURRENCY_CODES, TRANSACTION_KINDS } from '../../shared/finance.js';
import { NAV_ITEMS, canAccess, itemForPath, breadcrumb, visibleItems, SHORTCUTS } from '../../src/core/navigation/registry.js';
import { azFold } from '../../src/core/navigation/recent.js';
import { validPreferences, cleanPreferences, pgJsonBytes, PREFERENCES_MAX_BYTES } from '../../shared/preferences.js';
import { requireMember } from '../../netlify/lib/auth.mjs';

const root = new URL('../../', import.meta.url);
const SOURCED = /^(mod|role|cur|tx|month|integration)\./;
const placeholders = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');

async function sourceFiles(dir = new URL('src/', root), out = []) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = new URL(e.name + (e.isDirectory() ? '/' : ''), dir);
    if (e.isDirectory()) await sourceFiles(p, out);
    else if (/\.(jsx?|mjs)$/.test(e.name)) out.push(p);
  }
  return out;
}

// ── i18n ────────────────────────────────────────────────────
test('i18n: EN and RU have exactly the AZ keys (+ translations of shared names)', () => {
  const azKeys = Object.keys(az).sort();
  for (const [name, dict] of [['en', en], ['ru', ru]]) {
    const own = Object.keys(dict).filter((k) => !SOURCED.test(k)).sort();
    assert.deepEqual(own, azKeys, `${name}: same keys as az`);
    assert.deepEqual(Object.keys(dict).filter((k) => SOURCED.test(k)).sort(),
      Object.keys(en).filter((k) => SOURCED.test(k)).sort(), `${name}: same shared-name keys as en`);
  }
  assert.equal(Object.keys(az).filter((k) => SOURCED.test(k)).length, 0, 'az takes these names from shared/*.js');
});

test('i18n: placeholders match and no value is empty', () => {
  for (const [k, v] of Object.entries(az)) {
    for (const [name, dict] of [['en', en], ['ru', ru]]) {
      assert.ok(String(dict[k]).trim(), `${name}.${k} empty`);
      assert.equal(placeholders(dict[k]), placeholders(v), `${name}.${k} placeholders`);
    }
  }
});

test('i18n: every module, role, currency, transaction kind and month is translated', () => {
  for (const dict of [en, ru]) {
    for (const m of MODULES) {
      for (const f of ['name', 'shortName', 'summary']) assert.ok(dict[`mod.${m.key}.${f}`], `mod.${m.key}.${f}`);
      m.features.forEach((_, i) => assert.ok(dict[`mod.${m.key}.f${i}`], `mod.${m.key}.f${i}`));
      assert.equal(dict[`mod.${m.key}.f${m.features.length}`], undefined, `${m.key}: no extra feature`);
    }
    for (const r of ROLES) assert.ok(dict[`role.${r.key}`], `role.${r.key}`);
    for (const c of CURRENCY_CODES) assert.ok(dict[`cur.${c}`], `cur.${c}`);
    for (const k of Object.keys(TRANSACTION_KINDS)) assert.ok(dict[`tx.${k}`], `tx.${k}`);
    for (let i = 0; i < 12; i++) assert.ok(dict[`month.${i}`], `month.${i}`);
  }
});

test('i18n: every literal t(\'…\') key used in src/ exists in the AZ dictionary', async () => {
  const missing = [];
  for (const f of await sourceFiles()) {
    const src = await readFile(f, 'utf8');
    for (const m of src.matchAll(/\btr?\('([a-z0-9_.-]+)'/g)) if (!(m[1] in az)) missing.push(`${f.pathname.split('/src/')[1]}: ${m[1]}`);
  }
  assert.deepEqual(missing, []);
});

test('i18n: no hard-coded Azerbaijani UI text left in components (outside dictionaries)', async () => {
  const offenders = [];
  for (const f of await sourceFiles()) {
    const rel = f.pathname.split('/src/')[1];
    if (rel.startsWith('core/i18n/') || rel === 'core/ui/themes.js') continue;   // dictionaries; internal theme labels
    const lines = (await readFile(f, 'utf8')).split('\n');
    lines.forEach((line, i) => {
      if (/^\s*(\*|\/\/|\/\*)/.test(line)) return;                                // comments
      if (/ƏəİıÖöÜüŞşÇçĞğ|Ə: 'e'/.test(line)) return;                            // folding tables
      if (/throw new (Range|Type)?Error\(/.test(line)) return;                     // developer errors
      if (/[əüöçşğıİƏÜÖÇŞĞ]/.test(line)) offenders.push(`${rel}:${i + 1}`);
    });
  }
  assert.deepEqual(offenders, []);
});

test('i18n: the Phase 1/2A Azerbaijani texts checked by the browser tests are unchanged', () => {
  const expected = {
    'auth.err.invalid': 'E-poçt və ya şifrə yanlışdır.', 'auth.err.short': 'Şifrə ən azı 8 simvol olmalıdır.',
    'auth.signin': 'Daxil ol', 'auth.signup': 'Hesab yarat', 'auth.signout': 'Çıxış', 'dash.hello_name': 'Salam, {name}!',
    'dash.no_transactions': 'Hələ əməliyyat qeyd olunmayıb', 'dash.no_sales': 'Hələ satış qeyd olunmayıb',
    'system.db.modules': '{n} modul qeydiyyatda', 'setup.title': 'Konfiqurasiya tələb olunur', 'mw.tab.search': 'Axtarış və filtrlər',
    'mw.assistant.open': 'Assistenti aç', 'finance.empty.title': 'Hələ maliyyə əməliyyatı yoxdur', 'finance.no_revenue': 'Gəlir yoxdur',
    'app.not_found.title': 'Səhifə tapılmadı', 'plan.internal': 'Daxili plan', 'forbidden.title': 'İcazə yoxdur',
    'signup.company.required': 'Şirkətin adı məcburidir.', 'orgpage.save': 'Yadda saxla', 'orgpage.saved': 'Yadda saxlanıldı.',
  };
  for (const [k, v] of Object.entries(expected)) assert.equal(az[k], v, k);
});

// ── navigation registry ─────────────────────────────────────
const accessFor = (role) => ({
  can: (p) => ROLE_MATRIX[role].includes(p),
  canModule: (k) => ROLE_MATRIX[role].includes(`module.${k}.read`),
  isOwner: role === 'owner',
});

test('registry: unique keys and paths, all 10 modules, labels exist', () => {
  assert.equal(new Set(NAV_ITEMS.map((i) => i.key)).size, NAV_ITEMS.length);
  assert.equal(new Set(NAV_ITEMS.map((i) => i.path)).size, NAV_ITEMS.length);
  assert.deepEqual(NAV_ITEMS.filter((i) => i.module).map((i) => i.module), MODULES.map((m) => m.key));
  for (const i of NAV_ITEMS) if (!i.module) assert.ok(i.labelKey in az, i.labelKey);
  for (const s of SHORTCUTS) assert.ok(s.labelKey in az, s.labelKey);
  for (const i of NAV_ITEMS.filter((x) => x.permission)) assert.ok(ROLE_MATRIX.owner.includes(i.permission), i.permission);
});

test('registry (43): a page hidden from the menu is also refused by the route guard — for every role', () => {
  for (const role of Object.keys(ROLE_MATRIX)) {
    const access = accessFor(role);
    const shown = new Set(visibleItems(access).map((i) => i.key));
    for (const item of NAV_ITEMS.filter((i) => !i.hidden)) {
      // the route guard (App.resolveRoute) calls canAccess(itemForPath(path)) — same function, same data
      assert.equal(canAccess(itemForPath(item.path), access), shown.has(item.key), `${role} ${item.path}`);
    }
  }
  const viewer = accessFor('viewer');
  for (const p of ['/system/audit', '/settings/audit', '/system/organization', '/settings/organization', '/settings/security', '/finance']) {
    if (p === '/finance') continue;   // viewer has finance.read
    assert.equal(canAccess(itemForPath(p), viewer), false, p);
  }
  assert.equal(canAccess(itemForPath('/settings/security'), accessFor('admin')), false, 'security: Owner only');
  assert.equal(canAccess(itemForPath('/settings/security'), accessFor('owner')), true);
  assert.equal(canAccess(itemForPath('/finance'), accessFor('employee')), false, 'employee has no finance.read');
});

test('registry: path lookup and breadcrumb', () => {
  assert.equal(itemForPath('/').key, 'dashboard');
  assert.equal(itemForPath('/m/wholesale').module, 'wholesale');
  assert.equal(itemForPath('/m/does-not-exist'), null);
  assert.equal(itemForPath('/settings/notifications/').key, 'settings.notifications');
  assert.deepEqual(breadcrumb('/settings/notifications').map((i) => i.key), ['settings', 'settings.notifications']);
  assert.deepEqual(breadcrumb('/finance').map((i) => i.key), ['finance']);
});

test('registry is the single source: sidebar, palette, breadcrumb and route guard read it', async () => {
  const files = { 'layout/Sidebar.jsx': 'visibleItems', 'layout/CommandPalette.jsx': 'NAV_ITEMS', 'layout/Topbar.jsx': 'breadcrumb', 'App.jsx': 'canAccess' };
  for (const [f, sym] of Object.entries(files)) {
    const src = await readFile(new URL(`src/${f}`, root), 'utf8');
    assert.match(src, new RegExp(`from '[./]+core/navigation/registry\\.js'`), f);
    assert.ok(src.includes(sym), `${f} uses ${sym}`);
  }
});

// ── preferences ─────────────────────────────────────────────
test('preferences: allowed keys and values only, size limit, cleaning', () => {
  assert.ok(validPreferences({}));
  assert.ok(validPreferences({ theme: 'dark', sidebar: 'collapsed', onboarding_dismissed: true, timezone: 'Asia/Baku' }));
  for (const bad of [null, [], 'x', { theme: 'neon' }, { is_admin: true }, { onboarding_dismissed: 'yes' }, { timezone: '../x' }]) {
    assert.equal(validPreferences(bad), false, JSON.stringify(bad));
  }
  assert.equal(pgJsonBytes({ a: 1, b: 'x' }), '{"a": 1, "b": "x"}'.length, 'PostgreSQL jsonb text form');
  assert.equal(pgJsonBytes({ s: 'ə' }), '{"s": "ə"}'.length + 1, 'UTF-8 bytes');
  assert.equal(PREFERENCES_MAX_BYTES, 8192);
  assert.deepEqual(cleanPreferences({ theme: 'dark', evil: 1, sidebar: 'wide' }), { theme: 'dark' });
});

test('preferences: the database rule lists the same keys as shared/preferences.js', async () => {
  const sql = await readFile(new URL('supabase/migrations/20261123000900_profiles_settings.sql', root), 'utf8');
  const block = sql.slice(sql.indexOf('create function public.valid_preferences'), sql.indexOf('-- ── Profiles'));
  const keys = [...block.matchAll(/when '([a-z_]+)'/g)].map((m) => m[1]).sort();
  const { PREFERENCE_RULES } = await import('../../shared/preferences.js');
  assert.deepEqual(keys, Object.keys(PREFERENCE_RULES).sort());
});

// ── search folding ──────────────────────────────────────────
test('azFold (browser) = az_fold (database): same letter table', async () => {
  const sql = await readFile(new URL('supabase/migrations/20261123001100_search.sql', root), 'utf8');
  const [, from, to] = sql.match(/translate\(coalesce\(p, ''\), '([^']+)', '([^']+)'\)/);
  assert.equal([...from].length, [...to].length, 'translate() tables have the same length');
  [...from].forEach((c, i) => assert.equal(azFold(c), to[i], `${c} → ${to[i]}`));
  assert.equal(azFold('Şəhər MARKET'), 'seher market');
  assert.equal(azFold('İçəri Şəhər Ğ'), 'iceri seher g');
});

test('search: LIKE wildcards are escaped and the limit is capped in global_search()', async () => {
  const sql = await readFile(new URL('supabase/migrations/20261123001100_search.sql', root), 'utf8');
  assert.match(sql, /replace\(replace\(replace\(v_q, '\\', '\\\\'\), '%', '\\%'\), '_', '\\_'\)/);
  assert.match(sql, /least\(greatest\(coalesce\(p_limit, 20\), 0\), 50\)/);
  assert.match(sql, /left\(coalesce\(p_query, ''\), 100\)/);
});

// ── server: organization requires 2FA ───────────────────────
test('requireMember: check_access "mfa_required" → 403 MFA_REQUIRED (decision G)', async () => {
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_ANON_KEY = 'anon';
  const fetchImpl = async (url) => {
    if (url.endsWith('/auth/v1/user')) return new Response(JSON.stringify({ id: 'u1', email: 'u1@x.az' }));
    if (url.endsWith('/rest/v1/rpc/check_access')) return new Response(JSON.stringify('mfa_required'));
    throw new Error(url);
  };
  const req = new Request('https://x/api', { headers: { authorization: 'Bearer tok' } });
  const [ok, res] = await requireMember(req, null, ['ares.use'], { fetchImpl });
  assert.equal(ok, null);
  assert.equal(res.status, 403);
  assert.equal((await res.json()).error.code, 'MFA_REQUIRED');
});

test('internal-link rule: browser regex = database check', async () => {
  const sql = await readFile(new URL('supabase/migrations/20261123001000_notifications.sql', root), 'utf8');
  assert.match(sql, /link ~ '\^\/\[A-Za-z0-9\/_\?=&\.%#-\]\*\$' and link !~ '\^\/\/'/);
  const src = await readFile(new URL('src/layout/CommandPalette.jsx', root), 'utf8');
  const re = new RegExp(src.match(/INTERNAL_LINK = \/(.+)\/;/)[1]);
  for (const ok of ['/', '/settings/team', '/search?q=a&b=1', '/m/wholesale#x']) assert.ok(re.test(ok), ok);
  for (const bad of ['//evil.example', 'https://x', 'javascript:alert(1)', '/\\evil', ' /x', '/a b']) assert.equal(re.test(bad), false, bad);
});

test('i18n: errors reach the screen through errorText() (translated), never as raw .message', async () => {
  const offenders = [];
  for (const f of await sourceFiles()) {
    const rel = f.pathname.split('/src/')[1];
    if (rel.startsWith('core/data/') || rel.startsWith('core/i18n/') || rel === 'core/api/client.js') continue;   // data layer creates the errors
    (await readFile(f, 'utf8')).split('\n').forEach((line, i) => {
      if (/(error|text|message|content):\s*(e|err|error)\.message\b/.test(line) || /setMsg\((e|err|error)\.message\)/.test(line)) offenders.push(`${rel}:${i + 1}`);
    });
  }
  assert.deepEqual(offenders, []);
});

test('i18n audit script finds no gaps (keys, alphabet, database and server messages)', async () => {
  const { execFileSync } = await import('node:child_process');
  const out = execFileSync(process.execPath, [new URL('scripts/i18n-audit.mjs', root).pathname], { encoding: 'utf8' });
  assert.match(out, /Problems \(0\)/);
});
