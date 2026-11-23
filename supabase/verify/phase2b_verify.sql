-- ═════════════════════════════════════════════════════════════
-- TRADECORE AI · Read-only verification for a Supabase TEST project
-- (Phase 2A + 2B). Run it in the SQL editor after applying all 12 migrations.
-- It only reads catalogues — it creates, changes and deletes nothing.
-- Every row should say PASS. Never run migrations on production without approval.
-- ═════════════════════════════════════════════════════════════
with checks(area, name, ok) as (
  -- migrations
  select 'schema', 'all Phase 2A/2B tables exist',
    (select count(*) from pg_tables where schemaname = 'public' and tablename in
      ('organizations','organization_members','roles','role_permissions','permissions','organization_invites','plans',
       'organization_subscriptions','audit_log','notifications','notification_preferences')) = 11
  union all select 'schema', 'RLS on every table in public',
    not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity)
  union all select 'schema', 'profiles: 2B columns present',
    (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'profiles'
       and column_name in ('phone','job_title','avatar_path','preferences')) = 4
  union all select 'schema', 'organizations: details + mfa_required_roles present',
    (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'organizations'
       and column_name in ('legal_name','tax_id','address','phone','email','website','logo_path','mfa_required_roles')) = 8
  -- privileges
  union all select 'privileges', 'authenticated cannot write profiles.active_org_id directly',
    not has_column_privilege('authenticated', 'public.profiles', 'active_org_id', 'UPDATE')
  union all select 'privileges', 'authenticated cannot write organizations.mfa_required_roles',
    not has_column_privilege('authenticated', 'public.organizations', 'mfa_required_roles', 'UPDATE')
  union all select 'privileges', 'clients cannot insert / update / delete notifications',
    not has_table_privilege('authenticated', 'public.notifications', 'INSERT')
    and not has_table_privilege('authenticated', 'public.notifications', 'UPDATE')
    and not has_table_privilege('authenticated', 'public.notifications', 'DELETE')
  union all select 'privileges', 'anon cannot read notifications or profiles',
    not has_table_privilege('anon', 'public.notifications', 'SELECT') and not has_table_privilege('anon', 'public.profiles', 'SELECT')
  union all select 'privileges', 'clients cannot call notify()',
    not has_function_privilege('authenticated', 'public.notify(uuid, uuid, text, text, text, text, text, text, jsonb)', 'EXECUTE')
  union all select 'privileges', 'anon cannot execute any SECURITY DEFINER function in public',
    not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                where n.nspname = 'public' and p.prosecdef and has_function_privilege('anon', p.oid, 'EXECUTE'))
  union all select 'privileges', 'every SECURITY DEFINER function pins search_path',
    not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                where n.nspname = 'public' and p.prosecdef
                  and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%'))
  -- audit
  union all select 'audit', 'audit_log append-only triggers present',
    (select count(*) from pg_trigger where tgrelid = 'public.audit_log'::regclass and tgname in ('audit_log_no_update','audit_log_no_truncate')) = 2
  -- notifications / realtime
  union all select 'realtime', 'notifications are in the supabase_realtime publication',
    exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications')
  union all select 'notifications', 'team + security-policy triggers present',
    exists (select 1 from pg_trigger where tgname = 'notify_member_change')
    and exists (select 1 from pg_trigger where tgname = 'notify_security_policy')
  -- storage
  union all select 'storage', 'buckets avatars + org-logos: private, 2 MB, PNG/JPEG/WebP',
    (select count(*) from storage.buckets where id in ('avatars','org-logos') and not public and file_size_limit = 2097152
       and allowed_mime_types @> array['image/png','image/jpeg','image/webp'] and cardinality(allowed_mime_types) = 3) = 2
  union all select 'storage', '8 storage policies (tc avatars * / tc logos *)',
    (select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname like 'tc %') = 8
  -- search
  union all select 'search', 'pg_trgm installed',
    exists (select 1 from pg_extension where extname = 'pg_trgm')
  union all select 'search', 'trigram indexes on companies / products / saved_items',
    (select count(*) from pg_indexes where schemaname = 'public'
       and indexname in ('companies_search_trgm','products_search_trgm','saved_items_search_trgm')) = 3
  union all select 'search', 'global_search() executable by authenticated only',
    has_function_privilege('authenticated', 'public.global_search(uuid, text, integer)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.global_search(uuid, text, integer)', 'EXECUTE')
  union all select 'search', 'az_fold folds Azerbaijani letters', public.az_fold('Şəhər İçəri ĞÜÖÇ') = 'seher iceri guoc'
  -- 2FA
  union all select '2fa', 'RLS helpers include the 2FA gate (0012 applied)',
    pg_get_functiondef('public.member_org_ids()'::regprocedure) like '%_session_aal()%'
  union all select '2fa', 'set_security_policy protects the current policy too',
    pg_get_functiondef('public.set_security_policy(uuid, text[])'::regprocedure) like '%v_current%'
  union all select '2fa', 'no organization requires 2FA yet (default off)',
    not exists (select 1 from public.organizations where cardinality(mfa_required_roles) > 0)
  -- roles (2A matrix)
  union all select 'roles', '5 system roles, 125 role-permission pairs',
    (select count(*) from public.roles where org_id is null) = 5
    and (select count(*) from public.role_permissions rp join public.roles r on r.id = rp.role_id where r.org_id is null) = 125
)
select area, name, case when ok then 'PASS' else 'FAIL' end as result from checks
order by ok, area, name;
