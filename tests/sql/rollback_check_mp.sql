-- İ-3 rollback cycle checks (run with -v phase=after_up|after_down|after_reup).
\set ON_ERROR_STOP on
select set_config('test.phase', :'phase', false);
do $$
declare
  phase text := current_setting('test.phase');
  t text;
  has_mp boolean;
begin
  -- Phase 2B data of the rollback-test users is untouched in every phase (the audit log only grows)
  if (select row(x.*)::text from rbmp.snapshot() x) <> (select row(b.*)::text from rbmp.baseline b) then
    raise exception '[%] Phase 2B data changed: % vs baseline %', phase,
      (select row(x.*)::text from rbmp.snapshot() x), (select row(b.*)::text from rbmp.baseline b);
  end if;

  has_mp := to_regclass('public.marketplace_listings') is not null;
  if phase = 'after_down' then
    foreach t in array array['marketplace_listings','marketplace_variants','marketplace_orders','marketplace_order_lines',
                             'marketplace_settings','marketplace_calc_prefs','supplier_offers','supplier_offer_prices','integration_events'] loop
      if to_regclass('public.' || t) is not null then raise exception '[%] table % still exists', phase, t; end if;
    end loop;
    if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'notifications'
               and column_name = 'dedupe_key') then raise exception '[%] notifications.dedupe_key still exists', phase; end if;
    if to_regclass('public.integrations_shopify_shop_uq') is not null then raise exception '[%] integrations index still exists', phase; end if;
    if to_regprocedure('public.notify_once(uuid, uuid, text, text, text, text, text, text, jsonb, text)') is not null
       or to_regprocedure('public.marketplace_upsert_catalog(uuid, uuid, jsonb)') is not null then
      raise exception '[%] Modul 03 functions still exist', phase; end if;
    -- documented behaviour: catalog rows created by Modul 03 stay in `products` (central catalog), the integration row too
    if (select count(*) from public.products where name = 'RB Shopify məhsul') <> 1 then
      raise exception '[%] central catalog row should be kept by the rollback', phase; end if;
    -- the notifications created through notify_once stay (the table belongs to 2B)
    if (select count(*) from public.notifications where type = 'marketplace.seed') <> 1 then
      raise exception '[%] existing notifications must not be deleted by the rollback', phase; end if;
  else
    if not has_mp then raise exception '[%] Modul 03 tables missing', phase; end if;
    if phase = 'after_up' then
      if (select count(*) from public.marketplace_listings) <> 1 then raise exception '[%] listing seed missing', phase; end if;
      if (select count(*) from public.marketplace_order_lines) <> 1 then raise exception '[%] order seed missing', phase; end if;
      if (select count(*) from public.supplier_offer_prices) <> 2 then raise exception '[%] price history seed missing', phase; end if;
      if (select count(*) from public.integration_events) <> 1 then raise exception '[%] event seed missing', phase; end if;
      if (select count(*) from public.notifications where dedupe_key = 'rb:1') <> 1 then raise exception '[%] dedupe seed missing', phase; end if;
      if (select payment_fee_percent from public.marketplace_settings limit 1) <> 3.1 then raise exception '[%] settings seed missing', phase; end if;
    end if;
    if phase = 'after_reup' then
      if (select count(*) from public.marketplace_listings) <> 0 or (select count(*) from public.integration_events) <> 0 then
        raise exception '[%] Modul 03 data should be gone after down → up', phase; end if;
    end if;
  end if;
  raise notice '[%] OK — Phase 2B data intact', phase;
end $$;

-- Isolation in every phase: RB MP One sees only their own company
set role authenticated;
select set_config('request.jwt.claim.sub', '91000000-0000-0000-0000-000000000001', false);
do $$ begin
  if (select count(*) from public.companies where name like 'RB MP Co %') <> 1 then
    raise exception '[%] isolation broken', current_setting('test.phase');
  end if;
end $$;
reset role;
select format('%s: data intact, isolation OK', current_setting('test.phase')) as result;
