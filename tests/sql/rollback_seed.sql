-- Phase 1-shaped data, inserted BEFORE the Phase 2A migrations (rollback cycle test).
\set ON_ERROR_STOP on
insert into auth.users (id, email, raw_user_meta_data) values
  ('d0000000-0000-0000-0000-000000000001', 'r1@test.local', '{"full_name":"R One"}'),
  ('d0000000-0000-0000-0000-000000000002', 'r2@test.local', '{"full_name":"R Two"}');

set role authenticated;
do $$
declare u uuid; c uuid; conv uuid;
begin
  foreach u in array array['d0000000-0000-0000-0000-000000000001'::uuid, 'd0000000-0000-0000-0000-000000000002'::uuid] loop
    perform set_config('request.jwt.claim.sub', u::text, false);
    insert into public.companies (name) values ('Co ' || u) returning id into c;
    insert into public.products (name, supplier_id) values ('P ' || u, c);
    insert into public.saved_items (module_key, item_type, title) values ('wholesale', 'product', 'S');
    insert into public.module_events (source_module, event_type) values ('wholesale', 'supplier.saved');
    insert into public.activity_log (action) values ('seed');
    insert into public.financial_transactions (module_key, kind, amount_minor, currency, fx_rate_to_base) values
      ('wholesale', 'sale', 100000, 'AZN', 1), ('wholesale', 'purchase', 20000, 'USD', 1.70);
    insert into public.exchange_rates (currency, rate_to_base, rate_date, source) values ('USD', 1.7, '2026-11-20', 'manual');
    insert into public.ares_conversations (title) values ('C') returning id into conv;
    insert into public.ares_messages (conversation_id, role, content) values (conv, 'user', 'hi');
    insert into public.integrations (provider) values ('amazon');
  end loop;
end $$;
reset role;
select 'rollback seed inserted' as result;
