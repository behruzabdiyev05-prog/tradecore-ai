-- Rollback of 20261124001500_supplier_offers.sql
-- WARNING (Y14): deletes every supplier offer and its price history. Test environment only, or export first.
-- The audit log is not touched. Run after the 0016–0017 rollbacks.
drop table if exists public.supplier_offer_prices;
drop table if exists public.supplier_offers;
