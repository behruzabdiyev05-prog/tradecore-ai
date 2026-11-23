-- ═════════════════════════════════════════════════════════════
-- TRADECORE AI · Migration 0002 · Shared data layer
-- Entities used by several modules + the cross-module exchange bus.
-- Module-specific tables are added per module in Phase 3.
-- ═════════════════════════════════════════════════════════════

-- ── Companies: suppliers, customers, prospects (modules 02,05,06,09…) ──
create table public.companies (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null default auth.uid() references auth.users (id) on delete cascade,
  origin_module  text references public.modules (key),
  name           text not null check (length(trim(name)) > 0),
  legal_name     text,
  roles          text[] not null default '{}'
                 check (roles <@ array['supplier','customer','prospect','partner']::text[]),
  country_code   char(2),
  city           text,
  category       text,
  website        text,
  phone          text,
  email          text,
  address        text,
  social         jsonb not null default '{}'::jsonb,
  notes          text,
  -- provenance (no fabricated data: every record states its source)
  source         text,
  source_url     text,
  data_quality   public.data_quality not null default 'unverified',
  retrieved_at   timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index companies_user_idx on public.companies (user_id);
create index companies_user_city_cat_idx on public.companies (user_id, city, category);
create trigger companies_updated_at before update on public.companies
  for each row execute function public.set_updated_at();

-- ── Products: shared catalogue (modules 01–08) ───────────────
create table public.products (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null default auth.uid() references auth.users (id) on delete cascade,
  origin_module  text references public.modules (key),
  name           text not null check (length(trim(name)) > 0),
  sku            text,
  category       text,
  description    text,
  attributes     jsonb not null default '{}'::jsonb,
  supplier_id    uuid references public.companies (id) on delete set null,
  source         text,
  source_url     text,
  data_quality   public.data_quality not null default 'unverified',
  retrieved_at   timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index products_user_idx on public.products (user_id);
create trigger products_updated_at before update on public.products
  for each row execute function public.set_updated_at();

-- ── Saved items: research lists / opportunities across modules ──
-- Lets ARES answer "compare all my saved opportunities".
create table public.saved_items (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null default auth.uid() references auth.users (id) on delete cascade,
  module_key     text not null references public.modules (key),
  item_type      text not null check (item_type in
                   ('product','supplier','customer','opportunity','listing','asset','report','note')),
  title          text not null,
  data           jsonb not null default '{}'::jsonb,
  product_id     uuid references public.products (id) on delete set null,
  company_id     uuid references public.companies (id) on delete set null,
  score          numeric(5,2) check (score between 0 and 100),
  data_quality   public.data_quality not null default 'unverified',
  source         text,
  source_url     text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index saved_items_user_module_idx on public.saved_items (user_id, module_key);
create trigger saved_items_updated_at before update on public.saved_items
  for each row execute function public.set_updated_at();

-- ── Module events: cross-module data exchange bus ────────────
-- A module publishes an event (e.g. 'supplier.saved'); others may
-- subscribe (in-app or via Supabase Realtime). target_module NULL = broadcast.
create table public.module_events (
  id             bigint generated always as identity primary key,
  user_id        uuid not null default auth.uid() references auth.users (id) on delete cascade,
  source_module  text not null references public.modules (key),
  target_module  text references public.modules (key),
  event_type     text not null check (event_type ~ '^[a-z0-9_]+(\.[a-z0-9_]+)+$'),
  entity_type    text,
  entity_id      uuid,
  payload        jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now()
);
create index module_events_user_created_idx on public.module_events (user_id, created_at desc);
create index module_events_target_idx on public.module_events (user_id, target_module);

-- ── Activity log: historical record of user actions ──────────
create table public.activity_log (
  id          bigint generated always as identity primary key,
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  module_key  text references public.modules (key),
  action      text not null,
  entity_type text,
  entity_id   uuid,
  details     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index activity_log_user_created_idx on public.activity_log (user_id, created_at desc);

-- ── RLS: every row belongs to exactly one user ───────────────
alter table public.companies     enable row level security;
alter table public.products      enable row level security;
alter table public.saved_items   enable row level security;
alter table public.module_events enable row level security;
alter table public.activity_log  enable row level security;

create policy "own companies"   on public.companies   for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own products"    on public.products    for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own saved_items" on public.saved_items for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Events and activity are append-only history.
create policy "own events read"   on public.module_events for select to authenticated using (user_id = auth.uid());
create policy "own events insert" on public.module_events for insert to authenticated with check (user_id = auth.uid());
create policy "own activity read"   on public.activity_log for select to authenticated using (user_id = auth.uid());
create policy "own activity insert" on public.activity_log for insert to authenticated with check (user_id = auth.uid());

grant select, insert, update, delete on public.companies, public.products, public.saved_items to authenticated;
grant select, insert on public.module_events, public.activity_log to authenticated;
