-- ═════════════════════════════════════════════════════════════
-- TRADECORE AI · Migration 0015 · İ-3 — supplier offers (shared: Modul 03, later 02 / 05)
--  İ-2 design §2.6, §2.7:
--   • supplier_offers        — a supplier's offer for a central products row (optionally a Modul 03 variant)
--   • supplier_offer_prices  — append-only price history, written only by a trigger (0017)
--  Shared organization data: data.read / data.write (like products and companies), no module gate.
--  AZN amounts are GENERATED from the original currency × rate (cannot drift).
--  "At most one primary supplier per product / variant" is a partial unique index.
-- Rollback: supabase/rollback/20261124001500_supplier_offers.down.sql
-- ═════════════════════════════════════════════════════════════

create table public.supplier_offers (
  id                      uuid primary key default gen_random_uuid(),
  org_id                  uuid not null references public.organizations (id) on delete cascade,
  user_id                 uuid not null default auth.uid(),
  product_id              uuid not null references public.products (id) on delete cascade,
  marketplace_variant_id  uuid references public.marketplace_variants (id) on delete cascade,
  company_id              uuid references public.companies (id) on delete set null,
  supplier_name           text not null default 'AliExpress' check (length(trim(supplier_name)) between 1 and 200),
  origin_module           text not null default 'marketplace' references public.modules (key),
  url                     text check (url is null or (length(url) <= 2000 and url ~* '^https?://[^[:space:]]+$')),
  supplier_sku            text check (supplier_sku is null or length(supplier_sku) <= 200),
  currency                char(3) not null default 'AZN' references public.currencies (code),
  price_minor             bigint not null default 0 check (price_minor >= 0),
  shipping_minor          bigint not null default 0 check (shipping_minor >= 0),
  fx_rate_to_base         numeric(18,8) not null default 1 check (fx_rate_to_base > 0),
  price_azn_minor         bigint generated always as (round(price_minor * fx_rate_to_base)::bigint) stored,
  shipping_azn_minor      bigint generated always as (round(shipping_minor * fx_rate_to_base)::bigint) stored,
  delivery_min_days       integer check (delivery_min_days is null or delivery_min_days >= 0),
  delivery_max_days       integer check (delivery_max_days is null or delivery_max_days >= 0),
  supplier_stock          integer,
  notes                   text check (notes is null or length(notes) <= 2000),
  is_primary              boolean not null default false,
  last_checked_at         timestamptz not null default now(),
  source                  text not null default 'manual' check (length(source) <= 60),
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  constraint supplier_offers_days check (delivery_min_days is null or delivery_max_days is null or delivery_min_days <= delivery_max_days),
  constraint supplier_offers_azn_rate check (currency <> 'AZN' or fx_rate_to_base = 1)
);
create unique index supplier_offers_one_primary_uq on public.supplier_offers
  (org_id, product_id, coalesce(marketplace_variant_id, '00000000-0000-0000-0000-000000000000'::uuid)) where is_primary;
create index supplier_offers_product_idx on public.supplier_offers (org_id, product_id);

create table public.supplier_offer_prices (
  id                  bigint generated always as identity primary key,
  org_id              uuid not null references public.organizations (id) on delete cascade,
  offer_id            uuid not null references public.supplier_offers (id) on delete cascade,
  currency            char(3) not null references public.currencies (code),
  price_minor         bigint not null check (price_minor >= 0),
  shipping_minor      bigint not null check (shipping_minor >= 0),
  fx_rate_to_base     numeric(18,8) not null check (fx_rate_to_base > 0),
  price_azn_minor     bigint not null check (price_azn_minor >= 0),
  shipping_azn_minor  bigint not null check (shipping_azn_minor >= 0),
  recorded_at         timestamptz not null default now(),
  recorded_by         uuid
);
create index supplier_offer_prices_offer_idx on public.supplier_offer_prices (offer_id, recorded_at desc);

-- Existing TRADECORE triggers (İ-2 §10 matrix). supplier_offer_prices: no update path, no audit (it IS the history).
create trigger a_set_org before insert on public.supplier_offers for each row execute function public.set_row_org();
create trigger a_guard_owner before update on public.supplier_offers for each row execute function public.guard_row_owner();
create trigger b_same_org before insert or update on public.supplier_offers
  for each row execute function public.check_same_org('product_id', 'products', 'company_id', 'companies',
                                                      'marketplace_variant_id', 'marketplace_variants');
create trigger supplier_offers_updated_at before update on public.supplier_offers for each row execute function public.set_updated_at();
create trigger audit after insert or update or delete on public.supplier_offers for each row execute function public.audit_row();
create trigger b_same_org before insert on public.supplier_offer_prices
  for each row execute function public.check_same_org('offer_id', 'supplier_offers');

alter table public.supplier_offers       enable row level security;
alter table public.supplier_offer_prices enable row level security;

create policy "org read"   on public.supplier_offers for select to authenticated
  using (org_id in (select public.org_ids_with('data.read')));
create policy "org insert" on public.supplier_offers for insert to authenticated
  with check (org_id in (select public.org_ids_with('data.write')) and user_id = auth.uid());
create policy "org update" on public.supplier_offers for update to authenticated
  using (org_id in (select public.org_ids_with('data.write'))) with check (org_id in (select public.org_ids_with('data.write')));
create policy "org delete" on public.supplier_offers for delete to authenticated
  using (org_id in (select public.org_ids_with('data.write')));

create policy "org read" on public.supplier_offer_prices for select to authenticated
  using (org_id in (select public.org_ids_with('data.read')));

revoke all on public.supplier_offers, public.supplier_offer_prices from public, anon;
revoke truncate, references, trigger on public.supplier_offers, public.supplier_offer_prices from authenticated;
revoke insert, update, delete on public.supplier_offer_prices from authenticated;
