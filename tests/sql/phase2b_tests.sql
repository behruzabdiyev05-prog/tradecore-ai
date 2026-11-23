-- ═════════════════════════════════════════════════════════════
-- TRADECORE AI · Phase 2B security tests (scenarios 25–42 at SQL level)
-- Written BEFORE the implementation (see docs: Phase 2B plan).
-- 43–44 are browser checks (tests/e2e). Every check records PASS/FAIL;
-- the run fails if any FAIL. Self-contained: own schema `t2b`, own users.
-- ═════════════════════════════════════════════════════════════
\set ON_ERROR_STOP on
\set QUIET on

drop schema if exists t2b cascade;
create schema t2b;
create table t2b.results (n serial, scenario int, name text, ok boolean, detail text);
create table t2b.ctx (k text primary key, v text);
grant usage on schema t2b to authenticated, anon;
grant select, insert on t2b.results, t2b.ctx to authenticated, anon;
grant usage on sequence t2b.results_n_seq to authenticated, anon;

create function t2b.v(key text) returns text language sql stable as $$ select v from t2b.ctx where k = key $$;
create function t2b.u(key text) returns uuid language sql stable as $$ select v::uuid from t2b.ctx where k = key $$;
-- Emulates a Supabase session: JWT `sub` + `aal` (aal1 = password only, aal2 = password + 2FA)
create function t2b.as_user(key text, aal text default 'aal1') returns void language sql as $$
  select set_config('request.jwt.claim.sub', coalesce(t2b.v(key), ''), false),
         set_config('request.jwt.claim.aal', aal, false); $$;
create function t2b.ok(scn int, name text, cond boolean, detail text default '') returns void language sql as $$
  insert into t2b.results (scenario, name, ok, detail) values (scn, name, coalesce(cond, false), detail); $$;
create function t2b.rejects(scn int, name text, stmt text) returns void language plpgsql as $$
begin
  begin
    execute stmt;
  exception when others then
    if sqlstate in ('42501','23514','P0001','23503','23505','22023','55000','42P17','22P02','22001') then
      perform t2b.ok(scn, name, true, 'rejected: ' || sqlstate);
    else
      perform t2b.ok(scn, name, false, 'wrong error ' || sqlstate || ': ' || sqlerrm);
    end if;
    return;
  end;
  perform t2b.ok(scn, name, false, 'statement was ALLOWED: ' || left(stmt, 120));
end $$;
-- Rejected OR affects 0 rows (both mean "no effect").
create function t2b.no_effect(scn int, name text, stmt text) returns void language plpgsql as $$
declare n int;
begin
  begin
    execute stmt; get diagnostics n = row_count;
  exception when others then
    if sqlstate in ('42501','P0001') then perform t2b.ok(scn, name, true, 'rejected: ' || sqlstate);
    else perform t2b.ok(scn, name, false, 'wrong error ' || sqlstate || ': ' || sqlerrm); end if;
    return;
  end;
  perform t2b.ok(scn, name, n = 0, format('%s row(s) affected', n));
end $$;
create function t2b.allows(scn int, name text, stmt text) returns void language plpgsql as $$
begin
  execute stmt; perform t2b.ok(scn, name, true);
exception when others then perform t2b.ok(scn, name, false, sqlstate || ': ' || sqlerrm);
end $$;
create function t2b.n(stmt text) returns bigint language plpgsql as $$
declare n bigint;
begin
  execute 'select count(*) from (' || stmt || ') q' into n; return n;
exception when others then return -1;
end $$;
create function t2b.val(stmt text) returns text language plpgsql as $$
declare r text;
begin
  execute stmt into r; return r;
exception when others then return 'ERROR ' || sqlstate || ': ' || sqlerrm;
end $$;
-- For each user: every global_search result must also be visible to that user through
-- the tables' own RLS (guards the explicit permission filters inside global_search).
create function t2b.search_vs_rls(users text[]) returns text language plpgsql as $f$
declare u text; q text; o text; r record; total int := 0; bad int := 0; seen boolean;
begin
  foreach u in array users loop
    perform t2b.as_user(u);
    foreach q in array array['Market','Alfa','Gizli','Vizit','qeyd','Sahib','test.local','üçün','Şirkət','MMC'] loop
      foreach o in array array['org_p','org_q'] loop
        for r in select * from public.global_search(t2b.u(o), q, 50) loop
          total := total + 1;
          execute case r.kind
            when 'company'      then 'select exists (select 1 from public.companies where id::text = $1)'
            when 'product'      then 'select exists (select 1 from public.products where id::text = $1)'
            when 'saved_item'   then 'select exists (select 1 from public.saved_items where id::text = $1)'
            when 'notification' then 'select exists (select 1 from public.notifications where id::text = $1)'
            when 'member'       then format('select exists (select 1 from public.organization_members where user_id::text = $1 and org_id = %L)', t2b.v(o))
            else 'select false' end
          into seen using r.id;
          if not seen then bad := bad + 1; end if;
        end loop;
      end loop;
    end loop;
  end loop;
  return total || '/' || bad;
exception when others then
  return '0/-1';   -- global_search() missing or failing: counts as a failed check
end $f$;
grant execute on all functions in schema t2b to authenticated, anon;

-- ── fixture: users (org P = team, org Q = another tenant) ────
insert into t2b.ctx values
  ('p_owner','e0000000-0000-0000-0000-000000000001'),('p_admin','e0000000-0000-0000-0000-000000000002'),
  ('p_employee','e0000000-0000-0000-0000-000000000003'),('p_viewer','e0000000-0000-0000-0000-000000000004'),
  ('p_suspended','e0000000-0000-0000-0000-000000000005'),('p_limited','e0000000-0000-0000-0000-000000000006'),
  ('p_late','e0000000-0000-0000-0000-000000000007'),('p_late2','e0000000-0000-0000-0000-000000000008'),
  ('q_owner','f0000000-0000-0000-0000-000000000001'),('q_member','f0000000-0000-0000-0000-000000000002');

insert into auth.users (id, email, raw_user_meta_data) values
  ('e0000000-0000-0000-0000-000000000001','p.owner@test.local','{"full_name":"Pərvin Sahib","company_name":"Şirkət P"}'),
  ('f0000000-0000-0000-0000-000000000001','q.owner@test.local','{"full_name":"Qəmər Sahib","company_name":"Şirkət Q"}'),
  ('e0000000-0000-0000-0000-000000000002','p.admin@test.local','{"full_name":"Aydan Admin","invite_token":"pending"}'),
  ('e0000000-0000-0000-0000-000000000003','p.employee@test.local','{"full_name":"Elvin İşçi","invite_token":"pending"}'),
  ('e0000000-0000-0000-0000-000000000004','p.viewer@test.local','{"full_name":"Vüsal Baxan","invite_token":"pending"}'),
  ('e0000000-0000-0000-0000-000000000005','p.suspended@test.local','{"full_name":"Sona Dayanan","invite_token":"pending"}'),
  ('e0000000-0000-0000-0000-000000000006','p.limited@test.local','{"full_name":"Lalə Məhdud","invite_token":"pending"}'),
  ('e0000000-0000-0000-0000-000000000007','p.late@test.local','{"full_name":"Gec Gələn","invite_token":"pending"}'),
  ('e0000000-0000-0000-0000-000000000008','p.late2@test.local','{"full_name":"İkinci Gec","invite_token":"pending"}'),
  ('f0000000-0000-0000-0000-000000000002','q.member@test.local','{"full_name":"Qüdrət Üzv","invite_token":"pending"}');

insert into t2b.ctx select 'org_p', active_org_id::text from public.profiles where id = t2b.u('p_owner');
insert into t2b.ctx select 'org_q', active_org_id::text from public.profiles where id = t2b.u('q_owner');

-- A custom (non-system) role in org P that holds nothing but ares.use (search must return nothing).
insert into public.roles (org_id, key, name, rank, is_system)
  values (t2b.u('org_p'), 'limited', 'Məhdud', 60, false) returning id \gset limited_
insert into t2b.ctx values ('role_limited', :'limited_id');
insert into public.role_permissions (role_id, permission_key) values (t2b.u('role_limited'), 'ares.use');

set role authenticated;
do $$
declare r record; tok text;
begin
  for r in select * from (values ('p_admin','admin','org_p','p_owner'),('p_employee','employee','org_p','p_owner'),
                                 ('p_viewer','viewer','org_p','p_owner'),('p_suspended','employee','org_p','p_owner'),
                                 ('p_limited','viewer','org_p','p_owner'),('q_member','employee','org_q','q_owner')) v(k, role, org, inviter) loop
    perform t2b.as_user(r.inviter);
    tok := public.create_invite(t2b.u(r.org), replace(r.k, '_', '.') || '@test.local', r.role);
    perform t2b.as_user(r.k);
    perform public.accept_invite(tok);
  end loop;
  perform t2b.as_user('p_owner');
  perform public.set_member_status(t2b.u('p_suspended'), t2b.u('org_p'), 'suspended');
  perform t2b.ok(0, 'setup: teams via invites', true);
exception when others then
  perform t2b.ok(0, 'setup: teams via invites', false, sqlerrm);
end $$;
reset role;
update public.organization_members set role_id = t2b.u('role_limited')
  where org_id = t2b.u('org_p') and user_id = t2b.u('p_limited');

-- Business rows for search (inserted as the database owner = fixture only)
insert into public.companies (org_id, user_id, name, city) values
  (t2b.u('org_p'), t2b.u('p_owner'), 'Şəhər Market', 'Bakı'),
  (t2b.u('org_p'), t2b.u('p_owner'), '100% Pambıq', 'Gəncə'),
  (t2b.u('org_p'), t2b.u('p_owner'), 'Under_score MMC', 'Sumqayıt'),
  (t2b.u('org_q'), t2b.u('q_owner'), 'Gizli Q Market', 'Bakı');
insert into public.products (org_id, user_id, name, sku) values
  (t2b.u('org_p'), t2b.u('p_owner'), 'Vizit kartı 90x50', 'VK-90'),
  (t2b.u('org_q'), t2b.u('q_owner'), 'Gizli Q məhsul', 'GQ-1');
insert into public.saved_items (org_id, user_id, module_key, item_type, title) values
  (t2b.u('org_p'), t2b.u('p_owner'), 'wholesale', 'note', 'Topdan qeyd Alfa'),
  (t2b.u('org_p'), t2b.u('p_owner'), 'arbitrage', 'note', 'Arbitraj qeyd Alfa'),
  (t2b.u('org_q'), t2b.u('q_owner'), 'wholesale', 'note', 'Gizli Q qeyd Alfa');

-- Notifications created through the internal notify() (as the database owner)
do $$ begin
  perform public.notify(t2b.u('org_p'), t2b.u('p_admin'),    'system.test', 'Admin üçün', null, '/settings', null, null, '{}');
  perform public.notify(t2b.u('org_p'), t2b.u('p_employee'), 'system.test', 'İşçi üçün',  null, '/settings', null, null, '{}');
  perform public.notify(t2b.u('org_q'), t2b.u('q_owner'),    'system.test', 'Q üçün',     null, '/settings', null, null, '{}');
  perform t2b.ok(0, 'setup: notifications via notify()', true);
exception when others then
  perform t2b.ok(0, 'setup: notifications via notify()', false, sqlerrm);
end $$;
do $$ begin
  insert into t2b.ctx select 'n_admin', id::text from public.notifications where user_id = t2b.u('p_admin') and type = 'system.test';
exception when others then insert into t2b.ctx values ('n_admin', gen_random_uuid()::text); end $$;

-- ════════════════════ NOTIFICATIONS ════════════════════
set role authenticated;

-- 25. Reading other people's notifications
select t2b.as_user('p_employee');
select t2b.ok(25, 'employee sees own notification', t2b.n($$select 1 from public.notifications where type = 'system.test'$$) = 1);
select t2b.ok(25, 'employee sees no notification of another member', t2b.n(format(
  $$select 1 from public.notifications where user_id <> %L$$, t2b.v('p_employee'))) = 0);
select t2b.ok(25, 'employee sees no notification of org Q', t2b.n(format(
  $$select 1 from public.notifications where org_id = %L$$, t2b.v('org_q'))) = 0);
select t2b.as_user('q_owner');
select t2b.ok(25, 'org Q owner sees no notification of org P', t2b.n(format(
  $$select 1 from public.notifications where org_id = %L$$, t2b.v('org_p'))) = 0);
select t2b.ok(25, 'unread_notification_count counts only own', t2b.val(format(
  $$select public.unread_notification_count(%L)$$, t2b.v('org_p'))) = '0');

-- 26. Forged notifications
select t2b.as_user('p_employee');
select t2b.rejects(26, 'direct insert into notifications', format(
  $$insert into public.notifications (org_id, user_id, type, title) values (%L, %L, 'system.test', 'Saxta')$$,
  t2b.v('org_p'), t2b.v('p_admin')));
select t2b.rejects(26, 'direct insert of own notification', format(
  $$insert into public.notifications (org_id, user_id, type, title) values (%L, %L, 'system.test', 'Saxta')$$,
  t2b.v('org_p'), t2b.v('p_employee')));
select t2b.rejects(26, 'client cannot call notify()', format(
  $$select public.notify(%L, %L, 'system.test', 'Saxta', null, null, null, null, '{}')$$, t2b.v('org_p'), t2b.v('p_admin')));

-- 27. Marking / deleting someone else's notification
select t2b.no_effect(27, 'update other member''s notification', format(
  $$update public.notifications set read_at = now() where id = %L$$, t2b.v('n_admin')));
select t2b.no_effect(27, 'delete other member''s notification', format(
  $$delete from public.notifications where id = %L$$, t2b.v('n_admin')));
select t2b.ok(27, 'mark_notifications_read on other''s id affects 0', t2b.val(format(
  $$select public.mark_notifications_read(array[%L]::uuid[])$$, t2b.v('n_admin'))) = '0');
select t2b.ok(27, 'mark_notifications_read on own id affects 1', t2b.val(
  $$select public.mark_notifications_read(array(select id from public.notifications where type = 'system.test'))$$) = '1');
select t2b.no_effect(27, 'delete own notification (no delete right)',
  $$delete from public.notifications where type = 'system.test'$$);
reset role;
select t2b.ok(27, 'admin notification still unread', t2b.val(format(
  $$select read_at is null from public.notifications where id = %L$$, t2b.v('n_admin'))) = 'true');

-- 28. Links
select t2b.rejects(28, 'external https link', format(
  $$select public.notify(%L, %L, 'system.test', 'x', null, 'https://evil.example', null, null, '{}')$$, t2b.v('org_p'), t2b.v('p_owner')));
select t2b.rejects(28, 'javascript: link', format(
  $$select public.notify(%L, %L, 'system.test', 'x', null, 'javascript:alert(1)', null, null, '{}')$$, t2b.v('org_p'), t2b.v('p_owner')));
select t2b.rejects(28, 'protocol-relative //host link', format(
  $$select public.notify(%L, %L, 'system.test', 'x', null, '//evil.example/x', null, null, '{}')$$, t2b.v('org_p'), t2b.v('p_owner')));
select t2b.rejects(28, 'backslash link', format(
  $$select public.notify(%L, %L, 'system.test', 'x', null, '/\evil.example', null, null, '{}')$$, t2b.v('org_p'), t2b.v('p_owner')));
select t2b.ok(28, 'internal link accepted', t2b.val(format(
  $$select (public.notify(%L, %L, 'system.test', 'ok', null, '/settings/team?tab=1', null, null, '{}')) is not null$$,
  t2b.v('org_p'), t2b.v('p_owner'))) = 'true');

-- 29. Events of another organization (team triggers)
set role authenticated;
do $$ declare tok text; begin
  perform t2b.as_user('q_owner');
  tok := public.create_invite(t2b.u('org_q'), 'p.late@test.local', 'viewer');
  perform t2b.as_user('p_late');
  perform public.accept_invite(tok);
  perform t2b.ok(29, 'setup: user joins org Q', true);
exception when others then perform t2b.ok(29, 'setup: user joins org Q', false, sqlerrm); end $$;
select t2b.as_user('q_owner');
select t2b.ok(29, 'Q owner got invite.accepted for the new member', t2b.n(format(
  $$select 1 from public.notifications where type = 'invite.accepted' and entity_id = %L$$, t2b.v('p_late'))) = 1);
select t2b.as_user('p_owner');
select t2b.ok(29, 'P owner got nothing about org Q', t2b.n(format(
  $$select 1 from public.notifications where org_id <> %L$$, t2b.v('org_p'))) = 0
  and t2b.n(format($$select 1 from public.notifications where entity_id = %L$$, t2b.v('p_late'))) = 0);
select t2b.as_user('p_admin');
select t2b.ok(29, 'P admin got nothing about org Q', t2b.n(format(
  $$select 1 from public.notifications where org_id <> %L$$, t2b.v('org_p'))) = 0);

-- role change → target is notified, in the right organization
select t2b.as_user('p_owner');
select t2b.allows(29, 'owner changes viewer → employee', format(
  $$select public.set_member_role(%L, %L, 'employee')$$, t2b.v('p_viewer'), t2b.v('org_p')));
select t2b.as_user('p_viewer');
select t2b.ok(29, 'viewer got member.role_changed in org P', t2b.n(format(
  $$select 1 from public.notifications where type = 'member.role_changed' and org_id = %L$$, t2b.v('org_p'))) = 1);
select t2b.as_user('p_owner');
select t2b.allows(29, 'restore viewer role', format(
  $$select public.set_member_role(%L, %L, 'viewer')$$, t2b.v('p_viewer'), t2b.v('org_p')));

-- 30. Disabled notification type is not created
select t2b.as_user('p_admin');
select t2b.allows(30, 'admin disables member.joined in org P', format(
  $$insert into public.notification_preferences (user_id, org_id, type, enabled) values (%L, %L, 'member.joined', false)$$,
  t2b.v('p_admin'), t2b.v('org_p')));
do $$ declare tok text; begin
  perform t2b.as_user('p_owner');
  tok := public.create_invite(t2b.u('org_p'), 'p.late2@test.local', 'viewer');
  perform t2b.as_user('p_late2');
  perform public.accept_invite(tok);
  perform t2b.ok(30, 'setup: new member joins org P', true);
exception when others then perform t2b.ok(30, 'setup: new member joins org P', false, sqlerrm); end $$;
select t2b.as_user('p_admin');
select t2b.ok(30, 'admin (disabled) got no member.joined', t2b.n(format(
  $$select 1 from public.notifications where type = 'member.joined' and entity_id = %L$$, t2b.v('p_late2'))) = 0);
select t2b.ok(30, 'admin did get member.joined before switching it off', t2b.n(format(
  $$select 1 from public.notifications where type = 'member.joined' and entity_id = %L$$, t2b.v('p_viewer'))) = 1);
select t2b.as_user('p_owner');
select t2b.ok(30, 'owner (inviter) got invite.accepted', t2b.n(format(
  $$select 1 from public.notifications where type = 'invite.accepted' and entity_id = %L$$, t2b.v('p_late2'))) = 1);
select t2b.as_user('p_employee');
select t2b.ok(30, 'employee (no members.manage) got no member.joined', t2b.n($$select 1 from public.notifications where type = 'member.joined'$$) = 0);
reset role;
select t2b.ok(30, 'suspended member gets no notification', t2b.n(format(
  $$select 1 from public.notifications where user_id = %L$$, t2b.v('p_suspended'))) = 0
  and t2b.n('select 1 from public.notifications') > 0);
set role authenticated;

-- 31. Someone else's notification settings
select t2b.as_user('p_employee');
select t2b.rejects(31, 'insert preference for another user', format(
  $$insert into public.notification_preferences (user_id, org_id, type, enabled) values (%L, %L, 'member.role_changed', false)$$,
  t2b.v('p_admin'), t2b.v('org_p')));
select t2b.rejects(31, 'insert preference for an org you are not in', format(
  $$insert into public.notification_preferences (user_id, org_id, type, enabled) values (%L, %L, 'member.role_changed', false)$$,
  t2b.v('p_employee'), t2b.v('org_q')));
select t2b.no_effect(31, 'update another user''s preference',
  $$update public.notification_preferences set enabled = true where type = 'member.joined'$$);
select t2b.no_effect(31, 'delete another user''s preference',
  $$delete from public.notification_preferences where type = 'member.joined'$$);
select t2b.ok(31, 'preferences of others are invisible', t2b.n($$select 1 from public.notification_preferences$$) = 0);
reset role;
select t2b.ok(31, 'admin preference unchanged', t2b.val(format(
  $$select enabled = false from public.notification_preferences where user_id = %L and type = 'member.joined'$$, t2b.v('p_admin'))) = 'true');

-- ════════════════════ SEARCH ════════════════════
set role authenticated;
-- 32. Other organizations never appear
select t2b.as_user('p_owner');
select t2b.ok(32, 'search in own org finds "Şəhər Market"', t2b.n(format(
  $$select 1 from public.global_search(%L, 'Şəhər') where kind = 'company'$$, t2b.v('org_p'))) = 1);
select t2b.ok(32, 'search "Gizli" in org P returns nothing', t2b.n(format(
  $$select 1 from public.global_search(%L, 'Gizli')$$, t2b.v('org_p'))) = 0);
select t2b.ok(32, 'search in org Q (not a member) returns nothing', t2b.n(format(
  $$select 1 from public.global_search(%L, 'Gizli')$$, t2b.v('org_q'))) = 0);
select t2b.ok(32, 'search in org Q with a broad term returns nothing', t2b.n(format(
  $$select 1 from public.global_search(%L, 'Market')$$, t2b.v('org_q'))) = 0);
select t2b.as_user('q_member');
select t2b.ok(32, 'Q member: search in org P returns nothing', t2b.n(format(
  $$select 1 from public.global_search(%L, 'Market')$$, t2b.v('org_p'))) = 0);
select t2b.ok(32, 'Q member: search in own org works', t2b.n(format(
  $$select 1 from public.global_search(%L, 'Gizli')$$, t2b.v('org_q'))) = 3);
select t2b.as_user('p_owner');
-- functional: Azerbaijani letters + typos
select t2b.ok(32, 'az_fold: "seher" finds "Şəhər Market"', t2b.n(format(
  $$select 1 from public.global_search(%L, 'seher') where title = 'Şəhər Market'$$, t2b.v('org_p'))) = 1);
select t2b.ok(32, 'typo: "Şəhər Markte" still finds it', t2b.n(format(
  $$select 1 from public.global_search(%L, 'Şəhər Markte') where title = 'Şəhər Market'$$, t2b.v('org_p'))) = 1);
select t2b.ok(32, 'product by SKU', t2b.n(format(
  $$select 1 from public.global_search(%L, 'vk-90') where kind = 'product'$$, t2b.v('org_p'))) = 1);
select t2b.ok(32, 'member by name (members.read)', t2b.n(format(
  $$select 1 from public.global_search(%L, 'Aydan') where kind = 'member'$$, t2b.v('org_p'))) = 1);
select t2b.ok(32, 'own notification by title', t2b.n(format(
  $$select 1 from public.global_search(%L, 'ok') where kind = 'notification'$$, t2b.v('org_p'))) >= 1);
select t2b.ok(32, 'every result has an internal link', t2b.n(format(
  $$select 1 from public.global_search(%L, 'Alfa') where link !~ '^/'$$, t2b.v('org_p'))) = 0
  and t2b.n(format($$select 1 from public.global_search(%L, 'Alfa')$$, t2b.v('org_p'))) = 2);
select t2b.as_user('p_employee');
select t2b.ok(32, 'nobody else''s notifications in search', t2b.n(format(
  $$select 1 from public.global_search(%L, 'Admin üçün') where kind = 'notification'$$, t2b.v('org_p'))) = 0);

-- 33. Search obeys permissions, plan and member status
select t2b.as_user('p_limited');
select t2b.ok(33, 'role without data.read / members.read finds nothing', t2b.n(format(
  $$select 1 from public.global_search(%L, 'Market')$$, t2b.v('org_p'))) = 0
  and t2b.n(format($$select 1 from public.global_search(%L, 'Aydan')$$, t2b.v('org_p'))) = 0
  and t2b.n(format($$select 1 from public.global_search(%L, 'Alfa')$$, t2b.v('org_p'))) = 0);
select t2b.as_user('p_suspended');
select t2b.ok(33, 'suspended member finds nothing', t2b.n(format(
  $$select 1 from public.global_search(%L, 'Market')$$, t2b.v('org_p'))) = 0
  and t2b.n(format($$select 1 from public.global_search(%L, 'Aydan')$$, t2b.v('org_p'))) = 0);
do $$ declare res text := t2b.search_vs_rls(array['p_owner','p_admin','p_employee','p_viewer','p_suspended','p_limited','q_owner','q_member']);
begin perform t2b.ok(33, 'every search result is visible to that user via RLS (8 users)',
  split_part(res, '/', 1)::int > 20 and split_part(res, '/', 2) = '0', res || ' (results/not visible)'); end $$;
reset role;
insert into public.plans (key, name, modules) values ('t2b-wholesale-only', 'Test planı', array['wholesale']);
update public.organization_subscriptions set plan_id = (select id from public.plans where key = 't2b-wholesale-only')
  where org_id = t2b.u('org_p');
set role authenticated;
select t2b.as_user('p_employee');
select t2b.ok(33, 'saved item of a module outside the plan is not found', t2b.n(format(
  $$select 1 from public.global_search(%L, 'Alfa') where kind = 'saved_item'$$, t2b.v('org_p'))) = 1
  and t2b.n(format($$select 1 from public.global_search(%L, 'Arbitraj')$$, t2b.v('org_p'))) = 0);
do $$ declare res text := t2b.search_vs_rls(array['p_owner','p_employee','p_viewer']);
begin perform t2b.ok(33, 'with a reduced plan: results still match RLS',
  split_part(res, '/', 1)::int > 0 and split_part(res, '/', 2) = '0', res); end $$;
reset role;
update public.organization_subscriptions set plan_id = (select id from public.plans where key = 'internal')
  where org_id = t2b.u('org_p');
set role authenticated;

-- 34. Hostile input
select t2b.as_user('p_owner');
select t2b.ok(34, '"%" is a literal, not a wildcard', t2b.val(format(
  $$select string_agg(title, ',') from public.global_search(%L, '0%%') where kind = 'company'$$, t2b.v('org_p'))) = '100% Pambıq');
select t2b.ok(34, '"_" is a literal, not a wildcard', t2b.val(format(
  $$select string_agg(title, ',') from public.global_search(%L, 'r_s') where kind = 'company'$$, t2b.v('org_p'))) = 'Under_score MMC');
select t2b.ok(34, 'quote does not break the query', t2b.n(format(
  $$select 1 from public.global_search(%L, $q$x' or '1'='1$q$)$$, t2b.v('org_p'))) = 0);
select t2b.ok(34, 'backslash does not break the query', t2b.n(format(
  $$select 1 from public.global_search(%L, '\\\\')$$, t2b.v('org_p'))) = 0);
select t2b.ok(34, '10 000-character query: no error, bounded', t2b.n(format(
  $$select 1 from public.global_search(%L, repeat('Market ', 1500))$$, t2b.v('org_p'))) between 0 and 50);
select t2b.ok(34, 'limit 100 000 is capped at 50', t2b.n(format(
  $$select 1 from public.global_search(%L, 'ar', 100000)$$, t2b.v('org_p'))) between 0 and 50);
select t2b.ok(34, '1-character query returns nothing', t2b.n(format(
  $$select 1 from public.global_search(%L, 'M')$$, t2b.v('org_p'))) = 0);
select t2b.ok(34, 'NULL query returns nothing', t2b.n(format(
  $$select 1 from public.global_search(%L, null)$$, t2b.v('org_p'))) = 0);
select t2b.ok(34, 'negative limit returns nothing', t2b.n(format(
  $$select 1 from public.global_search(%L, 'Market', -5)$$, t2b.v('org_p'))) = 0);
reset role;

-- 35. Search performance (10 000 rows per source)
insert into public.companies (org_id, user_id, name, city)
  select t2b.u('org_p'), t2b.u('p_owner'), 'Toplu şirkət ' || g, 'Bakı' from generate_series(1, 10000) g;
insert into public.products (org_id, user_id, name, sku)
  select t2b.u('org_p'), t2b.u('p_owner'), 'Toplu məhsul ' || g, 'TM-' || g from generate_series(1, 10000) g;
insert into public.saved_items (org_id, user_id, module_key, item_type, title)
  select t2b.u('org_p'), t2b.u('p_owner'), 'wholesale', 'note', 'Toplu qeyd ' || g from generate_series(1, 10000) g;
analyze public.companies; analyze public.products; analyze public.saved_items;
set role authenticated;
select t2b.as_user('p_employee');
do $$ declare t0 timestamptz; n bigint; ms numeric; q text; worst numeric := 0; begin
  foreach q in array array['toplu 5123', 'tm-777', 'sehr market', 'Toplu qeyd 99', 'zzzz yoxdur'] loop
    t0 := clock_timestamp();
    n := t2b.n(format('select 1 from public.global_search(%L, %L)', t2b.v('org_p'), q));
    ms := extract(epoch from clock_timestamp() - t0) * 1000;
    worst := greatest(worst, ms);
    if n < 0 then worst := 1e9; end if;
  end loop;
  perform t2b.ok(35, '5 searches over 30k rows, each < 300 ms', worst < 300, format('slowest %s ms', round(worst, 1)));
end $$;
reset role;

-- ════════════════════ PROFILE & SETTINGS ════════════════════
set role authenticated;
-- 36. Profiles
select t2b.as_user('p_employee');
select t2b.no_effect(36, 'update another user''s profile', format(
  $$update public.profiles set full_name = 'Hacked' where id = %L$$, t2b.v('p_admin')));
select t2b.rejects(36, 'write active_org_id directly (own profile)', format(
  $$update public.profiles set active_org_id = %L where id = %L$$, t2b.v('org_q'), t2b.v('p_employee')));
select t2b.rejects(36, 'write active_org_id directly (own org)', format(
  $$update public.profiles set active_org_id = %L where id = %L$$, t2b.v('org_p'), t2b.v('p_employee')));
select t2b.rejects(36, 'switch_org to a foreign org', format($$select public.switch_org(%L)$$, t2b.v('org_q')));
select t2b.allows(36, 'update own name, phone, job title, locale', format(
  $$update public.profiles set full_name = 'Elvin Yeni', phone = '+994 50 123 45 67', job_title = 'Satış', locale = 'en' where id = %L$$,
  t2b.v('p_employee')));
select t2b.rejects(36, 'invalid locale', format($$update public.profiles set locale = 'xx' where id = %L$$, t2b.v('p_employee')));
select t2b.rejects(36, 'invalid phone', format($$update public.profiles set phone = 'call me<script>' where id = %L$$, t2b.v('p_employee')));
select t2b.rejects(36, 'avatar path outside own folder', format(
  $$update public.profiles set avatar_path = %L where id = %L$$, t2b.v('p_admin') || '/a.png', t2b.v('p_employee')));
select t2b.allows(36, 'avatar path inside own folder', format(
  $$update public.profiles set avatar_path = %L where id = %L$$, t2b.v('p_employee') || '/avatar.png', t2b.v('p_employee')));
select t2b.rejects(36, 'insert a profile row', format($$insert into public.profiles (id) values (%L)$$, gen_random_uuid()));
select t2b.no_effect(36, 'delete own profile', format($$delete from public.profiles where id = %L$$, t2b.v('p_employee')));

-- 37. Preferences shape and size
select t2b.allows(37, 'valid preferences', format(
  $$update public.profiles set preferences = '{"theme":"dark","sidebar":"collapsed","onboarding_dismissed":true}' where id = %L$$,
  t2b.v('p_employee')));
select t2b.rejects(37, 'unknown key', format($$update public.profiles set preferences = '{"is_admin":true}' where id = %L$$, t2b.v('p_employee')));
select t2b.rejects(37, 'invalid value', format($$update public.profiles set preferences = '{"theme":"neon"}' where id = %L$$, t2b.v('p_employee')));
select t2b.rejects(37, 'wrong type (array)', format($$update public.profiles set preferences = '[1,2]' where id = %L$$, t2b.v('p_employee')));
select t2b.rejects(37, 'larger than 8 KB', format(
  $$update public.profiles set preferences = jsonb_build_object('timezone', repeat('x', 9000)) where id = %L$$, t2b.v('p_employee')));

-- 38. Organization details
select t2b.no_effect(38, 'employee (no org.manage) edits org details', format(
  $$update public.organizations set legal_name = 'Hack MMC' where id = %L$$, t2b.v('org_p')));
select t2b.as_user('p_admin');
select t2b.allows(38, 'admin edits org details', format(
  $$update public.organizations set legal_name = 'P MMC', tax_id = '1234567890', address = 'Bakı, Nizami 1',
     phone = '+994 12 555 00 00', email = 'info@p.az', website = 'https://p.az' where id = %L$$, t2b.v('org_p')));
select t2b.rejects(38, 'VÖEN with 9 digits', format($$update public.organizations set tax_id = '123456789' where id = %L$$, t2b.v('org_p')));
select t2b.rejects(38, 'VÖEN with letters', format($$update public.organizations set tax_id = '12345678AB' where id = %L$$, t2b.v('org_p')));
select t2b.rejects(38, 'website with javascript:', format($$update public.organizations set website = 'javascript:alert(1)' where id = %L$$, t2b.v('org_p')));
select t2b.rejects(38, 'invalid company email', format($$update public.organizations set email = 'not-an-email' where id = %L$$, t2b.v('org_p')));
select t2b.rejects(38, 'logo path of another org', format(
  $$update public.organizations set logo_path = %L where id = %L$$, t2b.v('org_q') || '/logo.png', t2b.v('org_p')));
select t2b.rejects(38, 'write mfa_required_roles directly', format(
  $$update public.organizations set mfa_required_roles = '{}' where id = %L$$, t2b.v('org_p')));
select t2b.as_user('q_owner');
select t2b.no_effect(38, 'owner of org Q edits org P', format(
  $$update public.organizations set legal_name = 'Hack' where id = %L$$, t2b.v('org_p')));

-- 39. Security policy: owner only
select t2b.as_user('p_admin');
select t2b.rejects(39, 'admin sets security policy', format(
  $$select public.set_security_policy(%L, array['employee'])$$, t2b.v('org_p')));
select t2b.as_user('q_owner');
select t2b.rejects(39, 'owner of another org sets policy', format(
  $$select public.set_security_policy(%L, array['employee'])$$, t2b.v('org_p')));
select t2b.as_user('p_owner');
select t2b.rejects(39, 'unknown role in policy', format($$select public.set_security_policy(%L, array['god'])$$, t2b.v('org_p')));
select t2b.rejects(39, 'owner without 2FA cannot require 2FA for own role (lock-out guard)', format(
  $$select public.set_security_policy(%L, array['owner'])$$, t2b.v('org_p')));

-- ════════════════════ STORAGE ════════════════════
-- 40. Avatars and logos
reset role;
select t2b.ok(40, 'buckets are private, 2 MB, images only', (select count(*) from storage.buckets
  where id in ('avatars', 'org-logos') and not public and file_size_limit = 2097152
    and allowed_mime_types @> array['image/png','image/jpeg','image/webp'] and cardinality(allowed_mime_types) = 3) = 2);
set role authenticated;
select t2b.as_user('p_employee');
select t2b.allows(40, 'upload own avatar', format(
  $$insert into storage.objects (bucket_id, name, owner) values ('avatars', %L, %L)$$, t2b.v('p_employee') || '/avatar.png', t2b.v('p_employee')));
select t2b.rejects(40, 'upload into another user''s avatar folder', format(
  $$insert into storage.objects (bucket_id, name, owner) values ('avatars', %L, %L)$$, t2b.v('p_admin') || '/avatar.png', t2b.v('p_employee')));
select t2b.rejects(40, 'upload avatar at bucket root', format(
  $$insert into storage.objects (bucket_id, name, owner) values ('avatars', 'avatar.png', %L)$$, t2b.v('p_employee')));
select t2b.rejects(40, 'employee uploads org logo (no org.manage)', format(
  $$insert into storage.objects (bucket_id, name, owner) values ('org-logos', %L, %L)$$, t2b.v('org_p') || '/logo.png', t2b.v('p_employee')));
select t2b.as_user('p_admin');
select t2b.allows(40, 'admin uploads org logo', format(
  $$insert into storage.objects (bucket_id, name, owner) values ('org-logos', %L, %L)$$, t2b.v('org_p') || '/logo.png', t2b.v('p_admin')));
select t2b.as_user('q_owner');
select t2b.rejects(40, 'owner of Q writes a logo into org P', format(
  $$insert into storage.objects (bucket_id, name, owner) values ('org-logos', %L, %L)$$, t2b.v('org_p') || '/x.png', t2b.v('q_owner')));
select t2b.ok(40, 'owner of Q cannot read org P logo', t2b.n(format(
  $$select 1 from storage.objects where bucket_id = 'org-logos' and name like %L$$, t2b.v('org_p') || '/%')) = 0);
select t2b.ok(40, 'owner of Q cannot read P member avatars', t2b.n(
  $$select 1 from storage.objects where bucket_id = 'avatars'$$) = 0);
select t2b.no_effect(40, 'owner of Q deletes org P logo', format(
  $$delete from storage.objects where bucket_id = 'org-logos' and name = %L$$, t2b.v('org_p') || '/logo.png'));
select t2b.as_user('p_viewer');
select t2b.ok(40, 'member of P reads P logo and colleague avatar', t2b.n(
  $$select 1 from storage.objects where bucket_id in ('org-logos', 'avatars')$$) = 2);
select t2b.no_effect(40, 'member deletes colleague avatar', format(
  $$delete from storage.objects where bucket_id = 'avatars' and name = %L$$, t2b.v('p_employee') || '/avatar.png'));
select t2b.as_user('p_employee');
select t2b.allows(40, 'delete own avatar', format(
  $$delete from storage.objects where bucket_id = 'avatars' and name = %L$$, t2b.v('p_employee') || '/avatar.png'));

-- ════════════════════ 2FA ENFORCEMENT ════════════════════
-- 41. Organization requires 2FA for a role
select t2b.as_user('p_owner');
select t2b.allows(41, 'owner requires 2FA for employees', format(
  $$select public.set_security_policy(%L, array['employee'])$$, t2b.v('org_p')));
select t2b.as_user('p_employee');
select t2b.ok(41, 'employee with aal1: companies hidden', t2b.n($$select 1 from public.companies$$) = 0);
select t2b.ok(41, 'employee with aal1: notifications hidden', t2b.n($$select 1 from public.notifications$$) = 0);
select t2b.ok(41, 'employee with aal1: search empty', t2b.n(format(
  $$select 1 from public.global_search(%L, 'Market')$$, t2b.v('org_p'))) = 0);
select t2b.ok(41, 'employee with aal1: search matches RLS (nothing)', t2b.search_vs_rls(array['p_employee']) = '0/0');
select t2b.ok(41, 'employee with aal1: check_access = mfa_required', t2b.val(format(
  $$select public.check_access(%L, array['data.read'])$$, t2b.v('org_p'))) = 'mfa_required');
select t2b.ok(41, 'employee with aal1: gate reports 2FA required', t2b.val(format(
  $$select required from public.org_mfa_gate() where org_id = %L$$, t2b.v('org_p'))) = 'true');
select t2b.allows(41, 'employee with aal1 may still switch to the org (to see the 2FA screen)',
  format($$select public.switch_org(%L)$$, t2b.v('org_p')));
select t2b.as_user('p_employee', 'aal2');
select t2b.ok(41, 'employee with aal2: companies visible', t2b.n($$select 1 from public.companies$$) > 0);
select t2b.ok(41, 'employee with aal2: check_access = ok', t2b.val(format(
  $$select public.check_access(%L, array['data.read'])$$, t2b.v('org_p'))) = 'ok');
select t2b.ok(41, 'employee with aal2: gate reports ok', t2b.val(format(
  $$select required from public.org_mfa_gate() where org_id = %L$$, t2b.v('org_p'))) = 'false');
select t2b.as_user('p_viewer');
select t2b.ok(41, 'viewer (role not in policy) with aal1: data visible', t2b.n($$select 1 from public.companies$$) > 0);
select t2b.ok(41, 'viewer was notified: security.policy_changed', t2b.n(
  $$select 1 from public.notifications where type = 'security.policy_changed'$$) = 1);
select t2b.as_user('p_owner');
select t2b.ok(41, 'the owner who changed it is not notified', t2b.n(
  $$select 1 from public.notifications where type = 'security.policy_changed'$$) = 0);
select t2b.as_user('p_owner', 'aal2');
select t2b.allows(41, 'owner with 2FA may require it for owners too', format(
  $$select public.set_security_policy(%L, array['owner','employee'])$$, t2b.v('org_p')));
select t2b.as_user('p_owner');
select t2b.ok(41, 'owner with aal1 is now locked out of data', t2b.n($$select 1 from public.companies$$) = 0);
select t2b.rejects(41, 'owner with aal1 cannot switch the policy off (no bypass with a stolen password)', format(
  $$select public.set_security_policy(%L, '{}'::text[])$$, t2b.v('org_p')));
select t2b.as_user('p_employee');
select t2b.rejects(41, 'a member whose role is in the policy cannot change it either (not owner)', format(
  $$select public.set_security_policy(%L, '{}'::text[])$$, t2b.v('org_p')));
select t2b.as_user('p_owner');
select t2b.as_user('p_owner', 'aal2');
select t2b.allows(41, 'policy can be switched off again', format(
  $$select public.set_security_policy(%L, '{}'::text[])$$, t2b.v('org_p')));
select t2b.as_user('p_employee');
select t2b.ok(41, 'after switching off: aal1 sees data again', t2b.n($$select 1 from public.companies$$) > 0);

-- ════════════════════ ACTIVITY FEED ════════════════════
-- 42. my_activity shows only the caller's own actions in the given org
select t2b.as_user('p_employee');
select t2b.allows(42, 'employee creates a company', $$insert into public.companies (name) values ('Elvinin şirkəti')$$);
select t2b.ok(42, 'my_activity returns own rows', t2b.n(format($$select 1 from public.my_activity(%L)$$, t2b.v('org_p'))) >= 1);
do $$ begin
  insert into t2b.ctx select 'act_ids', coalesce(string_agg(id::text, ','), '') from public.my_activity(t2b.u('org_p'), 100);
exception when others then insert into t2b.ctx values ('act_ids', ''); end $$;
select t2b.ok(42, 'employee still cannot read the full audit log', t2b.n($$select 1 from public.audit_log$$) = 0);
select t2b.ok(42, 'my_activity for a foreign org returns nothing', t2b.n(format(
  $$select 1 from public.my_activity(%L)$$, t2b.v('org_q'))) <= 0);
select t2b.as_user('p_admin');
select t2b.ok(42, 'admin''s feed does not contain the employee''s company', t2b.n(format(
  $$select 1 from public.my_activity(%L, 100) where changed::text like '%%Elvinin%%'$$, t2b.v('org_p'))) = 0);
select t2b.ok(42, 'limit is capped at 100', t2b.n(format($$select 1 from public.my_activity(%L, 100000)$$, t2b.v('org_p'))) between 0 and 100);
reset role;
select t2b.ok(42, 'every row in the employee''s feed is the employee''s own, in org P', t2b.v('act_ids') <> ''
  and (select count(*) from public.audit_log l where l.id::text = any (string_to_array(t2b.v('act_ids'), ','))
         and (l.actor_id is distinct from t2b.u('p_employee') or l.org_id <> t2b.u('org_p'))) = 0
  and (select count(*) from public.audit_log where id::text = any (string_to_array(t2b.v('act_ids'), ','))) =
      cardinality(string_to_array(t2b.v('act_ids'), ',')));
select t2b.ok(42, 'the feed includes all own actions in org P', t2b.v('act_ids') <> ''
  and (select count(*) from public.audit_log where actor_id = t2b.u('p_employee') and org_id = t2b.u('org_p')
         and not (id::text = any (string_to_array(t2b.v('act_ids'), ',')))) = 0);
set role authenticated;

-- ════════════════════ GENERAL RULES ════════════════════
reset role;
select t2b.ok(0, 'new SECURITY DEFINER functions pin search_path', (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prosecdef
    and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')) = 0);
select t2b.ok(0, 'anon cannot execute any SECURITY DEFINER function', (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prosecdef and has_function_privilege('anon', p.oid, 'execute')) = 0);
select t2b.ok(0, 'clients cannot execute notify()', t2b.val($$select not has_function_privilege('authenticated',
  'public.notify(uuid, uuid, text, text, text, text, text, text, jsonb)', 'execute')$$) = 'true');
select t2b.ok(0, 'new tables have RLS on', (select count(*) from pg_class k join pg_namespace n on n.oid = k.relnamespace
  where n.nspname = 'public' and k.relname in ('notifications', 'notification_preferences') and k.relrowsecurity) = 2);
select t2b.ok(0, 'notifications published to Realtime', exists (select 1 from pg_publication_tables
  where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications'));
set role anon;
select t2b.rejects(0, 'anon reads notifications', 'select 1 from public.notifications');
select t2b.rejects(0, 'anon reads notification_preferences', 'select 1 from public.notification_preferences');
select t2b.rejects(0, 'anon calls global_search', format($$select * from public.global_search(%L, 'Market')$$, t2b.v('org_p')));
select t2b.ok(0, 'anon reads no storage objects', t2b.n('select 1 from storage.objects') <= 0);
reset role;

-- ── report ──────────────────────────────────────────────────
\set QUIET off
\pset footer off
select scenario as "#", case when ok then 'PASS' else 'FAIL' end as result, name, detail
  from t2b.results order by scenario, n;
select count(*) filter (where ok) as passed, count(*) filter (where not ok) as failed,
       count(distinct scenario) filter (where scenario > 0) as scenarios
  from t2b.results;
do $$ begin
  if exists (select 1 from t2b.results where not ok) then
    raise exception 'PHASE 2B TESTS FAILED: % failing check(s)', (select count(*) from t2b.results where not ok);
  end if;
end $$;
select 'ALL PHASE 2B TESTS PASSED' as result;
