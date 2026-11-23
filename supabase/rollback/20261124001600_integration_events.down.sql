-- Rollback of 20261124001600_integration_events.sql
-- WARNING (Y14): deletes the webhook journal. The `integrations` rows themselves are kept;
-- only the unique Shopify-domain index added by 0016 is removed. Run after the 0017 rollback.
drop table if exists public.integration_events;
drop index if exists public.integrations_shopify_shop_uq;
