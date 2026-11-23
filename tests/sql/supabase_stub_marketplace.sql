-- Stand-in for Supabase's `service_role` (the server key's role), used by the İ-3 marketplace tests.
-- In a real Supabase project this role already exists (with BYPASSRLS). NOT deployed to Supabase.
-- Applied by tests/sql/run_marketplace.sh BEFORE the migrations, so the conditional
-- `grant ... to service_role` statements in migrations 0013–0017 take effect.
-- The older runners (run.sh, run_phase2b.sh) do not load this file; the migrations work without it.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
end $$;
grant usage on schema public to service_role;
grant usage on schema auth to service_role;
grant execute on function auth.uid() to service_role;
