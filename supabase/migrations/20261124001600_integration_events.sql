-- ═════════════════════════════════════════════════════════════
-- TRADECORE AI · Migration 0016 · İ-3 — integration event journal (shared)
--  İ-2 design §2.8, §3, D3, Y1:
--   • integration_events — every webhook delivery stored once (provider + external id), retried, then purged:
--     after 30 days only the payload (addresses, phones, IPs) is removed; date, topic and status stay (D3).
--     Deliberately NO audit trigger: the payload must never be copied into audit_log (Y1).
--   • integrations: unique Shopify shop domain, so one shop can belong to only one organization (approved §3)
--  Clients may only read the journal, and only with integrations.manage. Writes: server functions (0017).
-- Rollback: supabase/rollback/20261124001600_integration_events.down.sql
-- ═════════════════════════════════════════════════════════════

create unique index integrations_shopify_shop_uq on public.integrations (lower(config ->> 'shop_domain'))
  where provider = 'shopify';

create table public.integration_events (
  id                 bigint generated always as identity primary key,
  org_id             uuid not null references public.organizations (id) on delete cascade,
  user_id            uuid not null,                      -- the member who connected the shop (Y6)
  integration_id     uuid not null references public.integrations (id) on delete cascade,
  provider           text not null check (provider ~ '^[a-z][a-z0-9-]{1,30}$'),
  external_id        text not null check (length(external_id) between 1 and 200),
  topic              text not null check (length(topic) between 1 and 100),
  shop_domain        text not null check (length(shop_domain) between 1 and 255),
  payload            jsonb check (payload is null or octet_length(payload::text) <= 1048576),
  payload_sha256     text check (payload_sha256 is null or payload_sha256 ~ '^[0-9a-f]{64}$'),
  status             text not null default 'received' check (status in ('received', 'processing', 'processed', 'failed', 'ignored')),
  attempts           integer not null default 0 check (attempts between 0 and 5),
  last_error         text check (last_error is null or length(last_error) <= 1000),
  received_at        timestamptz not null default now(),
  last_attempt_at    timestamptz,
  processed_at       timestamptz,
  next_retry_at      timestamptz,
  payload_purged_at  timestamptz,
  constraint integration_events_external_uq unique (provider, external_id)
);
create index integration_events_retry_idx on public.integration_events (status, next_retry_at);
create index integration_events_org_idx on public.integration_events (org_id, received_at desc);

create trigger a_guard_owner before update on public.integration_events for each row execute function public.guard_row_owner();
create trigger b_same_org before insert on public.integration_events
  for each row execute function public.check_same_org('integration_id', 'integrations');

alter table public.integration_events enable row level security;
create policy "integrations journal" on public.integration_events for select to authenticated
  using (org_id in (select public.org_ids_with('integrations.manage')));

revoke all on public.integration_events from public, anon;
revoke insert, update, delete, truncate, references, trigger on public.integration_events from authenticated;
