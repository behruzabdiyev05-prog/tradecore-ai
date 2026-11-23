-- ═════════════════════════════════════════════════════════════
-- TRADECORE AI · Phase 3 · Modules 01, 02, 04–10 — database tests (migrations 0018–0022)
-- Every check records PASS/FAIL; the run fails if any FAIL. Own schema `tm3`, own users/orgs (P, Q).
--   P00 setup  P01 structure  P02 opportunities  P03 trade documents + posting to finance
--   P04 leads  P05 trading + alerts  P06 supplier offers MOQ
-- ═════════════════════════════════════════════════════════════
\set ON_ERROR_STOP on
\set QUIET on

drop schema if exists tm3 cascade;
create schema tm3;
create table tm3.results (n serial, grp text, name text, ok boolean, detail text);
create table tm3.ctx (k text primary key, v text);
grant usage on schema tm3 to authenticated, anon;
grant select, insert, update on tm3.results, tm3.ctx to authenticated, anon;
grant usage on sequence tm3.results_n_seq to authenticated, anon;

create function tm3.v(key text) returns text language sql stable as $$ select v from tm3.ctx where k = key $$;
create function tm3.u(key text) returns uuid language sql stable as $$ select v::uuid from tm3.ctx where k = key $$;
create function tm3.put(key text, val text) returns void language sql as $$
  insert into tm3.ctx values (key, val) on conflict (k) do update set v = excluded.v $$;
-- Emulates a Supabase session: JWT `sub` + `aal`
create function tm3.as_user(key text, aal text default 'aal1') returns void language sql as $$
  select set_config('request.jwt.claim.sub', coalesce(tm3.v(key), ''), false),
         set_config('request.jwt.claim.aal', aal, false); $$;
create function tm3.ok(grp text, name text, cond boolean, detail text default '') returns void language sql as $$
  insert into tm3.results (grp, name, ok, detail) values (grp, name, coalesce(cond, false), detail); $$;
create function tm3.rejects(grp text, name text, stmt text) returns void language plpgsql as $$
begin
  begin
    execute stmt;
  exception when others then
    if sqlstate in ('42501','23514','P0001','23503','23505','22023','55000','42P17','22P02','22001','23502') then
      perform tm3.ok(grp, name, true, 'rejected: ' || sqlstate || ' ' || left(sqlerrm, 90));
    else
      perform tm3.ok(grp, name, false, 'wrong error ' || sqlstate || ': ' || sqlerrm);
    end if;
    return;
  end;
  perform tm3.ok(grp, name, false, 'statement was ALLOWED: ' || left(stmt, 140));
end $$;
-- Rejected with a message that contains `needle` (the user-facing text matters, not only the code).
create function tm3.rejects_msg(grp text, name text, stmt text, needle text) returns void language plpgsql as $$
begin
  begin
    execute stmt;
  exception when others then
    perform tm3.ok(grp, name, sqlerrm ilike '%' || needle || '%', sqlstate || ': ' || left(sqlerrm, 120));
    return;
  end;
  perform tm3.ok(grp, name, false, 'statement was ALLOWED: ' || left(stmt, 140));
end $$;
-- Rejected OR affects 0 rows (both mean "no effect").
create function tm3.no_effect(grp text, name text, stmt text) returns void language plpgsql as $$
declare n int;
begin
  begin
    execute stmt; get diagnostics n = row_count;
  exception when others then
    if sqlstate in ('42501','P0001','23503') then perform tm3.ok(grp, name, true, 'rejected: ' || sqlstate);
    else perform tm3.ok(grp, name, false, 'wrong error ' || sqlstate || ': ' || sqlerrm); end if;
    return;
  end;
  perform tm3.ok(grp, name, n = 0, format('%s row(s) affected', n));
end $$;
create function tm3.allows(grp text, name text, stmt text) returns void language plpgsql as $$
begin
  execute stmt; perform tm3.ok(grp, name, true);
exception when others then perform tm3.ok(grp, name, false, sqlstate || ': ' || sqlerrm);
end $$;
-- Number of rows a DML statement affects (-1 = error).
create function tm3.rows(stmt text) returns int language plpgsql as $$
declare n int;
begin
  execute stmt; get diagnostics n = row_count; return n;
exception when others then return -1;
end $$;
create function tm3.n(stmt text) returns bigint language plpgsql as $$
declare n bigint;
begin
  execute 'select count(*) from (' || stmt || ') q' into n; return n;
exception when others then return -1;
end $$;
create function tm3.val(stmt text) returns text language plpgsql as $$
declare r text;
begin
  execute stmt into r; return r;
exception when others then return 'ERROR ' || sqlstate || ': ' || sqlerrm;
end $$;
grant execute on all functions in schema tm3 to authenticated, anon;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant usage on schema tm3 to service_role';
    execute 'grant select, insert, update on tm3.results, tm3.ctx to service_role';
    execute 'grant usage on sequence tm3.results_n_seq to service_role';
    execute 'grant execute on all functions in schema tm3 to service_role';
  end if;
end $$;


-- ════════════════════ P00 · FIXTURE ════════════════════
insert into tm3.ctx values
  ('p_owner','a3000000-0000-0000-0000-000000000001'),('p_employee','a3000000-0000-0000-0000-000000000002'),
  ('p_viewer','a3000000-0000-0000-0000-000000000003'),('p_manager','a3000000-0000-0000-0000-000000000004'),
  ('q_owner','b3000000-0000-0000-0000-000000000001');
insert into auth.users (id, email, raw_user_meta_data) values
  ('a3000000-0000-0000-0000-000000000001','m3.p.owner@test.local','{"full_name":"Pünhan Sahib","company_name":"Ticarət P"}'),
  ('b3000000-0000-0000-0000-000000000001','m3.q.owner@test.local','{"full_name":"Qulu Sahib","company_name":"Ticarət Q"}'),
  ('a3000000-0000-0000-0000-000000000002','m3.p.employee@test.local','{"full_name":"Elçin İşçi","invite_token":"pending"}'),
  ('a3000000-0000-0000-0000-000000000003','m3.p.viewer@test.local','{"full_name":"Vüsal Baxan","invite_token":"pending"}'),
  ('a3000000-0000-0000-0000-000000000004','m3.p.manager@test.local','{"full_name":"Məryəm Menecer","invite_token":"pending"}');
insert into tm3.ctx select 'org_p', active_org_id::text from public.profiles where id = tm3.u('p_owner');
insert into tm3.ctx select 'org_q', active_org_id::text from public.profiles where id = tm3.u('q_owner');

set role authenticated;
do $$
declare r record; tok text;
begin
  for r in select * from (values ('p_employee','employee'),('p_viewer','viewer'),('p_manager','manager')) v(k, role) loop
    perform tm3.as_user('p_owner');
    tok := public.create_invite(tm3.u('org_p'), 'm3.' || replace(r.k, '_', '.') || '@test.local', r.role);
    perform tm3.as_user(r.k);
    perform public.accept_invite(tok);
  end loop;
  perform tm3.ok('P00', 'setup: komanda dəvətlə quruldu', true);
exception when others then perform tm3.ok('P00', 'setup: komanda dəvətlə quruldu', false, sqlerrm);
end $$;

select tm3.as_user('p_owner');
do $$ begin
  insert into public.products (org_id, name, origin_module) values (tm3.u('org_p'), 'Kağız stəkan 250 ml', 'wholesale');
  insert into public.companies (org_id, name, roles, city, country_code) values (tm3.u('org_p'), 'Çin Fabriki', '{supplier}', 'Guangzhou', 'CN');
  perform tm3.put('prod_p', (select id::text from public.products where name = 'Kağız stəkan 250 ml'));
  perform tm3.put('sup_p', (select id::text from public.companies where name = 'Çin Fabriki'));
exception when others then perform tm3.ok('P00', 'setup: P məhsul və təchizatçı', false, sqlerrm); end $$;
select tm3.as_user('q_owner');
do $$ begin
  insert into public.products (org_id, name) values (tm3.u('org_q'), 'Q gizli məhsul');
  insert into public.companies (org_id, name, roles) values (tm3.u('org_q'), 'Q gizli şirkət', '{customer}');
  perform tm3.put('prod_q', (select id::text from public.products where name = 'Q gizli məhsul'));
  perform tm3.put('comp_q', (select id::text from public.companies where name = 'Q gizli şirkət'));
exception when others then perform tm3.ok('P00', 'setup: Q məhsul və şirkət', false, sqlerrm); end $$;
reset role;

-- ════════════════════ P01 · STRUCTURE ════════════════════
create temp table p3_tables (t text) on commit preserve rows;
insert into p3_tables values ('opportunities'),('trade_documents'),('trade_document_lines'),('leads'),('lead_activities'),
  ('trading_accounts'),('trading_trades'),('trading_prices'),('trading_alerts');
grant select on p3_tables to authenticated;
select tm3.ok('P01', 'bütün 9 yeni cədvəl mövcuddur', (select count(*) from p3_tables where to_regclass('public.' || t) is not null) = 9);
select tm3.ok('P01', 'hamısında RLS aktivdir', (select bool_and(c.relrowsecurity) from pg_class c join p3_tables p on c.oid = to_regclass('public.' || p.t)));
select tm3.ok('P01', 'anon heç bir cədvələ çıxışa malik deyil', (select count(*) from p3_tables
  where has_table_privilege('anon', 'public.' || t, 'select') or has_table_privilege('anon', 'public.' || t, 'insert')) = 0);
select tm3.ok('P01', 'authenticated TRUNCATE edə bilmir', (select count(*) from p3_tables where has_table_privilege('authenticated', 'public.' || t, 'truncate')) = 0);
select tm3.ok('P01', 'yeni cədvəllərdən auth.users-ə FK yoxdur (Y16)', (select count(*) from pg_constraint c
  where c.contype = 'f' and c.confrelid = 'auth.users'::regclass and c.conrelid in (select to_regclass('public.' || t) from p3_tables)) = 0);
select tm3.ok('P01', 'hər cədvəldə org_id NOT NULL', (select count(*) from p3_tables p join information_schema.columns c
  on c.table_schema = 'public' and c.table_name = p.t and c.column_name = 'org_id' and c.is_nullable = 'NO') = 9);
select tm3.ok('P01', 'supplier_offers.min_order_qty əlavə olunub (boş buraxıla bilər)', (select is_nullable from information_schema.columns
  where table_schema = 'public' and table_name = 'supplier_offers' and column_name = 'min_order_qty') = 'YES');

-- ════════════════════ P02 · OPPORTUNITIES (01, 04, 05, 07, 08) ════════════════════
set role authenticated;
select tm3.as_user('p_employee');
select tm3.allows('P02', 'işçi 5 modulun hamısında qeyd yarada bilir', format($$insert into public.opportunities
  (org_id, module_key, title, currency, fx_rate_to_base, buy_price_minor, shipping_minor, sell_price_minor, product_id, company_id) values
  (%1$L, 'product-research', 'Termos 500 ml', 'USD', 1.7, 450, 120, 2500, %2$L, %3$L),
  (%1$L, 'arbitrage', 'iPhone qabı TR→AZ', 'TRY', 0.05, 30000, 5000, 1800, null, null),
  (%1$L, 'import-export', 'Fındıq ixracı', 'AZN', 1, 900, 100, 1500, null, null),
  (%1$L, 'used-goods', 'İşlənmiş noutbuk', 'AZN', 1, 30000, 0, 45000, null, null),
  (%1$L, 'digital-products', 'Menyu şablonu', 'AZN', 1, 0, 0, 1500, null, null)$$, tm3.v('org_p'), tm3.v('prod_p'), tm3.v('sup_p')));
select tm3.ok('P02', '5 qeyd yazıldı', tm3.n(format('select 1 from public.opportunities where org_id = %L', tm3.v('org_p'))) = 5);
select tm3.rejects('P02', 'icazəsiz modul açarı (marketplace) rədd edilir', format($$insert into public.opportunities (org_id, module_key, title) values (%L, 'marketplace', 'X')$$, tm3.v('org_p')));
select tm3.rejects('P02', 'AZN üçün məzənnə 1 olmalıdır', format($$insert into public.opportunities (org_id, module_key, title, currency, fx_rate_to_base) values (%L, 'arbitrage', 'X', 'AZN', 2)$$, tm3.v('org_p')));
select tm3.rejects('P02', 'mənfi qiymət rədd edilir', format($$insert into public.opportunities (org_id, module_key, title, buy_price_minor) values (%L, 'arbitrage', 'X', -1)$$, tm3.v('org_p')));
select tm3.rejects('P02', 'xal 1–5 aralığındadır', format($$insert into public.opportunities (org_id, module_key, title, demand_score) values (%L, 'arbitrage', 'X', 6)$$, tm3.v('org_p')));
select tm3.rejects('P02', 'başqa şirkətin məhsuluna bağlamaq olmur', format($$insert into public.opportunities (org_id, module_key, title, product_id) values (%L, 'arbitrage', 'X', %L)$$, tm3.v('org_p'), tm3.v('prod_q')));
select tm3.rejects('P02', 'qeydin modulunu dəyişmək olmur', format($$update public.opportunities set module_key = 'arbitrage' where org_id = %L and module_key = 'product-research'$$, tm3.v('org_p')));
select tm3.rejects('P02', 'javascript: linki rədd edilir', format($$insert into public.opportunities (org_id, module_key, title, source_url) values (%L, 'arbitrage', 'X', 'javascript:alert(1)')$$, tm3.v('org_p')));
select tm3.as_user('p_viewer');
select tm3.ok('P02', 'müşahidəçi qeydləri görür', tm3.n('select 1 from public.opportunities') = 5);
select tm3.rejects('P02', 'müşahidəçi qeyd yarada bilmir', format($$insert into public.opportunities (org_id, module_key, title) values (%L, 'arbitrage', 'X')$$, tm3.v('org_p')));
select tm3.no_effect('P02', 'müşahidəçi qeydi dəyişə bilmir', $$update public.opportunities set title = 'Y'$$);
select tm3.no_effect('P02', 'müşahidəçi qeydi silə bilmir', $$delete from public.opportunities$$);
select tm3.as_user('q_owner');
select tm3.ok('P02', 'Q şirkəti P-nin qeydlərini görmür', tm3.n('select 1 from public.opportunities') = 0);
select tm3.no_effect('P02', 'Q şirkəti P-nin qeydini dəyişə bilmir', $$update public.opportunities set title = 'hack'$$);
select tm3.rejects('P02', 'Q P-nin adına qeyd yarada bilmir', format($$insert into public.opportunities (org_id, module_key, title) values (%L, 'arbitrage', 'X')$$, tm3.v('org_p')));
reset role;
select tm3.ok('P02', 'qeyd audit jurnalına yazılır', (select count(*) from public.audit_log where table_name = 'opportunities' and action = 'INSERT') = 5);

-- ════════════════════ P03 · TRADE DOCUMENTS (02, 06, 09) ════════════════════
set role authenticated;
select tm3.as_user('p_employee');
select tm3.allows('P03', 'işçi satış sənədi yaradır', format($$insert into public.trade_documents (org_id, module_key, kind, number, company_id, counterparty_name)
  values (%L, 'b2b-trading', 'sale', 'S-001', %L, 'Çin Fabriki')$$, tm3.v('org_p'), tm3.v('sup_p')));
select tm3.put('doc_s', tm3.val($$select id::text from public.trade_documents where number = 'S-001'$$));
select tm3.allows('P03', 'işçi sətir əlavə edir (3 × 10.00, 10 % endirim)', format($$insert into public.trade_document_lines
  (org_id, document_id, product_id, description, quantity, unit_price_minor, discount_percent) values (%L, %L, %L, 'Kağız stəkan', 3, 1000, 10)$$,
  tm3.v('org_p'), tm3.v('doc_s'), tm3.v('prod_p')));
select tm3.ok('P03', 'sətir cəmi = round(3 × 1000 × 0.9) = 2700', tm3.val(format(
  'select public.trade_line_total(l)::text from public.trade_document_lines l where document_id = %L', tm3.v('doc_s'))) = '2700');
select tm3.rejects('P03', 'eyni nömrəli satış təkrarlanmır', format($$insert into public.trade_documents (org_id, module_key, kind, number) values (%L, 'b2b-trading', 'sale', 'S-001')$$, tm3.v('org_p')));
select tm3.allows('P03', 'eyni nömrə başqa növdə (təklif) mümkündür', format($$insert into public.trade_documents (org_id, module_key, kind, number) values (%L, 'b2b-trading', 'offer', 'S-001')$$, tm3.v('org_p')));
select tm3.rejects('P03', 'Müştəri Axtarışı modulunda yalnız təklif olur', format($$insert into public.trade_documents (org_id, module_key, kind, number) values (%L, 'b2b-client-finder', 'sale', 'X-1')$$, tm3.v('org_p')));
select tm3.rejects('P03', 'sənədi yazılmış kimi yaratmaq olmur', format($$insert into public.trade_documents (org_id, module_key, kind, number, posted_at) values (%L, 'wholesale', 'purchase', 'P-9', now())$$, tm3.v('org_p')));
select tm3.rejects('P03', 'sənədin növünü dəyişmək olmur', format($$update public.trade_documents set kind = 'purchase' where id = %L$$, tm3.v('doc_s')));
select tm3.rejects('P03', 'başqa şirkətin kontragentini bağlamaq olmur', format($$insert into public.trade_documents (org_id, module_key, kind, number, company_id) values (%L, 'wholesale', 'purchase', 'P-2', %L)$$, tm3.v('org_p'), tm3.v('comp_q')));
select tm3.rejects('P03', 'posted_at birbaşa yazıla bilmir', format($$update public.trade_documents set posted_at = now() where id = %L$$, tm3.v('doc_s')));
select tm3.rejects('P03', 'işçi (finance.write yoxdur) maliyyəyə yaza bilmir', format('select public.trade_document_post(%L)', tm3.v('doc_s')));
select tm3.rejects('P03', 'işçi "yazıldı" işarəsini birbaşa qoya bilmir', format('select public._trade_document_mark_posted(%L)', tm3.v('doc_s')));
select tm3.as_user('p_manager');
select tm3.ok('P03', 'menecer maliyyəyə yazır', tm3.val(format('select public.trade_document_post(%L)::text', tm3.v('doc_s'))) ~ '^[0-9a-f-]{36}$');
select tm3.ok('P03', 'mərkəzi maliyyədə 1 satış: 27.00 AZN, modul b2b-trading', tm3.val(format(
  $$select count(*)::text || '|' || max(amount_minor)::text || '|' || max(kind::text) || '|' || max(module_key)
    from public.financial_transactions where reference = 'trade_document:%s'$$, tm3.v('doc_s'))) = '1|2700|sale|b2b-trading');
select tm3.rejects_msg('P03', 'ikinci dəfə yazmaq olmur', format('select public.trade_document_post(%L)', tm3.v('doc_s')), 'artıq maliyyəyə yazılıb');
select tm3.rejects('P03', 'yazılmış sənədin sətri dəyişə bilmir', format($$update public.trade_document_lines set quantity = 30 where document_id = %L$$, tm3.v('doc_s')));
select tm3.rejects('P03', 'yazılmış sənədə sətir əlavə olunmur', format($$insert into public.trade_document_lines (org_id, document_id, description) values (%L, %L, 'Əlavə')$$, tm3.v('org_p'), tm3.v('doc_s')));
select tm3.rejects('P03', 'yazılmış sənədin valyutası dəyişmir', format($$update public.trade_documents set currency = 'USD', fx_rate_to_base = 1.7 where id = %L$$, tm3.v('doc_s')));
select tm3.allows('P03', 'yazılmış sənədin statusu dəyişə bilər', format($$update public.trade_documents set status = 'paid' where id = %L$$, tm3.v('doc_s')));
select tm3.no_effect('P03', 'yazılmış sənəd silinmir', format($$delete from public.trade_documents where id = %L$$, tm3.v('doc_s')));
select tm3.rejects_msg('P03', 'təklif maliyyəyə yazılmır', format($$select public.trade_document_post((select id from public.trade_documents where kind = 'offer' and number = 'S-001'))$$), 'Təklif');
select tm3.as_user('p_viewer');
select tm3.ok('P03', 'müşahidəçi sənəd və sətirləri görür', tm3.n('select 1 from public.trade_documents') = 2 and tm3.n('select 1 from public.trade_document_lines') = 1);
select tm3.rejects('P03', 'müşahidəçi sənəd yarada bilmir', format($$insert into public.trade_documents (org_id, module_key, kind, number) values (%L, 'wholesale', 'purchase', 'V-1')$$, tm3.v('org_p')));
select tm3.as_user('q_owner');
select tm3.ok('P03', 'Q şirkəti P-nin sənəd və sətirlərini görmür', tm3.n('select 1 from public.trade_documents') = 0 and tm3.n('select 1 from public.trade_document_lines') = 0);
select tm3.rejects('P03', 'Q P-nin sənədinə sətir yaza bilmir', format($$insert into public.trade_document_lines (org_id, document_id, description) values (%L, %L, 'x')$$, tm3.v('org_q'), tm3.v('doc_s')));
select tm3.rejects('P03', 'Q P-nin sənədini maliyyəyə yaza bilmir', format('select public.trade_document_post(%L)', tm3.v('doc_s')));
reset role;

-- ════════════════════ P04 · LEADS (09) ════════════════════
set role authenticated;
select tm3.as_user('p_employee');
do $$ begin
  insert into public.companies (org_id, name, roles, city, category, country_code, phone, source)
    values (tm3.u('org_p'), 'Şirin Kafe', '{prospect}', 'Bakı', 'cafe', 'AZ', '+994 12 000 00 00', 'manual');
  perform tm3.put('cafe', (select id::text from public.companies where name = 'Şirin Kafe'));
  insert into public.leads (org_id, company_id, segment, services, stage, score) values (tm3.u('org_p'), tm3.u('cafe'), 'cafe', '{menus,business_cards}', 'new', 70);
  perform tm3.put('lead', (select id::text from public.leads where company_id = tm3.u('cafe')));
  perform tm3.ok('P04', 'işçi namizəd yaradır (mərkəzi şirkət + pipeline)', true);
exception when others then perform tm3.ok('P04', 'işçi namizəd yaradır (mərkəzi şirkət + pipeline)', false, sqlerrm); end $$;
select tm3.rejects('P04', 'naməlum xidmət rədd edilir', format($$update public.leads set services = '{tattoos}' where id = %L$$, tm3.v('lead')));
select tm3.rejects('P04', 'eyni şirkət üçün ikinci namizəd olmur', format($$insert into public.leads (org_id, company_id) values (%L, %L)$$, tm3.v('org_p'), tm3.v('cafe')));
select tm3.rejects('P04', 'başqa şirkətin firmasını namizəd etmək olmur', format($$insert into public.leads (org_id, company_id) values (%L, %L)$$, tm3.v('org_p'), tm3.v('comp_q')));
select tm3.rejects('P04', 'namizədin şirkətini dəyişmək olmur', format($$update public.leads set company_id = %L where id = %L$$, tm3.v('sup_p'), tm3.v('lead')));
select tm3.allows('P04', 'mərhələ dəyişir', format($$update public.leads set stage = 'contacted', next_follow_up = current_date + 3 where id = %L$$, tm3.v('lead')));
select tm3.allows('P04', 'əlaqə tarixçəsi yazılır', format($$insert into public.lead_activities (org_id, lead_id, kind, summary) values (%L, %L, 'call', 'Menyu çapı ilə maraqlandılar')$$, tm3.v('org_p'), tm3.v('lead')));
select tm3.as_user('p_manager');
select tm3.no_effect('P04', 'başqa üzv müəllifin qeydini dəyişə bilmir', $$update public.lead_activities set summary = 'dəyişdim'$$);
select tm3.no_effect('P04', 'başqa üzv müəllifin qeydini silə bilmir', $$delete from public.lead_activities$$);
select tm3.as_user('p_viewer');
select tm3.ok('P04', 'müşahidəçi namizədi və tarixçəni görür', tm3.n('select 1 from public.leads') = 1 and tm3.n('select 1 from public.lead_activities') = 1);
select tm3.no_effect('P04', 'müşahidəçi mərhələni dəyişə bilmir', $$update public.leads set stage = 'won'$$);
select tm3.as_user('q_owner');
select tm3.ok('P04', 'Q şirkəti P-nin namizədlərini görmür', tm3.n('select 1 from public.leads') = 0 and tm3.n('select 1 from public.lead_activities') = 0);
reset role;

-- ════════════════════ P05 · TRADING (10) ════════════════════
set role authenticated;
select tm3.as_user('p_employee');
do $$ begin
  insert into public.trading_accounts (org_id, name, kind, currency, starting_balance) values (tm3.u('org_p'), 'Demo hesab', 'demo', 'USDT', 10000);
  perform tm3.put('acc', (select id::text from public.trading_accounts where name = 'Demo hesab'));
  insert into public.trading_trades (org_id, account_id, symbol, market, side, quantity, price, fee) values
    (tm3.u('org_p'), tm3.u('acc'), 'BTC/USDT', 'crypto', 'buy', 0.015, 60000, 0.9);
  perform tm3.ok('P05', 'işçi demo hesab və əməliyyat yazır', true);
exception when others then perform tm3.ok('P05', 'işçi demo hesab və əməliyyat yazır', false, sqlerrm); end $$;
select tm3.ok('P05', 'kiçik miqdar dəqiq saxlanılır (0.015)', tm3.val('select quantity::text from public.trading_trades') = '0.0150000000');
select tm3.rejects('P05', 'yanlış simvol rədd edilir', format($$insert into public.trading_trades (org_id, account_id, symbol, market, side, quantity, price) values (%L, %L, 'btc usdt; drop', 'crypto', 'buy', 1, 1)$$, tm3.v('org_p'), tm3.v('acc')));
select tm3.rejects('P05', 'sıfır qiymət rədd edilir', format($$insert into public.trading_trades (org_id, account_id, symbol, market, side, quantity, price) values (%L, %L, 'ETH', 'crypto', 'buy', 1, 0)$$, tm3.v('org_p'), tm3.v('acc')));
select tm3.allows('P05', 'işçi xəbərdarlıq qurur (BTC ≥ 65000)', format($$insert into public.trading_alerts (org_id, symbol, condition, price, note) values (%L, 'BTC/USDT', 'above', 65000, 'Satış nöqtəsi')$$, tm3.v('org_p')));
select tm3.as_user('p_manager');
select tm3.ok('P05', 'başqa üzvün xəbərdarlığı görünmür (şəxsidir)', tm3.n('select 1 from public.trading_alerts') = 0);
select tm3.allows('P05', 'qiymət qeyd olunur: 64000 (hədd keçilmir)', format($$insert into public.trading_prices (org_id, symbol, market, price, observed_at) values (%L, 'BTC/USDT', 'crypto', 64000, now() - interval '1 hour')$$, tm3.v('org_p')));
select tm3.allows('P05', 'qiymət qeyd olunur: 65500 (hədd keçilir)', format($$insert into public.trading_prices (org_id, symbol, market, price, observed_at) values (%L, 'BTC/USDT', 'crypto', 65500, now())$$, tm3.v('org_p')));
reset role;
select tm3.ok('P05', 'xəbərdarlıq bir dəfə işə düşdü və söndü', (select count(*) from public.trading_alerts where not active and trigger_price = 65500 and triggered_at is not null) = 1);
select tm3.ok('P05', 'yalnız xəbərdarlığın sahibinə bildiriş getdi', (select count(*) from public.notifications where type = 'trading.alert' and user_id = tm3.u('p_employee')) = 1
  and (select count(*) from public.notifications where type = 'trading.alert') = 1);
set role authenticated;
select tm3.as_user('p_viewer');
select tm3.ok('P05', 'müşahidəçi jurnalı görür', tm3.n('select 1 from public.trading_trades') = 1);
select tm3.rejects('P05', 'müşahidəçi əməliyyat yaza bilmir', format($$insert into public.trading_trades (org_id, account_id, symbol, market, side, quantity, price) values (%L, %L, 'ETH', 'crypto', 'buy', 1, 1)$$, tm3.v('org_p'), tm3.v('acc')));
select tm3.as_user('q_owner');
select tm3.ok('P05', 'Q şirkəti P-nin hesab, əməliyyat və qiymətlərini görmür', tm3.n('select 1 from public.trading_accounts') = 0
  and tm3.n('select 1 from public.trading_trades') = 0 and tm3.n('select 1 from public.trading_prices') = 0);
select tm3.rejects('P05', 'Q P-nin hesabına əməliyyat yaza bilmir', format($$insert into public.trading_trades (org_id, account_id, symbol, market, side, quantity, price) values (%L, %L, 'ETH', 'crypto', 'buy', 1, 1)$$, tm3.v('org_q'), tm3.v('acc')));
reset role;
select tm3.ok('P05', 'qiymət qeydləri audit-ə yazılmır (çox həcmli)', (select count(*) from public.audit_log where table_name = 'trading_prices') = 0);
select tm3.ok('P05', 'əməliyyatlar audit-ə yazılır', (select count(*) from public.audit_log where table_name = 'trading_trades') >= 1);

-- ════════════════════ P06 · SUPPLIER OFFERS: MINIMUM ORDER ════════════════════
set role authenticated;
select tm3.as_user('p_employee');
select tm3.rejects('P06', 'minimum sifariş 0 ola bilməz', format($$insert into public.supplier_offers (org_id, product_id, origin_module, min_order_qty) values (%L, %L, 'wholesale', 0)$$, tm3.v('org_p'), tm3.v('prod_p')));
select tm3.allows('P06', 'topdan təklif MOQ ilə yazılır (1000 ədəd)', format($$insert into public.supplier_offers (org_id, product_id, origin_module, supplier_name, currency, price_minor, fx_rate_to_base, min_order_qty) values (%L, %L, 'wholesale', 'Çin Fabriki', 'USD', 4, 1.7, 1000)$$, tm3.v('org_p'), tm3.v('prod_p')));
reset role;

-- ── report ──────────────────────────────────────────────────
\set QUIET off
\pset footer off
select grp as "qrup", case when ok then 'PASS' else 'FAIL' end as result, name, detail
  from tm3.results order by grp, n;
select count(*) filter (where ok) as passed, count(*) filter (where not ok) as failed, count(distinct grp) as groups
  from tm3.results;
do $$ begin
  if exists (select 1 from tm3.results where not ok) then
    raise exception 'PHASE 3 MODULE TESTS FAILED: % failing check(s)', (select count(*) from tm3.results where not ok);
  end if;
end $$;
select 'ALL PHASE 3 MODULE TESTS PASSED' as result;
