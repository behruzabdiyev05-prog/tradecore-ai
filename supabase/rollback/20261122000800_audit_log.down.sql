-- Rollback of 20261122000800_audit_log.sql
-- WARNING: drops the audit history. Export public.audit_log before running in production.
do $$
declare t text;
begin
  foreach t in array array['companies','products','saved_items','module_events','activity_log','financial_transactions',
                           'exchange_rates','ares_conversations','ares_messages','integrations','organizations',
                           'organization_members','organization_invites','organization_subscriptions'] loop
    execute format('drop trigger if exists audit on public.%I', t);
  end loop;
end $$;
drop table if exists public.audit_log;          -- its own immutability triggers go with it
drop function if exists public.audit_row();
drop function if exists public.audit_log_immutable();
