-- ═════════════════════════════════════════════════════════════
-- TRADECORE AI · Migration 0007 · Phase 2A — Business tables become tenant-scoped
--  • org_id on the 10 Phase 1 business tables (existing rows backfilled)
--  • user_id is kept as "created by"
--  • same-organization checks on every foreign key
--  • RLS rewritten: membership + permission (+ plan for module data)
-- Calculation definitions in finance_module_summary are unchanged.
-- Rollback: supabase/rollback/20261122000700_tenancy_business_tables.down.sql
-- ═════════════════════════════════════════════════════════════

-- ── 1. Every existing user gets an organization (backfill) ───
do $$
declare u record;
begin
  for u in
    select au.id, au.email, p.full_name from auth.users au left join public.profiles p on p.id = au.id
    where not exists (select 1 from public.organization_members m where m.user_id = au.id)
  loop
    insert into public.profiles (id) values (u.id) on conflict (id) do nothing;
    perform public._create_org(u.id, coalesce(nullif(trim(u.full_name), ''), split_part(u.email, '@', 1)) || ' şirkəti');
  end loop;
end $$;

-- ── 2. org_id column + backfill + NOT NULL ───────────────────
do $$
declare t text;
begin
  foreach t in array array['companies','products','saved_items','module_events','activity_log',
                           'financial_transactions','exchange_rates','ares_conversations','ares_messages','integrations'] loop
    execute format('alter table public.%I add column org_id uuid references public.organizations (id) on delete cascade', t);
    execute format('update public.%I x set org_id = p.active_org_id from public.profiles p where p.id = x.user_id', t);
    execute format('alter table public.%I alter column org_id set not null', t);
    execute format('create index %I on public.%I (org_id)', t || '_org_idx', t);
  end loop;
end $$;

-- ── 3. Triggers: default org, immutability, same-org references ──
-- Default org = the active organization of the row's creator.
create function public.set_row_org()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.org_id is null then
    select active_org_id into new.org_id from profiles where id = coalesce(new.user_id, auth.uid());
  end if;
  return new;
end $$;

-- A row never moves between organizations and never changes its creator.
create function public.guard_row_owner()
returns trigger language plpgsql as $$
begin
  if new.org_id is distinct from old.org_id or new.user_id is distinct from old.user_id then
    raise exception 'org_id və user_id dəyişdirilə bilməz' using errcode = 'insufficient_privilege';
  end if;
  return new;
end $$;

-- TG_ARGV: pairs of (column, referenced table). Each non-null reference must be in the same organization.
create function public.check_same_org()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare i int := 0; v_col text; v_tbl text; v_val text; v_org uuid; v_row jsonb := to_jsonb(new);
begin
  while i < tg_nargs loop
    v_col := tg_argv[i]; v_tbl := tg_argv[i + 1]; i := i + 2;
    v_val := v_row ->> v_col;
    continue when v_val is null;
    execute format('select org_id from public.%I where id = $1', v_tbl) into v_org using v_val::uuid;
    if v_org is distinct from new.org_id then
      raise exception 'Başqa şirkətin qeydinə istinad etmək olmaz (%)', v_col using errcode = 'insufficient_privilege';
    end if;
  end loop;
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['companies','products','saved_items','module_events','activity_log',
                           'financial_transactions','exchange_rates','ares_conversations','ares_messages','integrations'] loop
    -- BEFORE triggers fire in name order: "a_*" runs before the "b_same_org" checks below.
    execute format('create trigger a_set_org before insert on public.%I for each row execute function public.set_row_org()', t);
    execute format('create trigger a_guard_owner before update on public.%I for each row execute function public.guard_row_owner()', t);
  end loop;
end $$;

create trigger b_same_org before insert or update on public.products
  for each row execute function public.check_same_org('supplier_id', 'companies');
create trigger b_same_org before insert or update on public.saved_items
  for each row execute function public.check_same_org('product_id', 'products', 'company_id', 'companies');
create trigger b_same_org before insert or update on public.financial_transactions
  for each row execute function public.check_same_org('counterparty_id', 'companies', 'product_id', 'products');
create trigger b_same_org before insert or update on public.ares_messages
  for each row execute function public.check_same_org('conversation_id', 'ares_conversations');

-- ── 4. Shared resources are per organization, not per user ───
alter table public.exchange_rates drop constraint exchange_rates_user_id_currency_rate_date_source_key;
alter table public.exchange_rates add constraint exchange_rates_org_currency_date_source_key unique (org_id, currency, rate_date, source);
alter table public.integrations drop constraint integrations_user_id_provider_key;
alter table public.integrations add constraint integrations_org_provider_key unique (org_id, provider);

-- ── 5. RLS: replace "own rows" with "organization + permission" ──
drop policy "own companies"          on public.companies;
drop policy "own products"           on public.products;
drop policy "own saved_items"        on public.saved_items;
drop policy "own events read"        on public.module_events;
drop policy "own events insert"      on public.module_events;
drop policy "own activity read"      on public.activity_log;
drop policy "own activity insert"    on public.activity_log;
drop policy "own rates"              on public.exchange_rates;
drop policy "own transactions"       on public.financial_transactions;
drop policy "own ares conversations" on public.ares_conversations;
drop policy "own ares messages"      on public.ares_messages;
drop policy "own integrations"       on public.integrations;

-- companies, products: shared organization data
create policy "org read"   on public.companies for select to authenticated
  using (org_id in (select public.org_ids_with('data.read')));
create policy "org insert" on public.companies for insert to authenticated
  with check (org_id in (select public.org_ids_with('data.write')) and user_id = auth.uid());
create policy "org update" on public.companies for update to authenticated
  using (org_id in (select public.org_ids_with('data.write'))) with check (org_id in (select public.org_ids_with('data.write')));
create policy "org delete" on public.companies for delete to authenticated
  using (org_id in (select public.org_ids_with('data.write')));

create policy "org read"   on public.products for select to authenticated
  using (org_id in (select public.org_ids_with('data.read')));
create policy "org insert" on public.products for insert to authenticated
  with check (org_id in (select public.org_ids_with('data.write')) and user_id = auth.uid());
create policy "org update" on public.products for update to authenticated
  using (org_id in (select public.org_ids_with('data.write'))) with check (org_id in (select public.org_ids_with('data.write')));
create policy "org delete" on public.products for delete to authenticated
  using (org_id in (select public.org_ids_with('data.write')));

-- saved_items: shared data that belongs to a module (module permission + plan)
create policy "org read"   on public.saved_items for select to authenticated
  using (org_id in (select public.org_ids_with('data.read'))
         and (org_id, module_key) in (select * from public.org_module_access('read')));
create policy "org insert" on public.saved_items for insert to authenticated
  with check (org_id in (select public.org_ids_with('data.write')) and user_id = auth.uid()
              and (org_id, module_key) in (select * from public.org_module_access('write')));
create policy "org update" on public.saved_items for update to authenticated
  using (org_id in (select public.org_ids_with('data.write')) and (org_id, module_key) in (select * from public.org_module_access('write')))
  with check (org_id in (select public.org_ids_with('data.write')) and (org_id, module_key) in (select * from public.org_module_access('write')));
create policy "org delete" on public.saved_items for delete to authenticated
  using (org_id in (select public.org_ids_with('data.write')) and (org_id, module_key) in (select * from public.org_module_access('write')));

-- module_events: append-only cross-module bus
create policy "org read"   on public.module_events for select to authenticated
  using ((org_id, source_module) in (select * from public.org_module_access('read')));
create policy "org insert" on public.module_events for insert to authenticated
  with check ((org_id, source_module) in (select * from public.org_module_access('write')) and user_id = auth.uid());

-- activity_log: own entries; audit.read sees the organization's
create policy "org read"   on public.activity_log for select to authenticated
  using (org_id in (select public.member_org_ids())
         and (user_id = auth.uid() or org_id in (select public.org_ids_with('audit.read'))));
create policy "org insert" on public.activity_log for insert to authenticated
  with check (org_id in (select public.member_org_ids()) and user_id = auth.uid());

-- financial_transactions: finance permission (+ module access when tied to a module)
create policy "org read"   on public.financial_transactions for select to authenticated
  using (org_id in (select public.org_ids_with('finance.read'))
         and (module_key is null or (org_id, module_key) in (select * from public.org_module_access('read'))));
create policy "org insert" on public.financial_transactions for insert to authenticated
  with check (org_id in (select public.org_ids_with('finance.write')) and user_id = auth.uid()
              and (module_key is null or (org_id, module_key) in (select * from public.org_module_access('write'))));
create policy "org update" on public.financial_transactions for update to authenticated
  using (org_id in (select public.org_ids_with('finance.write')))
  with check (org_id in (select public.org_ids_with('finance.write'))
              and (module_key is null or (org_id, module_key) in (select * from public.org_module_access('write'))));
create policy "org delete" on public.financial_transactions for delete to authenticated
  using (org_id in (select public.org_ids_with('finance.write')));

-- exchange_rates: organization-wide finance resource
create policy "org read"  on public.exchange_rates for select to authenticated
  using (org_id in (select public.org_ids_with('finance.read')));
create policy "org write" on public.exchange_rates for all to authenticated
  using (org_id in (select public.org_ids_with('finance.write')))
  with check (org_id in (select public.org_ids_with('finance.write')));

-- ARES conversations stay private to their author, inside an org where ARES is allowed
create policy "own ares conversations in org" on public.ares_conversations for all to authenticated
  using (user_id = auth.uid() and org_id in (select public.org_ids_with('ares.use')))
  with check (user_id = auth.uid() and org_id in (select public.org_ids_with('ares.use')));
create policy "own ares messages in org" on public.ares_messages for all to authenticated
  using (user_id = auth.uid() and org_id in (select public.org_ids_with('ares.use')))
  with check (
    user_id = auth.uid() and org_id in (select public.org_ids_with('ares.use'))
    and exists (select 1 from public.ares_conversations c where c.id = conversation_id and c.user_id = auth.uid()));

-- integrations: integrations.manage only
create policy "org integrations" on public.integrations for all to authenticated
  using (org_id in (select public.org_ids_with('integrations.manage')))
  with check (org_id in (select public.org_ids_with('integrations.manage')));

-- ── 6. Finance summary per organization (definitions unchanged) ──
drop view public.finance_module_summary;
create view public.finance_module_summary
with (security_invoker = true) as
select
  org_id,
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
group by org_id, module_key;

-- ── 7. Privileges: anon never touches business data ──────────
revoke all on public.companies, public.products, public.saved_items, public.module_events, public.activity_log,
              public.financial_transactions, public.exchange_rates, public.ares_conversations, public.ares_messages,
              public.integrations, public.finance_module_summary, public.profiles, public.modules, public.currencies
  from anon;
-- PostgREST never issues TRUNCATE, but RLS does not cover it: remove it as defence in depth.
revoke truncate, references, trigger on public.companies, public.products, public.saved_items, public.module_events,
  public.activity_log, public.financial_transactions, public.exchange_rates, public.ares_conversations,
  public.ares_messages, public.integrations, public.profiles, public.modules, public.currencies from authenticated;
revoke all on public.finance_module_summary from authenticated;
grant select on public.finance_module_summary to authenticated;

do $$
declare f text;
begin
  for f in select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and (p.prosecdef or p.proname in ('guard_row_owner')) loop
    execute format('revoke all on function %s from public, anon', f);
  end loop;
end $$;
revoke all on function public.set_row_org(), public.check_same_org(), public.guard_row_owner() from authenticated;
-- RLS helpers / RPCs stay executable by authenticated (granted in 0006)
