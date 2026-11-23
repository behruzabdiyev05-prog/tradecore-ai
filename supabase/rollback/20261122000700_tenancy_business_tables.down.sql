-- Rollback of 20261122000700_tenancy_business_tables.sql
-- Restores Phase 1 per-user RLS. Rows keep their user_id, so no data is lost.
-- Note: if several users of one organization stored the same exchange rate / integration,
-- re-creating the per-user unique keys still succeeds (they were unique per org, hence per user).

-- 1. View back to per-user grouping (Phase 1 definition)
drop view public.finance_module_summary;
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
grant select on public.finance_module_summary to authenticated;

-- 2. Drop Phase 2A policies
drop policy "org read"   on public.companies;   drop policy "org insert" on public.companies;
drop policy "org update" on public.companies;   drop policy "org delete" on public.companies;
drop policy "org read"   on public.products;    drop policy "org insert" on public.products;
drop policy "org update" on public.products;    drop policy "org delete" on public.products;
drop policy "org read"   on public.saved_items; drop policy "org insert" on public.saved_items;
drop policy "org update" on public.saved_items; drop policy "org delete" on public.saved_items;
drop policy "org read"   on public.module_events; drop policy "org insert" on public.module_events;
drop policy "org read"   on public.activity_log;  drop policy "org insert" on public.activity_log;
drop policy "org read"   on public.financial_transactions; drop policy "org insert" on public.financial_transactions;
drop policy "org update" on public.financial_transactions; drop policy "org delete" on public.financial_transactions;
drop policy "org read"   on public.exchange_rates; drop policy "org write" on public.exchange_rates;
drop policy "own ares conversations in org" on public.ares_conversations;
drop policy "own ares messages in org"      on public.ares_messages;
drop policy "org integrations"              on public.integrations;

-- 3. Triggers and functions
do $$
declare t text;
begin
  foreach t in array array['companies','products','saved_items','module_events','activity_log',
                           'financial_transactions','exchange_rates','ares_conversations','ares_messages','integrations'] loop
    execute format('drop trigger if exists a_set_org on public.%I', t);
    execute format('drop trigger if exists a_guard_owner on public.%I', t);
  end loop;
end $$;
drop trigger b_same_org on public.products;
drop trigger b_same_org on public.saved_items;
drop trigger b_same_org on public.financial_transactions;
drop trigger b_same_org on public.ares_messages;
drop function public.set_row_org();
drop function public.guard_row_owner();
drop function public.check_same_org();

-- 4. Unique keys back to per user
alter table public.exchange_rates drop constraint exchange_rates_org_currency_date_source_key;
alter table public.exchange_rates add constraint exchange_rates_user_id_currency_rate_date_source_key unique (user_id, currency, rate_date, source);
alter table public.integrations drop constraint integrations_org_provider_key;
alter table public.integrations add constraint integrations_user_id_provider_key unique (user_id, provider);

-- 5. Drop org_id (indexes go with the column)
do $$
declare t text;
begin
  foreach t in array array['companies','products','saved_items','module_events','activity_log',
                           'financial_transactions','exchange_rates','ares_conversations','ares_messages','integrations'] loop
    execute format('alter table public.%I drop column org_id', t);
  end loop;
end $$;

-- 6. Phase 1 policies (verbatim from migrations 0002–0004)
create policy "own companies"   on public.companies   for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own products"    on public.products    for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own saved_items" on public.saved_items for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own events read"   on public.module_events for select to authenticated using (user_id = auth.uid());
create policy "own events insert" on public.module_events for insert to authenticated with check (user_id = auth.uid());
create policy "own activity read"   on public.activity_log for select to authenticated using (user_id = auth.uid());
create policy "own activity insert" on public.activity_log for insert to authenticated with check (user_id = auth.uid());
create policy "own rates" on public.exchange_rates for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own transactions" on public.financial_transactions for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
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
-- Privileges revoked from anon in 0007 stay revoked (strictly safer; Phase 1 never used anon access).
