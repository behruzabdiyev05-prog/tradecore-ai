-- ═════════════════════════════════════════════════════════════
-- TRADECORE AI · Migration 0009 · Phase 2B — Profile & settings
--  • profiles: phone, job title, avatar, preferences (+ column-level write grants:
--    active_org_id can no longer be written directly — only via switch_org())
--  • organizations: legal details (VÖEN), contacts, logo, 2FA policy
--  • Storage buckets `avatars` and `org-logos` (private) and their policies
--  • set_security_policy(): Owner only
-- Rollback: supabase/rollback/20261123000900_profiles_settings.down.sql
-- ═════════════════════════════════════════════════════════════

-- ── Preferences rule (mirrors shared/preferences.js; kept in sync by tests/sql/run_phase2b.sh) ──
create function public.valid_preferences(p jsonb)
returns boolean language plpgsql immutable set search_path = pg_catalog, pg_temp as $$
declare k text; v jsonb;
begin
  if p is null or jsonb_typeof(p) <> 'object' then return false; end if;
  if octet_length(p::text) > 8192 then return false; end if;
  for k, v in select * from jsonb_each(p) loop
    case k
      when 'theme'                then if v not in ('"light"'::jsonb, '"dark"'::jsonb) then return false; end if;
      when 'sidebar'              then if v not in ('"expanded"'::jsonb, '"collapsed"'::jsonb) then return false; end if;
      when 'onboarding_dismissed' then if jsonb_typeof(v) <> 'boolean' then return false; end if;
      when 'timezone'             then
        if jsonb_typeof(v) <> 'string' or length(v #>> '{}') > 64
           or (v #>> '{}') !~ '^[A-Za-z]+(/[A-Za-z0-9_+-]+){0,2}$' then return false; end if;
      else return false;
    end case;
  end loop;
  return true;
end $$;

-- ── Profiles ─────────────────────────────────────────────────
alter table public.profiles
  add column phone        text check (phone is null or phone ~ '^\+?[0-9 ()-]{5,20}$'),
  add column job_title    text check (job_title is null or length(job_title) <= 100),
  add column avatar_path  text check (avatar_path is null or (split_part(avatar_path, '/', 1) = id::text
                                       and avatar_path ~ '^[0-9a-f-]{36}/[A-Za-z0-9._-]{1,100}$')),
  add column preferences  jsonb not null default '{}'::jsonb check (public.valid_preferences(preferences));
-- Existing rows keep their values; new writes are checked.
alter table public.profiles add constraint profiles_locale_check check (locale in ('az', 'en', 'ru')) not valid;
alter table public.profiles add constraint profiles_full_name_check check (full_name is null or length(full_name) <= 200) not valid;

-- Column-level write grants. Phase 1 granted UPDATE on the whole row, which let a user
-- write active_org_id directly (RLS still hid foreign data). Now only switch_org() can.
revoke insert, update, delete, truncate, references, trigger on public.profiles from anon, authenticated;
revoke select on public.profiles from anon;
grant update (full_name, locale, base_currency, phone, job_title, avatar_path, preferences) on public.profiles to authenticated;

-- ── Organizations: legal details, logo, 2FA policy ───────────
alter table public.organizations
  add column legal_name          text check (legal_name is null or length(legal_name) <= 200),
  add column tax_id              text check (tax_id is null or tax_id ~ '^[0-9]{10}$'),   -- VÖEN: 10 digits
  add column address             text check (address is null or length(address) <= 300),
  add column phone               text check (phone is null or phone ~ '^\+?[0-9 ()-]{5,20}$'),
  add column email               text check (email is null or (length(email) <= 200 and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')),
  add column website             text check (website is null or (length(website) <= 200 and website ~ '^https?://[^\s<>"]+$')),
  add column logo_path           text check (logo_path is null or (split_part(logo_path, '/', 1) = id::text
                                              and logo_path ~ '^[0-9a-f-]{36}/[A-Za-z0-9._-]{1,100}$')),
  add column mfa_required_roles  text[] not null default '{}'
                                 check (mfa_required_roles <@ array['owner','admin','manager','employee','viewer']);

-- mfa_required_roles is deliberately NOT in this list: set_security_policy() only.
grant update (legal_name, tax_id, address, phone, email, website, logo_path) on public.organizations to authenticated;

-- ── Security policy (Owner only — role matrix unchanged, decision A) ──
-- Session assurance level from the Supabase JWT: aal1 = password, aal2 = password + 2FA.
create function public._session_aal()
returns text language sql stable set search_path = pg_catalog, pg_temp as $$
  select coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'aal',
    nullif(current_setting('request.jwt.claim.aal', true), ''),
    'aal1')
$$;

create function public.set_security_policy(p_org uuid, p_roles text[])
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_role text; v_roles text[] := coalesce(p_roles, '{}');
begin
  select r.key into v_role
  from organization_members m
  join organizations o on o.id = m.org_id and o.status = 'active'
  join roles r on r.id = m.role_id
  where m.org_id = p_org and m.user_id = auth.uid() and m.status = 'active';
  if v_role is distinct from 'owner' then perform public._deny('Təhlükəsizlik siyasətini yalnız Sahib dəyişə bilər'); end if;
  if not (v_roles <@ array['owner','admin','manager','employee','viewer']) then
    raise exception 'Naməlum rol' using errcode = '22023';
  end if;
  -- Lock-out guard: you cannot require 2FA for your own role from a session without 2FA.
  if v_role = any (v_roles) and public._session_aal() <> 'aal2' then
    perform public._deny('Əvvəlcə özünüz üçün iki addımlı girişi aktivləşdirin və onunla daxil olun');
  end if;
  update organizations
     set mfa_required_roles = array(select distinct x from unnest(v_roles) x order by 1)
   where id = p_org;
end $$;

-- ── Storage (Supabase). Skipped when the storage schema is absent (plain PostgreSQL). ──
-- Avatars:   avatars/<user_id>/<file>   — write: the user; read: the user + members of a shared org
-- Org logos: org-logos/<org_id>/<file>  — write: org.manage; read: members of the org
create function public.can_view_avatar(p_folder text)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select p_folder = auth.uid()::text
      or exists (select 1 from organization_members m
                 where m.user_id::text = p_folder and m.status = 'active'
                   and m.org_id in (select public.member_org_ids()))
$$;

do $$
begin
  if to_regclass('storage.objects') is null then
    raise notice 'storage schema not found — buckets and storage policies skipped';
    return;
  end if;

  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
    ('avatars',   'avatars',   false, 2097152, array['image/png','image/jpeg','image/webp']),
    ('org-logos', 'org-logos', false, 2097152, array['image/png','image/jpeg','image/webp'])
  on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
                                 allowed_mime_types = excluded.allowed_mime_types;

  create policy "tc avatars read" on storage.objects for select to authenticated
    using (bucket_id = 'avatars' and public.can_view_avatar((storage.foldername(name))[1]));
  create policy "tc avatars insert" on storage.objects for insert to authenticated
    with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text
                and cardinality(storage.foldername(name)) = 1);
  create policy "tc avatars update" on storage.objects for update to authenticated
    using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)
    with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text
                and cardinality(storage.foldername(name)) = 1);
  create policy "tc avatars delete" on storage.objects for delete to authenticated
    using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

  create policy "tc logos read" on storage.objects for select to authenticated
    using (bucket_id = 'org-logos' and (storage.foldername(name))[1] in (select x::text from public.member_org_ids() x));
  create policy "tc logos insert" on storage.objects for insert to authenticated
    with check (bucket_id = 'org-logos' and cardinality(storage.foldername(name)) = 1
                and (storage.foldername(name))[1] in (select x::text from public.org_ids_with('org.manage') x));
  create policy "tc logos update" on storage.objects for update to authenticated
    using (bucket_id = 'org-logos' and (storage.foldername(name))[1] in (select x::text from public.org_ids_with('org.manage') x))
    with check (bucket_id = 'org-logos' and cardinality(storage.foldername(name)) = 1
                and (storage.foldername(name))[1] in (select x::text from public.org_ids_with('org.manage') x));
  create policy "tc logos delete" on storage.objects for delete to authenticated
    using (bucket_id = 'org-logos' and (storage.foldername(name))[1] in (select x::text from public.org_ids_with('org.manage') x));
end $$;

-- ── Function privileges ──────────────────────────────────────
revoke all on function public.set_security_policy(uuid, text[]), public.can_view_avatar(text) from public, anon, authenticated;
revoke all on function public._session_aal() from public, anon;
grant execute on function public.set_security_policy(uuid, text[]), public.can_view_avatar(text),
                          public._session_aal(), public.valid_preferences(jsonb) to authenticated;
