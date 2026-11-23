-- ═════════════════════════════════════════════════════════════
-- TRADECORE AI · Read-only verification for a Supabase TEST project — Phase 3 (Modules 01, 02, 04–10)
-- Run it in the SQL editor of the TEST project right after migrations 0018–0022.
-- It only reads catalogues — it creates, changes and deletes nothing. Every row should say PASS.
-- ═════════════════════════════════════════════════════════════
with p3(t) as (values ('opportunities'),('trade_documents'),('trade_document_lines'),('leads'),('lead_activities'),
                      ('trading_accounts'),('trading_trades'),('trading_prices'),('trading_alerts')),
checks(area, name, ok) as (
  select 'schema', 'all 9 Phase 3 tables exist with RLS on',
    (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity and c.relname in (select t from p3)) = 9
  union all select 'schema', 'org_id NOT NULL in every Phase 3 table',
    (select count(*) from information_schema.columns where table_schema = 'public' and column_name = 'org_id'
       and is_nullable = 'NO' and table_name in (select t from p3)) = 9
  union all select 'schema', 'money columns (*_minor) are bigint',
    not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name in (select t from p3)
                and column_name like '%\_minor' and data_type <> 'bigint')
  union all select 'schema', 'supplier_offers.min_order_qty present (0022)',
    exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'supplier_offers' and column_name = 'min_order_qty')
  union all select 'security', 'anon has no privilege on any Phase 3 table',
    not exists (select 1 from p3 where has_table_privilege('anon', 'public.' || t, 'select,insert,update,delete'))
  union all select 'security', 'every Phase 3 table has policies for authenticated',
    (select count(distinct tablename) from pg_policies where schemaname = 'public' and tablename in (select t from p3)) = 9
  union all select 'security', 'tenant triggers (a_set_org, a_guard_owner) on every Phase 3 table',
    (select count(*) from pg_trigger where not tgisinternal and tgname = 'a_set_org'
       and tgrelid in (select to_regclass('public.' || t) from p3)) = 9
    and (select count(*) from pg_trigger where not tgisinternal and tgname = 'a_guard_owner'
       and tgrelid in (select to_regclass('public.' || t) from p3)) = 9
  union all select 'security', 'audit on business tables (price marks excluded)',
    (select count(*) from pg_trigger where not tgisinternal and tgname = 'audit'
       and tgrelid in (select to_regclass('public.' || t) from p3)) = 8
  union all select 'functions', 'trade_document_post(uuid) callable by members',
    has_function_privilege('authenticated', 'public.trade_document_post(uuid)', 'execute')
    and not has_function_privilege('anon', 'public.trade_document_post(uuid)', 'execute')
  union all select 'functions', 'trading alert trigger present', exists (select 1 from pg_trigger where tgname = 'alerts_check')
  union all select 'plans', 'all 10 modules are enabled in at least one plan',
    (select count(distinct m) from public.plans, unnest(modules) m) >= 10
)
select area, name, case when ok then 'PASS' else 'FAIL' end as result from checks
order by ok, area, name;
