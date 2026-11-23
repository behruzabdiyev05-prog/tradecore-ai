-- ═════════════════════════════════════════════════════════════
-- TRADECORE AI · Migration 0006 · Phase 2A — Access functions & team RPCs
-- All SECURITY DEFINER functions pin search_path and are NOT executable by anon.
-- Rollback: supabase/rollback/20261122000600_tenancy_functions.down.sql
-- ═════════════════════════════════════════════════════════════

-- ── Access helpers (used by every RLS policy) ────────────────
-- Set-returning helpers let policies use `org_id in (select …)`, which
-- PostgreSQL evaluates once per query instead of once per row.

create function public.member_org_ids()
returns setof uuid language sql stable security definer set search_path = public, pg_temp as $$
  select m.org_id
  from organization_members m
  join organizations o on o.id = m.org_id and o.status = 'active'
  where m.user_id = auth.uid() and m.status = 'active'
$$;

create function public.org_ids_with(p_key text)
returns setof uuid language sql stable security definer set search_path = public, pg_temp as $$
  select m.org_id
  from organization_members m
  join organizations o on o.id = m.org_id and o.status = 'active'
  join role_permissions rp on rp.role_id = m.role_id and rp.permission_key = p_key
  where m.user_id = auth.uid() and m.status = 'active'
$$;

-- (org, module) pairs the user may read/write: needs the module permission AND the plan must include the module.
create function public.org_module_access(p_action text)
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

create function public.is_member(p_org uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.member_org_ids() x where x = p_org)
$$;

create function public.has_permission(p_org uuid, p_key text)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.org_ids_with(p_key) x where x = p_org)
$$;

create function public.org_has_module(p_org uuid, p_module text)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from organization_subscriptions s join plans p on p.id = s.plan_id
    where s.org_id = p_org and s.status in ('active', 'past_due') and p_module = any (p.modules))
$$;

create function public.current_org_id()
returns uuid language sql stable security definer set search_path = public, pg_temp as $$
  select active_org_id from profiles where id = auth.uid()
$$;

-- Server-side access check used by Netlify Functions (with the caller's own JWT).
-- p_org NULL = the caller's active organization.
-- Returns: ok | not_member | suspended | org_inactive | forbidden
create function public.check_access(p_org uuid, p_keys text[])
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

-- ── Internal helpers (not callable by clients) ───────────────
create function public._role_id(p_key text)
returns uuid language sql stable security definer set search_path = public, pg_temp as $$
  select id from roles where key = p_key and org_id is null
$$;

create function public._member_role_key(p_org uuid, p_user uuid)
returns text language sql stable security definer set search_path = public, pg_temp as $$
  select r.key from organization_members m join roles r on r.id = m.role_id
  where m.org_id = p_org and m.user_id = p_user
$$;

-- Mirrors canAssignRole() in shared/permissions.js
create function public._can_manage(p_actor_role text, p_target_role text, p_new_role text, p_is_self boolean)
returns boolean language sql immutable as $$
  select case
    when p_is_self then false
    when p_actor_role = 'owner' then true
    when p_actor_role = 'admin' then coalesce(p_target_role, '') not in ('owner', 'admin')
                                     and p_new_role in ('manager', 'employee', 'viewer')
    else false
  end
$$;

create function public._deny(p_message text)
returns void language plpgsql as $$
begin
  raise exception '%', p_message using errcode = 'insufficient_privilege';
end $$;

create function public._create_org(p_user uuid, p_name text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_org uuid;
begin
  insert into organizations (name, created_by) values (left(trim(p_name), 200), p_user) returning id into v_org;
  insert into organization_members (org_id, user_id, role_id) values (v_org, p_user, public._role_id('owner'));
  insert into organization_subscriptions (org_id, plan_id) select v_org, id from plans where key = 'internal';
  update profiles set active_org_id = v_org where id = p_user and active_org_id is null;
  return v_org;
end $$;

-- ── Last-owner protection (applies even to direct DB writes) ──
create function public.protect_last_owner()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_owner uuid := public._role_id('owner'); v_remaining int;
begin
  if old.role_id = v_owner and old.status = 'active'
     and (tg_op = 'DELETE' or new.role_id <> v_owner or new.status <> 'active' or new.org_id <> old.org_id) then
    -- allow when the whole organization is being deleted
    if tg_op = 'DELETE' and not exists (select 1 from organizations where id = old.org_id) then
      return old;
    end if;
    select count(*) into v_remaining from organization_members
      where org_id = old.org_id and role_id = v_owner and status = 'active' and id <> old.id;
    if v_remaining = 0 then
      raise exception 'Şirkətin sonuncu Sahibi silinə, dayandırıla və ya rolu azaldıla bilməz'
        using errcode = 'insufficient_privilege';
    end if;
  end if;
  return coalesce(new, old);
end $$;

create trigger organization_members_protect_last_owner
  before update or delete on public.organization_members
  for each row execute function public.protect_last_owner();

-- ── Signup: own organization unless joining by invite (decision 2) ──
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
begin
  insert into profiles (id, full_name)
  values (new.id, nullif(trim(v_meta ->> 'full_name'), ''))
  on conflict (id) do nothing;

  -- Only these two keys are read from (user-controlled) metadata; org_id/role keys are ignored.
  if coalesce(v_meta ->> 'invite_token', '') = '' then
    perform public._create_org(new.id, coalesce(
      nullif(trim(v_meta ->> 'company_name'), ''),
      coalesce(nullif(trim(v_meta ->> 'full_name'), ''), split_part(new.email, '@', 1)) || ' şirkəti'));
  end if;
  return new;
end $$;

-- ── Client RPCs ──────────────────────────────────────────────
create function public.my_orgs()
returns table (org_id uuid, name text, base_currency char(3), role_key text, role_name text,
               permissions text[], modules text[], is_active boolean)
language sql stable security definer set search_path = public, pg_temp as $$
  select o.id, o.name, o.base_currency, r.key, r.name,
         array(select rp.permission_key from role_permissions rp where rp.role_id = m.role_id order by 1),
         coalesce((select p.modules from organization_subscriptions s join plans p on p.id = s.plan_id
                   where s.org_id = o.id and s.status in ('active', 'past_due')), '{}'),
         o.id = (select active_org_id from profiles where id = auth.uid())
  from organization_members m
  join organizations o on o.id = m.org_id and o.status = 'active'
  join roles r on r.id = m.role_id
  where m.user_id = auth.uid() and m.status = 'active'
  order by o.name
$$;

create function public.switch_org(p_org uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.is_member(p_org) then perform public._deny('Bu şirkətin üzvü deyilsiniz'); end if;
  update profiles set active_org_id = p_org where id = auth.uid();
end $$;

create function public.create_organization(p_name text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then perform public._deny('Daxil olmaq tələb olunur'); end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'Şirkətin adı məcburidir'; end if;
  return public._create_org(auth.uid(), p_name);
end $$;

create function public.list_members(p_org uuid)
returns table (user_id uuid, email text, full_name text, role_key text, role_name text, status text, joined_at timestamptz)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.has_permission(p_org, 'members.read') then perform public._deny('İcazə yoxdur'); end if;
  return query
    select m.user_id, u.email::text, p.full_name, r.key, r.name, m.status, m.joined_at
    from organization_members m
    join roles r on r.id = m.role_id
    join auth.users u on u.id = m.user_id
    left join profiles p on p.id = m.user_id
    where m.org_id = p_org
    order by r.rank, m.joined_at;
end $$;

create function public.create_invite(p_org uuid, p_email text, p_role_key text)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_email text := lower(trim(p_email));
  v_actor_role text := public._member_role_key(p_org, auth.uid());
  v_role uuid := public._role_id(p_role_key);
  v_limit int;
  v_token text;
begin
  if not public.has_permission(p_org, 'members.manage') then perform public._deny('Dəvət göndərmək icazəniz yoxdur'); end if;
  if v_role is null then raise exception 'Naməlum rol: %', p_role_key; end if;
  if not public._can_manage(v_actor_role, null, p_role_key, false) then
    perform public._deny('Bu rolu təyin etmək icazəniz yoxdur');
  end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Yanlış e-poçt ünvanı'; end if;
  if exists (select 1 from organization_members m join auth.users u on u.id = m.user_id
             where m.org_id = p_org and lower(u.email) = v_email) then
    raise exception 'Bu istifadəçi artıq şirkətin üzvüdür';
  end if;
  select (p.limits ->> 'max_members')::int into v_limit
    from organization_subscriptions s join plans p on p.id = s.plan_id where s.org_id = p_org;
  if v_limit is not null and (select count(*) from organization_members where org_id = p_org and status = 'active')
       + (select count(*) from organization_invites where org_id = p_org and accepted_at is null
            and revoked_at is null and expires_at > now()) >= v_limit then
    raise exception 'Planın üzv limiti dolub (%)', v_limit;
  end if;

  -- one pending invite per email per org
  update organization_invites set revoked_at = now()
    where org_id = p_org and email = v_email and accepted_at is null and revoked_at is null;

  v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  insert into organization_invites (org_id, email, role_id, token_hash, created_by)
    values (p_org, v_email, v_role, sha256(convert_to(v_token, 'UTF8')), auth.uid());
  return v_token;   -- shown once; only its hash is stored
end $$;

create function public.accept_invite(p_token text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_inv organization_invites; v_email text; v_confirmed timestamptz;
begin
  if auth.uid() is null then perform public._deny('Daxil olmaq tələb olunur'); end if;
  select * into v_inv from organization_invites where token_hash = sha256(convert_to(coalesce(p_token, ''), 'UTF8'));
  if v_inv.id is null then raise exception 'Dəvət etibarsızdır'; end if;
  if v_inv.revoked_at is not null then raise exception 'Dəvət ləğv edilib'; end if;
  if v_inv.accepted_at is not null then raise exception 'Dəvət artıq istifadə olunub'; end if;
  if v_inv.expires_at <= now() then raise exception 'Dəvətin vaxtı bitib'; end if;

  select lower(email), email_confirmed_at into v_email, v_confirmed from auth.users where id = auth.uid();
  if v_confirmed is null then perform public._deny('E-poçt ünvanınız təsdiqlənməyib'); end if;
  if v_email is distinct from v_inv.email then perform public._deny('Dəvət başqa e-poçt ünvanı üçündür'); end if;
  if exists (select 1 from organization_members where org_id = v_inv.org_id and user_id = auth.uid()) then
    raise exception 'Siz artıq bu şirkətin üzvüsünüz';
  end if;

  insert into organization_members (org_id, user_id, role_id, invited_by)
    values (v_inv.org_id, auth.uid(), v_inv.role_id, v_inv.created_by);
  update organization_invites set accepted_at = now(), accepted_by = auth.uid() where id = v_inv.id;
  update profiles set active_org_id = v_inv.org_id where id = auth.uid() and active_org_id is null;
  return v_inv.org_id;
end $$;

create function public.revoke_invite(p_invite uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_org uuid;
begin
  select org_id into v_org from organization_invites where id = p_invite;
  if v_org is null or not public.has_permission(v_org, 'members.manage') then perform public._deny('İcazə yoxdur'); end if;
  update organization_invites set revoked_at = now() where id = p_invite and accepted_at is null and revoked_at is null;
end $$;

create function public.set_member_role(p_user uuid, p_org uuid, p_role_key text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_target text := public._member_role_key(p_org, p_user); v_role uuid := public._role_id(p_role_key);
begin
  if not public.has_permission(p_org, 'members.manage') then perform public._deny('İcazə yoxdur'); end if;
  if v_target is null then raise exception 'Üzv tapılmadı'; end if;
  if v_role is null then raise exception 'Naməlum rol: %', p_role_key; end if;
  if not public._can_manage(public._member_role_key(p_org, auth.uid()), v_target, p_role_key, p_user = auth.uid()) then
    perform public._deny('Bu dəyişiklik üçün icazəniz yoxdur');
  end if;
  update organization_members set role_id = v_role where org_id = p_org and user_id = p_user;
end $$;

create function public.set_member_status(p_user uuid, p_org uuid, p_status text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_target text := public._member_role_key(p_org, p_user);
begin
  if not public.has_permission(p_org, 'members.manage') then perform public._deny('İcazə yoxdur'); end if;
  if v_target is null then raise exception 'Üzv tapılmadı'; end if;
  if p_status not in ('active', 'suspended') then raise exception 'Yanlış status'; end if;
  -- same authority rule as role changes (target keeps its role)
  if not public._can_manage(public._member_role_key(p_org, auth.uid()), v_target,
                            case when v_target in ('owner', 'admin') then v_target else 'viewer' end,
                            p_user = auth.uid()) then
    perform public._deny('Bu dəyişiklik üçün icazəniz yoxdur');
  end if;
  update organization_members set status = p_status where org_id = p_org and user_id = p_user;
end $$;

create function public.remove_member(p_user uuid, p_org uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_target text := public._member_role_key(p_org, p_user);
begin
  if v_target is null then raise exception 'Üzv tapılmadı'; end if;
  if p_user <> auth.uid() then   -- leaving yourself is always allowed (last-owner trigger still applies)
    if not public.has_permission(p_org, 'members.manage') then perform public._deny('İcazə yoxdur'); end if;
    if not public._can_manage(public._member_role_key(p_org, auth.uid()), v_target,
                              case when v_target in ('owner', 'admin') then v_target else 'viewer' end, false) then
      perform public._deny('Bu dəyişiklik üçün icazəniz yoxdur');
    end if;
  end if;
  delete from organization_members where org_id = p_org and user_id = p_user;
  update profiles set active_org_id = (select org_id from organization_members
                                       where user_id = p_user and status = 'active' order by joined_at limit 1)
    where id = p_user and active_org_id = p_org;
end $$;

-- ── Policies for tenancy tables ──────────────────────────────
create policy "member orgs readable" on public.organizations
  for select to authenticated using (id in (select public.member_org_ids()));
create policy "org.manage updates org" on public.organizations
  for update to authenticated
  using (id in (select public.org_ids_with('org.manage')))
  with check (id in (select public.org_ids_with('org.manage')));

create policy "catalogue readable" on public.permissions for select to authenticated using (true);
create policy "plans readable" on public.plans for select to authenticated using (true);
create policy "roles readable" on public.roles
  for select to authenticated using (org_id is null or org_id in (select public.member_org_ids()));
create policy "role permissions readable" on public.role_permissions
  for select to authenticated using (role_id in (select id from public.roles));

create policy "members readable with members.read" on public.organization_members
  for select to authenticated using (org_id in (select public.org_ids_with('members.read')));
create policy "invites readable with members.manage" on public.organization_invites
  for select to authenticated using (org_id in (select public.org_ids_with('members.manage')));
create policy "subscription readable by members" on public.organization_subscriptions
  for select to authenticated using (org_id in (select public.member_org_ids()));

-- ── Function privileges: nothing for anon; RPCs for authenticated only ──
do $$
declare f text;
begin
  for f in select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.prosecdef loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
end $$;
revoke all on function public._can_manage(text, text, text, boolean) from public, anon, authenticated;
revoke all on function public._deny(text) from public, anon, authenticated;

grant execute on function
  public.member_org_ids(), public.org_ids_with(text), public.org_module_access(text),
  public.is_member(uuid), public.has_permission(uuid, text), public.org_has_module(uuid, text),
  public.current_org_id(), public.check_access(uuid, text[]),
  public.my_orgs(), public.switch_org(uuid), public.create_organization(text), public.list_members(uuid),
  public.create_invite(uuid, text, text), public.accept_invite(text), public.revoke_invite(uuid),
  public.set_member_role(uuid, uuid, text), public.set_member_status(uuid, uuid, text), public.remove_member(uuid, uuid)
to authenticated;
