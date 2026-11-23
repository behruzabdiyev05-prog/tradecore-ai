-- Rollback of 20261122000600_tenancy_functions.sql

drop policy "member orgs readable"                 on public.organizations;
drop policy "org.manage updates org"               on public.organizations;
drop policy "catalogue readable"                   on public.permissions;
drop policy "plans readable"                       on public.plans;
drop policy "roles readable"                       on public.roles;
drop policy "role permissions readable"            on public.role_permissions;
drop policy "members readable with members.read"   on public.organization_members;
drop policy "invites readable with members.manage" on public.organization_invites;
drop policy "subscription readable by members"     on public.organization_subscriptions;

drop trigger organization_members_protect_last_owner on public.organization_members;

drop function public.protect_last_owner();
drop function public.my_orgs();
drop function public.switch_org(uuid);
drop function public.create_organization(text);
drop function public.list_members(uuid);
drop function public.create_invite(uuid, text, text);
drop function public.accept_invite(text);
drop function public.revoke_invite(uuid);
drop function public.set_member_role(uuid, uuid, text);
drop function public.set_member_status(uuid, uuid, text);
drop function public.remove_member(uuid, uuid);
drop function public.check_access(uuid, text[]);
drop function public.current_org_id();
drop function public.org_has_module(uuid, text);
drop function public.has_permission(uuid, text);
drop function public.is_member(uuid);
drop function public.org_module_access(text);
drop function public.org_ids_with(text);
drop function public.member_org_ids();
drop function public._create_org(uuid, text);
drop function public._deny(text);
drop function public._can_manage(text, text, text, boolean);
drop function public._member_role_key(uuid, uuid);
drop function public._role_id(text);

-- Phase 1 signup trigger function (verbatim from migration 0001)
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', null))
  on conflict (id) do nothing;
  return new;
end $$;
revoke all on function public.handle_new_user() from public, anon, authenticated;
