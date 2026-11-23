-- İ-3 rollback cycle — part 1 (before 0013–0017): Phase 2B-shaped data + a baseline outside `public`.
-- part 2 (after them, \if :with_mp): data in every new Modul 03 table and in the new notifications column.
\set ON_ERROR_STOP on
\if :with_mp
  -- Shopify connection (fixture) + data written through the server functions and as a user
  insert into public.integrations (org_id, user_id, provider, status, config)
    select active_org_id, id, 'shopify', 'connected', '{"shop_domain":"rb-mp.myshopify.com","currency":"USD"}'
    from public.profiles where id = '91000000-0000-0000-0000-000000000001';
  select public.marketplace_upsert_catalog(
    (select active_org_id from public.profiles where id = '91000000-0000-0000-0000-000000000001'),
    (select id from public.integrations where config->>'shop_domain' = 'rb-mp.myshopify.com'),
    '[{"external_id":"gid://shopify/Product/77","name":"RB Shopify məhsul","admin_url":"https://rb-mp.myshopify.com/admin/products/77",
       "sale_azn_minor":2500,"stock":9,"status":"active","variant_count":1,
       "variants":[{"external_id":"gid://shopify/ProductVariant/771","title":"Tək","price_azn_minor":2500,"stock":9}]}]');
  select public.marketplace_upsert_shopify_order(
    (select active_org_id from public.profiles where id = '91000000-0000-0000-0000-000000000001'),
    (select id from public.integrations where config->>'shop_domain' = 'rb-mp.myshopify.com'),
    '{"external_id":"gid://shopify/Order/7001","order_number":"#7001","customer_name":"RB müştəri","currency":"USD","fx_rate":1.7,
      "status":"processing","financial_status":"PAID","fulfillment_status":"UNFULFILLED"}',
    '[{"external_id":"gid://shopify/LineItem/7001","listing_external_id":"gid://shopify/Product/77","quantity":1,
       "sale_azn_minor":2500,"fee_azn_minor":80,"cost_azn_minor":0,"cost_missing":true}]');
  select public.integration_event_store('shopify', 'rb-wh-1', 'rb-mp.myshopify.com', 'orders/create', '{"id":7001}', repeat('9', 64));
  select public.notify_once(active_org_id, id, 'marketplace.seed', 'RB bildiriş', null, '/m/marketplace', null, null, '{}', 'rb:1')
    from public.profiles where id = '91000000-0000-0000-0000-000000000001';
  set role authenticated;
  select set_config('request.jwt.claim.sub', '91000000-0000-0000-0000-000000000001', false);
  insert into public.marketplace_settings (org_id, payment_fee_percent) values (public.current_org_id(), 3.1);
  insert into public.marketplace_calc_prefs (org_id, calc_settings) values (public.current_org_id(), '{"fee":3.1}');
  insert into public.supplier_offers (product_id, supplier_name, currency, price_minor, fx_rate_to_base)
    select product_id, 'RB AliExpress', 'USD', 900, 1.7 from public.marketplace_listings limit 1;
  update public.supplier_offers set price_minor = 950 where supplier_name = 'RB AliExpress';
  reset role;
  select 'Modul 03 data inserted' as result;
\else
  insert into auth.users (id, email, raw_user_meta_data) values
    ('91000000-0000-0000-0000-000000000001', 'rbmp1@test.local', '{"full_name":"RB MP One","company_name":"RB MP A"}'),
    ('91000000-0000-0000-0000-000000000002', 'rbmp2@test.local', '{"full_name":"RB MP Two","company_name":"RB MP B"}');
  set role authenticated;
  do $$
  declare u uuid;
  begin
    foreach u in array array['91000000-0000-0000-0000-000000000001'::uuid, '91000000-0000-0000-0000-000000000002'::uuid] loop
      perform set_config('request.jwt.claim.sub', u::text, false);
      insert into public.companies (name) values ('RB MP Co ' || u);
      insert into public.products (name, origin_module) values ('RB MP P ' || u, 'wholesale');
      insert into public.financial_transactions (module_key, kind, amount_minor, currency, fx_rate_to_base)
        values ('wholesale', 'sale', 120000, 'AZN', 1);
      update public.profiles set job_title = 'Direktor' where id = u;
    end loop;
  end $$;
  reset role;
  select public.notify(active_org_id, id, 'system.test', 'RB MP 2B bildiriş', null, '/', null, null, '{}')
    from public.profiles where id = '91000000-0000-0000-0000-000000000001';
  -- baseline kept outside `public`, so it survives the rollback
  create schema rbmp;
  create function rbmp.snapshot() returns table (profiles bigint, orgs bigint, members bigint, companies bigint,
                                                  non_marketplace_products bigint, revenue numeric, notifications_2b bigint,
                                                  job_titles text)
  language sql stable as $f$
    with u(id) as (values ('91000000-0000-0000-0000-000000000001'::uuid), ('91000000-0000-0000-0000-000000000002'::uuid))
    select (select count(*) from public.profiles where id in (select id from u)),
           (select count(*) from public.organizations where created_by in (select id from u)),
           (select count(*) from public.organization_members where user_id in (select id from u)),
           (select count(*) from public.companies where user_id in (select id from u)),
           (select count(*) from public.products where user_id in (select id from u) and origin_module is distinct from 'marketplace'),
           (select sum(amount_base_minor) from public.financial_transactions where user_id in (select id from u)),
           (select count(*) from public.notifications where user_id in (select id from u) and type = 'system.test'),
           (select string_agg(coalesce(job_title, '-'), ',' order by id) from public.profiles where id in (select id from u))
  $f$;
  create table rbmp.baseline as select * from rbmp.snapshot();
  select '2B data + baseline recorded' as result;
\endif
