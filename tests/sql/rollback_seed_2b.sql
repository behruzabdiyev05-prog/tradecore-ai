-- 2B rollback cycle — part 1 (before the 2B migrations): Phase 2A-shaped data.
-- part 2 (after them, \if :with_2b): data in the new 2B tables and columns.
\set ON_ERROR_STOP on
\if :with_2b
  set role authenticated;
  select set_config('request.jwt.claim.sub', '90000000-0000-0000-0000-000000000001', false);
  update public.profiles set phone = '+994 50 000 00 01', job_title = 'Direktor', preferences = '{"theme":"dark"}'
    where id = '90000000-0000-0000-0000-000000000001';
  update public.organizations set legal_name = 'RB MMC', tax_id = '1000000001' where id = public.current_org_id();
  insert into public.notification_preferences (org_id, type, enabled) values (public.current_org_id(), 'member.joined', false);
  reset role;
  select public.notify(active_org_id, id, 'system.test', 'Rollback test', null, '/', null, null, '{}')
    from public.profiles where id = '90000000-0000-0000-0000-000000000001';
  select '2B data inserted' as result;
\else
  insert into auth.users (id, email, raw_user_meta_data) values
    ('90000000-0000-0000-0000-000000000001', 'rb1@test.local', '{"full_name":"RB One","company_name":"RB A"}'),
    ('90000000-0000-0000-0000-000000000002', 'rb2@test.local', '{"full_name":"RB Two","company_name":"RB B"}');
  set role authenticated;
  do $$
  declare u uuid;
  begin
    foreach u in array array['90000000-0000-0000-0000-000000000001'::uuid, '90000000-0000-0000-0000-000000000002'::uuid] loop
      perform set_config('request.jwt.claim.sub', u::text, false);
      insert into public.companies (name) values ('RB Co ' || u);
      insert into public.products (name) values ('RB P ' || u);
      insert into public.financial_transactions (module_key, kind, amount_minor, currency, fx_rate_to_base)
        values ('wholesale', 'sale', 100000, 'AZN', 1);
    end loop;
  end $$;
  reset role;
  -- baseline kept outside `public`, so it survives the rollback
  create schema rb2b;
  create function rb2b.snapshot() returns table (profiles bigint, orgs bigint, members bigint, companies bigint,
                                                  products bigint, revenue numeric, names text)
  language sql stable as $f$
    with u(id) as (values ('90000000-0000-0000-0000-000000000001'::uuid), ('90000000-0000-0000-0000-000000000002'::uuid))
    select (select count(*) from public.profiles where id in (select id from u)),
           (select count(*) from public.organizations where created_by in (select id from u)),
           (select count(*) from public.organization_members where user_id in (select id from u)),
           (select count(*) from public.companies where user_id in (select id from u)),
           (select count(*) from public.products where user_id in (select id from u)),
           (select sum(amount_base_minor) from public.financial_transactions where user_id in (select id from u)),
           (select string_agg(full_name, ',' order by id) from public.profiles where id in (select id from u))
  $f$;
  create table rb2b.baseline as select * from rb2b.snapshot();
  select '2A data + baseline recorded' as result;
\endif
