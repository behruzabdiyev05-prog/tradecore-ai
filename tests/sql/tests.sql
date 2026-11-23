-- TRADECORE AI · Database tests (RLS isolation, finance math, constraints)
\set ON_ERROR_STOP on

-- Two users (trigger must create profiles)
insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111111111', 'a@test.local', '{"full_name":"User A"}'),
  ('22222222-2222-2222-2222-222222222222', 'b@test.local', '{}');

do $$ begin
  assert (select count(*) from public.profiles) = 2, 'profiles not auto-created';
  assert (select full_name from public.profiles where id = '11111111-1111-1111-1111-111111111111') = 'User A', 'full_name not copied';
  assert (select count(*) from public.modules) = 10, 'expected 10 modules';
end $$;

-- ── Act as user A ────────────────────────────────────────────
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);

insert into public.financial_transactions (module_key, kind, amount_minor, currency, fx_rate_to_base) values
  ('wholesale', 'sale',        100000, 'AZN', 1),          -- 1000.00 AZN
  ('wholesale', 'purchase',     20000, 'USD', 1.70),        -- 200 USD → 340.00 AZN
  ('wholesale', 'shipping',      5000, 'AZN', 1),          --   50.00
  ('wholesale', 'customs',       3333, 'TRY', 0.0525),      -- 33.33 TRY → 1.749825 → 175 minor
  ('wholesale', 'commission',    2500, 'AZN', 1),          --   25.00
  ('wholesale', 'tax',           1000, 'AZN', 1),          --   10.00
  ('wholesale', 'capital_in',  500000, 'AZN', 1),          -- 5000.00 capital
  ('arbitrage', 'sale',          1, 'EUR', 1.99999999);    -- rounding edge → 2 minor

insert into public.module_events (source_module, target_module, event_type, payload)
  values ('wholesale', 'b2b-trading', 'supplier.saved', '{"name":"X"}');
insert into public.companies (name, roles, origin_module) values ('Test Supplier', '{supplier}', 'wholesale');

do $$
declare r record;
begin
  -- generated AZN amounts (must match shared/finance.js convertToBase)
  assert (select amount_base_minor from public.financial_transactions where kind='purchase') = 34000, 'USD conversion';
  assert (select amount_base_minor from public.financial_transactions where kind='customs') = 175, 'TRY rounding';
  assert (select amount_base_minor from public.financial_transactions where module_key='arbitrage') = 2, 'EUR rounding edge';

  select * into r from public.finance_module_summary where module_key = 'wholesale';
  assert r.revenue_minor      = 100000, 'revenue';
  assert r.cogs_minor         = 34000 + 5000 + 175, 'cogs';
  assert r.expenses_minor     = 3500, 'expenses';
  assert r.gross_profit_minor = 100000 - 39175, 'gross profit';
  assert r.net_profit_minor   = 100000 - 39175 - 3500, 'net profit';
  assert r.cash_flow_minor    = 100000 - 39175 - 3500 + 500000, 'cash flow';
  assert r.tx_count = 7, 'tx count';
end $$;

-- Constraint: AZN must have rate 1
do $$ begin
  begin
    insert into public.financial_transactions (kind, amount_minor, currency, fx_rate_to_base) values ('sale', 100, 'AZN', 1.5);
    raise exception 'AZN rate check missing';
  exception when check_violation then null; end;
  begin
    insert into public.financial_transactions (kind, amount_minor, currency) values ('sale', -5, 'AZN');
    raise exception 'negative amount allowed';
  exception when check_violation then null; end;
  begin
    insert into public.integrations (provider, config) values ('amazon', '{"api_key":"abc"}');
    raise exception 'secret stored in integrations.config';
  exception when check_violation then null; end;
  begin
    insert into public.module_events (source_module, event_type) values ('wholesale', 'BadName');
    raise exception 'invalid event_type accepted';
  exception when check_violation then null; end;
end $$;

-- Cannot write rows for someone else
do $$ begin
  begin
    insert into public.companies (user_id, name) values ('22222222-2222-2222-2222-222222222222', 'Spoof');
    raise exception 'RLS allowed spoofed user_id';
  exception when insufficient_privilege then null; end;
end $$;

-- ── Act as user B: must see nothing of A ─────────────────────
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);
do $$ begin
  assert (select count(*) from public.financial_transactions) = 0, 'B sees A transactions';
  assert (select count(*) from public.finance_module_summary) = 0, 'B sees A summary';
  assert (select count(*) from public.companies) = 0, 'B sees A companies';
  assert (select count(*) from public.module_events) = 0, 'B sees A events';
  assert (select count(*) from public.profiles) = 1, 'B sees other profiles';
  assert (select count(*) from public.modules) = 10, 'B cannot read modules';
end $$;

-- ARES message into someone else's conversation must fail
reset role;
insert into public.ares_conversations (id, user_id, title)
  values ('33333333-3333-3333-3333-333333333333', '11111111-1111-1111-1111-111111111111', 'A conv');
set role authenticated;
do $$ begin
  begin
    insert into public.ares_messages (conversation_id, role, content)
      values ('33333333-3333-3333-3333-333333333333', 'user', 'hijack');
    raise exception 'B wrote into A conversation';
  exception when insufficient_privilege then null; end;
end $$;

-- Anonymous: no access
reset role;
set role anon;
do $$ begin
  begin
    perform count(*) from public.financial_transactions;
    raise exception 'anon can read transactions';
  exception when insufficient_privilege then null; end;
end $$;

reset role;
select 'ALL SQL TESTS PASSED' as result;
