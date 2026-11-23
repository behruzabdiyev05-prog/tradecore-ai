-- Rollback of 20261124001400_marketplace_core.sql
-- WARNING (Y14): deletes every Modul 03 listing, variant, order, order line, setting and calculator
-- preference. Run it only in a test environment, or export the data first.
-- Kept on purpose: the audit log (history outlives deleted rows) and the central `products` rows
-- that the Modul 03 import created (they belong to the shared catalog; delete them manually if needed).
-- Run after the 0015–0017 rollbacks (supabase/rollback is applied newest first).
drop table if exists public.marketplace_order_lines;
drop table if exists public.marketplace_orders;
drop table if exists public.marketplace_variants;
drop table if exists public.marketplace_listings;
drop table if exists public.marketplace_settings;
drop table if exists public.marketplace_calc_prefs;
drop function if exists public.marketplace_guard_listing();
drop function if exists public.marketplace_guard_variant();
drop function if exists public.marketplace_guard_order();
drop function if exists public.marketplace_guard_line();
drop function if exists public.marketplace_settings_touch();
