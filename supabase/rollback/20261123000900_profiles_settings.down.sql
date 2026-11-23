-- Rollback of 20261123000900_profiles_settings.sql
-- WARNING: deletes the 2B profile fields (phone, job title, avatar path, preferences) and the
-- organization details (legal name, VÖEN, contacts, logo path, 2FA policy).
-- Storage buckets `avatars` / `org-logos` and their files are NOT deleted (Supabase only allows
-- that through the Storage API); without the policies below nobody can read or write them.
do $$
begin
  if to_regclass('storage.objects') is not null then
    drop policy if exists "tc avatars read"   on storage.objects;
    drop policy if exists "tc avatars insert" on storage.objects;
    drop policy if exists "tc avatars update" on storage.objects;
    drop policy if exists "tc avatars delete" on storage.objects;
    drop policy if exists "tc logos read"     on storage.objects;
    drop policy if exists "tc logos insert"   on storage.objects;
    drop policy if exists "tc logos update"   on storage.objects;
    drop policy if exists "tc logos delete"   on storage.objects;
  end if;
end $$;

drop function if exists public.set_security_policy(uuid, text[]);
drop function if exists public.can_view_avatar(text);
drop function if exists public._session_aal();

alter table public.organizations
  drop column if exists legal_name, drop column if exists tax_id, drop column if exists address,
  drop column if exists phone, drop column if exists email, drop column if exists website,
  drop column if exists logo_path, drop column if exists mfa_required_roles;

alter table public.profiles
  drop constraint if exists profiles_locale_check,
  drop constraint if exists profiles_full_name_check,
  drop column if exists phone, drop column if exists job_title,
  drop column if exists avatar_path, drop column if exists preferences;
drop function if exists public.valid_preferences(jsonb);

-- Restore exactly the privileges profiles had before 0009 (verified by the pg_dump diff in
-- tests/sql/run_phase2b.sh): whole-row select/insert/update/delete for authenticated, nothing for anon.
revoke update (full_name, locale, base_currency) on public.profiles from authenticated;
revoke all on public.profiles from anon, authenticated;
grant select, insert, update, delete on public.profiles to authenticated;
