-- Rollback of 20261125002200_supplier_offer_moq.sql
alter table public.supplier_offers drop column if exists min_order_qty;
