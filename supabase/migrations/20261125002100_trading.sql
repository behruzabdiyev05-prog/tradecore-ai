-- ═════════════════════════════════════════════════════════════
-- TRADECORE AI · Phase 3 · 0021 — Financial trading journal (Module 10)
--
-- Independent from physical trade (no products, no central ledger). Records only:
-- TRADECORE never places an order with a broker or exchange; a "real" account is a
-- journal of trades the user made elsewhere, a "demo" account is practice.
-- Prices are entered by the user (or later by an authorised data provider, Phase 7).
-- Quantities and prices are numeric (crypto needs many decimals); money math in
-- shared/modules/trading.js uses exact decimal arithmetic.
-- ═════════════════════════════════════════════════════════════

create table public.trading_accounts (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references public.organizations (id) on delete cascade,
  user_id           uuid not null default auth.uid(),
  name              text not null check (length(trim(name)) between 1 and 100),
  kind              text not null default 'demo' check (kind in ('demo', 'real')),
  currency          text not null default 'USD' check (currency ~ '^[A-Z0-9]{2,10}$'),
  starting_balance  numeric(28,10) not null default 0 check (starting_balance >= 0),
  notes             text check (notes is null or length(notes) <= 2000),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint trading_accounts_name_uq unique (org_id, name)
);

create table public.trading_trades (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.organizations (id) on delete cascade,
  user_id         uuid not null default auth.uid(),
  account_id      uuid not null references public.trading_accounts (id) on delete cascade,
  symbol          text not null check (symbol ~ '^[A-Z0-9][A-Z0-9./:_-]{0,29}$'),
  market          text not null check (market in ('crypto', 'forex', 'stock', 'index', 'gold', 'commodity')),
  side            text not null check (side in ('buy', 'sell')),
  quantity        numeric(28,10) not null check (quantity > 0),
  price           numeric(28,10) not null check (price > 0),
  fee             numeric(28,10) not null default 0 check (fee >= 0),
  executed_at     timestamptz not null default now(),
  notes           text check (notes is null or length(notes) <= 2000),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index trading_trades_account_idx on public.trading_trades (account_id, symbol, executed_at);

create table public.trading_prices (
  id           bigint generated always as identity primary key,
  org_id       uuid not null references public.organizations (id) on delete cascade,
  user_id      uuid not null default auth.uid(),
  symbol       text not null check (symbol ~ '^[A-Z0-9][A-Z0-9./:_-]{0,29}$'),
  market       text not null check (market in ('crypto', 'forex', 'stock', 'index', 'gold', 'commodity')),
  price        numeric(28,10) not null check (price > 0),
  observed_at  timestamptz not null default now(),
  source       text not null default 'manual' check (length(source) between 1 and 60),
  created_at   timestamptz not null default now(),
  constraint trading_prices_uq unique (org_id, symbol, observed_at)
);
create index trading_prices_symbol_idx on public.trading_prices (org_id, symbol, observed_at desc);

create table public.trading_alerts (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.organizations (id) on delete cascade,
  user_id        uuid not null default auth.uid(),
  symbol         text not null check (symbol ~ '^[A-Z0-9][A-Z0-9./:_-]{0,29}$'),
  condition      text not null check (condition in ('above', 'below')),
  price          numeric(28,10) not null check (price > 0),
  note           text check (note is null or length(note) <= 300),
  active         boolean not null default true,
  triggered_at   timestamptz,
  trigger_price  numeric(28,10),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index trading_alerts_active_idx on public.trading_alerts (org_id, symbol) where active;

do $$
declare t text;
begin
  foreach t in array array['trading_accounts', 'trading_trades', 'trading_prices', 'trading_alerts'] loop
    execute format('create trigger a_set_org before insert on public.%I for each row execute function public.set_row_org()', t);
    execute format('create trigger a_guard_owner before update on public.%I for each row execute function public.guard_row_owner()', t);
  end loop;
  foreach t in array array['trading_accounts', 'trading_trades', 'trading_alerts'] loop
    execute format('create trigger %I before update on public.%I for each row execute function public.set_updated_at()', t || '_updated_at', t);
  end loop;
  -- price marks are high-volume data, not business decisions: not audited
  foreach t in array array['trading_accounts', 'trading_trades', 'trading_alerts'] loop
    execute format('create trigger audit after insert or update or delete on public.%I for each row execute function public.audit_row()', t);
  end loop;
end $$;
create trigger b_same_org before insert or update on public.trading_trades
  for each row execute function public.check_same_org('account_id', 'trading_accounts');

-- A new price crosses an active alert → the alert fires once and its author is notified.
create function public.trading_alerts_check()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare a trading_alerts;
begin
  for a in select * from trading_alerts
           where org_id = new.org_id and symbol = new.symbol and active
             and ((condition = 'above' and new.price >= price) or (condition = 'below' and new.price <= price))
           for update loop
    update trading_alerts set active = false, triggered_at = now(), trigger_price = new.price where id = a.id;
    perform public.notify_once(a.org_id, a.user_id, 'trading.alert',
      format('%s: qiymət %s %s həddinə çatdı', a.symbol, trim(to_char(new.price, 'FM999999999990.##########')),
             case a.condition when 'above' then '≥' else '≤' end || ' ' || trim(to_char(a.price, 'FM999999999990.##########'))),
      a.note, '/m/financial-trading?tab=alerts', 'trading_alert', a.id::text,
      jsonb_build_object('symbol', a.symbol, 'condition', a.condition, 'price', a.price::text, 'last', new.price::text),
      'trading_alert:' || a.id);
  end loop;
  return new;
end $$;
create trigger alerts_check after insert on public.trading_prices for each row execute function public.trading_alerts_check();
revoke all on function public.trading_alerts_check() from public, anon, authenticated;

alter table public.trading_accounts enable row level security;
alter table public.trading_trades enable row level security;
alter table public.trading_prices enable row level security;
alter table public.trading_alerts enable row level security;
do $$
declare t text;
begin
  foreach t in array array['trading_accounts', 'trading_trades', 'trading_prices'] loop
    execute format($p$create policy "module read" on public.%I for select to authenticated
      using (org_id in (select public.org_ids_with('data.read')) and (org_id, 'financial-trading'::text) in (select * from public.org_module_access('read')))$p$, t);
    execute format($p$create policy "module insert" on public.%I for insert to authenticated
      with check (org_id in (select public.org_ids_with('data.write')) and user_id = auth.uid()
                  and (org_id, 'financial-trading'::text) in (select * from public.org_module_access('write')))$p$, t);
    execute format($p$create policy "module update" on public.%I for update to authenticated
      using (org_id in (select public.org_ids_with('data.write')) and (org_id, 'financial-trading'::text) in (select * from public.org_module_access('write')))
      with check (org_id in (select public.org_ids_with('data.write')) and (org_id, 'financial-trading'::text) in (select * from public.org_module_access('write')))$p$, t);
    execute format($p$create policy "module delete" on public.%I for delete to authenticated
      using (org_id in (select public.org_ids_with('data.write')) and (org_id, 'financial-trading'::text) in (select * from public.org_module_access('write')))$p$, t);
  end loop;
end $$;
-- alerts are personal: each member sees and manages only their own
create policy "own alerts" on public.trading_alerts for all to authenticated
  using (user_id = auth.uid() and (org_id, 'financial-trading'::text) in (select * from public.org_module_access('read')))
  with check (user_id = auth.uid() and (org_id, 'financial-trading'::text) in (select * from public.org_module_access('read')));

revoke all on public.trading_accounts, public.trading_trades, public.trading_prices, public.trading_alerts from public, anon;
grant select, insert, update, delete on public.trading_accounts, public.trading_trades, public.trading_prices, public.trading_alerts to authenticated;
revoke truncate, references, trigger on public.trading_accounts, public.trading_trades, public.trading_prices, public.trading_alerts from authenticated;
