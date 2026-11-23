-- ═════════════════════════════════════════════════════════════
-- TRADECORE AI · Phase 2A security tests (SaaS tenancy)
-- Written BEFORE the implementation (see docs: Phase 2A plan).
-- Every scenario records PASS/FAIL; the run fails if any FAIL.
-- Scenario numbers match the plan (SQL-level: 1–19, 24;
-- 20 = server unit tests, 21 = build check, 22–23 = browser E2E).
-- ═════════════════════════════════════════════════════════════
\set ON_ERROR_STOP on
\set QUIET on

-- ── test utilities (test database only) ─────────────────────
create schema test_util;
create table test_util.results (n serial, scenario int, name text, ok boolean, detail text);
create table test_util.ctx (k text primary key, v text);
grant usage on schema test_util to authenticated, anon;
grant select, insert on test_util.results to authenticated, anon;
grant usage on sequence test_util.results_n_seq to authenticated, anon;
grant select, insert on test_util.ctx to authenticated, anon;

create function test_util.v(key text) returns text language sql stable as $$ select v from test_util.ctx where k = key $$;
create function test_util.u(key text) returns uuid language sql stable as $$ select v::uuid from test_util.ctx where k = key $$;
create function test_util.as_user(key text) returns void language sql as $$
  select set_config('request.jwt.claim.sub', coalesce(test_util.v(key), ''), false); $$;
create function test_util.ok(scn int, name text, cond boolean, detail text default '') returns void language sql as $$
  insert into test_util.results (scenario, name, ok, detail) values (scn, name, coalesce(cond, false), detail); $$;

-- Expect the statement to be REJECTED by a security/business rule.
-- Missing objects (undefined table/column/function) count as FAIL, not as "rejected".
create function test_util.rejects(scn int, name text, stmt text) returns void language plpgsql as $$
begin
  begin
    execute stmt;
  exception when others then
    if sqlstate in ('42501','23514','P0001','23503','23505','22023','55000','42P17') then
      perform test_util.ok(scn, name, true, 'rejected: ' || sqlstate);
    else
      perform test_util.ok(scn, name, false, 'wrong error ' || sqlstate || ': ' || sqlerrm);
    end if;
    return;
  end;
  perform test_util.ok(scn, name, false, 'statement was ALLOWED: ' || left(stmt, 120));
end $$;

-- Run a statement and return affected row count (or -1 on error).
create function test_util.affected(stmt text) returns int language plpgsql as $$
declare n int;
begin
  execute stmt; get diagnostics n = row_count; return n;
exception when others then return -1;
end $$;

-- Count rows visible to the current role (or -1 on error).
create function test_util.count_rows(stmt text) returns bigint language plpgsql as $$
declare n bigint;
begin
  execute 'select count(*) from (' || stmt || ') q' into n; return n;
exception when others then return -1;
end $$;

grant execute on all functions in schema test_util to authenticated, anon;

-- Business tables that must be tenant-isolated (Phase 1 tables carrying user data).
create table test_util.business_tables (t text primary key);
insert into test_util.business_tables values
  ('companies'),('products'),('saved_items'),('module_events'),('activity_log'),
  ('financial_transactions'),('exchange_rates'),('ares_conversations'),('ares_messages'),('integrations');
grant select on test_util.business_tables to authenticated, anon;

-- ── fixture: users ──────────────────────────────────────────
insert into test_util.ctx values
  ('a_owner','a0000000-0000-0000-0000-000000000001'),('a_admin','a0000000-0000-0000-0000-000000000002'),
  ('a_manager','a0000000-0000-0000-0000-000000000003'),('a_employee','a0000000-0000-0000-0000-000000000004'),
  ('a_viewer','a0000000-0000-0000-0000-000000000005'),('a_suspended','a0000000-0000-0000-0000-000000000006'),
  ('a_removed','a0000000-0000-0000-0000-000000000007'),
  ('b_owner','b0000000-0000-0000-0000-000000000001'),
  ('x_invitee','c0000000-0000-0000-0000-000000000001'),('x_other','c0000000-0000-0000-0000-000000000002'),
  ('x_hacker','c0000000-0000-0000-0000-000000000003');

insert into auth.users (id, email, raw_user_meta_data) values
  ('a0000000-0000-0000-0000-000000000001','a.owner@test.local','{"full_name":"A Owner","company_name":"Şirkət A"}'),
  ('b0000000-0000-0000-0000-000000000001','b.owner@test.local','{"full_name":"B Owner","company_name":"Şirkət B"}'),
  ('a0000000-0000-0000-0000-000000000002','a.admin@test.local','{"invite_token":"pending"}'),
  ('a0000000-0000-0000-0000-000000000003','a.manager@test.local','{"invite_token":"pending"}'),
  ('a0000000-0000-0000-0000-000000000004','a.employee@test.local','{"invite_token":"pending"}'),
  ('a0000000-0000-0000-0000-000000000005','a.viewer@test.local','{"invite_token":"pending"}'),
  ('a0000000-0000-0000-0000-000000000006','a.suspended@test.local','{"invite_token":"pending"}'),
  ('a0000000-0000-0000-0000-000000000007','a.removed@test.local','{"invite_token":"pending"}'),
  ('c0000000-0000-0000-0000-000000000001','x.invitee@test.local','{"invite_token":"pending"}'),
  ('c0000000-0000-0000-0000-000000000002','x.other@test.local','{"invite_token":"pending"}');

-- Org ids (created by the signup trigger) — recorded if the schema supports it.
do $$ begin
  insert into test_util.ctx select 'org_a', active_org_id::text from public.profiles where id = test_util.u('a_owner');
  insert into test_util.ctx select 'org_b', active_org_id::text from public.profiles where id = test_util.u('b_owner');
exception when others then
  perform test_util.ok(0, 'setup: signup creates organizations', false, sqlerrm);
end $$;

-- ── fixture: team of org A via the invite RPCs ──────────────
set role authenticated;
do $$
declare r record; tok text;
begin
  for r in select * from (values ('a_admin','admin'),('a_manager','manager'),('a_employee','employee'),
                                 ('a_viewer','viewer'),('a_suspended','employee'),('a_removed','viewer')) v(k, role) loop
    perform test_util.as_user('a_owner');
    tok := public.create_invite(test_util.u('org_a'), replace(r.k, '_', '.') || '@test.local', r.role);
    perform test_util.as_user(r.k);
    perform public.accept_invite(tok);
  end loop;
  perform test_util.as_user('a_owner');
  perform public.set_member_status(test_util.u('a_suspended'), test_util.u('org_a'), 'suspended');
  perform public.remove_member(test_util.u('a_removed'), test_util.u('org_a'));
  perform test_util.ok(0, 'setup: team via invites', true);
exception when others then
  perform test_util.ok(0, 'setup: team via invites', false, sqlerrm);
end $$;

-- ── fixture: one row per business table in A and in B ───────
do $$
declare who text; c uuid; p uuid; conv uuid;
begin
  foreach who in array array['a_owner','b_owner'] loop
    perform test_util.as_user(who);
    insert into public.companies (name, roles) values ('Co ' || who, '{supplier}') returning id into c;
    insert into public.products (name, supplier_id) values ('Prod ' || who, c) returning id into p;
    insert into public.saved_items (module_key, item_type, title) values ('wholesale', 'product', 'Saved ' || who);
    insert into public.module_events (source_module, event_type) values ('wholesale', 'supplier.saved');
    insert into public.activity_log (action) values ('test.' || who);
    insert into public.financial_transactions (module_key, kind, amount_minor, currency) values ('wholesale', 'sale', 1000, 'AZN');
    insert into public.exchange_rates (currency, rate_to_base, rate_date, source) values ('USD', 1.7, current_date, 'manual');
    insert into public.ares_conversations (title) values ('Conv ' || who) returning id into conv;
    insert into public.ares_messages (conversation_id, role, content) values (conv, 'user', 'hello');
    insert into public.integrations (provider) values ('amazon');
    insert into test_util.ctx values (who || '_company', c::text), (who || '_conv', conv::text);
  end loop;
  perform test_util.ok(0, 'setup: business rows in A and B', true);
exception when others then
  perform test_util.ok(0, 'setup: business rows in A and B', false, sqlerrm);
end $$;
reset role;
-- ════════════════ SCENARIOS ════════════════
set role authenticated;
select test_util.as_user('a_owner');

-- 1. Cross-org read: A sees none of B's rows (every business table + view)
do $$ declare t text; n bigint; begin
  for t in select bt.t from test_util.business_tables bt loop
    n := test_util.count_rows(format('select 1 from public.%I where org_id = %L', t, test_util.v('org_b')));
    perform test_util.ok(1, 'A cannot read B: ' || t, n = 0, 'visible=' || n);
  end loop;
  n := test_util.count_rows(format('select 1 from public.finance_module_summary where org_id = %L', test_util.v('org_b')));
  perform test_util.ok(1, 'A cannot read B: finance_module_summary', n = 0, 'visible=' || n);
  n := test_util.count_rows('select 1 from public.companies');
  perform test_util.ok(1, 'A sees own rows (sanity)', n >= 1, 'visible=' || n);
end $$;

-- 2. Insert with foreign org_id
select test_util.rejects(2, 'insert companies into B', format($q$insert into public.companies (org_id, name) values (%L, 'X')$q$, test_util.v('org_b')));
select test_util.rejects(2, 'insert transaction into B', format($q$insert into public.financial_transactions (org_id, kind, amount_minor, currency) values (%L, 'sale', 1, 'AZN')$q$, test_util.v('org_b')));

-- 3. Move own row to another org
select test_util.rejects(3, 'move company A→B', format($q$update public.companies set org_id = %L where id = %L$q$, test_util.v('org_b'), test_util.v('a_owner_company')));

-- 4. Update/delete B rows from A → 0 rows affected, B data intact
do $$ declare t text; n int; begin
  for t in select bt.t from test_util.business_tables bt loop
    n := test_util.affected(format('update public.%I set org_id = org_id where org_id = %L', t, test_util.v('org_b')));
    perform test_util.ok(4, 'A cannot update B: ' || t, n = 0, 'affected=' || n);
    n := test_util.affected(format('delete from public.%I where org_id = %L', t, test_util.v('org_b')));
    perform test_util.ok(4, 'A cannot delete B: ' || t, n = 0, 'affected=' || n);
  end loop;
end $$;

-- 5. Foreign-key leak across orgs
select test_util.rejects(5, 'product → B supplier', format($q$insert into public.products (name, supplier_id) values ('Leak', %L)$q$, test_util.v('b_owner_company')));
select test_util.rejects(5, 'transaction → B counterparty', format($q$insert into public.financial_transactions (kind, amount_minor, currency, counterparty_id) values ('sale', 1, 'AZN', %L)$q$, test_util.v('b_owner_company')));
select test_util.rejects(5, 'ARES message → B conversation', format($q$insert into public.ares_messages (conversation_id, role, content) values (%L, 'user', 'x')$q$, test_util.v('b_owner_conv')));

-- 6. Role limits on data
select test_util.as_user('a_viewer');
select test_util.rejects(6, 'viewer cannot insert company', $q$insert into public.companies (name) values ('V')$q$);
select test_util.ok(6, 'viewer can read companies', test_util.count_rows('select 1 from public.companies') >= 1);
select test_util.as_user('a_employee');
select test_util.ok(6, 'employee cannot read finance', test_util.count_rows('select 1 from public.financial_transactions') = 0);
select test_util.rejects(6, 'employee cannot insert transaction', $q$insert into public.financial_transactions (kind, amount_minor, currency) values ('sale', 1, 'AZN')$q$);
select test_util.ok(6, 'employee can write data', test_util.affected($q$insert into public.companies (name) values ('E')$q$) = 1);

-- 7. Self-promotion through direct table writes
select test_util.rejects(7, 'employee updates own membership', format($q$update public.organization_members set role_id = (select id from public.roles where key = 'owner' and org_id is null) where user_id = %L$q$, test_util.v('a_employee')));
select test_util.rejects(7, 'employee inserts membership', format($q$insert into public.organization_members (org_id, user_id, role_id) values (%L, %L, (select id from public.roles where key = 'owner' and org_id is null))$q$, test_util.v('org_a'), test_util.v('x_other')));
select test_util.rejects(7, 'employee calls set_member_role', format($q$select public.set_member_role(%L, %L, 'manager')$q$, test_util.v('a_viewer'), test_util.v('org_a')));

-- 8. Admin limits
select test_util.as_user('a_admin');
select test_util.rejects(8, 'admin makes manager an owner', format($q$select public.set_member_role(%L, %L, 'owner')$q$, test_util.v('a_manager'), test_util.v('org_a')));
select test_util.rejects(8, 'admin makes manager an admin', format($q$select public.set_member_role(%L, %L, 'admin')$q$, test_util.v('a_manager'), test_util.v('org_a')));
select test_util.rejects(8, 'admin promotes self', format($q$select public.set_member_role(%L, %L, 'owner')$q$, test_util.v('a_admin'), test_util.v('org_a')));
select test_util.rejects(8, 'admin removes owner', format($q$select public.remove_member(%L, %L)$q$, test_util.v('a_owner'), test_util.v('org_a')));
select test_util.rejects(8, 'admin suspends owner', format($q$select public.set_member_status(%L, %L, 'suspended')$q$, test_util.v('a_owner'), test_util.v('org_a')));
select test_util.rejects(8, 'admin invites an owner', format($q$select public.create_invite(%L, 'n1@test.local', 'owner')$q$, test_util.v('org_a')));
select test_util.rejects(8, 'admin invites an admin', format($q$select public.create_invite(%L, 'n2@test.local', 'admin')$q$, test_util.v('org_a')));
select test_util.ok(8, 'admin may set employee→manager', test_util.affected(format($q$select public.set_member_role(%L, %L, 'manager')$q$, test_util.v('a_employee'), test_util.v('org_a'))) = 1);
select test_util.ok(8, 'admin may set back manager→employee', test_util.affected(format($q$select public.set_member_role(%L, %L, 'employee')$q$, test_util.v('a_employee'), test_util.v('org_a'))) = 1);

-- 9. Last owner protection
select test_util.as_user('a_owner');
select test_util.rejects(9, 'last owner leaves', format($q$select public.remove_member(%L, %L)$q$, test_util.v('a_owner'), test_util.v('org_a')));
select test_util.rejects(9, 'last owner suspends self', format($q$select public.set_member_status(%L, %L, 'suspended')$q$, test_util.v('a_owner'), test_util.v('org_a')));
select test_util.rejects(9, 'last owner demotes self', format($q$select public.set_member_role(%L, %L, 'admin')$q$, test_util.v('a_owner'), test_util.v('org_a')));
reset role;
select test_util.rejects(9, 'direct delete of last owner (even as DB owner)', format($q$delete from public.organization_members where user_id = %L and org_id = %L$q$, test_util.v('a_owner'), test_util.v('org_a')));
set role authenticated;

-- 10. System roles are immutable
select test_util.as_user('a_owner');
select test_util.rejects(10, 'owner adds permission to viewer', $q$insert into public.role_permissions (role_id, permission_key) select id, 'finance.write' from public.roles where key = 'viewer' and org_id is null$q$);
select test_util.rejects(10, 'owner deletes system permission', $q$delete from public.role_permissions where permission_key = 'audit.read'$q$);
select test_util.rejects(10, 'owner renames system role', $q$update public.roles set name = 'X' where key = 'viewer'$q$);

-- 11. Invite token abuse
do $$ declare tok text; tok2 text; tok3 text; inv uuid; begin
  perform test_util.as_user('a_owner');
  tok := public.create_invite(test_util.u('org_a'), 'x.invitee@test.local', 'viewer');
  perform test_util.as_user('x_other');
  perform test_util.rejects(11, 'invite used with a different email', format('select public.accept_invite(%L)', tok));
  perform test_util.as_user('x_invitee');
  perform test_util.rejects(11, 'forged token', $q$select public.accept_invite('deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef')$q$);
  perform test_util.ok(11, 'valid invite accepted', test_util.affected(format('select public.accept_invite(%L)', tok)) = 1);
  perform test_util.rejects(11, 'invite reused', format('select public.accept_invite(%L)', tok));
  -- revoked
  perform test_util.as_user('a_owner');
  tok2 := public.create_invite(test_util.u('org_a'), 'x.other@test.local', 'viewer');
  select id into inv from public.organization_invites where email = 'x.other@test.local' and revoked_at is null and accepted_at is null;
  perform public.revoke_invite(inv);
  perform test_util.as_user('x_other');
  perform test_util.rejects(11, 'revoked invite', format('select public.accept_invite(%L)', tok2));
  -- expired
  perform test_util.as_user('a_owner');
  tok3 := public.create_invite(test_util.u('org_a'), 'x.other@test.local', 'viewer');
  insert into test_util.results (scenario, name, ok, detail) values (11, '__expire__', true, tok3);
exception when others then
  perform test_util.ok(11, 'invite flow', false, sqlerrm);
end $$;
reset role;
do $$ begin
  update public.organization_invites set expires_at = now() - interval '1 minute'
    where email = 'x.other@test.local' and revoked_at is null and accepted_at is null;
exception when others then null; end $$;
set role authenticated;
select test_util.as_user('x_other');
select test_util.rejects(11, 'expired invite', format('select public.accept_invite(%L)',
  (select detail from test_util.results where name = '__expire__')));

-- 12. Tokens are stored only as hashes
reset role;
select test_util.ok(12, 'no plaintext token in organization_invites',
  test_util.count_rows($q$select 1 from public.organization_invites i, test_util.results r
    where r.name = '__expire__' and i::text like '%' || r.detail || '%'$q$) = 0
  and test_util.count_rows('select 1 from public.organization_invites') > 0);
delete from test_util.results where name = '__expire__';
set role authenticated;
select test_util.as_user('a_owner');
select test_util.rejects(12, 'token_hash column not readable by members', $q$select token_hash from public.organization_invites$q$);

-- 13. Signup metadata cannot place a user in someone else's org
reset role;
insert into auth.users (id, email, raw_user_meta_data) values
  ('c0000000-0000-0000-0000-000000000003', 'x.hacker@test.local',
   jsonb_build_object('org_id', test_util.v('org_b'), 'role', 'owner', 'company_name', 'Hack Co'));
select test_util.ok(13, 'hacker not in B', test_util.count_rows(format($q$select 1 from public.organization_members
  where user_id = %L and org_id = %L$q$, test_util.v('x_hacker'), test_util.v('org_b'))) = 0
  and test_util.v('org_b') is not null);
select test_util.ok(13, 'hacker owns exactly one own org', test_util.count_rows(format($q$select 1 from public.organization_members m
  join public.roles r on r.id = m.role_id where m.user_id = %L and r.key = 'owner'$q$, test_util.v('x_hacker'))) = 1);

-- 14. Audit log is tamper-proof
set role authenticated;
select test_util.as_user('a_owner');
select test_util.rejects(14, 'owner updates audit_log', $q$update public.audit_log set action = 'X'$q$);
select test_util.rejects(14, 'owner deletes audit_log', $q$delete from public.audit_log$q$);
select test_util.rejects(14, 'owner inserts fake audit row', format($q$insert into public.audit_log (org_id, table_name, action) values (%L, 'companies', 'DELETE')$q$, test_util.v('org_a')));
select test_util.rejects(14, 'owner truncates audit_log', $q$truncate public.audit_log$q$);
reset role;
select test_util.rejects(14, 'DB owner updates audit_log (trigger)', $q$update public.audit_log set action = 'X'$q$);
select test_util.rejects(14, 'DB owner deletes audit_log (trigger)', $q$delete from public.audit_log$q$);
select test_util.rejects(14, 'DB owner truncates audit_log (trigger)', $q$truncate public.audit_log$q$);

-- 15. Audit completeness + isolation
set role authenticated;
select test_util.as_user('a_owner');
select test_util.ok(15, 'company insert is audited', test_util.count_rows($q$select 1 from public.audit_log where table_name = 'companies' and action = 'INSERT'$q$) >= 1);
select test_util.ok(15, 'role change is audited', test_util.count_rows($q$select 1 from public.audit_log where table_name = 'organization_members' and action = 'UPDATE'$q$) >= 1);
select test_util.ok(15, 'every business table audited', test_util.count_rows($q$select distinct table_name from public.audit_log where table_name in (select t from test_util.business_tables)$q$) = 10);
select test_util.ok(15, 'A cannot see B audit', test_util.count_rows(format($q$select 1 from public.audit_log where org_id = %L$q$, test_util.v('org_b'))) = 0);
select test_util.as_user('a_employee');
select test_util.ok(15, 'employee cannot read audit', test_util.count_rows('select 1 from public.audit_log') = 0);

-- 16. Suspended / removed members lose access immediately
select test_util.as_user('a_suspended');
select test_util.ok(16, 'suspended sees no companies', test_util.count_rows('select 1 from public.companies') = 0);
select test_util.rejects(16, 'suspended cannot insert', $q$insert into public.companies (name) values ('S')$q$);
select test_util.as_user('a_removed');
select test_util.ok(16, 'removed sees no companies', test_util.count_rows('select 1 from public.companies') = 0);
select test_util.rejects(16, 'removed cannot insert', format($q$insert into public.companies (org_id, name) values (%L, 'R')$q$, test_util.v('org_a')));

-- 17. Plan gating
reset role;
do $$ begin
  insert into public.plans (key, name, modules) values ('test-limited', 'Test', array['wholesale']);
  update public.organization_subscriptions set plan_id = (select id from public.plans where key = 'test-limited') where org_id = test_util.u('org_b');
  insert into public.saved_items (org_id, user_id, module_key, item_type, title) values (test_util.u('org_b'), test_util.u('b_owner'), 'marketplace', 'note', 'hidden');
exception when others then perform test_util.ok(17, 'plan setup', false, sqlerrm); end $$;
set role authenticated;
select test_util.as_user('b_owner');
select test_util.ok(17, 'module outside plan not readable', test_util.count_rows($q$select 1 from public.saved_items where module_key = 'marketplace'$q$) = 0);
select test_util.ok(17, 'module inside plan readable', test_util.count_rows($q$select 1 from public.saved_items where module_key = 'wholesale'$q$) >= 1);
select test_util.rejects(17, 'module outside plan not writable', $q$insert into public.saved_items (module_key, item_type, title) values ('marketplace', 'note', 'x')$q$);
reset role;
do $$ begin
  update public.organization_subscriptions set plan_id = (select id from public.plans where key = 'internal') where org_id = test_util.u('org_b');
exception when others then null; end $$;

-- 18. Helper functions leak nothing; SECURITY DEFINER functions are pinned
set role authenticated;
select test_util.as_user('a_owner');
select test_util.ok(18, 'has_permission(B) is false for A', test_util.count_rows(format($q$select 1 where public.has_permission(%L, 'finance.read') is false$q$, test_util.v('org_b'))) = 1);
select test_util.ok(18, 'is_member(B) is false for A', test_util.count_rows(format($q$select 1 where public.is_member(%L) is false$q$, test_util.v('org_b'))) = 1);
select test_util.ok(18, 'has_permission(A) is true for A owner', test_util.count_rows(format($q$select 1 where public.has_permission(%L, 'finance.read')$q$, test_util.v('org_a'))) = 1);
reset role;
select test_util.ok(18, 'all SECURITY DEFINER functions set search_path',
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef
      and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')) = 0);
select test_util.ok(18, 'anon cannot execute any SECURITY DEFINER function',
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef and has_function_privilege('anon', p.oid, 'execute')) = 0);

-- 19. Anonymous visitor
set role anon;
do $$ declare t text; begin
  for t in select bt.t from test_util.business_tables bt loop
    perform test_util.rejects(19, 'anon reads ' || t, format('select 1 from public.%I', t));
  end loop;
end $$;
select test_util.rejects(19, 'anon calls create_invite', format($q$select public.create_invite(%L, 'z@test.local', 'viewer')$q$, test_util.v('org_a')));
select test_util.rejects(19, 'anon reads organizations', 'select 1 from public.organizations');
reset role;

-- Coverage rule: every table with user data is tenant-scoped and RLS-protected
select test_util.ok(1, 'coverage: every table with user_id has org_id + RLS',
  (select count(*) from information_schema.columns c
     join pg_class k on k.relname = c.table_name and k.relkind = 'r'
     join pg_namespace n on n.oid = k.relnamespace and n.nspname = 'public'
    where c.table_schema = 'public' and c.column_name = 'user_id'
      and c.table_name not in ('organization_members')
      and (not k.relrowsecurity or not exists (select 1 from information_schema.columns c2
            where c2.table_schema = 'public' and c2.table_name = c.table_name and c2.column_name = 'org_id'))) = 0);

-- 24. RLS performance with 10 000 rows
do $$ begin
  insert into public.companies (org_id, user_id, name)
    select test_util.u('org_a'), test_util.u('a_owner'), 'Bulk ' || g from generate_series(1, 10000) g;
exception when others then perform test_util.ok(24, 'bulk insert', false, sqlerrm); end $$;
analyze public.companies;
set role authenticated;
select test_util.as_user('a_employee');
do $$ declare t0 timestamptz; n bigint; ms numeric; begin
  t0 := clock_timestamp();
  n := test_util.count_rows('select 1 from public.companies');
  ms := extract(epoch from clock_timestamp() - t0) * 1000;
  perform test_util.ok(24, '10k-row RLS scan < 200 ms', n >= 10000 and ms < 200, format('rows=%s, %s ms', n, round(ms, 1)));
end $$;
reset role;

-- ── report ──────────────────────────────────────────────────
\set QUIET off
\pset footer off
select scenario as "#", case when ok then 'PASS' else 'FAIL' end as result, name, detail
  from test_util.results order by scenario, n;
select count(*) filter (where ok) as passed, count(*) filter (where not ok) as failed,
       count(distinct scenario) filter (where scenario > 0) as scenarios
  from test_util.results;
do $$ begin
  if exists (select 1 from test_util.results where not ok) then
    raise exception 'TENANCY TESTS FAILED: % failing check(s)', (select count(*) from test_util.results where not ok);
  end if;
end $$;
select 'ALL TENANCY TESTS PASSED' as result;
