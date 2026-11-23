-- ═════════════════════════════════════════════════════════════
-- TRADECORE AI · Migration 0008 · Phase 2A — Tamper-proof audit log
-- Written only by triggers. Nobody (incl. organization owners) can
-- update, delete or truncate it. Retention/archiving: Phase 9 (decision E).
-- Rollback: supabase/rollback/20261122000800_audit_log.down.sql
-- ═════════════════════════════════════════════════════════════

create table public.audit_log (
  id          bigint generated always as identity primary key,
  org_id      uuid not null,            -- no FK: history outlives deleted rows/orgs
  actor_id    uuid,                     -- auth.uid() at the time (NULL = system / migration)
  table_name  text not null,
  record_id   text,
  action      text not null check (action in ('INSERT', 'UPDATE', 'DELETE')),
  changed     jsonb not null default '{}'::jsonb,   -- INSERT/DELETE: row; UPDATE: {col: {old, new}} for changed cols only
  at          timestamptz not null default now()
);
create index audit_log_org_at_idx on public.audit_log (org_id, at desc);
create index audit_log_org_table_idx on public.audit_log (org_id, table_name, at desc);

-- TG_ARGV: columns to leave out of `changed` (secrets, large/private text)
create function public.audit_row()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_new jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  v_old jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  v_skip text[] := array['updated_at'] || coalesce(tg_argv::text[], '{}');
  v_org uuid;
  v_changed jsonb;
begin
  v_org := case when tg_table_name = 'organizations'
                then coalesce(v_new ->> 'id', v_old ->> 'id')::uuid
                else coalesce(v_new ->> 'org_id', v_old ->> 'org_id')::uuid end;

  if tg_op = 'UPDATE' then
    select coalesce(jsonb_object_agg(k, jsonb_build_object('old', v_old -> k, 'new', v_new -> k)), '{}'::jsonb)
      into v_changed
      from jsonb_object_keys(v_new) k
      where k <> all (v_skip) and (v_new -> k) is distinct from (v_old -> k);
    if v_changed = '{}'::jsonb then return null; end if;
  else
    v_changed := coalesce(v_new, v_old) - v_skip;
  end if;

  insert into audit_log (org_id, actor_id, table_name, record_id, action, changed)
  values (v_org, auth.uid(), tg_table_name, coalesce(v_new ->> 'id', v_old ->> 'id', v_new ->> 'org_id'), tg_op, v_changed);
  return null;
end $$;

-- Business tables
create trigger audit after insert or update or delete on public.companies              for each row execute function public.audit_row();
create trigger audit after insert or update or delete on public.products               for each row execute function public.audit_row();
create trigger audit after insert or update or delete on public.saved_items            for each row execute function public.audit_row();
create trigger audit after insert or update or delete on public.module_events          for each row execute function public.audit_row();
create trigger audit after insert or update or delete on public.activity_log           for each row execute function public.audit_row();
create trigger audit after insert or update or delete on public.financial_transactions for each row execute function public.audit_row();
create trigger audit after insert or update or delete on public.exchange_rates         for each row execute function public.audit_row();
create trigger audit after insert or update or delete on public.ares_conversations     for each row execute function public.audit_row();
create trigger audit after insert or update or delete on public.ares_messages          for each row execute function public.audit_row('content');
create trigger audit after insert or update or delete on public.integrations           for each row execute function public.audit_row();
-- Tenancy tables
create trigger audit after insert or update or delete on public.organizations              for each row execute function public.audit_row();
create trigger audit after insert or update or delete on public.organization_members       for each row execute function public.audit_row();
create trigger audit after insert or update or delete on public.organization_invites       for each row execute function public.audit_row('token_hash');
create trigger audit after insert or update or delete on public.organization_subscriptions for each row execute function public.audit_row();

-- Append-only, enforced even for the database owner role
create function public.audit_log_immutable()
returns trigger language plpgsql as $$
begin
  raise exception 'audit_log yalnız əlavə oluna bilər; dəyişdirmək və silmək qadağandır'
    using errcode = 'insufficient_privilege';
end $$;
create trigger audit_log_no_update before update or delete on public.audit_log
  for each row execute function public.audit_log_immutable();
create trigger audit_log_no_truncate before truncate on public.audit_log
  for each statement execute function public.audit_log_immutable();

alter table public.audit_log enable row level security;
create policy "audit readable with audit.read" on public.audit_log
  for select to authenticated using (org_id in (select public.org_ids_with('audit.read')));

revoke all on public.audit_log from public, anon, authenticated;
grant select on public.audit_log to authenticated;
revoke all on function public.audit_row(), public.audit_log_immutable() from public, anon, authenticated;
