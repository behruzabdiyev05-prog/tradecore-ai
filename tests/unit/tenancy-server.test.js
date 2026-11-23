// Phase 2A · scenario 20 (server) and 21 (no secrets in the browser bundle)
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import ares from '../../netlify/functions/ares.mjs';
import integrations from '../../netlify/functions/integrations.mjs';
import { canAssignRole, ROLE_MATRIX, PERMISSIONS, ROLE_PERMISSION_PAIRS } from '../../shared/permissions.js';

const ORG_A = '0a000000-0000-4000-8000-000000000001';
const ORG_B = '0b000000-0000-4000-8000-000000000001';

/**
 * Mock Supabase: tokens map to users; check_access mirrors the SQL function's answers.
 *   alice — owner of A · eve — viewer of A (no integrations.manage) · sam — suspended in A · bob — owner of B
 */
const MEMBERS = {
  alice: { [ORG_A]: { status: 'active', perms: ['ares.use', 'integrations.manage', 'module.wholesale.read'] } },
  eve: { [ORG_A]: { status: 'active', perms: ['ares.use', 'module.wholesale.read'] } },
  sam: { [ORG_A]: { status: 'suspended', perms: ['ares.use'] } },
  bob: { [ORG_B]: { status: 'active', perms: ['ares.use', 'integrations.manage'] } },
};
const ACTIVE = { alice: ORG_A, eve: ORG_A, sam: ORG_A, bob: ORG_B };
const calls = [];
const fetchImpl = async (url, opts) => {
  const token = opts.headers.Authorization?.replace('Bearer ', '');
  calls.push({ url, token });
  if (url.endsWith('/auth/v1/user')) {
    return MEMBERS[token] ? new Response(JSON.stringify({ id: token, email: `${token}@x.az` })) : new Response('{}', { status: 401 });
  }
  if (url.endsWith('/rest/v1/rpc/check_access')) {
    const { p_org, p_keys } = JSON.parse(opts.body);
    const org = p_org ?? ACTIVE[token];
    const m = MEMBERS[token]?.[org];
    const status = !m ? 'not_member' : m.status !== 'active' ? 'suspended'
      : p_keys.every((k) => m.perms.includes(k)) ? 'ok' : 'forbidden';
    return new Response(JSON.stringify(status));
  }
  throw new Error('unexpected fetch ' + url);
};

beforeEach(() => {
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_ANON_KEY = 'anon';
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  calls.length = 0;
});

const aresReq = (token, body) => new Request('http://x/api/ares', {
  method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});
const intReq = (token, org) => new Request(`http://x/api/integrations${org ? `?orgId=${org}` : ''}`, {
  headers: { Authorization: `Bearer ${token}` },
});
const code = async (res) => (await res.json()).error?.code;

test('20 · ARES: another organization → 403 NOT_MEMBER', async () => {
  const res = await ares(aresReq('alice', { message: 'x', orgId: ORG_B }), {}, { fetchImpl });
  assert.equal(res.status, 403);
  assert.equal(await code(res), 'NOT_MEMBER');
});

test('20 · ARES: malformed orgId → 400; omitted orgId → active org', async () => {
  const bad = await ares(aresReq('alice', { message: 'x', orgId: "1' or 1=1" }), {}, { fetchImpl });
  assert.equal(bad.status, 400);
  const res = await ares(aresReq('alice', { message: 'x' }), {}, { fetchImpl });
  assert.equal(res.status, 503, 'passes membership, then honestly reports ARES not configured');
  assert.equal(await code(res), 'ARES_NOT_CONFIGURED');
});

test('20 · ARES: suspended member → 403 MEMBER_SUSPENDED', async () => {
  const res = await ares(aresReq('sam', { message: 'x', orgId: ORG_A }), {}, { fetchImpl });
  assert.equal(res.status, 403);
  assert.equal(await code(res), 'MEMBER_SUSPENDED');
});

test('20 · ARES: module context needs module read permission', async () => {
  const res = await ares(aresReq('bob', { message: 'x', orgId: ORG_B, moduleKey: 'wholesale' }), {}, { fetchImpl });
  assert.equal(res.status, 403);
  assert.equal(await code(res), 'FORBIDDEN');
});

test('20 · integrations: viewer without integrations.manage → 403; other org → 403; owner → 200', async () => {
  assert.equal((await integrations(intReq('eve', ORG_A), {}, { fetchImpl })).status, 403);
  const other = await integrations(intReq('alice', ORG_B), {}, { fetchImpl });
  assert.equal(other.status, 403);
  assert.equal(await code(other), 'NOT_MEMBER');
  assert.equal((await integrations(intReq('alice', ORG_A), {}, { fetchImpl })).status, 200);
  assert.equal((await integrations(intReq('alice', 'not-a-uuid'), {}, { fetchImpl })).status, 400);
});

test('20 · membership is checked with the caller token — never a service-role key', async () => {
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-secret';
  await ares(aresReq('alice', { message: 'x', orgId: ORG_A }), {}, { fetchImpl });
  const rpc = calls.find((c) => c.url.endsWith('/rpc/check_access'));
  assert.equal(rpc.token, 'alice');
  assert.ok(calls.every((c) => c.token !== 'service-secret'));
});

test('21 · no service-role key or secret env names anywhere in src/ or netlify/', async () => {
  const files = [];
  async function walk(dir) {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      const p = new URL(e.name + (e.isDirectory() ? '/' : ''), dir);
      if (e.isDirectory()) await walk(p); else files.push(p);
    }
  }
  await walk(new URL('../../src/', import.meta.url));
  await walk(new URL('../../netlify/', import.meta.url));
  for (const f of files) {
    const src = await readFile(f, 'utf8');
    assert.doesNotMatch(src, /service_role|SERVICE_ROLE_KEY/i, f.pathname);
  }
});

test('role-assignment rules (mirror of SQL _can_manage)', () => {
  assert.equal(canAssignRole({ actorRole: 'admin', targetCurrentRole: 'employee', newRole: 'owner', isSelf: false }), false);
  assert.equal(canAssignRole({ actorRole: 'admin', targetCurrentRole: 'employee', newRole: 'admin', isSelf: false }), false);
  assert.equal(canAssignRole({ actorRole: 'admin', targetCurrentRole: 'owner', newRole: 'viewer', isSelf: false }), false);
  assert.equal(canAssignRole({ actorRole: 'admin', targetCurrentRole: 'employee', newRole: 'manager', isSelf: false }), true);
  assert.equal(canAssignRole({ actorRole: 'owner', targetCurrentRole: 'owner', newRole: 'admin', isSelf: true }), false);
  assert.equal(canAssignRole({ actorRole: 'owner', targetCurrentRole: 'employee', newRole: 'owner', isSelf: false }), true);
  assert.equal(canAssignRole({ actorRole: 'manager', targetCurrentRole: 'viewer', newRole: 'employee', isSelf: false }), false);
});

test('permission registry: 31 keys, 5 roles, owner has all, viewer writes nothing', () => {
  assert.equal(PERMISSIONS.length, 31);
  assert.deepEqual(Object.keys(ROLE_MATRIX), ['owner', 'admin', 'manager', 'employee', 'viewer']);
  assert.equal(ROLE_MATRIX.owner.length, PERMISSIONS.length);
  assert.ok(!ROLE_MATRIX.admin.includes('billing.manage'));
  assert.ok(ROLE_MATRIX.viewer.every((p) => !p.endsWith('.write') && !p.endsWith('.manage')));
  assert.equal(new Set(ROLE_PERMISSION_PAIRS).size, ROLE_PERMISSION_PAIRS.length);
});
