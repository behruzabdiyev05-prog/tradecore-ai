-- ═════════════════════════════════════════════════════════════
-- TRADECORE AI · Migration 0004 · ARES + integrations
-- ═════════════════════════════════════════════════════════════

-- ── ARES conversations ───────────────────────────────────────
-- module_key NULL = central ARES; otherwise the module-local assistant.
-- Both use the same central ARES backend (one intelligence layer).
create table public.ares_conversations (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  module_key  text references public.modules (key),
  title       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index ares_conv_user_idx on public.ares_conversations (user_id, updated_at desc);
create trigger ares_conversations_updated_at before update on public.ares_conversations
  for each row execute function public.set_updated_at();

create table public.ares_messages (
  id               bigint generated always as identity primary key,
  conversation_id  uuid not null references public.ares_conversations (id) on delete cascade,
  user_id          uuid not null default auth.uid() references auth.users (id) on delete cascade,
  role             text not null check (role in ('user', 'assistant', 'system')),
  content          text not null,
  module_key       text references public.modules (key),
  metadata         jsonb not null default '{}'::jsonb,   -- provider, model, sources, data_quality
  created_at       timestamptz not null default now()
);
create index ares_msg_conv_idx on public.ares_messages (conversation_id, id);

-- ── Integrations: connection status & NON-secret configuration ──
-- API credentials are NEVER stored here; they live in server-side
-- environment variables (Netlify) or Supabase Vault.
create table public.integrations (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null default auth.uid() references auth.users (id) on delete cascade,
  provider        text not null,       -- 'alibaba', 'amazon', 'ebay', 'shopify', 'market-data', …
  status          text not null default 'not_connected'
                  check (status in ('not_connected','connected','error','disabled')),
  config          jsonb not null default '{}'::jsonb,
  sync_status     text not null default 'idle' check (sync_status in ('idle','syncing','ok','failed')),
  last_sync_at    timestamptz,
  last_error      text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (user_id, provider),
  constraint config_has_no_secrets check (
    not (config ?| array['api_key','apiKey','secret','client_secret','password','token','access_token'])
  )
);
create trigger integrations_updated_at before update on public.integrations
  for each row execute function public.set_updated_at();

alter table public.ares_conversations enable row level security;
alter table public.ares_messages      enable row level security;
alter table public.integrations       enable row level security;

create policy "own ares conversations" on public.ares_conversations for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own ares messages" on public.ares_messages for all to authenticated
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and exists (select 1 from public.ares_conversations c
                where c.id = conversation_id and c.user_id = auth.uid())
  );
create policy "own integrations" on public.integrations for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

grant select, insert, update, delete on public.ares_conversations, public.ares_messages, public.integrations to authenticated;
