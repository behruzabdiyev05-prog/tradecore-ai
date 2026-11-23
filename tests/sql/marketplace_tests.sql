-- ═════════════════════════════════════════════════════════════
-- TRADECORE AI · İ-3 · Modul 03 (Marketplace) — verilənlər bazası testləri
-- Written BEFORE migrations 0013–0017 (İ-2 design doc, section 8 + section 10).
-- Every check records PASS/FAIL; the run fails if any FAIL.
-- Self-contained: own schema `tmk`, own users and organizations (P, Q, R).
-- Groups:
--   M00 setup            M01 structure           M02 RLS matrix (5 roles)
--   M03 isolation (A/B)  M04 2FA                 M05 D1 frozen figures + Y4/Y5
--   M06 import rules     M07 duplicates          M08 triggers
--   M09 D4/D7 manual     M10 D2 archive          M11 D3 purge + Y1
--   M12 D6 delete        M13 privileges          M14 Y13 blocked shop + Y9 currency
--   M15 history + Y7     M16 Y3 calc prefs + settings            M17 audit + Y16
-- ═════════════════════════════════════════════════════════════
\set ON_ERROR_STOP on
\set QUIET on

drop schema if exists tmk cascade;
create schema tmk;
create table tmk.results (n serial, grp text, name text, ok boolean, detail text);
create table tmk.ctx (k text primary key, v text);
grant usage on schema tmk to authenticated, anon;
grant select, insert, update on tmk.results, tmk.ctx to authenticated, anon;
grant usage on sequence tmk.results_n_seq to authenticated, anon;

create function tmk.v(key text) returns text language sql stable as $$ select v from tmk.ctx where k = key $$;
create function tmk.u(key text) returns uuid language sql stable as $$ select v::uuid from tmk.ctx where k = key $$;
create function tmk.put(key text, val text) returns void language sql as $$
  insert into tmk.ctx values (key, val) on conflict (k) do update set v = excluded.v $$;
-- Emulates a Supabase session: JWT `sub` + `aal`
create function tmk.as_user(key text, aal text default 'aal1') returns void language sql as $$
  select set_config('request.jwt.claim.sub', coalesce(tmk.v(key), ''), false),
         set_config('request.jwt.claim.aal', aal, false); $$;
create function tmk.ok(grp text, name text, cond boolean, detail text default '') returns void language sql as $$
  insert into tmk.results (grp, name, ok, detail) values (grp, name, coalesce(cond, false), detail); $$;
create function tmk.rejects(grp text, name text, stmt text) returns void language plpgsql as $$
begin
  begin
    execute stmt;
  exception when others then
    if sqlstate in ('42501','23514','P0001','23503','23505','22023','55000','42P17','22P02','22001','23502') then
      perform tmk.ok(grp, name, true, 'rejected: ' || sqlstate || ' ' || left(sqlerrm, 90));
    else
      perform tmk.ok(grp, name, false, 'wrong error ' || sqlstate || ': ' || sqlerrm);
    end if;
    return;
  end;
  perform tmk.ok(grp, name, false, 'statement was ALLOWED: ' || left(stmt, 140));
end $$;
-- Rejected with a message that contains `needle` (the user-facing text matters, not only the code).
create function tmk.rejects_msg(grp text, name text, stmt text, needle text) returns void language plpgsql as $$
begin
  begin
    execute stmt;
  exception when others then
    perform tmk.ok(grp, name, sqlerrm ilike '%' || needle || '%', sqlstate || ': ' || left(sqlerrm, 120));
    return;
  end;
  perform tmk.ok(grp, name, false, 'statement was ALLOWED: ' || left(stmt, 140));
end $$;
-- Rejected OR affects 0 rows (both mean "no effect").
create function tmk.no_effect(grp text, name text, stmt text) returns void language plpgsql as $$
declare n int;
begin
  begin
    execute stmt; get diagnostics n = row_count;
  exception when others then
    if sqlstate in ('42501','P0001','23503') then perform tmk.ok(grp, name, true, 'rejected: ' || sqlstate);
    else perform tmk.ok(grp, name, false, 'wrong error ' || sqlstate || ': ' || sqlerrm); end if;
    return;
  end;
  perform tmk.ok(grp, name, n = 0, format('%s row(s) affected', n));
end $$;
create function tmk.allows(grp text, name text, stmt text) returns void language plpgsql as $$
begin
  execute stmt; perform tmk.ok(grp, name, true);
exception when others then perform tmk.ok(grp, name, false, sqlstate || ': ' || sqlerrm);
end $$;
-- Number of rows a DML statement affects (-1 = error).
create function tmk.rows(stmt text) returns int language plpgsql as $$
declare n int;
begin
  execute stmt; get diagnostics n = row_count; return n;
exception when others then return -1;
end $$;
create function tmk.n(stmt text) returns bigint language plpgsql as $$
declare n bigint;
begin
  execute 'select count(*) from (' || stmt || ') q' into n; return n;
exception when others then return -1;
end $$;
create function tmk.val(stmt text) returns text language plpgsql as $$
declare r text;
begin
  execute stmt into r; return r;
exception when others then return 'ERROR ' || sqlstate || ': ' || sqlerrm;
end $$;
grant execute on all functions in schema tmk to authenticated, anon;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant usage on schema tmk to service_role';
    execute 'grant select, insert, update on tmk.results, tmk.ctx to service_role';
    execute 'grant usage on sequence tmk.results_n_seq to service_role';
    execute 'grant execute on all functions in schema tmk to service_role';
  end if;
end $$;

-- ════════════════════ M00 · FIXTURE ════════════════════
insert into tmk.ctx values
  ('p_owner','a1000000-0000-0000-0000-000000000001'),('p_admin','a1000000-0000-0000-0000-000000000002'),
  ('p_manager','a1000000-0000-0000-0000-000000000003'),('p_employee','a1000000-0000-0000-0000-000000000004'),
  ('p_viewer','a1000000-0000-0000-0000-000000000005'),
  ('q_owner','b1000000-0000-0000-0000-000000000001'),('q_employee','b1000000-0000-0000-0000-000000000002'),
  ('r_owner','c1000000-0000-0000-0000-000000000001');

insert into auth.users (id, email, raw_user_meta_data) values
  ('a1000000-0000-0000-0000-000000000001','mp.p.owner@test.local','{"full_name":"Pərviz Sahib","company_name":"Market P"}'),
  ('b1000000-0000-0000-0000-000000000001','mp.q.owner@test.local','{"full_name":"Qənbər Sahib","company_name":"Market Q"}'),
  ('c1000000-0000-0000-0000-000000000001','mp.r.owner@test.local','{"full_name":"Rəna Sahib","company_name":"Market R"}'),
  ('a1000000-0000-0000-0000-000000000002','mp.p.admin@test.local','{"full_name":"Aynur Admin","invite_token":"pending"}'),
  ('a1000000-0000-0000-0000-000000000003','mp.p.manager@test.local','{"full_name":"Murad Menecer","invite_token":"pending"}'),
  ('a1000000-0000-0000-0000-000000000004','mp.p.employee@test.local','{"full_name":"Elnur İşçi","invite_token":"pending"}'),
  ('a1000000-0000-0000-0000-000000000005','mp.p.viewer@test.local','{"full_name":"Vəfa Baxan","invite_token":"pending"}'),
  ('b1000000-0000-0000-0000-000000000002','mp.q.employee@test.local','{"full_name":"Qoşqar İşçi","invite_token":"pending"}');

insert into tmk.ctx select 'org_p', active_org_id::text from public.profiles where id = tmk.u('p_owner');
insert into tmk.ctx select 'org_q', active_org_id::text from public.profiles where id = tmk.u('q_owner');
insert into tmk.ctx select 'org_r', active_org_id::text from public.profiles where id = tmk.u('r_owner');

set role authenticated;
do $$
declare r record; tok text;
begin
  for r in select * from (values ('p_admin','admin','org_p','p_owner'),('p_manager','manager','org_p','p_owner'),
                                 ('p_employee','employee','org_p','p_owner'),('p_viewer','viewer','org_p','p_owner'),
                                 ('q_employee','employee','org_q','q_owner')) v(k, role, org, inviter) loop
    perform tmk.as_user(r.inviter);
    tok := public.create_invite(tmk.u(r.org), 'mp.' || replace(r.k, '_', '.') || '@test.local', r.role);
    perform tmk.as_user(r.k);
    perform public.accept_invite(tok);
  end loop;
  perform tmk.ok('M00', 'setup: komandalar dəvətlə quruldu', true);
exception when others then
  perform tmk.ok('M00', 'setup: komandalar dəvətlə quruldu', false, sqlerrm);
end $$;
reset role;

-- Shopify connections (fixture, as the database owner). R holds the live NovaNest domain (blocked, Y13).
insert into public.integrations (org_id, user_id, provider, status, config) values
  (tmk.u('org_p'), tmk.u('p_owner'), 'shopify', 'connected', '{"shop_domain":"tc-test-p.myshopify.com","currency":"USD"}'),
  (tmk.u('org_q'), tmk.u('q_owner'), 'shopify', 'connected', '{"shop_domain":"tc-test-q.myshopify.com","currency":"USD"}'),
  (tmk.u('org_r'), tmk.u('r_owner'), 'shopify', 'connected', '{"shop_domain":"novanest991.myshopify.com","currency":"USD"}');
insert into tmk.ctx select 'integ_p', id::text from public.integrations where org_id = tmk.u('org_p') and provider = 'shopify';
insert into tmk.ctx select 'integ_q', id::text from public.integrations where org_id = tmk.u('org_q') and provider = 'shopify';
insert into tmk.ctx select 'integ_r', id::text from public.integrations where org_id = tmk.u('org_r') and provider = 'shopify';

-- Catalog import through the server function (as service_role, no user JWT)
set role service_role;
select set_config('request.jwt.claim.sub', '', false);
do $$ declare r jsonb; begin
  r := public.marketplace_upsert_catalog(tmk.u('org_p'), tmk.u('integ_p'), $j$[
    {"external_id":"gid://shopify/Product/1","name":"Simsiz qulaqlıq","vendor":"Acme",
     "admin_url":"https://tc-test-p.myshopify.com/admin/products/1","image_url":"https://cdn.shopify.com/s/files/q.jpg",
     "sale_azn_minor":5100,"stock":0,"status":"active","variant_count":2,
     "variants":[
       {"external_id":"gid://shopify/ProductVariant/11","title":"Qara","sku":"QX-B","price_azn_minor":5100,"stock":8,
        "inventory_item_id":"gid://shopify/InventoryItem/111","location_id":"gid://shopify/Location/1","position":1},
       {"external_id":"gid://shopify/ProductVariant/12","title":"Ağ","sku":"QX-W","price_azn_minor":5100,"stock":4,
        "inventory_item_id":"gid://shopify/InventoryItem/112","location_id":"gid://shopify/Location/1","position":2}]},
    {"external_id":"gid://shopify/Product/2","name":"Telefon qabı","vendor":"Acme",
     "admin_url":"https://tc-test-p.myshopify.com/admin/products/2","image_url":null,
     "sale_azn_minor":1700,"stock":20,"status":"active","variant_count":0,
     "inventory_item_id":"gid://shopify/InventoryItem/200","location_id":"gid://shopify/Location/1","variants":[]}]$j$);
  perform tmk.ok('M00', 'setup: P kataloqu server funksiyası ilə idxal edildi', (r->>'products')::int = 2 and (r->>'variants')::int = 2, r::text);
exception when others then perform tmk.ok('M00', 'setup: P kataloqu server funksiyası ilə idxal edildi', false, sqlerrm); end $$;
do $$ declare r jsonb; begin
  r := public.marketplace_upsert_catalog(tmk.u('org_q'), tmk.u('integ_q'), $j$[
    {"external_id":"gid://shopify/Product/900","name":"Gizli Q məhsul","vendor":"Q",
     "admin_url":"https://tc-test-q.myshopify.com/admin/products/900","sale_azn_minor":999,"stock":5,"status":"active",
     "variant_count":0,"variants":[]}]$j$);
  perform tmk.ok('M00', 'setup: Q kataloqu idxal edildi', (r->>'products')::int = 1, r::text);
exception when others then perform tmk.ok('M00', 'setup: Q kataloqu idxal edildi', false, sqlerrm); end $$;
reset role;

do $$ begin
  perform tmk.put('l1', (select id::text from public.marketplace_listings where org_id = tmk.u('org_p') and external_id = 'gid://shopify/Product/1'));
  perform tmk.put('l2', (select id::text from public.marketplace_listings where org_id = tmk.u('org_p') and external_id = 'gid://shopify/Product/2'));
  perform tmk.put('lq', (select id::text from public.marketplace_listings where org_id = tmk.u('org_q')));
  perform tmk.put('p1', (select product_id::text from public.marketplace_listings where id = tmk.u('l1')));
  perform tmk.put('p2', (select product_id::text from public.marketplace_listings where id = tmk.u('l2')));
  perform tmk.put('pq', (select product_id::text from public.marketplace_listings where id = tmk.u('lq')));
  perform tmk.put('v11', (select id::text from public.marketplace_variants where external_id = 'gid://shopify/ProductVariant/11'));
  perform tmk.put('v12', (select id::text from public.marketplace_variants where external_id = 'gid://shopify/ProductVariant/12'));
exception when others then perform tmk.ok('M00', 'setup: listinq ID-ləri', false, sqlerrm); end $$;

-- Costs entered by the owner in the UI (must survive a later catalog re-sync)
set role authenticated;
select tmk.as_user('p_owner');
select tmk.allows('M00', 'setup: sahib xərcləri daxil edir', format(
  $$update public.marketplace_listings set purchase_azn_minor = 800, shipping_azn_minor = 300, other_azn_minor = 100 where id = %L$$, tmk.v('l2')));
select tmk.allows('M00', 'setup: sahib variant xərcini daxil edir', format(
  $$update public.marketplace_variants set purchase_azn_minor = 1500, shipping_azn_minor = 400 where id = %L$$, tmk.v('v11')));
select tmk.allows('M00', 'setup: sahib Modul 03 parametrlərini yaradır', format(
  $$insert into public.marketplace_settings (org_id, payment_fee_percent, payment_fee_fixed_azn_minor, low_stock_threshold) values (%L, 2.9, 0, 5)$$, tmk.v('org_p')));
-- A manual product + listing created by an employee (fixture for D4/D7)
select tmk.as_user('p_employee');
do $$ begin
  with p as (insert into public.products (name, origin_module) values ('Əl məhsulu', 'marketplace') returning id)
  insert into public.marketplace_listings (product_id, stock, sale_azn_minor, purchase_azn_minor) select id, 3, 1000, 500 from p;
  perform tmk.ok('M00', 'setup: işçi əl ilə məhsul yaradır', true);
exception when others then perform tmk.ok('M00', 'setup: işçi əl ilə məhsul yaradır', false, sqlerrm); end $$;
reset role;
do $$ begin
  perform tmk.put('lm', (select l.id::text from public.marketplace_listings l join public.products p on p.id = l.product_id
                          where p.name = 'Əl məhsulu' and l.org_id = tmk.u('org_p')));
exception when others then null; end $$;

-- First Shopify order import (server)
set role service_role;
select set_config('request.jwt.claim.sub', '', false);
do $$ declare r jsonb; begin
  r := public.marketplace_upsert_shopify_order(tmk.u('org_p'), tmk.u('integ_p'),
    $j${"external_id":"gid://shopify/Order/1001","order_number":"#1001","customer_name":"Aysel M.","customer_email":"aysel@example.com",
        "currency":"USD","fx_rate":1.70,"presentment_currency":"EUR","status":"processing","financial_status":"PAID",
        "fulfillment_status":"UNFULFILLED","placed_at":"2026-11-20T10:00:00Z"}$j$,
    $j$[{"external_id":"gid://shopify/LineItem/1","listing_external_id":"gid://shopify/Product/1",
         "variant_external_id":"gid://shopify/ProductVariant/11","line_title":"Simsiz qulaqlıq - Qara","quantity":2,
         "sale_azn_minor":8500,"shipping_income_azn_minor":850,"tax_azn_minor":0,"discount_azn_minor":0,"fee_azn_minor":300,
         "refund_azn_minor":0,"cost_azn_minor":3800,"cost_missing":false},
        {"external_id":"gid://shopify/LineItem/2","listing_external_id":"gid://shopify/Product/999",
         "variant_external_id":null,"line_title":"Naməlum məhsul","quantity":1,
         "sale_azn_minor":1700,"shipping_income_azn_minor":0,"tax_azn_minor":0,"discount_azn_minor":0,"fee_azn_minor":50,
         "refund_azn_minor":0,"cost_azn_minor":0,"cost_missing":true}]$j$);
  perform tmk.ok('M00', 'setup: Shopify sifarişi idxal edildi', (r->>'inserted')::int = 2 and (r->>'unmatched')::int = 1, r::text);
exception when others then perform tmk.ok('M00', 'setup: Shopify sifarişi idxal edildi', false, sqlerrm); end $$;
do $$ declare r jsonb; begin
  r := public.marketplace_upsert_shopify_order(tmk.u('org_q'), tmk.u('integ_q'),
    $j${"external_id":"gid://shopify/Order/9001","order_number":"#9001","customer_name":"Q müştəri","currency":"USD","fx_rate":1.70,
        "status":"processing","financial_status":"PAID","fulfillment_status":"UNFULFILLED","placed_at":"2026-11-20T11:00:00Z"}$j$,
    $j$[{"external_id":"gid://shopify/LineItem/91","listing_external_id":"gid://shopify/Product/900","quantity":1,
         "sale_azn_minor":999,"fee_azn_minor":30,"cost_azn_minor":0,"cost_missing":true}]$j$);
  perform tmk.ok('M00', 'setup: Q sifarişi idxal edildi', (r->>'inserted')::int = 1, r::text);
exception when others then perform tmk.ok('M00', 'setup: Q sifarişi idxal edildi', false, sqlerrm); end $$;
-- Webhook events (server)
do $$ declare r jsonb; begin
  r := public.integration_event_store('shopify', 'wh-1', 'tc-test-p.myshopify.com', 'orders/create',
         '{"id":1001,"shipping_address":{"address1":"TMK-ünvan-7781","phone":"+994507781778"},"client_details":{"browser_ip":"10.77.81.78"}}', repeat('a', 64));
  perform tmk.put('e1', r->>'id');
  perform public.integration_event_finish((r->>'id')::bigint, 'processed', null, null);
  r := public.integration_event_store('shopify', 'wh-2', 'tc-test-p.myshopify.com', 'orders/updated',
         '{"id":1001,"shipping_address":{"address1":"TMK-ünvan-7781"}}', repeat('b', 64));
  perform tmk.put('e2', r->>'id');
  perform public.integration_event_finish((r->>'id')::bigint, 'processed', null, null);
  r := public.integration_event_store('shopify', 'wh-q1', 'tc-test-q.myshopify.com', 'orders/create', '{"id":9001}', repeat('c', 64));
  perform tmk.put('eq', r->>'id');
  perform tmk.ok('M00', 'setup: webhook hadisələri saxlanıldı', tmk.v('e1') is not null and tmk.v('e2') is not null and tmk.v('eq') is not null);
exception when others then perform tmk.ok('M00', 'setup: webhook hadisələri saxlanıldı', false, sqlerrm); end $$;
reset role;
do $$ begin
  perform tmk.put('o1', (select id::text from public.marketplace_orders where external_id = 'gid://shopify/Order/1001'));
  perform tmk.put('oq', (select id::text from public.marketplace_orders where external_id = 'gid://shopify/Order/9001'));
  perform tmk.put('ln1', (select id::text from public.marketplace_order_lines where external_id = 'gid://shopify/LineItem/1'));
  perform tmk.put('ln2', (select id::text from public.marketplace_order_lines where external_id = 'gid://shopify/LineItem/2'));
exception when others then perform tmk.ok('M00', 'setup: sifariş ID-ləri', false, sqlerrm); end $$;

-- ════════════════════ M01 · STRUCTURE ════════════════════
create temp table mp_tables(t text);
insert into mp_tables values ('marketplace_listings'),('marketplace_variants'),('marketplace_orders'),('marketplace_order_lines'),
  ('marketplace_settings'),('marketplace_calc_prefs'),('supplier_offers'),('supplier_offer_prices'),('integration_events');
grant select on mp_tables to authenticated, anon;

select tmk.ok('M01', '9 yeni cədvəl var və hamısında RLS açıqdır', (select count(*) from pg_class k join pg_namespace n on n.oid = k.relnamespace
  where n.nspname = 'public' and k.relkind = 'r' and k.relrowsecurity and k.relname in (select t from mp_tables)) = 9);
select tmk.ok('M01', 'hər yeni cədvəldə org_id NOT NULL-dur', (select count(*) from information_schema.columns
  where table_schema = 'public' and column_name = 'org_id' and is_nullable = 'NO' and table_name in (select t from mp_tables)) = 9);
select tmk.ok('M01', 'bütün pul sütunları (_minor) bigint-dir', (select count(*) from information_schema.columns
  where table_schema = 'public' and table_name in (select t from mp_tables) and column_name like '%\_minor' and data_type <> 'bigint') = 0
  and (select count(*) from information_schema.columns where table_schema = 'public' and table_name in (select t from mp_tables)
       and column_name like '%\_minor') >= 25);
select tmk.ok('M01', 'notifications.dedupe_key əlavə olunub (boş buraxıla bilər)', exists (select 1 from information_schema.columns
  where table_schema = 'public' and table_name = 'notifications' and column_name = 'dedupe_key' and is_nullable = 'YES'));
select tmk.ok('M01', 'integrations: Shopify domeni üzrə unikal indeks', to_regclass('public.integrations_shopify_shop_uq') is not null);
select tmk.ok('M01', 'products cədvəlinin sütunları dəyişməyib', (select string_agg(column_name || ':' || data_type, ',' order by ordinal_position)
  from information_schema.columns where table_schema = 'public' and table_name = 'products')
  = 'id:uuid,user_id:uuid,origin_module:text,name:text,sku:text,category:text,description:text,attributes:jsonb,supplier_id:uuid,source:text,source_url:text,data_quality:USER-DEFINED,retrieved_at:timestamp with time zone,created_at:timestamp with time zone,updated_at:timestamp with time zone,org_id:uuid');
select tmk.ok('M01', 'listinq products-a 1:1 bağlıdır (product_id unikal)', tmk.n($$select 1 from pg_constraint c
  where c.conrelid = 'public.marketplace_listings'::regclass and c.contype = 'u'
    and c.conkey = array[(select attnum from pg_attribute where attrelid = 'public.marketplace_listings'::regclass and attname = 'product_id')]$$) = 1);
select tmk.ok('M01', 'listinq → products: ON DELETE RESTRICT', tmk.val($$select confdeltype from pg_constraint
  where conrelid = 'public.marketplace_listings'::regclass and confrelid = 'public.products'::regclass$$) = 'r');
select tmk.ok('M01', 'sifariş sətri → listinq: ON DELETE RESTRICT (D6)', tmk.val($$select confdeltype from pg_constraint
  where conrelid = 'public.marketplace_order_lines'::regclass and confrelid = 'public.marketplace_listings'::regclass$$) = 'r');

set role authenticated;
select tmk.as_user('p_owner');
select tmk.allows('M01', 'setup: yoxlama məhsulu', $$insert into public.products (name, origin_module) values ('Yoxlama məhsulu', 'marketplace')$$);
select tmk.put('pchk', tmk.val($$select id::text from public.products where name = 'Yoxlama məhsulu'$$));
select tmk.rejects('M01', 'mənfi alış qiyməti rədd edilir', format(
  $$insert into public.marketplace_listings (product_id, purchase_azn_minor) values (%L, -1)$$, tmk.v('pchk')));
select tmk.rejects('M01', 'Shopify CDN-dən kənar şəkil linki rədd edilir', format(
  $$insert into public.marketplace_listings (product_id, image_url) values (%L, 'https://evil.example/x.png')$$, tmk.v('pchk')));
select tmk.rejects('M01', 'javascript: təchizatçı linki rədd edilir', format(
  $$insert into public.marketplace_listings (product_id, supplier_url) values (%L, 'javascript:alert(1)')$$, tmk.v('pchk')));
select tmk.rejects('M01', 'yad domenli Admin linki rədd edilir', format(
  $$insert into public.marketplace_listings (product_id, admin_url) values (%L, 'https://evil.example/admin/products/1')$$, tmk.v('pchk')));
select tmk.rejects('M01', 'naməlum məhsul statusu rədd edilir', format(
  $$insert into public.marketplace_listings (product_id, status) values (%L, 'deleted')$$, tmk.v('pchk')));
select tmk.rejects('M01', 'mənfi stok rədd edilir', format(
  $$insert into public.marketplace_listings (product_id, stock) values (%L, -3)$$, tmk.v('pchk')));
reset role;

-- ════════════════════ M02 · RLS MATRIX (org P, 5 roles) ════════════════════
set role authenticated;
do $$
declare r text; w boolean; a boolean;
begin
  foreach r in array array['p_owner','p_admin','p_manager','p_employee','p_viewer'] loop
    perform tmk.as_user(r);
    w := r <> 'p_viewer';                       -- data.write + module.marketplace.write
    a := r in ('p_owner','p_admin');            -- integrations.manage
    perform tmk.ok('M02', r || ': listinqləri oxuyur', tmk.n('select 1 from public.marketplace_listings') >= 3);
    perform tmk.ok('M02', r || ': variantları oxuyur', tmk.n('select 1 from public.marketplace_variants') = 2);
    perform tmk.ok('M02', r || ': sifarişləri oxuyur', tmk.n('select 1 from public.marketplace_orders') >= 1);
    perform tmk.ok('M02', r || ': sifariş sətirlərini oxuyur', tmk.n('select 1 from public.marketplace_order_lines') >= 2);
    perform tmk.ok('M02', r || ': Modul 03 parametrlərini oxuyur', tmk.n('select 1 from public.marketplace_settings') = 1);
    if w then
      perform tmk.allows('M02', r || ': əl ilə listinq yaradır', format(
        $s$with p as (insert into public.products (name, origin_module) values (%L, 'marketplace') returning id)
           insert into public.marketplace_listings (product_id) select id from p$s$, 'RLS ' || r));
      perform tmk.ok('M02', r || ': listinqi redaktə edir', tmk.rows(format(
        'update public.marketplace_listings set sale_azn_minor = sale_azn_minor where id = %L', tmk.v('l2'))) = 1);
      perform tmk.ok('M02', r || ': sifariş statusunu dəyişir', tmk.rows(format(
        'update public.marketplace_orders set status = status where id = %L', tmk.v('o1'))) = 1);
      perform tmk.allows('M02', r || ': təchizatçı təklifi yaradır', format(
        $s$insert into public.supplier_offers (product_id, supplier_name, price_minor) values (%L, %L, 500)$s$, tmk.v('p2'), 'RLS ' || r));
    else
      perform tmk.rejects('M02', r || ': listinq yarada bilmir', format(
        $s$with p as (insert into public.products (name, origin_module) values ('RLS viewer', 'marketplace') returning id)
           insert into public.marketplace_listings (product_id) select id from p$s$));
      perform tmk.no_effect('M02', r || ': listinqi redaktə edə bilmir', format(
        'update public.marketplace_listings set sale_azn_minor = 1 where id = %L', tmk.v('l2')));
      perform tmk.no_effect('M02', r || ': sifarişi dəyişə bilmir', format(
        $s$update public.marketplace_orders set status = 'complete' where id = %L$s$, tmk.v('o1')));
      perform tmk.no_effect('M02', r || ': sifarişi silə bilmir', format('delete from public.marketplace_orders where id = %L', tmk.v('o1')));
      perform tmk.rejects('M02', r || ': təchizatçı təklifi yarada bilmir', format(
        $s$insert into public.supplier_offers (product_id, supplier_name, price_minor) values (%L, 'RLS viewer', 500)$s$, tmk.v('p2')));
    end if;
    if a then
      perform tmk.ok('M02', r || ': parametrləri dəyişir', tmk.rows(format(
        'update public.marketplace_settings set low_stock_threshold = low_stock_threshold where org_id = %L', tmk.v('org_p'))) = 1);
      perform tmk.ok('M02', r || ': webhook jurnalını oxuyur', tmk.n('select 1 from public.integration_events') >= 2);
    else
      perform tmk.no_effect('M02', r || ': parametrləri dəyişə bilmir', format(
        'update public.marketplace_settings set low_stock_threshold = 0 where org_id = %L', tmk.v('org_p')));
      perform tmk.ok('M02', r || ': webhook jurnalını görmür', tmk.n('select 1 from public.integration_events') = 0);
    end if;
    perform tmk.rejects('M02', r || ': sifarişi birbaşa yarada bilmir (yalnız funksiya)', format(
      $s$insert into public.marketplace_orders (order_number, customer_name) values ('X-%s', 'X')$s$, r));
    perform tmk.rejects('M02', r || ': sifariş sətrini birbaşa yarada bilmir', format(
      $s$insert into public.marketplace_order_lines (order_id, quantity) values (%L, 1)$s$, tmk.v('o1')));
    perform tmk.rejects('M02', r || ': qiymət tarixçəsinə yaza bilmir', format(
      $s$insert into public.supplier_offer_prices (offer_id, currency, price_minor, shipping_minor, fx_rate_to_base) select id, 'AZN', 1, 1, 1 from public.supplier_offers limit 1$s$));
    perform tmk.rejects('M02', r || ': webhook jurnalına yaza bilmir', format(
      $s$insert into public.integration_events (integration_id, provider, external_id, topic, shop_domain) values (%L, 'shopify', 'fake-%s', 'x', 'x')$s$,
      tmk.v('integ_p'), r));
  end loop;
end $$;
reset role;

-- ════════════════════ M03 · ISOLATION (org Q vs org P) ════════════════════
set role authenticated;
select tmk.as_user('q_owner');
do $$ declare t text; begin
  for t in select mp.t from mp_tables mp loop
    perform tmk.ok('M03', 'Q sahibi P-nin ' || t || ' sətirlərini görmür',
      tmk.n(format('select 1 from public.%I where org_id = %L', t, tmk.v('org_p'))) = 0);
  end loop;
end $$;
select tmk.ok('M03', 'Q sahibi öz listinqini görür', tmk.n('select 1 from public.marketplace_listings') = 1);
select tmk.no_effect('M03', 'Q sahibi P listinqini dəyişə bilmir', format(
  'update public.marketplace_listings set sale_azn_minor = 1 where id = %L', tmk.v('l2')));
select tmk.no_effect('M03', 'Q sahibi P listinqini silə bilmir', format('delete from public.marketplace_listings where id = %L', tmk.v('l2')));
select tmk.no_effect('M03', 'Q sahibi P sifarişini dəyişə bilmir', format(
  $$update public.marketplace_orders set note = 'Q' where id = %L$$, tmk.v('o1')));
select tmk.rejects('M03', 'Q sahibi P məhsuluna listinq bağlaya bilmir', format(
  'insert into public.marketplace_listings (product_id) values (%L)', tmk.v('p1')));
select tmk.rejects('M03', 'Q sahibi P sifarişi yarada bilmir (funksiya)', format(
  $$select public.marketplace_create_manual_order(%L, '{"order_number":"Q-1","customer_name":"Q"}', jsonb_build_array(jsonb_build_object('listing_id', %L, 'quantity', 1, 'sale_azn_minor', 100)))$$,
  tmk.v('org_p'), tmk.v('lm')));
select tmk.ok('M03', 'Q sahibi P listinq tarixçəsini görmür', tmk.n(format($$select * from public.marketplace_history('listing', %L)$$, tmk.v('l2'))) = 0);
select tmk.ok('M03', 'Q sahibi P mağaza vəziyyətini görmür', tmk.val(format($$select public.marketplace_store_status(%L)::text$$, tmk.v('org_p'))) is null);
select tmk.as_user('q_employee');
select tmk.rejects('M03', 'Q işçisi P məhsuluna təchizatçı təklifi bağlaya bilmir', format(
  $$insert into public.supplier_offers (product_id, supplier_name, price_minor) values (%L, 'Q', 1)$$, tmk.v('p2')));
select tmk.as_user('p_employee');
select tmk.ok('M03', 'P işçisi Q sətirlərini görmür', tmk.n(format('select 1 from public.marketplace_listings where org_id = %L', tmk.v('org_q'))) = 0
  and tmk.n(format('select 1 from public.marketplace_orders where org_id = %L', tmk.v('org_q'))) = 0);
reset role;
select tmk.ok('M03', 'Q mağazasının hadisəsi Q şirkətinə yazıldı', tmk.val(format(
  'select org_id::text from public.integration_events where id = %s', coalesce(tmk.v('eq'), '0'))) = tmk.v('org_q'));
set role service_role;
select tmk.rejects('M03', 'server: Q inteqrasiyası ilə P-yə sifariş yazmaq olmur', format(
  $$select public.marketplace_upsert_shopify_order(%L, %L, '{"external_id":"gid://shopify/Order/x1","order_number":"#x1","customer_name":"X","currency":"USD","fx_rate":1.7,"status":"processing"}', '[]')$$,
  tmk.v('org_p'), tmk.v('integ_q')));
reset role;

-- ════════════════════ M04 · 2FA ════════════════════
set role authenticated;
select tmk.as_user('p_owner', 'aal2');
select tmk.allows('M04', 'sahib (aal2) işçi rolu üçün 2FA tələb edir', format(
  $$select public.set_security_policy(%L, array['employee'])$$, tmk.v('org_p')));
select tmk.as_user('p_employee', 'aal1');
select tmk.ok('M04', 'işçi aal1 ilə listinqləri görmür', tmk.n('select 1 from public.marketplace_listings') = 0);
select tmk.ok('M04', 'işçi aal1 ilə sifarişləri görmür', tmk.n('select 1 from public.marketplace_orders') = 0);
select tmk.ok('M04', 'işçi aal1 ilə təchizatçı təkliflərini görmür', tmk.n('select 1 from public.supplier_offers') = 0);
select tmk.rejects('M04', 'işçi aal1 ilə sifariş yarada bilmir', format(
  $$select public.marketplace_create_manual_order(%L, '{"order_number":"MFA-1","customer_name":"X"}', jsonb_build_array(jsonb_build_object('listing_id', %L, 'quantity', 1, 'sale_azn_minor', 100)))$$,
  tmk.v('org_p'), tmk.v('lm')));
select tmk.ok('M04', 'işçi aal1 ilə tarixçəni görmür', tmk.n(format($$select * from public.marketplace_history('listing', %L)$$, tmk.v('l2'))) = 0);
select tmk.as_user('p_employee', 'aal2');
select tmk.ok('M04', 'işçi aal2 ilə listinqləri görür', tmk.n('select 1 from public.marketplace_listings') >= 3);
select tmk.as_user('p_manager', 'aal1');
select tmk.ok('M04', 'siyasətdə olmayan rol (menecer) aal1 ilə görür', tmk.n('select 1 from public.marketplace_listings') >= 3);
select tmk.as_user('p_owner', 'aal2');
select tmk.allows('M04', 'siyasət geri götürülür', format($$select public.set_security_policy(%L, '{}')$$, tmk.v('org_p')));
reset role;

-- ════════════════════ M09 · D4 / D7 MANUAL ORDERS ════════════════════
set role authenticated;
select tmk.as_user('p_employee');
select tmk.ok('M09', 'işçi əl ilə sifariş yaradır (stok 3, miqdar 2)', tmk.val(format(
  $$select public.marketplace_create_manual_order(%L, '{"order_number":"M-1","customer_name":"Kamran","status":"processing"}',
      jsonb_build_array(jsonb_build_object('listing_id', %L, 'quantity', 2, 'sale_azn_minor', 2000, 'cost_azn_minor', 1000)))::text$$,
  tmk.v('org_p'), tmk.v('lm'))) ~ '^[0-9a-f-]{36}$');
select tmk.ok('M09', 'stok 3 → 1 azaldı', tmk.val(format('select stock::text from public.marketplace_listings where id = %L', tmk.v('lm'))) = '1');
select tmk.rejects_msg('M09', 'stok çatmırsa sifariş rədd edilir', format(
  $$select public.marketplace_create_manual_order(%L, '{"order_number":"M-2","customer_name":"X"}',
      jsonb_build_array(jsonb_build_object('listing_id', %L, 'quantity', 5, 'sale_azn_minor', 100)))$$,
  tmk.v('org_p'), tmk.v('lm')), 'Stok kifayət etmir');
select tmk.ok('M09', 'rədd edilən sifariş yazılmayıb, stok dəyişməyib', tmk.n($$select 1 from public.marketplace_orders where order_number = 'M-2'$$) = 0
  and tmk.val(format('select stock::text from public.marketplace_listings where id = %L', tmk.v('lm'))) = '1');
select tmk.rejects('M09', 'iki sətir birlikdə stoku aşırsa hamısı rədd edilir (atomik)', format(
  $$select public.marketplace_create_manual_order(%L, '{"order_number":"M-3","customer_name":"X"}',
      jsonb_build_array(jsonb_build_object('listing_id', %L, 'quantity', 1, 'sale_azn_minor', 100),
                        jsonb_build_object('listing_id', %L, 'quantity', 1, 'sale_azn_minor', 100)))$$,
  tmk.v('org_p'), tmk.v('lm'), tmk.v('lm')));
select tmk.ok('M09', 'atomik rədddən sonra sifariş yoxdur, stok 1', tmk.n($$select 1 from public.marketplace_orders where order_number = 'M-3'$$) = 0
  and tmk.val(format('select stock::text from public.marketplace_listings where id = %L', tmk.v('lm'))) = '1');
select tmk.rejects_msg('M09', 'D7: eyni əl ilə sifariş nömrəsi rədd edilir', format(
  $$select public.marketplace_create_manual_order(%L, '{"order_number":"M-1","customer_name":"X"}',
      jsonb_build_array(jsonb_build_object('listing_id', %L, 'quantity', 1, 'sale_azn_minor', 100)))$$,
  tmk.v('org_p'), tmk.v('lm')), 'artıq var');
select tmk.ok('M09', 'variantlı sifariş variant stokunu azaldır', tmk.val(format(
  $$select public.marketplace_create_manual_order(%L, '{"order_number":"M-5","customer_name":"Leyla"}',
      jsonb_build_array(jsonb_build_object('listing_id', %L, 'variant_id', %L, 'quantity', 1, 'sale_azn_minor', 5100, 'cost_azn_minor', 1900)))::text$$,
  tmk.v('org_p'), tmk.v('l1'), tmk.v('v12'))) ~ '^[0-9a-f-]{36}$'
  and tmk.val(format('select stock::text from public.marketplace_variants where id = %L', tmk.v('v12'))) = '3');
select tmk.as_user('p_viewer');
select tmk.rejects('M09', 'müşahidəçi sifariş yarada bilmir', format(
  $$select public.marketplace_create_manual_order(%L, '{"order_number":"M-4","customer_name":"X"}',
      jsonb_build_array(jsonb_build_object('listing_id', %L, 'quantity', 1, 'sale_azn_minor', 100)))$$,
  tmk.v('org_p'), tmk.v('lm')));
reset role;
select tmk.ok('M09', 'əl ilə sifariş: kanal manual, valyuta AZN, yaradan işçi', tmk.val($$select channel || '/' || currency || '/' || fx_rate_to_base::numeric(4,2)::text || '/' || user_id::text
  from public.marketplace_orders where order_number = 'M-1'$$) = 'manual/AZN/1.00/' || tmk.v('p_employee'));
do $$ begin
  perform tmk.put('om1', (select id::text from public.marketplace_orders where order_number = 'M-1'));
  perform tmk.put('lnm1', (select l.id::text from public.marketplace_order_lines l join public.marketplace_orders o on o.id = l.order_id where o.order_number = 'M-1'));
exception when others then null; end $$;

-- ════════════════════ M05 · D1 FROZEN FIGURES + Y4 / Y5 ════════════════════
set role authenticated;
select tmk.as_user('p_employee');
select tmk.rejects_msg('M05', 'Shopify sətrində satışı dəyişmək olmur', format(
  'update public.marketplace_order_lines set sale_azn_minor = 99999 where id = %L', tmk.v('ln1')), 'Shopify');
do $$ declare c text; begin
  foreach c in array array['refund_azn_minor','fee_azn_minor','cost_azn_minor','shipping_income_azn_minor','tax_azn_minor','discount_azn_minor','quantity','fx_rate_to_base'] loop
    perform tmk.rejects('M05', 'Shopify sətrində ' || c || ' dəyişmir', format(
      'update public.marketplace_order_lines set %I = %I + 1 where id = %L', c, c, tmk.v('ln1')));
  end loop;
end $$;
select tmk.rejects('M05', 'Shopify sətrində cost_missing dəyişmir', format(
  'update public.marketplace_order_lines set cost_missing = false where id = %L', tmk.v('ln2')));
select tmk.rejects('M05', 'Shopify sifarişində valyuta dəyişmir', format(
  $$update public.marketplace_orders set currency = 'EUR' where id = %L$$, tmk.v('o1')));
select tmk.rejects('M05', 'Shopify sifarişində məzənnə dəyişmir', format(
  'update public.marketplace_orders set fx_rate_to_base = 2 where id = %L', tmk.v('o1')));
select tmk.rejects('M05', 'Shopify sifarişində müştəri adı dəyişmir', format(
  $$update public.marketplace_orders set customer_name = 'Saxta' where id = %L$$, tmk.v('o1')));
select tmk.rejects('M05', 'Shopify ödəniş statusu dəyişmir', format(
  $$update public.marketplace_orders set financial_status = 'REFUNDED' where id = %L$$, tmk.v('o1')));
select tmk.rejects('M05', 'Shopify sifariş tarixi dəyişmir', format(
  $$update public.marketplace_orders set placed_at = now() where id = %L$$, tmk.v('o1')));
select tmk.ok('M05', 'status, izləmə, daşıyıcı, qeyd dəyişir', tmk.rows(format(
  $$update public.marketplace_orders set status = 'transit', tracking_number = 'LP123', carrier = 'Cainiao', note = 'Yoxlanıldı', shipped_at = now() where id = %L$$, tmk.v('o1'))) = 1);
select tmk.ok('M05', 'təchizatçı sifarişi sahələri dəyişir', tmk.rows(format(
  $$update public.marketplace_order_lines set supplier_order_number = 'AE-1', supplier_order_status = 'ordered', supplier_ordered_at = now(), supplier_paid_azn_minor = 3000 where id = %L$$, tmk.v('ln1'))) = 1);
select tmk.ok('M05', 'əl ilə sifarişdə satış redaktə olunur', tmk.rows(format(
  'update public.marketplace_order_lines set sale_azn_minor = 2100 where id = %L', tmk.v('lnm1'))) = 1);
select tmk.rejects('M05', 'Y4: istifadəçi Shopify kanallı listinq yarada bilmir', format(
  $$insert into public.marketplace_listings (product_id, channel, external_id) values (%L, 'shopify', 'gid://shopify/Product/fake')$$, tmk.v('pchk')));
select tmk.rejects('M05', 'Y4: listinqin Shopify ID-si dəyişmir', format(
  $$update public.marketplace_listings set external_id = 'gid://shopify/Product/x' where id = %L$$, tmk.v('l1')));
select tmk.rejects('M05', 'Y4: listinqin kanalı dəyişmir', format(
  $$update public.marketplace_listings set channel = 'manual', external_id = null where id = %L$$, tmk.v('l1')));
select tmk.rejects('M05', 'Y4: listinqin məhsul bağlantısı dəyişmir', format(
  'update public.marketplace_listings set product_id = %L where id = %L', tmk.v('pchk'), tmk.v('l1')));
select tmk.rejects('M05', 'Y4: variantın inventar ID-si dəyişmir', format(
  $$update public.marketplace_variants set inventory_item_id = 'x' where id = %L$$, tmk.v('v11')));
select tmk.rejects('M05', 'Y4: istifadəçi variant yarada bilmir', format(
  $$insert into public.marketplace_variants (listing_id, external_id) values (%L, 'gid://shopify/ProductVariant/fake')$$, tmk.v('l1')));
select tmk.no_effect('M05', 'sifariş sətrini birbaşa silmək olmur', format('delete from public.marketplace_order_lines where id = %L', tmk.v('ln1')));
select tmk.ok('M05', 'Shopify listinqində satış qiyməti və xərclər redaktə olunur', tmk.rows(format(
  'update public.marketplace_listings set sale_azn_minor = 5200, purchase_azn_minor = 1700 where id = %L', tmk.v('l1'))) = 1);
reset role;
select tmk.ok('M05', 'Y5: dondurulmuş sətir dəyişməyib (8500 / 300 / 3800)', tmk.val(format(
  $$select sale_azn_minor || '/' || fee_azn_minor || '/' || cost_azn_minor from public.marketplace_order_lines where id = %L$$, tmk.v('ln1'))) = '8500/300/3800');

-- ════════════════════ M06 · IMPORT RULES (server) ════════════════════
set role service_role;
select set_config('request.jwt.claim.sub', '', false);
do $$ declare r jsonb; begin
  -- Second delivery: new statuses, a refund (AZN at the NEW rate 1.80), a changed sale (must be ignored), cost now known for line 2
  r := public.marketplace_upsert_shopify_order(tmk.u('org_p'), tmk.u('integ_p'),
    $j${"external_id":"gid://shopify/Order/1001","order_number":"#1001","customer_name":"Aysel M.","customer_email":null,
        "currency":"USD","fx_rate":1.80,"status":"problem","financial_status":"PARTIALLY_REFUNDED",
        "fulfillment_status":"UNFULFILLED","placed_at":"2026-11-21T10:00:00Z"}$j$,
    $j$[{"external_id":"gid://shopify/LineItem/1","listing_external_id":"gid://shopify/Product/1","variant_external_id":"gid://shopify/ProductVariant/11",
         "line_title":"Simsiz qulaqlıq - Qara","quantity":2,"sale_azn_minor":9999,"shipping_income_azn_minor":999,"fee_azn_minor":999,
         "refund_azn_minor":1800,"cost_azn_minor":9999,"cost_missing":false},
        {"external_id":"gid://shopify/LineItem/2","listing_external_id":"gid://shopify/Product/999","line_title":"Naməlum məhsul","quantity":1,
         "sale_azn_minor":1700,"fee_azn_minor":50,"refund_azn_minor":0,"cost_azn_minor":900,"cost_missing":false},
        {"external_id":"gid://shopify/LineItem/3","listing_external_id":"gid://shopify/Product/2","line_title":"Telefon qabı","quantity":1,
         "sale_azn_minor":1800,"fee_azn_minor":60,"refund_azn_minor":0,"cost_azn_minor":1200,"cost_missing":false}]$j$);
  perform tmk.ok('M06', 'təkrar idxal: 2 yeniləndi, 1 yeni sətir', (r->>'updated')::int = 2 and (r->>'inserted')::int = 1, r::text);
  -- Third delivery (rate 1.79): line 2 cost changes again (already filled → must stay 900);
  -- line 3 (added in the 2nd delivery at 1.80) gets a refund of 7.77 AZN at 1.79 → 7.77 / 1.79 × 1.80 = 7.81
  r := public.marketplace_upsert_shopify_order(tmk.u('org_p'), tmk.u('integ_p'),
    $j${"external_id":"gid://shopify/Order/1001","order_number":"#1001","customer_name":"Aysel M.","currency":"USD","fx_rate":1.79,
        "status":"problem","financial_status":"PARTIALLY_REFUNDED","fulfillment_status":"UNFULFILLED"}$j$,
    $j$[{"external_id":"gid://shopify/LineItem/2","listing_external_id":"gid://shopify/Product/999","quantity":1,
         "sale_azn_minor":1700,"fee_azn_minor":50,"refund_azn_minor":0,"cost_azn_minor":1200,"cost_missing":false},
        {"external_id":"gid://shopify/LineItem/3","listing_external_id":"gid://shopify/Product/2","line_title":"Telefon qabı","quantity":1,
         "sale_azn_minor":1800,"fee_azn_minor":60,"refund_azn_minor":777,"cost_azn_minor":1200,"cost_missing":false}]$j$);
exception when others then perform tmk.ok('M06', 'təkrar idxal', false, sqlerrm); end $$;
reset role;
select tmk.ok('M06', 'satış, çatdırılma, komissiya dondurulub (8500 / 850 / 300)', tmk.val(format(
  $$select sale_azn_minor || '/' || shipping_income_azn_minor || '/' || fee_azn_minor from public.marketplace_order_lines where id = %L$$, tmk.v('ln1'))) = '8500/850/300');
select tmk.ok('M06', 'maya artıq var idisə dəyişmir (3800)', tmk.val(format(
  'select cost_azn_minor::text from public.marketplace_order_lines where id = %L', tmk.v('ln1'))) = '3800');
select tmk.ok('M06', 'refund ilkin məzənnə ilə: 1800 / 1.80 × 1.70 = 1700', tmk.val(format(
  'select refund_azn_minor::text from public.marketplace_order_lines where id = %L', tmk.v('ln1'))) = '1700');
select tmk.ok('M06', 'Y17: sonradan əlavə olunan sətir öz məzənnəsini saxlayır (1.80), refund onunla: 777 / 1.79 × 1.80 = 781', tmk.val(
  $$select fx_rate_to_base::numeric(6,2) || '/' || refund_azn_minor from public.marketplace_order_lines where external_id = 'gid://shopify/LineItem/3'$$) = '1.80/781');
select tmk.ok('M06', 'ilk sətirlərin dondurulmuş məzənnəsi 1.70 qalır', tmk.val(format(
  'select fx_rate_to_base::numeric(6,2)::text from public.marketplace_order_lines where id = %L', tmk.v('ln1'))) = '1.70');
select tmk.ok('M06', 'çatışmayan maya bir dəfə dolur (900), sonra dəyişmir', tmk.val(format(
  $$select cost_azn_minor || '/' || cost_missing from public.marketplace_order_lines where id = %L$$, tmk.v('ln2'))) = '900/false');
select tmk.ok('M06', 'statuslar yenilənir, valyuta/məzənnə/tarix dondurulur', tmk.val(format(
  $$select status || '/' || financial_status || '/' || currency || '/' || fx_rate_to_base::numeric(6,2) || '/' || to_char(placed_at at time zone 'UTC', 'YYYY-MM-DD')
    from public.marketplace_orders where id = %L$$, tmk.v('o1'))) = 'problem/PARTIALLY_REFUNDED/USD/1.70/2026-11-20');
select tmk.ok('M06', 'boş gələn e-poçt köhnəni silmir', tmk.val(format(
  'select customer_email from public.marketplace_orders where id = %L', tmk.v('o1'))) = 'aysel@example.com');
select tmk.ok('M06', 'istifadəçinin yazdığı izləmə nömrəsi idxalda qalır', tmk.val(format(
  'select tracking_number from public.marketplace_orders where id = %L', tmk.v('o1'))) = 'LP123');
select tmk.ok('M06', 'sifarişdə 3 sətir, təkrar sətir yoxdur', tmk.n(format(
  'select 1 from public.marketplace_order_lines where order_id = %L', tmk.v('o1'))) = 3);
select tmk.ok('M06', 'uyğunsuz sətir idxal olunur, listinqi boşdur', tmk.val(format(
  $$select coalesce(listing_id::text, 'null') from public.marketplace_order_lines where id = %L$$, tmk.v('ln2'))) = 'null');
select tmk.ok('M06', 'Y6: server sətirlərinin yaradanı mağazanı qoşan istifadəçidir', tmk.val(format(
  'select user_id::text from public.marketplace_listings where id = %L', tmk.v('l1'))) = tmk.v('p_owner')
  and tmk.val(format('select user_id::text from public.marketplace_orders where id = %L', tmk.v('o1'))) = tmk.v('p_owner'));
set role service_role;
do $$ declare r jsonb; begin
  r := public.marketplace_upsert_catalog(tmk.u('org_p'), tmk.u('integ_p'), $j$[
    {"external_id":"gid://shopify/Product/2","name":"Telefon qabı (yeni ad)","vendor":"Acme",
     "admin_url":"https://tc-test-p.myshopify.com/admin/products/2","sale_azn_minor":1900,"stock":20,"status":"active",
     "variant_count":0,"inventory_item_id":"gid://shopify/InventoryItem/200","location_id":"gid://shopify/Location/1","variants":[]},
    {"external_id":"gid://shopify/Product/1","name":"Simsiz qulaqlıq","vendor":"Acme",
     "admin_url":"https://tc-test-p.myshopify.com/admin/products/1","sale_azn_minor":5300,"stock":0,"status":"active","variant_count":2,
     "variants":[{"external_id":"gid://shopify/ProductVariant/11","title":"Qara","sku":"QX-B","price_azn_minor":5300,"stock":8,
        "inventory_item_id":"gid://shopify/InventoryItem/111","location_id":"gid://shopify/Location/1","position":1}]}]$j$);
exception when others then perform tmk.ok('M06', 'kataloq yenidən sinxronlaşdırılır', false, sqlerrm); end $$;
reset role;
select tmk.ok('M06', 'kataloq sinxronizasiyası xərcləri üzərinə yazmır (800/300/100)', tmk.val(format(
  $$select purchase_azn_minor || '/' || shipping_azn_minor || '/' || other_azn_minor from public.marketplace_listings where id = %L$$, tmk.v('l2'))) = '800/300/100');
select tmk.ok('M06', 'kataloq sinxronizasiyası variant xərcini üzərinə yazmır (1500/400)', tmk.val(format(
  $$select purchase_azn_minor || '/' || shipping_azn_minor from public.marketplace_variants where id = %L$$, tmk.v('v11'))) = '1500/400');
select tmk.ok('M06', 'satış qiyməti və ad yenilənir', tmk.val(format(
  $$select l.sale_azn_minor || '/' || p.name from public.marketplace_listings l join public.products p on p.id = l.product_id where l.id = %L$$, tmk.v('l2'))) = '1900/Telefon qabı (yeni ad)');
select tmk.ok('M06', 'Shopify məhsulu kataloqda: mənbə shopify, modul marketplace, verified', tmk.val(format(
  $$select source || '/' || origin_module || '/' || data_quality from public.products where id = %L$$, tmk.v('p2'))) = 'shopify/marketplace/verified');

-- ════════════════════ M07 · DUPLICATES ════════════════════
set role service_role;
select tmk.ok('M07', 'eyni webhook ikinci dəfə saxlanılmır (duplicate)', tmk.val($$select (public.integration_event_store('shopify', 'wh-1', 'tc-test-p.myshopify.com', 'orders/create', '{}', repeat('a', 64)))->>'duplicate'$$) = 'true');
reset role;
select tmk.ok('M07', 'jurnalda wh-1 bir dəfədir', tmk.n($$select 1 from public.integration_events where provider = 'shopify' and external_id = 'wh-1'$$) = 1);
do $$ begin
  perform public.notify_once(tmk.u('org_p'), tmk.u('p_owner'), 'marketplace.test', 'Bir dəfə', null, '/m/marketplace', null, null, '{}', 'once:1');
  perform public.notify_once(tmk.u('org_p'), tmk.u('p_owner'), 'marketplace.test', 'Bir dəfə', null, '/m/marketplace', null, null, '{}', 'once:1');
exception when others then perform tmk.ok('M07', 'notify_once', false, sqlerrm); end $$;
select tmk.ok('M07', 'eyni dedupe_key ilə bildiriş bir dəfə yaranır', tmk.n($$select 1 from public.notifications where type = 'marketplace.test'$$) = 1);
select tmk.ok('M07', 'uyğunsuz sətir bildirişi 3 idxaldan sonra 1 dənədir (sahib)', tmk.n(format(
  $$select 1 from public.notifications where type = 'marketplace.unmatched_line' and user_id = %L$$, tmk.v('p_owner'))) = 1);
select tmk.ok('M07', 'uyğunsuz sətir bildirişi yazma icazəli 4 üzvə gedir, müşahidəçiyə yox', tmk.n(format(
  $$select 1 from public.notifications where type = 'marketplace.unmatched_line' and org_id = %L$$, tmk.v('org_p'))) = 4
  and tmk.n(format($$select 1 from public.notifications where type = 'marketplace.unmatched_line' and user_id = %L$$, tmk.v('p_viewer'))) = 0);

-- ════════════════════ M08 · TRIGGERS ════════════════════
select tmk.ok('M08', 'variant_count = 2', tmk.val(format('select variant_count::text from public.marketplace_listings where id = %L', tmk.v('l1'))) = '2');
select tmk.ok('M08', 'listinq stoku = variantların cəmi (8 + 3 = 11)', tmk.val(format('select stock::text from public.marketplace_listings where id = %L', tmk.v('l1'))) = '11');
set role authenticated;
select tmk.as_user('p_employee');
select tmk.allows('M08', 'işçi variant stokunu 0 edir', format('update public.marketplace_variants set stock = 0 where id = %L', tmk.v('v12')));
reset role;
select tmk.ok('M08', 'listinq stoku yenidən hesablanır (8)', tmk.val(format('select stock::text from public.marketplace_listings where id = %L', tmk.v('l1'))) = '8');
-- Low-stock crossings on listing 2 (threshold 5)
set role authenticated;
select tmk.as_user('p_employee');
select tmk.allows('M08', 'stok 20 → 3', format('update public.marketplace_listings set stock = 3 where id = %L', tmk.v('l2')));
select tmk.allows('M08', 'stok 3 → 2 (yenə aşağı)', format('update public.marketplace_listings set stock = 2 where id = %L', tmk.v('l2')));
reset role;
select tmk.ok('M08', 'həddi keçəndə hər yazıcıya 1 az-stok bildirişi', tmk.n(format(
  $$select 1 from public.notifications where type = 'marketplace.low_stock' and entity_id = %L and user_id = %L$$, tmk.v('l2'), tmk.v('p_owner'))) = 1
  and tmk.n(format($$select 1 from public.notifications where type = 'marketplace.low_stock' and entity_id = %L$$, tmk.v('l2'))) = 4);
select tmk.ok('M08', 'müşahidəçi az-stok bildirişi almır', tmk.n(format(
  $$select 1 from public.notifications where type = 'marketplace.low_stock' and user_id = %L$$, tmk.v('p_viewer'))) = 0);
set role authenticated;
select tmk.as_user('p_employee');
select tmk.allows('M08', 'stok 2 → 10 → 4', format('update public.marketplace_listings set stock = 10 where id = %L', tmk.v('l2')));
select tmk.allows('M08', 'stok 10 → 4', format('update public.marketplace_listings set stock = 4 where id = %L', tmk.v('l2')));
reset role;
select tmk.ok('M08', 'yenidən keçəndə ikinci bildiriş yaranır', tmk.n(format(
  $$select 1 from public.notifications where type = 'marketplace.low_stock' and entity_id = %L and user_id = %L$$, tmk.v('l2'), tmk.v('p_owner'))) = 2);
-- Supplier offers: generated AZN, price history, notification
set role authenticated;
select tmk.as_user('p_employee');
select tmk.allows('M08', 'işçi USD təklif əlavə edir (5.00 × 1.70)', format(
  $$insert into public.supplier_offers (product_id, supplier_name, url, currency, price_minor, shipping_minor, fx_rate_to_base, is_primary, delivery_min_days, delivery_max_days)
    values (%L, 'AliExpress A', 'https://www.aliexpress.com/item/1005001234567890.html', 'USD', 500, 100, 1.70, true, 10, 20)$$, tmk.v('p2')));
reset role;
do $$ begin perform tmk.put('of1', (select id::text from public.supplier_offers where supplier_name = 'AliExpress A')); exception when others then null; end $$;
select tmk.ok('M08', 'AZN qarşılığı avtomatik: 850 / 170', tmk.val(format(
  $$select price_azn_minor || '/' || shipping_azn_minor from public.supplier_offers where id = %L$$, tmk.v('of1'))) = '850/170');
select tmk.ok('M08', 'yaradılanda tarixçəyə 1 sətir', tmk.n(format('select 1 from public.supplier_offer_prices where offer_id = %L', tmk.v('of1'))) = 1);
set role authenticated;
select tmk.as_user('p_employee');
select tmk.allows('M08', 'qiymət 5.00 → 6.00', format('update public.supplier_offers set price_minor = 600 where id = %L', tmk.v('of1')));
select tmk.allows('M08', 'yalnız qeyd dəyişir', format($$update public.supplier_offers set notes = 'zəng edildi' where id = %L$$, tmk.v('of1')));
select tmk.rejects('M08', 'ikinci əsas təchizatçı rədd edilir', format(
  $$insert into public.supplier_offers (product_id, supplier_name, price_minor, is_primary) values (%L, 'AliExpress B', 400, true)$$, tmk.v('p2')));
select tmk.rejects('M08', 'min gün > max gün rədd edilir', format(
  $$insert into public.supplier_offers (product_id, supplier_name, price_minor, delivery_min_days, delivery_max_days) values (%L, 'C', 1, 9, 3)$$, tmk.v('p2')));
reset role;
select tmk.ok('M08', 'qiymət dəyişəndə tarixçə 2 sətir, qeyd dəyişəndə artmır', tmk.n(format('select 1 from public.supplier_offer_prices where offer_id = %L', tmk.v('of1'))) = 2);
select tmk.ok('M08', 'qiymət dəyişikliyi bildirişi yazıcılara gedir', tmk.n(format(
  $$select 1 from public.notifications where type = 'marketplace.supplier_price' and entity_id = %L$$, tmk.v('of1'))) = 4);
-- Inventory webhook (server)
set role service_role;
do $$ begin
  perform public.marketplace_apply_inventory(tmk.u('org_p'), tmk.u('integ_p'), 'gid://shopify/InventoryItem/111', 'gid://shopify/Location/1', 6);
  perform public.marketplace_apply_inventory(tmk.u('org_p'), tmk.u('integ_p'), 'gid://shopify/InventoryItem/200', 'gid://shopify/Location/1', 15);
exception when others then perform tmk.ok('M08', 'inventar yenilənməsi', false, sqlerrm); end $$;
select tmk.ok('M08', 'naməlum inventar elementi nəzərə alınmır', tmk.val(format($$select (public.marketplace_apply_inventory(
  %L, %L, 'gid://shopify/InventoryItem/404', 'gid://shopify/Location/1', 1))->>'status'$$, tmk.v('org_p'), tmk.v('integ_p'))) = 'ignored');
reset role;
select tmk.ok('M08', 'inventar: variant 6, listinq cəmi 6; variantsız listinq 15', tmk.val(format(
  'select stock::text from public.marketplace_variants where id = %L', tmk.v('v11'))) = '6'
  and tmk.val(format('select stock::text from public.marketplace_listings where id = %L', tmk.v('l1'))) = '6'
  and tmk.val(format('select stock::text from public.marketplace_listings where id = %L', tmk.v('l2'))) = '15');

-- ════════════════════ M10 · D2 ARCHIVE INSTEAD OF DELETE ════════════════════
set role authenticated;
select tmk.as_user('p_owner');
select tmk.no_effect('M10', 'sahib Shopify sifarişini silə bilmir', format('delete from public.marketplace_orders where id = %L', tmk.v('o1')));
select tmk.ok('M10', 'Shopify sifarişi arxivləşdirilir', tmk.rows(format(
  'update public.marketplace_orders set archived_at = now() where id = %L', tmk.v('o1'))) = 1);
reset role;
set role service_role;
do $$ begin
  perform public.marketplace_upsert_shopify_order(tmk.u('org_p'), tmk.u('integ_p'),
    $j${"external_id":"gid://shopify/Order/1001","order_number":"#1001","customer_name":"Aysel M.","currency":"USD","fx_rate":1.80,
        "status":"complete","financial_status":"PARTIALLY_REFUNDED","fulfillment_status":"FULFILLED"}$j$, '[]');
exception when others then perform tmk.ok('M10', 'arxivdən sonra idxal', false, sqlerrm); end $$;
reset role;
select tmk.ok('M10', 'idxal arxivi geri açmır və sifarişi təkrarlamır', tmk.n($$select 1 from public.marketplace_orders where external_id = 'gid://shopify/Order/1001'$$) = 1
  and tmk.val(format('select (archived_at is not null)::text from public.marketplace_orders where id = %L', tmk.v('o1'))) = 'true');
set role authenticated;
select tmk.as_user('p_owner');
select tmk.ok('M10', 'arxivdən çıxarmaq olur', tmk.rows(format(
  'update public.marketplace_orders set archived_at = null where id = %L', tmk.v('o1'))) = 1);
select tmk.as_user('p_employee');
select tmk.ok('M10', 'əl ilə sifariş silinir', tmk.rows(format('delete from public.marketplace_orders where id = %L', tmk.v('om1'))) = 1);
reset role;
select tmk.ok('M10', 'silinən əl ilə sifarişin sətirləri də silinib', tmk.n(format(
  'select 1 from public.marketplace_order_lines where order_id = %L', tmk.v('om1'))) = 0);

-- ════════════════════ M11 · D3 PURGE + Y1 ════════════════════
do $$ begin
  update public.integration_events set received_at = now() - interval '31 days', last_attempt_at = now() - interval '31 days'
    where id = tmk.v('e1')::bigint;
  update public.integration_events set received_at = now() - interval '29 days', last_attempt_at = now() - interval '29 days'
    where id = tmk.v('e2')::bigint;
exception when others then perform tmk.ok('M11', 'setup: hadisə tarixləri', false, sqlerrm); end $$;
set role service_role;
select tmk.ok('M11', 'təmizləmə 1 hadisəni təmizləyir', tmk.val('select public.integration_events_purge(30)::text') = '1');
reset role;
select tmk.ok('M11', '31 günlük hadisənin məzmunu silindi, qeyd qaldı', tmk.val(format(
  $$select (payload is null)::text || '/' || (payload_purged_at is not null)::text || '/' || topic || '/' || status from public.integration_events where id = %s$$,
  coalesce(tmk.v('e1'), '0'))) = 'true/true/orders/create/processed');
select tmk.ok('M11', '29 günlük hadisənin məzmunu qalır', tmk.val(format(
  'select (payload is not null)::text from public.integration_events where id = %s', coalesce(tmk.v('e2'), '0'))) = 'true');
select tmk.ok('M11', 'sifariş, sətirlər, müştəri adı və e-poçtu qalır', tmk.val(format(
  $$select customer_name || '/' || customer_email from public.marketplace_orders where id = %L$$, tmk.v('o1'))) = 'Aysel M./aysel@example.com'
  and tmk.n(format('select 1 from public.marketplace_order_lines where order_id = %L', tmk.v('o1'))) = 3);
select tmk.ok('M11', 'Y1: webhook jurnalı audit jurnalına yazılmır', (select count(*) from public.audit_log where table_name = 'integration_events') = 0);
select tmk.ok('M11', 'Y1: ünvan, telefon, IP audit jurnalında yoxdur', (select count(*) from public.audit_log
  where changed::text like '%TMK-ünvan-7781%' or changed::text like '%994507781778%' or changed::text like '%10.77.81.78%') = 0);
-- Five failed attempts → one sync_failed notification
set role service_role;
do $$ declare r jsonb; i int; begin
  r := public.integration_event_store('shopify', 'wh-3', 'tc-test-p.myshopify.com', 'orders/create', '{"id":1003}', repeat('d', 64));
  perform tmk.put('e3', r->>'id');
  for i in 1..5 loop
    perform public.integration_event_finish((r->>'id')::bigint, 'failed', 'Sınaq xətası', now() + interval '1 minute');
  end loop;
exception when others then perform tmk.ok('M11', '5 uğursuz cəhd', false, sqlerrm); end $$;
reset role;
select tmk.ok('M11', '5 uğursuz cəhddən sonra 1 sinxronizasiya xətası bildirişi', tmk.n(format(
  $$select 1 from public.notifications where type = 'marketplace.sync_failed' and user_id = %L$$, tmk.v('p_owner'))) = 1
  and tmk.val(format('select attempts::text from public.integration_events where id = %s', coalesce(tmk.v('e3'), '0'))) = '5');

-- ════════════════════ M12 · D6 DELETE ════════════════════
set role authenticated;
select tmk.as_user('p_employee');
select tmk.rejects_msg('M12', 'sifarişi olan məhsul silinmir, səbəb göstərilir', format(
  'select public.marketplace_delete_listing(%L)', tmk.v('l1')), 'sifariş');
select tmk.ok('M12', 'silinməyən listinq yerindədir', tmk.n(format('select 1 from public.marketplace_listings where id = %L', tmk.v('l1'))) = 1);
do $$ begin
  with p as (insert into public.products (name, origin_module) values ('Silinəcək məhsul', 'marketplace') returning id)
  insert into public.marketplace_listings (product_id) select id from p;
  insert into public.supplier_offers (product_id, supplier_name, price_minor)
    select id, 'Silinəcək təklif', 100 from public.products where name = 'Silinəcək məhsul';
  with p as (insert into public.products (name, origin_module) values ('Topdan məhsul', 'wholesale') returning id)
  insert into public.marketplace_listings (product_id) select id from p;
exception when others then perform tmk.ok('M12', 'setup: silinəcək məhsullar', false, sqlerrm); end $$;
select tmk.put('ldel', tmk.val($$select l.id::text from public.marketplace_listings l join public.products p on p.id = l.product_id where p.name = 'Silinəcək məhsul'$$));
select tmk.put('lwh', tmk.val($$select l.id::text from public.marketplace_listings l join public.products p on p.id = l.product_id where p.name = 'Topdan məhsul'$$));
select tmk.allows('M12', 'sifarişi olmayan Modul 03 məhsulu silinir', format('select public.marketplace_delete_listing(%L)', tmk.v('ldel')));
select tmk.allows('M12', 'başqa modulun məhsulunun listinqi silinir', format('select public.marketplace_delete_listing(%L)', tmk.v('lwh')));
select tmk.rejects('M12', 'listinqi olan məhsulu kataloqdan birbaşa silmək olmur', format('delete from public.products where id = %L', tmk.v('p2')));
select tmk.as_user('p_viewer');
select tmk.rejects('M12', 'müşahidəçi məhsul silə bilmir', format('select public.marketplace_delete_listing(%L)', tmk.v('lm')));
reset role;
select tmk.ok('M12', 'Modul 03 məhsulu: listinq, kataloq sətri və təklif silindi', tmk.n($$select 1 from public.products where name = 'Silinəcək məhsul'$$) = 0
  and tmk.n($$select 1 from public.supplier_offers where supplier_name = 'Silinəcək təklif'$$) = 0
  and tmk.n(format('select 1 from public.marketplace_listings where id = %L', tmk.v('ldel'))) = 0);
select tmk.ok('M12', 'başqa modulun məhsulu kataloqda qalır', tmk.n($$select 1 from public.products where name = 'Topdan məhsul'$$) = 1
  and tmk.n(format('select 1 from public.marketplace_listings where id = %L', tmk.v('lwh'))) = 0);

-- ════════════════════ M13 · PRIVILEGES ════════════════════
create temp table mp_server_fns(sig text);
insert into mp_server_fns values
  ('public.notify_once(uuid, uuid, text, text, text, text, text, text, jsonb, text)'),
  ('public.notify_marketplace(uuid, text, text, text, text, text, text, jsonb, text)'),
  ('public.integration_event_store(text, text, text, text, jsonb, text)'),
  ('public.integration_event_finish(bigint, text, text, timestamptz)'),
  ('public.integration_events_purge(integer)'),
  ('public.marketplace_upsert_catalog(uuid, uuid, jsonb)'),
  ('public.marketplace_upsert_shopify_order(uuid, uuid, jsonb, jsonb)'),
  ('public.marketplace_apply_inventory(uuid, uuid, text, text, integer)');
create temp table mp_user_fns(sig text);
insert into mp_user_fns values
  ('public.marketplace_create_manual_order(uuid, jsonb, jsonb)'), ('public.marketplace_history(text, uuid)'),
  ('public.marketplace_store_status(uuid)'), ('public.marketplace_delete_listing(uuid)');
do $$ declare s text; begin
  for s in select sig from mp_server_fns loop
    perform tmk.ok('M13', 'brauzer (authenticated) çağıra bilmir: ' || split_part(s, '(', 1),
      tmk.val(format($q$select (not has_function_privilege('authenticated', %L, 'execute'))::text$q$, s)) = 'true');
    perform tmk.ok('M13', 'anon çağıra bilmir: ' || split_part(s, '(', 1),
      tmk.val(format($q$select (not has_function_privilege('anon', %L, 'execute'))::text$q$, s)) = 'true');
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      perform tmk.ok('M13', 'server (service_role) çağıra bilir: ' || split_part(s, '(', 1),
        tmk.val(format($q$select has_function_privilege('service_role', %L, 'execute')::text$q$, s)) = 'true');
    end if;
  end loop;
  for s in select sig from mp_user_fns loop
    perform tmk.ok('M13', 'istifadəçi çağıra bilir, anon yox: ' || split_part(s, '(', 1),
      tmk.val(format($q$select (has_function_privilege('authenticated', %L, 'execute') and not has_function_privilege('anon', %L, 'execute'))::text$q$, s, s)) = 'true');
  end loop;
end $$;
select tmk.ok('M13', 'bütün SECURITY DEFINER funksiyaları search_path təyin edir', (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prosecdef and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')) = 0);
select tmk.ok('M13', 'anon heç bir SECURITY DEFINER funksiyasını çağıra bilmir', (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prosecdef and has_function_privilege('anon', p.oid, 'execute')) = 0);
select tmk.ok('M13', 'authenticated-dən TRUNCATE/REFERENCES/TRIGGER alınıb', tmk.val($$select count(*)::text from mp_tables mp
  where has_table_privilege('authenticated', 'public.' || mp.t, 'TRUNCATE') or has_table_privilege('authenticated', 'public.' || mp.t, 'REFERENCES')
     or has_table_privilege('authenticated', 'public.' || mp.t, 'TRIGGER')$$) = '0');
set role authenticated;
select tmk.as_user('p_owner');
select tmk.rejects('M13', 'sahib belə server funksiyasını brauzerdən çağıra bilmir', format(
  $$select public.marketplace_upsert_catalog(%L, %L, '[]')$$, tmk.v('org_p'), tmk.v('integ_p')));
reset role;
set role anon;
select set_config('request.jwt.claim.sub', '', false);
do $$ declare t text; begin
  for t in select mp.t from mp_tables mp loop
    perform tmk.rejects('M13', 'anon oxuya bilmir: ' || t, format('select 1 from public.%I', t));
  end loop;
end $$;
reset role;

-- ════════════════════ M14 · Y13 BLOCKED SHOP + Y9 CURRENCY ════════════════════
set role service_role;
select tmk.ok('M14', 'canlı NovaNest domeni bloklanır (marketplace_blocked_shop)', tmk.val($$select public.marketplace_blocked_shop('NovaNest991.myshopify.com')::text$$) = 'true'
  and tmk.val($$select public.marketplace_blocked_shop('tc-test-p.myshopify.com')::text$$) = 'false');
select tmk.ok('M14', 'NovaNest webhook-u saxlanılmır', tmk.val($$select (public.integration_event_store('shopify', 'wh-nn', 'novanest991.myshopify.com', 'orders/create', '{}', repeat('e', 64)))->>'reason'$$) = 'blocked_shop');
select tmk.rejects_msg('M14', 'NovaNest inteqrasiyası ilə kataloq idxalı rədd edilir', format(
  $$select public.marketplace_upsert_catalog(%L, %L, '[]')$$, tmk.v('org_r'), tmk.v('integ_r')), 'qadağan');
select tmk.rejects_msg('M14', 'NovaNest inteqrasiyası ilə sifariş idxalı rədd edilir', format(
  $$select public.marketplace_upsert_shopify_order(%L, %L, '{"external_id":"gid://shopify/Order/nn","order_number":"#nn","customer_name":"X","currency":"USD","fx_rate":1.7,"status":"processing"}', '[]')$$,
  tmk.v('org_r'), tmk.v('integ_r')), 'qadağan');
select tmk.ok('M14', 'bağlı olmayan mağazanın webhook-u saxlanılmır', tmk.val($$select (public.integration_event_store('shopify', 'wh-x', 'unknown-shop.myshopify.com', 'orders/create', '{}', repeat('f', 64)))->>'reason'$$) = 'not_connected');
select tmk.rejects_msg('M14', 'Y9: dəstəklənməyən valyuta (CAD) aydın mesajla rədd edilir', format(
  $$select public.marketplace_upsert_shopify_order(%L, %L, '{"external_id":"gid://shopify/Order/cad","order_number":"#cad","customer_name":"X","currency":"CAD","fx_rate":1.2,"status":"processing"}', '[]')$$,
  tmk.v('org_p'), tmk.v('integ_p')), 'CAD');
reset role;
select tmk.ok('M14', 'jurnalda NovaNest və naməlum mağaza hadisəsi yoxdur', tmk.n($$select 1 from public.integration_events where shop_domain in ('novanest991.myshopify.com', 'unknown-shop.myshopify.com')$$) = 0);

-- ════════════════════ M15 · HISTORY RPC + Y7 STORE STATUS ════════════════════
set role authenticated;
select tmk.as_user('p_employee');
select tmk.ok('M15', 'işçi listinq qiymət tarixçəsini görür', tmk.n(format($$select * from public.marketplace_history('listing', %L)$$, tmk.v('l2'))) >= 1);
select tmk.ok('M15', 'tarixçə yalnız icazəli sütunları qaytarır', tmk.n(format(
  $$select k from public.marketplace_history('listing', %L) h, jsonb_object_keys(h.changed) k
    where k not in ('purchase_azn_minor','shipping_azn_minor','other_azn_minor','sale_azn_minor','status','stock','low_stock_threshold')$$, tmk.v('l2'))) = 0);
select tmk.ok('M15', 'sifariş sətri tarixçəsi maya/refund/təchizatçı sahələrini göstərir', tmk.n(format(
  $$select 1 from public.marketplace_history('order_line', %L) h where h.changed ? 'supplier_order_status'$$, tmk.v('ln1'))) >= 1);
select tmk.ok('M15', 'naməlum obyekt üçün tarixçə boşdur', tmk.n(format($$select * from public.marketplace_history('company', %L)$$, tmk.v('l2'))) = 0);
select tmk.ok('M15', 'Y7: işçi mağaza vəziyyətini görür (vaxt + xəta sayı)', tmk.val(format(
  $$select (s ? 'last_event_at' and s ? 'failed_events' and not (s ? 'payload'))::text from public.marketplace_store_status(%L) s$$, tmk.v('org_p'))) = 'true');
select tmk.ok('M15', 'Y7: xətalı hadisə sayı 1', tmk.val(format(
  $$select s->>'failed_events' from public.marketplace_store_status(%L) s$$, tmk.v('org_p'))) = '1');
select tmk.as_user('p_viewer');
select tmk.ok('M15', 'müşahidəçi də tarixçəni və vəziyyəti görür', tmk.n(format($$select * from public.marketplace_history('listing', %L)$$, tmk.v('l2'))) >= 1
  and tmk.val(format($$select public.marketplace_store_status(%L)::text$$, tmk.v('org_p'))) is not null);
reset role;

-- ════════════════════ M16 · Y3 CALC PREFS + SETTINGS ════════════════════
set role authenticated;
select tmk.as_user('p_employee');
select tmk.allows('M16', 'işçi öz kalkulyator parametrlərini saxlayır', format(
  $$insert into public.marketplace_calc_prefs (org_id, calc_settings) values (%L, '{"other":2,"ads":1,"fee":2.9,"usTax":0,"duty":0}')$$, tmk.v('org_p')));
select tmk.rejects('M16', 'başqasının adına parametr saxlamaq olmur', format(
  $$insert into public.marketplace_calc_prefs (org_id, user_id, calc_settings) values (%L, %L, '{}')$$, tmk.v('org_p'), tmk.v('p_viewer')));
select tmk.rejects('M16', '4 KB-dan böyük parametr rədd edilir', format(
  $$update public.marketplace_calc_prefs set calc_settings = jsonb_build_object('x', repeat('a', 5000)) where org_id = %L$$, tmk.v('org_p')));
select tmk.as_user('p_viewer');
select tmk.allows('M16', 'müşahidəçi də öz parametrlərini saxlayır', format(
  $$insert into public.marketplace_calc_prefs (org_id, calc_settings) values (%L, '{"fee":3}')$$, tmk.v('org_p')));
select tmk.ok('M16', 'hər kəs yalnız öz sətrini görür', tmk.n('select 1 from public.marketplace_calc_prefs') = 1);
select tmk.ok('M16', 'başqasının sətrini dəyişmək olmur', tmk.rows(format(
  $$update public.marketplace_calc_prefs set calc_settings = '{}' where user_id = %L$$, tmk.v('p_employee'))) = 0);
select tmk.as_user('p_admin');
select tmk.ok('M16', 'admin komissiya faizini dəyişir', tmk.rows(format(
  'update public.marketplace_settings set payment_fee_percent = 3.4 where org_id = %L', tmk.v('org_p'))) = 1);
select tmk.as_user('p_manager');
select tmk.no_effect('M16', 'menecer parametrləri dəyişə bilmir', format(
  'update public.marketplace_settings set payment_fee_percent = 9 where org_id = %L', tmk.v('org_p')));
reset role;
select tmk.ok('M16', 'parametrlərdə son dəyişən admin kimi qeyd olunur', tmk.val(format(
  'select updated_by::text from public.marketplace_settings where org_id = %L', tmk.v('org_p'))) = tmk.v('p_admin'));

-- ════════════════════ M17 · AUDIT + Y16 ════════════════════
select tmk.ok('M17', 'listinq qiymət dəyişikliyi audit jurnalındadır', (select count(*) from public.audit_log
  where table_name = 'marketplace_listings' and action = 'UPDATE' and changed ? 'purchase_azn_minor') >= 1);
select tmk.ok('M17', 'server idxalı audit jurnalındadır (aktor boş = sistem)', (select count(*) from public.audit_log
  where table_name = 'marketplace_order_lines' and action = 'INSERT' and actor_id is null) >= 3);
select tmk.ok('M17', 'parametr dəyişikliyi audit jurnalındadır', (select count(*) from public.audit_log
  where table_name = 'marketplace_settings' and action = 'UPDATE') >= 1);
select tmk.ok('M17', 'kalkulyator parametrləri audit-ə yazılmır (şəxsi ayar)', (select count(*) from public.audit_log
  where table_name = 'marketplace_calc_prefs') = 0);
select tmk.ok('M17', 'Y16: yeni cədvəllərdən auth.users-ə FK yoxdur (istifadəçi silinsə məlumat itmir)', (select count(*) from pg_constraint c
  where c.contype = 'f' and c.confrelid = 'auth.users'::regclass
    and c.conrelid in (select to_regclass('public.' || mp.t) from mp_tables mp)) = 0
  and (select count(*) from mp_tables mp where to_regclass('public.' || mp.t) is not null) = 9);

-- ── report ──────────────────────────────────────────────────
\set QUIET off
\pset footer off
select grp as "qrup", case when ok then 'PASS' else 'FAIL' end as result, name, detail
  from tmk.results order by grp, n;
select count(*) filter (where ok) as passed, count(*) filter (where not ok) as failed, count(distinct grp) as groups
  from tmk.results;
do $$ begin
  if exists (select 1 from tmk.results where not ok) then
    raise exception 'MARKETPLACE TESTS FAILED: % failing check(s)', (select count(*) from tmk.results where not ok);
  end if;
end $$;
select 'ALL MARKETPLACE (İ-3) TESTS PASSED' as result;
