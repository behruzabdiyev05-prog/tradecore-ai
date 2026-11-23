-- ═════════════════════════════════════════════════════════════
-- TRADECORE AI · Migration 0003 · Central financial management
-- Definitions mirror shared/finance.js (verified by tests).
-- Money = bigint minor units. Base currency = AZN.
-- ═════════════════════════════════════════════════════════════

create type public.transaction_kind as enum (
  'sale',
  'purchase', 'shipping', 'customs',            -- cogs (landed cost)
  'commission', 'tax', 'operational', 'other_expense',  -- expenses
  'capital_in', 'capital_out'                   -- capital (cash flow only)
);

-- ── Exchange rates: AZN per 1 unit of currency ───────────────
-- No rates are seeded. Each rate records where it came from.
create table public.exchange_rates (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  currency      char(3) not null references public.currencies (code) check (currency <> 'AZN'),
  rate_to_base  numeric(18,8) not null check (rate_to_base > 0),
  rate_date     date not null,
  source        text not null,          -- e.g. 'manual', 'cbar.az'
  data_quality  public.data_quality not null default 'unverified',
  created_at    timestamptz not null default now(),
  unique (user_id, currency, rate_date, source)
);

-- ── Financial transactions (every module writes here) ────────
create table public.financial_transactions (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null default auth.uid() references auth.users (id) on delete cascade,
  module_key        text references public.modules (key),   -- NULL = general / company-wide
  kind              public.transaction_kind not null,
  amount_minor      bigint not null check (amount_minor > 0),
  currency          char(3) not null references public.currencies (code),
  fx_rate_to_base   numeric(18,8) not null default 1 check (fx_rate_to_base > 0),
  amount_base_minor bigint generated always as (round(amount_minor * fx_rate_to_base)::bigint) stored,
  occurred_on       date not null default current_date,
  description       text,
  counterparty_id   uuid references public.companies (id) on delete set null,
  product_id        uuid references public.products (id) on delete set null,
  reference         text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint azn_rate_is_one check (currency <> 'AZN' or fx_rate_to_base = 1)
);
create index fin_tx_user_module_date_idx on public.financial_transactions (user_id, module_key, occurred_on desc);
create trigger financial_transactions_updated_at before update on public.financial_transactions
  for each row execute function public.set_updated_at();

-- ── Summary view (per user, per module) ──────────────────────
-- security_invoker → caller's RLS applies; users only see their own rows.
create view public.finance_module_summary
with (security_invoker = true) as
select
  user_id,
  module_key,
  count(*)::int                                                                   as tx_count,
  coalesce(sum(amount_base_minor) filter (where kind = 'sale'), 0)::bigint          as revenue_minor,
  coalesce(sum(amount_base_minor) filter (where kind in ('purchase','shipping','customs')), 0)::bigint as cogs_minor,
  coalesce(sum(amount_base_minor) filter (where kind in ('commission','tax','operational','other_expense')), 0)::bigint as expenses_minor,
  (coalesce(sum(amount_base_minor) filter (where kind = 'sale'), 0)
   - coalesce(sum(amount_base_minor) filter (where kind in ('purchase','shipping','customs')), 0))::bigint as gross_profit_minor,
  (coalesce(sum(amount_base_minor) filter (where kind = 'sale'), 0)
   - coalesce(sum(amount_base_minor) filter (where kind in
       ('purchase','shipping','customs','commission','tax','operational','other_expense')), 0))::bigint as net_profit_minor,
  coalesce(sum(case when kind in ('sale','capital_in') then amount_base_minor else -amount_base_minor end), 0)::bigint as cash_flow_minor
from public.financial_transactions
group by user_id, module_key;

alter table public.exchange_rates         enable row level security;
alter table public.financial_transactions enable row level security;

create policy "own rates" on public.exchange_rates for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own transactions" on public.financial_transactions for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

grant select, insert, update, delete on public.exchange_rates, public.financial_transactions to authenticated;
grant select on public.finance_module_summary to authenticated;
