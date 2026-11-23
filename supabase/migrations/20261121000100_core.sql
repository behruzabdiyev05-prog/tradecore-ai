-- ═════════════════════════════════════════════════════════════
-- TRADECORE AI · Migration 0001 · Core
-- profiles, module registry, currencies, shared helpers
-- ═════════════════════════════════════════════════════════════

-- Data provenance: every externally sourced value states how reliable it is.
create type public.data_quality as enum ('verified', 'estimated', 'unverified');

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ── Module registry (mirrors shared/modules.js) ──────────────
create table public.modules (
  key         text primary key,
  code        text not null unique,
  name        text not null,
  sort_order  smallint not null,
  is_enabled  boolean not null default true,
  created_at  timestamptz not null default now()
);

insert into public.modules (key, code, name, sort_order) values
  ('product-research',  '01', 'Məhsul Araşdırması',   1),
  ('wholesale',         '02', 'Topdan Ticarət',       2),
  ('marketplace',       '03', 'Marketplace Ticarəti', 3),
  ('arbitrage',         '04', 'Arbitraj Ticarəti',    4),
  ('import-export',     '05', 'İdxal və İxrac',       5),
  ('b2b-trading',       '06', 'B2B Ticarət',          6),
  ('used-goods',        '07', 'İşlənmiş Mallar',      7),
  ('digital-products',  '08', 'Rəqəmsal Məhsullar',   8),
  ('b2b-client-finder', '09', 'B2B Müştəri Axtarışı', 9),
  ('financial-trading', '10', 'Maliyyə Ticarəti',     10);

-- ── Currencies (mirrors shared/finance.js) ───────────────────
create table public.currencies (
  code         char(3) primary key,
  name         text not null,
  minor_units  smallint not null default 2,
  is_base      boolean not null default false
);

insert into public.currencies (code, name, is_base) values
  ('AZN', 'Azərbaycan manatı', true),
  ('USD', 'ABŞ dolları',       false),
  ('EUR', 'Avro',              false),
  ('TRY', 'Türk lirəsi',       false),
  ('CNY', 'Çin yuanı',         false),
  ('GBP', 'Britaniya funtu',   false);

-- ── Profiles (1:1 with auth.users) ───────────────────────────
create table public.profiles (
  id             uuid primary key references auth.users (id) on delete cascade,
  full_name      text,
  base_currency  char(3) not null default 'AZN' references public.currencies (code),
  locale         text not null default 'az',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

-- Auto-create a profile when a user signs up.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', null))
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── Row Level Security ───────────────────────────────────────
alter table public.modules    enable row level security;
alter table public.currencies enable row level security;
alter table public.profiles   enable row level security;

create policy "modules readable" on public.modules
  for select to authenticated using (true);
create policy "currencies readable" on public.currencies
  for select to authenticated using (true);

create policy "own profile select" on public.profiles
  for select to authenticated using (id = auth.uid());
create policy "own profile update" on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

grant select on public.modules, public.currencies to authenticated;
grant select, update on public.profiles to authenticated;
