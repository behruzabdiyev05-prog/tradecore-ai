-- Verifies no data is lost across up → down → up (run with -v phase=after_up|after_down|after_reup).
\set ON_ERROR_STOP on
select set_config('test.phase', :'phase', false);
do $$
declare
  phase text := current_setting('test.phase');
  expected jsonb := '{"companies":2,"products":2,"saved_items":2,"module_events":2,"activity_log":2,
                      "financial_transactions":4,"exchange_rates":2,"ares_conversations":2,"ares_messages":2,"integrations":2}';
  t text; n bigint; has_org boolean; s record;
begin
  for t in select jsonb_object_keys(expected) loop
    execute format('select count(*) from public.%I', t) into n;
    if n <> (expected ->> t)::bigint then raise exception '[%] % rows in %, expected %', phase, n, t, expected ->> t; end if;
    select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = t and column_name = 'org_id') into has_org;
    if phase = 'after_down' and has_org then raise exception '[%] % still has org_id', phase, t; end if;
    if phase <> 'after_down' then
      if not has_org then raise exception '[%] % has no org_id', phase, t; end if;
      execute format('select count(*) from public.%I x join public.profiles p on p.id = x.user_id where x.org_id is distinct from p.active_org_id', t) into n;
      if n > 0 then raise exception '[%] % rows of % not in their creator''s organization', phase, n, t; end if;
    end if;
  end loop;

  -- financial totals identical in every phase (1000.00 sale, 340.00 purchase per user)
  select sum(amount_base_minor) filter (where kind = 'sale') as rev, sum(amount_base_minor) filter (where kind = 'purchase') as cogs
    into s from public.financial_transactions;
  if s.rev <> 200000 or s.cogs <> 68000 then raise exception '[%] totals changed: %', phase, s; end if;

  if phase = 'after_down' then
    if not exists (select 1 from pg_policies where tablename = 'companies' and policyname = 'own companies') then
      raise exception '[%] Phase 1 policy not restored', phase;
    end if;
  else
    if (select count(*) from public.organization_members m join public.roles r on r.id = m.role_id
        where r.key = 'owner' and m.user_id in ('d0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000002')) <> 2 then
      raise exception '[%] backfilled users are not owners of their organizations', phase;
    end if;
  end if;
  raise notice '[%] OK — all rows and totals intact', phase;
end $$;

-- Isolation still holds in every phase: user 1 sees only their own company
set role authenticated;
select set_config('request.jwt.claim.sub', 'd0000000-0000-0000-0000-000000000001', false);
do $$ begin
  if (select count(*) from public.companies) <> 1 then
    raise exception '[%] user 1 sees % companies, expected 1', current_setting('test.phase'), (select count(*) from public.companies);
  end if;
end $$;
reset role;
select current_setting('test.phase') || ': data intact, isolation OK' as result;
