import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import { MODULES, MODULE_KEYS, getModule, isModuleKey } from '../../shared/modules.js';
import { CURRENCY_CODES } from '../../shared/finance.js';
import { matchPath } from '../../src/core/router/matchPath.js';
import { createEventBus } from '../../src/core/data/eventBus.js';

const root = new URL('../../', import.meta.url);
const read = (p) => readFile(new URL(p, root), 'utf8');

test('exactly 10 modules with unique keys and codes 01–10', () => {
  assert.equal(MODULES.length, 10);
  assert.equal(new Set(MODULE_KEYS).size, 10);
  assert.deepEqual(MODULES.map((m) => m.code), ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10']);
  for (const m of MODULES) {
    assert.ok(m.name && m.shortName && m.icon && m.summary, `${m.key} metadata`);
    assert.ok(m.features.length >= 5, `${m.key} features`);
  }
  assert.equal(getModule('financial-trading').finance, false, 'financial trading kept separate from goods finance');
  assert.ok(isModuleKey('wholesale'));
  assert.ok(!isModuleKey('nope'));
});

test('DB module seed matches shared/modules.js', async () => {
  const sql = await read('supabase/migrations/20261121000100_core.sql');
  const seeded = [...sql.matchAll(/\('([a-z0-9-]+)',\s*'(\d\d)'/g)].map((m) => `${m[1]}:${m[2]}`);
  assert.deepEqual(seeded, MODULES.map((m) => `${m.key}:${m.code}`));
});

test('DB currencies match shared/finance.js', async () => {
  const sql = await read('supabase/migrations/20261121000100_core.sql');
  const block = sql.slice(sql.indexOf('insert into public.currencies'));
  const codes = [...block.matchAll(/\('([A-Z]{3})'/g)].map((m) => m[1]);
  assert.deepEqual(codes, CURRENCY_CODES);
});

test('every module has its own folder, root component and lazy loader', async () => {
  const loaders = await read('src/modules/index.js');
  for (const key of MODULE_KEYS) {
    const s = await stat(new URL(`src/modules/${key}/index.jsx`, root));
    assert.ok(s.isFile(), `${key}/index.jsx`);
    assert.match(loaders, new RegExp(`'${key}': \\(\\) => import\\('./${key}/index.jsx'\\)`));
    const src = await read(`src/modules/${key}/index.jsx`);
    assert.match(src, new RegExp(`getModule\\('${key}'\\)`));
  }
  const dirs = (await readdir(new URL('src/modules/', root), { withFileTypes: true }))
    .filter((d) => d.isDirectory() && !d.name.startsWith('_')).map((d) => d.name).sort();
  assert.deepEqual(dirs, [...MODULE_KEYS].sort(), 'no orphan module folders');
});

test('no secrets in frontend: only VITE_SUPABASE_* env read in src/', async () => {
  const files = [];
  async function walk(dir) {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      const p = new URL(e.name + (e.isDirectory() ? '/' : ''), dir);
      if (e.isDirectory()) await walk(p); else files.push(p);
    }
  }
  await walk(new URL('src/', root));
  for (const f of files) {
    const src = await readFile(f, 'utf8');
    for (const m of src.matchAll(/VITE_[A-Z_]+/g)) {
      assert.ok(['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY'].includes(m[0]), `${f.pathname}: ${m[0]}`);
    }
    assert.doesNotMatch(src, /SERVICE_ROLE|PROVIDER_API_KEY|sk-[a-zA-Z0-9]{10}/, f.pathname);
  }
});

test('matchPath', () => {
  assert.deepEqual(matchPath('/', '/'), {});
  assert.deepEqual(matchPath('/m/:moduleKey', '/m/wholesale'), { moduleKey: 'wholesale' });
  assert.deepEqual(matchPath('/m/:moduleKey', '/m/wholesale/'), { moduleKey: 'wholesale' });
  assert.equal(matchPath('/m/:moduleKey', '/m'), null);
  assert.equal(matchPath('/finance', '/system'), null);
  assert.equal(matchPath('/', '/finance'), null);
});

test('eventBus: routing, filters, validation, persistence', async () => {
  const persisted = [];
  const bus = createEventBus({ persist: async (e) => persisted.push(e) });
  const got = { b2b: [], all: [], typed: [] };
  const off = bus.subscribe({ module: 'b2b-trading' }, (e) => got.b2b.push(e.type));
  bus.subscribe({}, (e) => got.all.push(e.type));
  bus.subscribe({ type: 'deal.closed' }, (e) => got.typed.push(e.source));

  await bus.publish({ source: 'wholesale', target: 'b2b-trading', type: 'supplier.saved' });
  await bus.publish({ source: 'wholesale', target: 'arbitrage', type: 'price.updated' });
  await bus.publish({ source: 'marketplace', type: 'deal.closed' }, { persist: true });

  assert.deepEqual(got.b2b, ['supplier.saved', 'deal.closed']); // targeted + broadcast, not arbitrage's
  assert.deepEqual(got.all, ['supplier.saved', 'price.updated', 'deal.closed']);
  assert.deepEqual(got.typed, ['marketplace']);
  assert.equal(persisted.length, 1);

  off();
  await bus.publish({ source: 'wholesale', target: 'b2b-trading', type: 'supplier.saved' });
  assert.equal(got.b2b.length, 2, 'unsubscribed');

  await assert.rejects(bus.publish({ source: 'x', type: 'a.b' }));
  await assert.rejects(bus.publish({ source: 'wholesale', target: 'x', type: 'a.b' }));
  await assert.rejects(bus.publish({ source: 'wholesale', type: 'BadType' }));
  await assert.rejects(createEventBus().publish({ source: 'wholesale', type: 'a.b' }, { persist: true }));

  // a throwing subscriber must not break others
  const bus2 = createEventBus();
  let ok = false;
  bus2.subscribe({}, () => { throw new Error('boom'); });
  bus2.subscribe({}, () => { ok = true; });
  const origErr = console.error; console.error = () => {};
  await bus2.publish({ source: 'wholesale', type: 'a.b' });
  console.error = origErr;
  assert.ok(ok);
});

test('every section has a theme with an existing background scene', async () => {
  const { THEMES, SCENES, sectionForPath, getTheme } = await import('../../src/core/ui/themes.js');
  for (const key of [...MODULE_KEYS, 'dashboard', 'finance', 'system', 'auth']) {
    const th = THEMES[key];
    assert.ok(th, `theme for ${key}`);
    assert.ok(SCENES.includes(th.scene), `${key} scene`);
    assert.match(th.accent, /^#[0-9a-f]{6}$/i);
    assert.match(th.accent2, /^#[0-9a-f]{6}$/i);
    for (const dir of ['', 'light/']) {
      const s = await stat(new URL(`public/backgrounds/${dir}${th.scene}.jpg`, root));
      assert.ok(s.size > 20_000 && s.size < 400_000, `${dir}${th.scene}.jpg size`);
    }
  }
  assert.equal(sectionForPath('/'), 'dashboard');
  assert.equal(sectionForPath('/finance'), 'finance');
  assert.equal(sectionForPath('/system'), 'system');
  assert.equal(sectionForPath('/m/wholesale'), 'wholesale');
  assert.equal(getTheme('unknown').scene, THEMES.dashboard.scene);
});
