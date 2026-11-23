-- ═════════════════════════════════════════════════════════════
-- TRADECORE AI · Migration 0012 · Phase 2B — Organization-level 2FA (decision G)
-- If an organization requires 2FA for a member's role (organizations.mfa_required_roles,
-- default: none = off) and the session is not 2FA-verified (JWT aal ≠ aal2), that
-- organization's data stays closed: the RLS helpers below simply do not return it.
-- The 2A function files are not edited; the helpers are replaced here (create or replace)
-- and restored by the rollback script.
-- Rollback: supabase/rollback/20261123001200_mfa_enforcement.down.sql
-- ═════════════════════════════════════════════════════════════

create or replace function public.member_org_ids()
returns setof uuid language sql stable security definer set search_path = public, pg_temp as $$
  select m.org_id
  from organization_members m
  join organizations o on o.id = m.org_id and o.status = 'active'
  join roles r on r.id = m.role_id
  where m.user_id = auth.uid() and m.status = 'active'
    and (not (r.key = any (o.mfa_required_roles)) or public._session_aal() = 'aal2')
$$;

create or replace function public.org_ids_with(p_key text)
returns setof uuid language sql stable security definer set search_path = public, pg_temp as $$
  select m.org_id
  from organization_members m
  join organizations o on o.id = m.org_id and o.status = 'active'
  join roles r on r.id = m.role_id
  join role_permissions rp on rp.role_id = m.role_id and rp.permission_key = p_key
  where m.user_id = auth.uid() and m.status = 'active'
    and (not (r.key = any (o.mfa_required_roles)) or public._session_aal() = 'aal2')
$$;

create or replace function public.org_module_access(p_action text)
returns table (org_id uuid, module_key text)
language sql stable security definer set search_path = public, pg_temp as $$
  select m.org_id, mk.key
  from organization_members m
  join organizations o on o.id = m.org_id and o.status = 'active'
  join roles r on r.id = m.role_id
  join organization_subscriptions s on s.org_id = m.org_id and s.status in ('active', 'past_due')
  join plans p on p.id = s.plan_id
  join modules mk on mk.key = any (p.modules) and mk.is_enabled
  join role_permissions rp on rp.role_id = m.role_id and rp.permission_key = 'module.' || mk.key || '.' || p_action
  where m.user_id = auth.uid() and m.status = 'active'
    and (not (r.key = any (o.mfa_required_roles)) or public._session_aal() = 'aal2')
$$;

-- Server-side check: new status 'mfa_required' (netlify/lib/auth.mjs maps it to 403 MFA_REQUIRED).
create or replace function public.check_access(p_org uuid, p_keys text[])
returns text language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_org uuid := coalesce(p_org, public.current_org_id()); v_status text; v_org_status text; v_mfa boolean; k text;
begin
  if v_org is null then return 'not_member'; end if;
  select m.status, o.status, r.key = any (o.mfa_required_roles) into v_status, v_org_status, v_mfa
  from organization_members m join organizations o on o.id = m.org_id join roles r on r.id = m.role_id
  where m.org_id = v_org and m.user_id = auth.uid();
  if v_status is null then return 'not_member'; end if;
  if v_status <> 'active' then return 'suspended'; end if;
  if v_org_status <> 'active' then return 'org_inactive'; end if;
  if v_mfa and public._session_aal() <> 'aal2' then return 'mfa_required'; end if;
  foreach k in array coalesce(p_keys, '{}') loop
    if not public.has_permission(v_org, k) then return 'forbidden'; end if;
  end loop;
  return 'ok';
end $$;

-- Switching to such an organization stays possible, so the app can show the 2FA screen.
create or replace function public.switch_org(p_org uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not exists (select 1 from organization_members m join organizations o on o.id = m.org_id and o.status = 'active'
                 where m.org_id = p_org and m.user_id = auth.uid() and m.status = 'active') then
    perform public._deny('Bu şirkətin üzvü deyilsiniz');
  end if;
  update profiles set active_org_id = p_org where id = auth.uid();
end $$;

-- The policy itself is protected by 2FA: whoever's role is in the CURRENT or the NEW policy
-- must change it from a 2FA session (aal2). Otherwise someone holding only the Owner's
-- password could switch the requirement off. (0009 only guarded the new policy.)
create or replace function public.set_security_policy(p_org uuid, p_roles text[])
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_role text; v_current text[]; v_roles text[] := coalesce(p_roles, '{}');
begin
  select r.key, o.mfa_required_roles into v_role, v_current
  from organization_members m
  join organizations o on o.id = m.org_id and o.status = 'active'
  join roles r on r.id = m.role_id
  where m.org_id = p_org and m.user_id = auth.uid() and m.status = 'active';
  if v_role is distinct from 'owner' then perform public._deny('Təhlükəsizlik siyasətini yalnız Sahib dəyişə bilər'); end if;
  if not (v_roles <@ array['owner','admin','manager','employee','viewer']) then
    raise exception 'Naməlum rol' using errcode = '22023';
  end if;
  if (v_role = any (v_roles) or v_role = any (v_current)) and public._session_aal() <> 'aal2' then
    perform public._deny('Əvvəlcə özünüz üçün iki addımlı girişi aktivləşdirin və onunla daxil olun');
  end if;
  update organizations
     set mfa_required_roles = array(select distinct x from unnest(v_roles) x order by 1)
   where id = p_org;
end $$;

-- For the UI: in which of my organizations does this session still need 2FA?
create function public.org_mfa_gate()
returns table (org_id uuid, required boolean)
language sql stable security definer set search_path = public, pg_temp as $$
  select m.org_id, (r.key = any (o.mfa_required_roles) and public._session_aal() <> 'aal2')
  from organization_members m
  join organizations o on o.id = m.org_id and o.status = 'active'
  join roles r on r.id = m.role_id
  where m.user_id = auth.uid() and m.status = 'active'
$$;

revoke all on function public.org_mfa_gate() from public, anon, authenticated;
grant execute on function public.org_mfa_gate() to authenticated;
-- create or replace keeps the existing grants of the replaced functions (anon: none).
