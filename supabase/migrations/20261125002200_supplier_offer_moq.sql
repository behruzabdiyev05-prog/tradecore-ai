-- ═════════════════════════════════════════════════════════════
-- TRADECORE AI · Phase 3 · 0022 — Minimum order quantity on supplier offers (Module 02)
-- Additive only: one nullable column on the shared `supplier_offers` table (İ-3).
-- Existing rows and İ-3 rules are unchanged.
-- ═════════════════════════════════════════════════════════════
alter table public.supplier_offers
  add column min_order_qty integer check (min_order_qty is null or min_order_qty between 1 and 100000000);
