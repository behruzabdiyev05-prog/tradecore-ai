import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import ares, { validateAresBody } from '../../netlify/functions/ares.mjs';
import health from '../../netlify/functions/health.mjs';
import integrations from '../../netlify/functions/integrations.mjs';
import { buildContext } from '../../netlify/lib/ares/context.mjs';

const ENV = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'ARES_PROVIDER', 'ARES_PROVIDER_API_KEY', 'AMAZON_SP_CLIENT_ID'];
beforeEach(() => {
  for (const k of ENV) delete process.env[k];
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_ANON_KEY = 'anon';
});

/** Mock Supabase Auth: token "good" is valid. (Phase 2A: also answers the membership RPC.) */
const fetchImpl = async (url, opts) => {
  if (url === 'https://example.supabase.co/rest/v1/rpc/check_access') {
    assert.equal(opts.headers.Authorization, 'Bearer good', 'membership is checked with the caller\'s own token');
    return new Response(JSON.stringify('ok'), { status: 200 });
  }
  assert.equal(url, 'https://example.supabase.co/auth/v1/user');
  assert.equal(opts.headers.apikey, 'anon');
  if (opts.headers.Authorization === 'Bearer good') {
    return new Response(JSON.stringify({ id: 'u1', email: 'a@b.c' }), { status: 200 });
  }
  return new Response('{}', { status: 401 });
};

const req = (method, { token, body } = {}) =>
  new Request('http://localhost/api/ares', {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });

test('health: ok and reports booleans only', async () => {
  const res = await health(new Request('http://x/api/health'));
  assert.equal(res.status, 200);
  const j = await res.json();
  assert.equal(j.status, 'ok');
  assert.deepEqual(j.services, { supabaseAuth: true, ares: false });
  assert.equal((await health(new Request('http://x', { method: 'POST' }))).status, 405);
});

test('ares GET: reports not configured honestly', async () => {
  const j = await (await ares(req('GET'))).json();
  assert.equal(j.configured, false);
  assert.match(j.reason, /ARES_PROVIDER/);
  process.env.ARES_PROVIDER = 'some-ai';
  process.env.ARES_PROVIDER_API_KEY = 'secret-value';
  const j2 = await (await ares(req('GET'))).json();
  assert.equal(j2.configured, false, 'no adapter registered in Phase 1');
  assert.ok(!JSON.stringify(j2).includes('secret-value'), 'never leaks key');
});

test('ares POST: auth required, token verified server-side', async () => {
  assert.equal((await ares(req('POST', { body: { message: 'hi' } }), {}, { fetchImpl })).status, 401);
  const bad = await ares(req('POST', { token: 'bad', body: { message: 'hi' } }), {}, { fetchImpl });
  assert.equal(bad.status, 401);
  assert.equal((await bad.json()).error.code, 'INVALID_TOKEN');
});

test('ares POST: validation', async () => {
  const call = (body) => ares(req('POST', { token: 'good', body }), {}, { fetchImpl });
  assert.equal((await call('{not json')).status, 400);
  assert.equal((await call({ message: '' })).status, 400);
  assert.equal((await call({ message: 'x', moduleKey: 'nope' })).status, 400);
  assert.equal((await call({ message: 'x', history: [{ role: 'system', content: 'x' }] })).status, 400);
  assert.equal((await call({ message: 'x'.repeat(4001) })).status, 400);
  assert.equal(validateAresBody({ message: 'ok', moduleKey: 'wholesale', history: [{ role: 'user', content: 'a' }] }), null);
});

test('ares POST: valid request returns 503 ARES_NOT_CONFIGURED (no fake answers)', async () => {
  const res = await ares(req('POST', { token: 'good', body: { message: 'Bazarı analiz et', moduleKey: 'financial-trading' } }), {}, { fetchImpl });
  assert.equal(res.status, 503);
  const j = await res.json();
  assert.equal(j.error.code, 'ARES_NOT_CONFIGURED');
  assert.equal(j.reply, undefined);
});

test('ares: auth not configured → 503', async () => {
  delete process.env.SUPABASE_URL;
  const res = await ares(req('POST', { token: 'good', body: { message: 'x' } }), {}, { fetchImpl });
  assert.equal(res.status, 503);
  assert.equal((await res.json()).error.code, 'AUTH_NOT_CONFIGURED');
});

test('ARES context: central vs module scope', () => {
  const c = buildContext(null);
  assert.equal(c.scope, 'central');
  assert.equal(c.platform.modules.length, 10);
  const m = buildContext('b2b-client-finder');
  assert.equal(m.scope, 'module');
  assert.equal(m.module.code, '09');
  assert.match(m.system, /uydurma/);
});

test('integrations: auth required; reports presence, never values', async () => {
  const r0 = await integrations(new Request('http://x/api/integrations'), {}, { fetchImpl });
  assert.equal(r0.status, 401);
  process.env.AMAZON_SP_CLIENT_ID = 'very-secret-id';
  const r = await integrations(new Request('http://x/api/integrations', { headers: { Authorization: 'Bearer good' } }), {}, { fetchImpl });
  assert.equal(r.status, 200);
  const text = await r.text();
  assert.ok(!text.includes('very-secret-id'));
  const amazon = JSON.parse(text).integrations.find((i) => i.key === 'amazon');
  assert.equal(amazon.credentials, 'partial');
  assert.equal(amazon.status, 'not_implemented');
});
