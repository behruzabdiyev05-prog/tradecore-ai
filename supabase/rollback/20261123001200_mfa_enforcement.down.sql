-- Rollback of 20261123001200_mfa_enforcement.sql
-- Restores the Phase 2A versions (byte-for-byte the bodies from 20261122000600_tenancy_functions.sql).
-- organizations.mfa_required_roles stays (dropped by the 0009 rollback); it simply has no effect any more.

create or replace function public.member_org_ids()
returns setof uuid language sql stable security definer set search_path = public, pg_temp as $$
  select m.org_id
  from organization_members m
  join organizations o on o.id = m.org_id and o.status = 'active'
  where m.user_id = auth.uid() and m.status = 'active'
$$;

create or replace function public.org_ids_with(p_key text)
returns setof uuid language sql stable security definer set search_path = public, pg_temp as $$
  select m.org_id
  from organization_members m
  join organizations o on o.id = m.org_id and o.status = 'active'
  join role_permissions rp on rp.role_id = m.role_id and rp.permission_key = p_key
  where m.user_id = auth.uid() and m.status = 'active'
$$;

create or replace function public.org_module_access(p_action text)
returns table (org_id uuid, module_key text)
language sql stable security definer set search_path = public, pg_temp as $$
  select m.org_id, mk.key
  from organization_members m
  join organizations o on o.id = m.org_id and o.status = 'active'
  join organization_subscriptions s on s.org_id = m.org_id and s.status in ('active', 'past_due')
  join plans p on p.id = s.plan_id
  join modules mk on mk.key = any (p.modules) and mk.is_enabled
  join role_permissions rp on rp.role_id = m.role_id and rp.permission_key = 'module.' || mk.key || '.' || p_action
  where m.user_id = auth.uid() and m.status = 'active'
$$;

create or replace function public.check_access(p_org uuid, p_keys text[])
returns text language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_org uuid := coalesce(p_org, public.current_org_id()); v_status text; v_org_status text; k text;
begin
  if v_org is null then return 'not_member'; end if;
  select m.status, o.status into v_status, v_org_status
  from organization_members m join organizations o on o.id = m.org_id
  where m.org_id = v_org and m.user_id = auth.uid();
  if v_status is null then return 'not_member'; end if;
  if v_status <> 'active' then return 'suspended'; end if;
  if v_org_status <> 'active' then return 'org_inactive'; end if;
  foreach k in array coalesce(p_keys, '{}') loop
    if not public.has_permission(v_org, k) then return 'forbidden'; end if;
  end loop;
  return 'ok';
end $$;

create or replace function public.switch_org(p_org uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.is_member(p_org) then perform public._deny('Bu şirkətin üzvü deyilsiniz'); end if;
  update profiles set active_org_id = p_org where id = auth.uid();
end $$;

-- set_security_policy: back to the 0009 version
create or replace function public.set_security_policy(p_org uuid, p_roles text[])
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

drop function if exists public.org_mfa_gate();
