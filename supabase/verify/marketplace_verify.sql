-- ═════════════════════════════════════════════════════════════
-- TRADECORE AI · Read-only verification for a Supabase TEST project — İ-3 (Modul 03 · Marketplace)
-- Run it in the SQL editor of the TEST project (`tradecore-test`) right after migrations 0013–0017,
-- and after supabase/verify/phase2b_verify.sql reports all PASS.
-- It only reads catalogues and counts rows — it creates, changes and deletes nothing.
-- Every row should say PASS. Never run it — or the migrations — on production without approval.
-- ═════════════════════════════════════════════════════════════
with mp(t) as (values ('marketplace_listings'),('marketplace_variants'),('marketplace_orders'),('marketplace_order_lines'),
                      ('marketplace_settings'),('marketplace_calc_prefs'),('supplier_offers'),('supplier_offer_prices'),('integration_events')),
server_fns(sig) as (values
  ('public.notify_once(uuid, uuid, text, text, text, text, text, text, jsonb, text)'),
  ('public.notify_marketplace(uuid, text, text, text, text, text, text, jsonb, text)'),
  ('public.integration_event_store(text, text, text, text, jsonb, text)'),
  ('public.integration_event_finish(bigint, text, text, timestamptz)'),
  ('public.integration_events_purge(integer)'),
  ('public.marketplace_upsert_catalog(uuid, uuid, jsonb)'),
  ('public.marketplace_upsert_shopify_order(uuid, uuid, jsonb, jsonb)'),
  ('public.marketplace_apply_inventory(uuid, uuid, text, text, integer)')),
user_fns(sig) as (values
  ('public.marketplace_create_manual_order(uuid, jsonb, jsonb)'), ('public.marketplace_history(text, uuid)'),
  ('public.marketplace_store_status(uuid)'), ('public.marketplace_delete_listing(uuid)')),
checks(area, name, ok) as (
  -- schema
  select 'schema', 'all 9 Modul 03 tables exist with RLS on',
    (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity and c.relname in (select t from mp)) = 9
  union all select 'schema', 'org_id NOT NULL in every Modul 03 table',
    (select count(*) from information_schema.columns where table_schema = 'public' and column_name = 'org_id'
       and is_nullable = 'NO' and table_name in (select t from mp)) = 9
  union all select 'schema', 'money columns (*_minor) are bigint',
    not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name in (select t from mp)
                and column_name like '%\_minor' and data_type <> 'bigint')
  union all select 'schema', 'notifications.dedupe_key + partial unique index (0013)',
    exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'notifications' and column_name = 'dedupe_key')
    and to_regclass('public.notifications_dedupe_uq') is not null
  union all select 'schema', 'integrations: one organization per Shopify domain (0016)', to_regclass('public.integrations_shopify_shop_uq') is not null
  union all select 'schema', 'products table unchanged (16 columns, no Modul 03 column)',
    (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'products') = 16
    and not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'products'
                    and column_name in ('stock','sale_price','purchase_price','external_id','image_url'))
  union all select 'schema', 'listing ↔ product is 1:1 and products cannot be deleted under a listing (RESTRICT)',
    exists (select 1 from pg_constraint where conname = 'marketplace_listings_product_uq')
    and (select confdeltype from pg_constraint where conrelid = 'public.marketplace_listings'::regclass
           and confrelid = 'public.products'::regclass) = 'r'
  union all select 'schema', 'D6: order lines keep their product (RESTRICT)',
    (select confdeltype from pg_constraint where conrelid = 'public.marketplace_order_lines'::regclass
       and confrelid = 'public.marketplace_listings'::regclass) = 'r'
  union all select 'schema', 'D7: manual order numbers unique per organization',
    to_regclass('public.marketplace_orders_manual_number_uq') is not null
  union all select 'schema', 'Y16: no foreign key from Modul 03 tables to auth.users',
    not exists (select 1 from pg_constraint c where c.contype = 'f' and c.confrelid = 'auth.users'::regclass
                and c.conrelid in (select to_regclass('public.' || t) from mp))
  -- triggers
  union all select 'triggers', 'tenant triggers on the 6 core tables + supplier_offers (a_set_org, a_guard_owner)',
    (select count(*) from pg_trigger where not tgisinternal and tgname in ('a_set_org','a_guard_owner')
       and tgrelid in (select to_regclass('public.' || t) from mp where t not in ('supplier_offer_prices','integration_events'))) = 14
  union all select 'triggers', 'D1 guards on listings, variants, orders, order lines',
    (select count(*) from pg_trigger where not tgisinternal and tgname = 'b_guard'
       and tgrelid in (select to_regclass('public.' || t) from mp)) = 4
  union all select 'triggers', 'Y1: no audit trigger on integration_events, supplier_offer_prices, marketplace_calc_prefs',
    not exists (select 1 from pg_trigger where not tgisinternal and tgname = 'audit'
                and tgrelid in ('public.integration_events'::regclass, 'public.supplier_offer_prices'::regclass,
                                'public.marketplace_calc_prefs'::regclass))
  union all select 'triggers', 'audit trigger on the other 6 Modul 03 tables',
    (select count(*) from pg_trigger where not tgisinternal and tgname = 'audit'
       and tgrelid in (select to_regclass('public.' || t) from mp)) = 6
  union all select 'triggers', 'roll-up, low-stock and price-history triggers present',
    (select count(*) from pg_trigger where not tgisinternal
       and tgname in ('marketplace_variant_rollup','marketplace_low_stock','supplier_offer_price_log')) = 3
  -- privileges
  union all select 'privileges', 'anon has no privilege on any Modul 03 table',
    not exists (select 1 from mp where has_table_privilege('anon', 'public.' || t, 'SELECT')
                or has_table_privilege('anon', 'public.' || t, 'INSERT') or has_table_privilege('anon', 'public.' || t, 'UPDATE')
                or has_table_privilege('anon', 'public.' || t, 'DELETE'))
  union all select 'privileges', 'clients cannot insert orders / lines / variants / price history / journal',
    not has_table_privilege('authenticated', 'public.marketplace_orders', 'INSERT')
    and not has_table_privilege('authenticated', 'public.marketplace_order_lines', 'INSERT')
    and not has_table_privilege('authenticated', 'public.marketplace_variants', 'INSERT')
    and not has_table_privilege('authenticated', 'public.supplier_offer_prices', 'INSERT')
    and not has_table_privilege('authenticated', 'public.integration_events', 'INSERT')
  union all select 'privileges', 'clients cannot execute the 8 server functions',
    not exists (select 1 from server_fns where has_function_privilege('authenticated', sig, 'EXECUTE')
                or has_function_privilege('anon', sig, 'EXECUTE'))
  union all select 'privileges', 'service_role can execute the 8 server functions',
    not exists (select 1 from pg_roles where rolname = 'service_role')
    or not exists (select 1 from server_fns where not has_function_privilege('service_role', sig, 'EXECUTE'))
  union all select 'privileges', 'signed-in users can execute the 4 user functions, anon cannot',
    not exists (select 1 from user_fns where not has_function_privilege('authenticated', sig, 'EXECUTE')
                or has_function_privilege('anon', sig, 'EXECUTE'))
  union all select 'privileges', 'anon cannot execute any SECURITY DEFINER function in public',
    not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                where n.nspname = 'public' and p.prosecdef and has_function_privilege('anon', p.oid, 'EXECUTE'))
  union all select 'privileges', 'every SECURITY DEFINER function pins search_path',
    not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                where n.nspname = 'public' and p.prosecdef
                  and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%'))
  union all select 'privileges', 'D6: marketplace_delete_listing runs with the caller''s own RLS (SECURITY INVOKER)',
    not (select prosecdef from pg_proc where oid = 'public.marketplace_delete_listing(uuid)'::regprocedure)
  -- live data protection
  union all select 'protection', 'Y13: the live NovaNest shop is blocked by the database',
    public.marketplace_blocked_shop('novanest991.myshopify.com') and not public.marketplace_blocked_shop('example.myshopify.com')
  union all select 'protection', 'no integration points to the live NovaNest shop',
    not exists (select 1 from public.integrations where provider = 'shopify'
                and public.marketplace_blocked_shop(config ->> 'shop_domain'))
  union all select 'protection', 'D3: purge function present (payload only)', to_regprocedure('public.integration_events_purge(integer)') is not null
  union all select 'protection', 'Modul 03 is enabled in at least one plan (otherwise every Modul 03 policy hides all rows)',
    exists (select 1 from public.plans where 'marketplace' = any (modules))
)
select area, name, case when ok then 'PASS' else 'FAIL' end as result from checks
order by ok, area, name;
