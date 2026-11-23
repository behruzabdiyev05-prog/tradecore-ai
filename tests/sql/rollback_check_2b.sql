-- 2B rollback cycle checks (run with -v phase=after_up|after_down|after_reup).
\set ON_ERROR_STOP on
select set_config('test.phase', :'phase', false);
do $$
declare
  phase text := current_setting('test.phase');
  has_2b boolean;
begin
  -- Phase 2A data of the rollback-test users is untouched in every phase (the audit log only grows)
  if (select row(x.*)::text from rb2b.snapshot() x) <> (select row(b.*)::text from rb2b.baseline b) then
    raise exception '[%] Phase 2A data changed: % vs baseline %', phase,
      (select row(x.*)::text from rb2b.snapshot() x), (select row(b.*)::text from rb2b.baseline b);
  end if;

  has_2b := to_regclass('public.notifications') is not null;
  if phase = 'after_down' then
    if has_2b then raise exception '[%] notifications table still exists', phase; end if;
    if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'profiles'
               and column_name in ('phone', 'job_title', 'avatar_path', 'preferences')) then
      raise exception '[%] 2B profile columns still exist', phase; end if;
    if to_regprocedure('public.global_search(uuid, text, integer)') is not null then raise exception '[%] global_search still exists', phase; end if;
  else
    if not has_2b then raise exception '[%] notifications table missing', phase; end if;
    if phase = 'after_up' then
      if (select count(*) from public.notifications where type = 'system.test') <> 1 then raise exception '[%] 2B seed missing', phase; end if;
      if (select tax_id from public.organizations where name = 'RB A') <> '1000000001' then raise exception '[%] org details missing', phase; end if;
    end if;
    if phase = 'after_reup' and (select count(*) from public.notifications where type = 'system.test') <> 0 then
      raise exception '[%] 2B data should be gone after down → up', phase; end if;
  end if;
  raise notice '[%] OK — Phase 2A data intact', phase;
end $$;

-- Isolation in every phase: RB One sees only their own company
set role authenticated;
select set_config('request.jwt.claim.sub', '90000000-0000-0000-0000-000000000001', false);
do $$ begin
  if (select count(*) from public.companies where name like 'RB Co %') <> 1 then
    raise exception '[%] isolation broken', current_setting('test.phase');
  end if;
end $$;
reset role;
select current_setting('test.phase') || ': Phase 2A data intact, isolation OK' as result;
