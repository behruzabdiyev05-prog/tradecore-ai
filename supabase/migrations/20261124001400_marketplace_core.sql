-- ═════════════════════════════════════════════════════════════
-- TRADECORE AI · Migration 0014 · İ-3 (Modul 03 · Marketplace) — core tables
--  İ-2 design §2.1–2.5, §2.9, §10:
--   • marketplace_listings      — marketplace part of a central products row (1:1)
--   • marketplace_variants      — Shopify variants
--   • marketplace_orders        — order header (Q1)
--   • marketplace_order_lines   — frozen financial line (D1), with its own frozen rate (parity finding Y17)
--   • marketplace_settings      — one row per organization
--   • marketplace_calc_prefs    — calculator parameters per user (Y3)
--  Every table: org_id NOT NULL, RLS (membership + permission + plan + 2FA through the
--  existing helpers), the existing a_set_org / a_guard_owner / b_same_org / audit triggers.
--  Money: *_minor bigint in AZN qəpik. No change to public.products or any other existing table.
--  user_id = creator, deliberately WITHOUT a foreign key to auth.users (Y16): deleting a user
--  must never delete an organization's orders (same approach as audit_log.actor_id).
-- Rollback: supabase/rollback/20261124001400_marketplace_core.down.sql
-- ═════════════════════════════════════════════════════════════

-- ── 1. Tables ────────────────────────────────────────────────
create table public.marketplace_listings (
  id                   uuid primary key default gen_random_uuid(),
  org_id               uuid not null references public.organizations (id) on delete cascade,
  user_id              uuid not null default auth.uid(),
  product_id           uuid not null references public.products (id) on delete restrict,
  channel              text not null default 'manual' check (channel in ('manual', 'shopify')),
  external_id          text check (external_id is null or length(external_id) between 1 and 200),
  admin_url            text check (admin_url is null or admin_url ~ '^https://[a-z0-9][a-z0-9-]*\.myshopify\.com/admin/products/[0-9]+$'),
  image_url            text check (image_url is null or (length(image_url) <= 2000 and image_url ~ '^https://cdn\.shopify\.com/[^[:space:]]*$')),
  supplier_name        text check (supplier_name is null or length(supplier_name) <= 200),
  supplier_url         text check (supplier_url is null or (length(supplier_url) <= 2000 and supplier_url ~* '^https?://[^[:space:]]+$')),
  purchase_azn_minor   bigint not null default 0 check (purchase_azn_minor >= 0),
  shipping_azn_minor   bigint not null default 0 check (shipping_azn_minor >= 0),
  other_azn_minor      bigint not null default 0 check (other_azn_minor >= 0),
  sale_azn_minor       bigint not null default 0 check (sale_azn_minor >= 0),
  stock                integer not null default 0 check (stock >= 0),
  status               text not null default 'active' check (status in ('active', 'out_of_stock', 'draft')),
  low_stock_threshold  integer check (low_stock_threshold is null or low_stock_threshold >= 0),
  variant_count        integer not null default 0 check (variant_count >= 0),
  inventory_item_id    text check (inventory_item_id is null or length(inventory_item_id) <= 200),
  location_id          text check (location_id is null or length(location_id) <= 200),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint marketplace_listings_product_uq unique (product_id),
  constraint marketplace_listings_channel_id check ((channel = 'shopify') = (external_id is not null))
);
create unique index marketplace_listings_external_uq on public.marketplace_listings (org_id, channel, external_id) where external_id is not null;
create index marketplace_listings_org_status_idx on public.marketplace_listings (org_id, status);
create index marketplace_listings_inventory_idx on public.marketplace_listings (org_id, inventory_item_id) where inventory_item_id is not null;

create table public.marketplace_variants (
  id                   uuid primary key default gen_random_uuid(),
  org_id               uuid not null references public.organizations (id) on delete cascade,
  user_id              uuid not null default auth.uid(),
  listing_id           uuid not null references public.marketplace_listings (id) on delete cascade,
  external_id          text not null check (length(external_id) between 1 and 200),
  title                text check (title is null or length(title) <= 300),
  sku                  text check (sku is null or length(sku) <= 200),
  position             integer not null default 1,
  price_azn_minor      bigint not null default 0 check (price_azn_minor >= 0),
  purchase_azn_minor   bigint not null default 0 check (purchase_azn_minor >= 0),
  shipping_azn_minor   bigint not null default 0 check (shipping_azn_minor >= 0),
  other_azn_minor      bigint not null default 0 check (other_azn_minor >= 0),
  stock                integer not null default 0 check (stock >= 0),
  inventory_item_id    text check (inventory_item_id is null or length(inventory_item_id) <= 200),
  location_id          text check (location_id is null or length(location_id) <= 200),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint marketplace_variants_external_uq unique (org_id, external_id)
);
create index marketplace_variants_listing_idx on public.marketplace_variants (listing_id);
create index marketplace_variants_inventory_idx on public.marketplace_variants (org_id, inventory_item_id) where inventory_item_id is not null;

create table public.marketplace_orders (
  id                    uuid primary key default gen_random_uuid(),
  org_id                uuid not null references public.organizations (id) on delete cascade,
  user_id               uuid not null default auth.uid(),
  channel               text not null default 'manual' check (channel in ('manual', 'shopify')),
  order_number          text not null check (length(trim(order_number)) between 1 and 100),
  external_id           text check (external_id is null or length(external_id) between 1 and 200),
  customer_name         text not null check (length(trim(customer_name)) between 1 and 200),
  customer_email        text check (customer_email is null or length(customer_email) <= 320),
  currency              char(3) not null default 'AZN' references public.currencies (code),
  fx_rate_to_base       numeric(18,8) not null default 1 check (fx_rate_to_base > 0),
  presentment_currency  text check (presentment_currency is null or presentment_currency ~ '^[A-Z]{3}$'),
  status                text not null default 'processing' check (status in ('processing', 'transit', 'complete', 'problem')),
  financial_status      text check (financial_status is null or length(financial_status) <= 40),
  fulfillment_status    text check (fulfillment_status is null or length(fulfillment_status) <= 40),
  tracking_number       text check (tracking_number is null or length(tracking_number) <= 100),
  carrier               text check (carrier is null or length(carrier) <= 60),
  shipped_at            timestamptz,
  delivered_at          timestamptz,
  shopify_fulfilled_at  timestamptz,
  note                  text check (note is null or length(note) <= 2000),
  placed_at             timestamptz not null default now(),
  financials_locked_at  timestamptz,
  archived_at           timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint marketplace_orders_channel_id check ((channel = 'shopify') = (external_id is not null)),
  constraint marketplace_orders_azn_rate check (currency <> 'AZN' or fx_rate_to_base = 1)
);
create unique index marketplace_orders_external_uq on public.marketplace_orders (org_id, external_id) where external_id is not null;
create unique index marketplace_orders_manual_number_uq on public.marketplace_orders (org_id, order_number) where channel = 'manual';   -- D7
create index marketplace_orders_placed_idx on public.marketplace_orders (org_id, placed_at desc);
create index marketplace_orders_status_idx on public.marketplace_orders (org_id, status) where archived_at is null;

create table public.marketplace_order_lines (
  id                          uuid primary key default gen_random_uuid(),
  org_id                      uuid not null references public.organizations (id) on delete cascade,
  user_id                     uuid not null default auth.uid(),
  order_id                    uuid not null references public.marketplace_orders (id) on delete cascade,
  external_id                 text check (external_id is null or length(external_id) between 1 and 200),
  listing_id                  uuid references public.marketplace_listings (id) on delete restrict,   -- D6
  variant_id                  uuid references public.marketplace_variants (id) on delete set null,
  shopify_variant_id          text check (shopify_variant_id is null or length(shopify_variant_id) <= 200),
  line_title                  text check (line_title is null or length(line_title) <= 500),
  quantity                    integer not null default 1 check (quantity > 0),
  -- rate frozen when THIS line was first imported (a line added to the order later keeps its own rate;
  -- DropPilot froze per line). Refunds are converted with it. Manual lines: AZN, 1.
  fx_rate_to_base             numeric(18,8) not null default 1 check (fx_rate_to_base > 0),
  sale_azn_minor              bigint not null default 0 check (sale_azn_minor >= 0),
  shipping_income_azn_minor   bigint not null default 0 check (shipping_income_azn_minor >= 0),
  tax_azn_minor               bigint not null default 0 check (tax_azn_minor >= 0),
  discount_azn_minor          bigint not null default 0 check (discount_azn_minor >= 0),
  fee_azn_minor               bigint not null default 0 check (fee_azn_minor >= 0),
  refund_azn_minor            bigint not null default 0 check (refund_azn_minor >= 0),
  cost_azn_minor              bigint not null default 0 check (cost_azn_minor >= 0),
  cost_missing                boolean not null default false,
  supplier_order_number       text check (supplier_order_number is null or length(supplier_order_number) <= 100),
  supplier_order_status       text not null default 'not_ordered'
                              check (supplier_order_status in ('not_ordered', 'ordered', 'shipped', 'delivered', 'problem')),
  supplier_ordered_at         timestamptz,
  supplier_paid_azn_minor     bigint check (supplier_paid_azn_minor is null or supplier_paid_azn_minor >= 0),
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now()
);
create unique index marketplace_order_lines_external_uq on public.marketplace_order_lines (org_id, external_id) where external_id is not null;
create index marketplace_order_lines_order_idx on public.marketplace_order_lines (order_id);
create index marketplace_order_lines_listing_idx on public.marketplace_order_lines (org_id, listing_id);
create index marketplace_order_lines_supplier_idx on public.marketplace_order_lines (org_id, supplier_order_status);

create table public.marketplace_settings (
  org_id                       uuid primary key references public.organizations (id) on delete cascade,
  user_id                      uuid not null default auth.uid(),                 -- creator (Y2)
  payment_fee_percent          numeric(6,3) not null default 2.9 check (payment_fee_percent >= 0 and payment_fee_percent < 100),
  payment_fee_fixed_azn_minor  bigint not null default 0 check (payment_fee_fixed_azn_minor >= 0),
  low_stock_threshold          integer not null default 5 check (low_stock_threshold >= 0),
  updated_by                   uuid default auth.uid(),
  created_at                   timestamptz not null default now(),
  updated_at                   timestamptz not null default now()
);

create table public.marketplace_calc_prefs (
  org_id         uuid not null references public.organizations (id) on delete cascade,
  user_id        uuid not null default auth.uid(),
  calc_settings  jsonb not null default '{}'::jsonb
                 check (jsonb_typeof(calc_settings) = 'object' and octet_length(calc_settings::text) <= 4096),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  primary key (org_id, user_id)
);

-- ── 2. Existing TRADECORE triggers (reused, not redefined) ──
do $$
declare t text;
begin
  foreach t in array array['marketplace_listings','marketplace_variants','marketplace_orders','marketplace_order_lines',
                           'marketplace_settings','marketplace_calc_prefs'] loop
    execute format('create trigger a_set_org before insert on public.%I for each row execute function public.set_row_org()', t);
    execute format('create trigger a_guard_owner before update on public.%I for each row execute function public.guard_row_owner()', t);
    execute format('create trigger %I before update on public.%I for each row execute function public.set_updated_at()', t || '_updated_at', t);
  end loop;
  -- audit: everything except the personal calculator preferences (İ-2 §10 matrix)
  foreach t in array array['marketplace_listings','marketplace_variants','marketplace_orders','marketplace_order_lines','marketplace_settings'] loop
    execute format('create trigger audit after insert or update or delete on public.%I for each row execute function public.audit_row()', t);
  end loop;
end $$;
create trigger b_same_org before insert or update on public.marketplace_listings
  for each row execute function public.check_same_org('product_id', 'products');
create trigger b_same_org before insert or update on public.marketplace_variants
  for each row execute function public.check_same_org('listing_id', 'marketplace_listings');
create trigger b_same_org before insert or update on public.marketplace_order_lines
  for each row execute function public.check_same_org('order_id', 'marketplace_orders', 'listing_id', 'marketplace_listings',
                                                      'variant_id', 'marketplace_variants');

-- ── 3. Guards: what a browser session may never change (D1, Y4, Y5) ──
-- A browser request runs as the `authenticated` role. The server functions run as their owner
-- (SECURITY DEFINER) and the server key as `service_role`; both pass. This cannot be forged
-- from the browser (no session flag to set).
create function public.marketplace_guard_listing()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if current_user not in ('authenticated', 'anon') then return new; end if;
  if new.channel is distinct from old.channel or new.external_id is distinct from old.external_id
     or new.product_id is distinct from old.product_id then
    raise exception 'Shopify identifikatorları və məhsul bağlantısı dəyişdirilə bilməz' using errcode = 'insufficient_privilege';
  end if;
  if old.channel = 'shopify' and (new.admin_url is distinct from old.admin_url
       or new.inventory_item_id is distinct from old.inventory_item_id or new.location_id is distinct from old.location_id
       or new.variant_count is distinct from old.variant_count) then
    raise exception 'Shopify-dan gələn sahələr dəyişdirilə bilməz' using errcode = 'insufficient_privilege';
  end if;
  return new;
end $$;

create function public.marketplace_guard_variant()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if current_user not in ('authenticated', 'anon') then return new; end if;
  if new.listing_id is distinct from old.listing_id or new.external_id is distinct from old.external_id
     or new.inventory_item_id is distinct from old.inventory_item_id or new.location_id is distinct from old.location_id then
    raise exception 'Shopify variant identifikatorları dəyişdirilə bilməz' using errcode = 'insufficient_privilege';
  end if;
  return new;
end $$;

create function public.marketplace_guard_order()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if current_user not in ('authenticated', 'anon') then return new; end if;
  if new.channel is distinct from old.channel or new.external_id is distinct from old.external_id
     or new.currency is distinct from old.currency or new.fx_rate_to_base is distinct from old.fx_rate_to_base
     or new.placed_at is distinct from old.placed_at or new.financials_locked_at is distinct from old.financials_locked_at then
    raise exception 'Sifarişin valyutası, məzənnəsi, tarixi və mənbəyi dəyişdirilə bilməz' using errcode = 'insufficient_privilege';
  end if;
  if old.channel = 'shopify' and (new.order_number is distinct from old.order_number
       or new.customer_name is distinct from old.customer_name or new.customer_email is distinct from old.customer_email
       or new.financial_status is distinct from old.financial_status or new.fulfillment_status is distinct from old.fulfillment_status
       or new.presentment_currency is distinct from old.presentment_currency) then
    raise exception 'Shopify sifarişinin bu sahələri yalnız Shopify-dan yenilənir' using errcode = 'insufficient_privilege';
  end if;
  return new;
end $$;

create function public.marketplace_guard_line()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if current_user not in ('authenticated', 'anon') then return new; end if;
  if new.order_id is distinct from old.order_id or new.external_id is distinct from old.external_id
     or new.shopify_variant_id is distinct from old.shopify_variant_id then
    raise exception 'Sifariş sətrinin bağlantıları dəyişdirilə bilməz' using errcode = 'insufficient_privilege';
  end if;
  -- Shopify lines carry an external id; manual lines do not (D1: manual lines stay editable)
  if old.external_id is not null and (
       new.sale_azn_minor is distinct from old.sale_azn_minor or new.shipping_income_azn_minor is distinct from old.shipping_income_azn_minor
       or new.tax_azn_minor is distinct from old.tax_azn_minor or new.discount_azn_minor is distinct from old.discount_azn_minor
       or new.fee_azn_minor is distinct from old.fee_azn_minor or new.refund_azn_minor is distinct from old.refund_azn_minor
       or new.cost_azn_minor is distinct from old.cost_azn_minor or new.cost_missing is distinct from old.cost_missing
       or new.quantity is distinct from old.quantity or new.fx_rate_to_base is distinct from old.fx_rate_to_base
       or new.listing_id is distinct from old.listing_id
       or new.variant_id is distinct from old.variant_id or new.line_title is distinct from old.line_title) then
    raise exception 'Shopify sifarişinin maliyyə rəqəmləri dəyişdirilə bilməz' using errcode = 'insufficient_privilege';
  end if;
  return new;
end $$;

-- Records who last changed the organization settings (not settable by the client).
create function public.marketplace_settings_touch()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  new.updated_by := coalesce(auth.uid(), case when tg_op = 'UPDATE' then old.updated_by end, new.user_id);
  return new;
end $$;

-- "b_guard_*" runs after the a_* triggers and before b_same_org (BEFORE triggers fire in name order)
create trigger b_guard before update on public.marketplace_listings    for each row execute function public.marketplace_guard_listing();
create trigger b_guard before update on public.marketplace_variants    for each row execute function public.marketplace_guard_variant();
create trigger b_guard before update on public.marketplace_orders      for each row execute function public.marketplace_guard_order();
create trigger b_guard before update on public.marketplace_order_lines for each row execute function public.marketplace_guard_line();
create trigger b_touch before insert or update on public.marketplace_settings for each row execute function public.marketplace_settings_touch();

-- ── 4. Row Level Security ────────────────────────────────────
alter table public.marketplace_listings    enable row level security;
alter table public.marketplace_variants    enable row level security;
alter table public.marketplace_orders      enable row level security;
alter table public.marketplace_order_lines enable row level security;
alter table public.marketplace_settings    enable row level security;
alter table public.marketplace_calc_prefs  enable row level security;

-- Module data: data.* permission + module.marketplace.* (plan + 2FA inside the helpers)
create policy "mp read" on public.marketplace_listings for select to authenticated
  using (org_id in (select public.org_ids_with('data.read')) and (org_id, 'marketplace'::text) in (select * from public.org_module_access('read')));
create policy "mp insert manual" on public.marketplace_listings for insert to authenticated
  with check (org_id in (select public.org_ids_with('data.write')) and (org_id, 'marketplace'::text) in (select * from public.org_module_access('write'))
              and user_id = auth.uid() and channel = 'manual');                                              -- Y4
create policy "mp update" on public.marketplace_listings for update to authenticated
  using (org_id in (select public.org_ids_with('data.write')) and (org_id, 'marketplace'::text) in (select * from public.org_module_access('write')))
  with check (org_id in (select public.org_ids_with('data.write')) and (org_id, 'marketplace'::text) in (select * from public.org_module_access('write')));
create policy "mp delete" on public.marketplace_listings for delete to authenticated
  using (org_id in (select public.org_ids_with('data.write')) and (org_id, 'marketplace'::text) in (select * from public.org_module_access('write')));

create policy "mp read" on public.marketplace_variants for select to authenticated
  using (org_id in (select public.org_ids_with('data.read')) and (org_id, 'marketplace'::text) in (select * from public.org_module_access('read')));
create policy "mp update" on public.marketplace_variants for update to authenticated
  using (org_id in (select public.org_ids_with('data.write')) and (org_id, 'marketplace'::text) in (select * from public.org_module_access('write')))
  with check (org_id in (select public.org_ids_with('data.write')) and (org_id, 'marketplace'::text) in (select * from public.org_module_access('write')));
-- variants: no insert/delete for clients (created by the Shopify import only)

create policy "mp read" on public.marketplace_orders for select to authenticated
  using (org_id in (select public.org_ids_with('data.read')) and (org_id, 'marketplace'::text) in (select * from public.org_module_access('read')));
create policy "mp update" on public.marketplace_orders for update to authenticated
  using (org_id in (select public.org_ids_with('data.write')) and (org_id, 'marketplace'::text) in (select * from public.org_module_access('write')))
  with check (org_id in (select public.org_ids_with('data.write')) and (org_id, 'marketplace'::text) in (select * from public.org_module_access('write')));
create policy "mp delete manual" on public.marketplace_orders for delete to authenticated                      -- D2
  using (channel = 'manual' and org_id in (select public.org_ids_with('data.write'))
         and (org_id, 'marketplace'::text) in (select * from public.org_module_access('write')));
-- orders: no insert policy — manual orders only through marketplace_create_manual_order() (D4)

create policy "mp read" on public.marketplace_order_lines for select to authenticated
  using (org_id in (select public.org_ids_with('data.read')) and (org_id, 'marketplace'::text) in (select * from public.org_module_access('read')));
create policy "mp update" on public.marketplace_order_lines for update to authenticated
  using (org_id in (select public.org_ids_with('data.write')) and (org_id, 'marketplace'::text) in (select * from public.org_module_access('write')))
  with check (org_id in (select public.org_ids_with('data.write')) and (org_id, 'marketplace'::text) in (select * from public.org_module_access('write')));
-- lines: no insert/delete for clients (function / cascade only)

create policy "mp read" on public.marketplace_settings for select to authenticated
  using ((org_id, 'marketplace'::text) in (select * from public.org_module_access('read')));
create policy "mp insert" on public.marketplace_settings for insert to authenticated
  with check (org_id in (select public.org_ids_with('integrations.manage')) and user_id = auth.uid()
              and (org_id, 'marketplace'::text) in (select * from public.org_module_access('read')));
create policy "mp update" on public.marketplace_settings for update to authenticated
  using (org_id in (select public.org_ids_with('integrations.manage')) and (org_id, 'marketplace'::text) in (select * from public.org_module_access('read')))
  with check (org_id in (select public.org_ids_with('integrations.manage')) and (org_id, 'marketplace'::text) in (select * from public.org_module_access('read')));

create policy "own calc prefs" on public.marketplace_calc_prefs for all to authenticated
  using (user_id = auth.uid() and (org_id, 'marketplace'::text) in (select * from public.org_module_access('read')))
  with check (user_id = auth.uid() and (org_id, 'marketplace'::text) in (select * from public.org_module_access('read')));

-- ── 5. Privileges ────────────────────────────────────────────
revoke all on public.marketplace_listings, public.marketplace_variants, public.marketplace_orders,
              public.marketplace_order_lines, public.marketplace_settings, public.marketplace_calc_prefs
  from public, anon;
revoke truncate, references, trigger on public.marketplace_listings, public.marketplace_variants, public.marketplace_orders,
              public.marketplace_order_lines, public.marketplace_settings, public.marketplace_calc_prefs
  from authenticated;
-- defence in depth: no client path exists for these writes
revoke insert, delete on public.marketplace_variants from authenticated;
revoke insert on public.marketplace_orders from authenticated;
revoke insert, delete on public.marketplace_order_lines from authenticated;
revoke delete on public.marketplace_settings from authenticated;

revoke all on function public.marketplace_guard_listing(), public.marketplace_guard_variant(), public.marketplace_guard_order(),
                       public.marketplace_guard_line(), public.marketplace_settings_touch()
  from public, anon, authenticated;
