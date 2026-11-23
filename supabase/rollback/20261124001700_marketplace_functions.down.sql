-- Rollback of 20261124001700_marketplace_functions.sql
-- Removes the Modul 03 functions and behaviour triggers. No data is deleted by this script
-- (tables are removed by the 0014–0016 rollbacks). The guards from 0014 stay until 0014 is rolled back.
drop trigger if exists supplier_offer_price_log on public.supplier_offers;
drop trigger if exists marketplace_low_stock on public.marketplace_listings;
drop trigger if exists marketplace_variant_rollup on public.marketplace_variants;
drop function if exists public.supplier_offer_price_log();
drop function if exists public.marketplace_low_stock();
drop function if exists public.marketplace_variant_rollup();
drop function if exists public.marketplace_delete_listing(uuid);
drop function if exists public.marketplace_store_status(uuid);
drop function if exists public.marketplace_history(text, uuid);
drop function if exists public.marketplace_create_manual_order(uuid, jsonb, jsonb);
drop function if exists public.integration_events_purge(integer);
drop function if exists public.integration_event_finish(bigint, text, text, timestamptz);
drop function if exists public.integration_event_store(text, text, text, text, jsonb, text);
drop function if exists public.marketplace_apply_inventory(uuid, uuid, text, text, integer);
drop function if exists public.marketplace_upsert_shopify_order(uuid, uuid, jsonb, jsonb);
drop function if exists public.marketplace_upsert_catalog(uuid, uuid, jsonb);
drop function if exists public._marketplace_integration(uuid, uuid);
drop function if exists public.marketplace_blocked_shop(text);
