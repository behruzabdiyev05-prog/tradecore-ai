-- Rollback of 20261124001300_notifications_dedupe.sql
-- Removes the de-duplication column, its index and the two helper functions.
-- Existing notifications are NOT deleted (the table belongs to Phase 2B); only their dedupe keys are dropped.
drop function if exists public.notify_marketplace(uuid, text, text, text, text, text, text, jsonb, text);
drop function if exists public.notify_once(uuid, uuid, text, text, text, text, text, text, jsonb, text);
drop index if exists public.notifications_dedupe_uq;
alter table public.notifications drop column if exists dedupe_key;
