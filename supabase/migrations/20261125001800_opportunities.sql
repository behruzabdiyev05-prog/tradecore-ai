-- ═════════════════════════════════════════════════════════════
-- TRADECORE AI · Phase 3 · 0018 — Trade opportunities (Modules 01, 04, 05, 07, 08)
--
-- One table for every "is this worth buying and reselling?" record, so the five
-- research-style modules share one structure (no duplicate tables):
--   01 product-research · 04 arbitrage · 05 import-export · 07 used-goods · 08 digital-products
-- Amounts are integer minor units. Costs are in `currency` (rate → AZN in fx_rate_to_base),
-- the sale price in `sell_currency` (rate in sell_fx_rate_to_base). Profit is computed by
-- shared/modules/opportunity.js (UI, ARES, tests) — never stored, so it cannot drift.
-- Data is entered by the user (manual); `data_quality` says whether a figure is verified.
-- Rules reused unchanged: set_row_org, guard_row_owner, set_updated_at, check_same_org, audit_row,
-- org_ids_with (role permission), org_module_access (plan + module permission + 2FA).
-- ═════════════════════════════════════════════════════════════

create table public.opportunities (
  id                     uuid primary key default gen_random_uuid(),
  org_id                 uuid not null references public.organizations (id) on delete cascade,
  user_id                uuid not null default auth.uid(),
  module_key             text not null references public.modules (key)
                         check (module_key in ('product-research', 'arbitrage', 'import-export', 'used-goods', 'digital-products')),
  title                  text not null check (length(trim(title)) between 1 and 300),
  product_id             uuid references public.products (id) on delete set null,
  company_id             uuid references public.companies (id) on delete set null,       -- supplier / seller
  category               text check (category is null or length(category) <= 200),
  status                 text not null default 'idea'
                         check (status in ('idea', 'researching', 'approved', 'rejected', 'done')),
  origin                 text check (origin is null or length(origin) <= 120),          -- where bought (country / platform / seller)
  target                 text check (target is null or length(target) <= 120),          -- where sold
  currency               char(3) not null default 'AZN' references public.currencies (code),
  fx_rate_to_base        numeric(18,8) not null default 1 check (fx_rate_to_base > 0),
  buy_price_minor        bigint not null default 0 check (buy_price_minor >= 0),
  shipping_minor         bigint not null default 0 check (shipping_minor >= 0),
  customs_minor          bigint not null default 0 check (customs_minor >= 0),          -- fixed customs / broker fees
  tax_minor              bigint not null default 0 check (tax_minor >= 0),              -- other fixed taxes
  repair_minor           bigint not null default 0 check (repair_minor >= 0),           -- used goods: repair / cleaning
  other_minor            bigint not null default 0 check (other_minor >= 0),
  duty_percent           numeric(6,3) not null default 0 check (duty_percent >= 0 and duty_percent < 100),
  import_vat_percent     numeric(6,3) not null default 0 check (import_vat_percent >= 0 and import_vat_percent < 100),
  sell_currency          char(3) not null default 'AZN' references public.currencies (code),
  sell_fx_rate_to_base   numeric(18,8) not null default 1 check (sell_fx_rate_to_base > 0),
  sell_price_minor       bigint not null default 0 check (sell_price_minor >= 0),
  fee_percent            numeric(6,3) not null default 0 check (fee_percent >= 0 and fee_percent < 100),   -- platform / marketplace commission
  fee_fixed_minor        bigint not null default 0 check (fee_fixed_minor >= 0),                           -- in sell_currency
  quantity               integer not null default 1 check (quantity between 1 and 10000000),
  demand_score           smallint check (demand_score between 1 and 5),
  competition_score      smallint check (competition_score between 1 and 5),
  risk_score             smallint check (risk_score between 1 and 5),
  condition              text check (condition is null or condition in ('new', 'like_new', 'good', 'fair', 'for_parts')),
  details                jsonb not null default '{}'::jsonb
                         check (jsonb_typeof(details) = 'object' and octet_length(details::text) <= 8192),
  source_url             text check (source_url is null or (length(source_url) <= 2000 and source_url ~* '^https?://[^[:space:]]+$')),
  data_quality           public.data_quality not null default 'unverified',
  notes                  text check (notes is null or length(notes) <= 4000),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint opportunities_azn_rate check (currency <> 'AZN' or fx_rate_to_base = 1),
  constraint opportunities_sell_azn_rate check (sell_currency <> 'AZN' or sell_fx_rate_to_base = 1)
);
create index opportunities_org_module_idx on public.opportunities (org_id, module_key, created_at desc);

create trigger a_set_org before insert on public.opportunities for each row execute function public.set_row_org();
create trigger a_guard_owner before update on public.opportunities for each row execute function public.guard_row_owner();
create trigger opportunities_updated_at before update on public.opportunities for each row execute function public.set_updated_at();
create trigger b_same_org before insert or update on public.opportunities
  for each row execute function public.check_same_org('product_id', 'products', 'company_id', 'companies');
create trigger audit after insert or update or delete on public.opportunities for each row execute function public.audit_row();

-- A record can never move to another module (the module decides who may see it).
create function public.opportunities_guard()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if new.module_key is distinct from old.module_key then
    raise exception 'Qeydin modulu dəyişdirilə bilməz' using errcode = 'insufficient_privilege';
  end if;
  return new;
end $$;
create trigger b_guard before update on public.opportunities for each row execute function public.opportunities_guard();
revoke all on function public.opportunities_guard() from public, anon, authenticated;

alter table public.opportunities enable row level security;
create policy "module read" on public.opportunities for select to authenticated
  using (org_id in (select public.org_ids_with('data.read')) and (org_id, module_key) in (select * from public.org_module_access('read')));
create policy "module insert" on public.opportunities for insert to authenticated
  with check (org_id in (select public.org_ids_with('data.write')) and user_id = auth.uid()
              and (org_id, module_key) in (select * from public.org_module_access('write')));
create policy "module update" on public.opportunities for update to authenticated
  using (org_id in (select public.org_ids_with('data.write')) and (org_id, module_key) in (select * from public.org_module_access('write')))
  with check (org_id in (select public.org_ids_with('data.write')) and (org_id, module_key) in (select * from public.org_module_access('write')));
create policy "module delete" on public.opportunities for delete to authenticated
  using (org_id in (select public.org_ids_with('data.write')) and (org_id, module_key) in (select * from public.org_module_access('write')));

revoke all on public.opportunities from public, anon;
grant select, insert, update, delete on public.opportunities to authenticated;
revoke truncate, references, trigger on public.opportunities from authenticated;
