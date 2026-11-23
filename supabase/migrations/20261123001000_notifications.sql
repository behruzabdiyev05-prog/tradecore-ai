-- ═════════════════════════════════════════════════════════════
-- TRADECORE AI · Migration 0010 · Phase 2B — Notification centre
--  • notifications: created ONLY inside the database (notify()); clients can read
--    their own and mark them read through RPCs — never insert, update or delete.
--  • notification_preferences: per user + organization + type on/off
--  • team triggers, security-policy notification, activity feed (my_activity)
--  • retention: not deleted automatically (decision J)
-- Rollback: supabase/rollback/20261123001000_notifications.down.sql
-- ═════════════════════════════════════════════════════════════

create table public.notifications (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations (id) on delete cascade,
  user_id      uuid not null references auth.users (id) on delete cascade,     -- recipient
  type         text not null check (type ~ '^[a-z]+(\.[a-z_]+)+$' and length(type) <= 60),
  title        text not null check (length(title) between 1 and 200),          -- AZ fallback; the client renders type + data in the user's language
  body         text check (body is null or length(body) <= 1000),
  -- Internal links only: "/path…". No scheme, no "//host", no backslash, no whitespace.
  link         text check (link is null or (length(link) <= 300 and link ~ '^/[A-Za-z0-9/_?=&.%#-]*$' and link !~ '^//')),
  entity_type  text check (entity_type is null or length(entity_type) <= 60),
  entity_id    text check (entity_id is null or length(entity_id) <= 100),
  data         jsonb not null default '{}'::jsonb check (jsonb_typeof(data) = 'object' and octet_length(data::text) <= 4096),
  read_at      timestamptz,
  created_at   timestamptz not null default now()
);
create index notifications_recipient_idx on public.notifications (user_id, org_id, created_at desc);
create index notifications_unread_idx on public.notifications (user_id, org_id) where read_at is null;

create table public.notification_preferences (
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  org_id      uuid not null references public.organizations (id) on delete cascade,
  type        text not null check (type ~ '^[a-z]+(\.[a-z_]+)+$' and length(type) <= 60),
  enabled     boolean not null default true,
  updated_at  timestamptz not null default now(),
  primary key (user_id, org_id, type)
);
create trigger notification_preferences_updated_at before update on public.notification_preferences
  for each row execute function public.set_updated_at();

-- ── RLS + grants ─────────────────────────────────────────────
alter table public.notifications            enable row level security;
alter table public.notification_preferences enable row level security;

create policy "own notifications readable" on public.notifications
  for select to authenticated
  using (user_id = auth.uid() and org_id in (select public.member_org_ids()));

create policy "own preferences readable" on public.notification_preferences
  for select to authenticated using (user_id = auth.uid() and org_id in (select public.member_org_ids()));
create policy "own preferences insert" on public.notification_preferences
  for insert to authenticated with check (user_id = auth.uid() and org_id in (select public.member_org_ids()));
create policy "own preferences update" on public.notification_preferences
  for update to authenticated
  using (user_id = auth.uid() and org_id in (select public.member_org_ids()))
  with check (user_id = auth.uid() and org_id in (select public.member_org_ids()));
create policy "own preferences delete" on public.notification_preferences
  for delete to authenticated using (user_id = auth.uid() and org_id in (select public.member_org_ids()));

revoke all on public.notifications, public.notification_preferences from public, anon, authenticated;
grant select on public.notifications to authenticated;
grant select, insert, delete on public.notification_preferences to authenticated;
grant update (enabled) on public.notification_preferences to authenticated;

-- ── notify(): the only way a notification is created (internal) ──
-- Created only when the recipient is an active member of an active organization
-- and has not switched this type off. Returns the id, or NULL when skipped.
create function public.notify(p_org uuid, p_user uuid, p_type text, p_title text, p_body text,
                              p_link text, p_entity_type text, p_entity_id text, p_data jsonb)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid;
begin
  if not exists (select 1 from organization_members m join organizations o on o.id = m.org_id
                 where m.org_id = p_org and m.user_id = p_user and m.status = 'active' and o.status = 'active') then
    return null;
  end if;
  if exists (select 1 from notification_preferences
             where user_id = p_user and org_id = p_org and type = p_type and not enabled) then
    return null;
  end if;
  insert into notifications (org_id, user_id, type, title, body, link, entity_type, entity_id, data)
  values (p_org, p_user, p_type, left(p_title, 200), left(p_body, 1000), p_link, p_entity_type, p_entity_id,
          coalesce(p_data, '{}'::jsonb))
  returning id into v_id;
  return v_id;
end $$;

create function public._display_name(p_user uuid)
returns text language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(nullif(trim(p.full_name), ''), split_part(u.email, '@', 1), 'İstifadəçi')
  from auth.users u left join profiles p on p.id = u.id where u.id = p_user
$$;

-- ── Team events ──────────────────────────────────────────────
create function public.notify_member_change()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_name text := public._display_name(new.user_id); v_org text; v_role record; r record;
begin
  select name into v_org from organizations where id = new.org_id;
  select key, name into v_role from roles where id = new.role_id;

  if tg_op = 'INSERT' then
    -- the inviter: "your invite was accepted"
    if new.invited_by is not null and new.invited_by <> new.user_id then
      perform public.notify(new.org_id, new.invited_by, 'invite.accepted',
        format('%s dəvətinizi qəbul etdi', v_name), null, '/settings/team', 'member', new.user_id::text,
        jsonb_build_object('name', v_name, 'role', v_role.key));
    end if;
    -- everyone else who manages the team: "a new member joined"
    for r in select m.user_id from organization_members m
             join role_permissions rp on rp.role_id = m.role_id and rp.permission_key = 'members.manage'
             where m.org_id = new.org_id and m.status = 'active'
               and m.user_id <> new.user_id and m.user_id is distinct from new.invited_by loop
      perform public.notify(new.org_id, r.user_id, 'member.joined',
        format('%s komandaya qoşuldu', v_name), null, '/settings/team', 'member', new.user_id::text,
        jsonb_build_object('name', v_name, 'role', v_role.key));
    end loop;
    return null;
  end if;

  -- UPDATE: tell the member themselves (unless they did it)
  if new.user_id is distinct from auth.uid() then
    if new.role_id <> old.role_id then
      perform public.notify(new.org_id, new.user_id, 'member.role_changed',
        format('"%s" şirkətində rolunuz dəyişdi: %s', v_org, v_role.name), null, '/settings/team', 'member', new.user_id::text,
        jsonb_build_object('org', v_org, 'role', v_role.key));
    end if;
    if new.status <> old.status then
      -- a suspended member is not an active member, so notify() skips them; they are told on restore
      perform public.notify(new.org_id, new.user_id, 'member.status_changed',
        case when new.status = 'active' then format('"%s" şirkətində üzvlüyünüz bərpa olundu', v_org)
             else format('"%s" şirkətində üzvlüyünüz dayandırıldı', v_org) end,
        null, '/', 'member', new.user_id::text, jsonb_build_object('org', v_org, 'status', new.status));
    end if;
  end if;
  return null;
end $$;

create trigger notify_member_change after insert or update on public.organization_members
  for each row execute function public.notify_member_change();

-- ── Security policy changed → every other active member ──────
create function public.notify_security_policy()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare r record;
begin
  if new.mfa_required_roles is distinct from old.mfa_required_roles then
    for r in select user_id from organization_members
             where org_id = new.id and status = 'active' and user_id is distinct from auth.uid() loop
      perform public.notify(new.id, r.user_id, 'security.policy_changed',
        format('"%s" şirkətinin təhlükəsizlik siyasəti dəyişdi', new.name), null, '/settings/security', 'organization', new.id::text,
        jsonb_build_object('org', new.name, 'roles', to_jsonb(new.mfa_required_roles)));
    end loop;
  end if;
  return null;
end $$;

create trigger notify_security_policy after update of mfa_required_roles on public.organizations
  for each row execute function public.notify_security_policy();

-- ── Client RPCs ──────────────────────────────────────────────
create function public.mark_notifications_read(p_ids uuid[])
returns int language plpgsql security definer set search_path = public, pg_temp as $$
declare n int;
begin
  update notifications set read_at = now()
   where id = any (coalesce(p_ids, '{}')) and user_id = auth.uid() and read_at is null
     and org_id in (select public.member_org_ids());
  get diagnostics n = row_count;
  return n;
end $$;

create function public.mark_all_notifications_read(p_org uuid)
returns int language plpgsql security definer set search_path = public, pg_temp as $$
declare n int;
begin
  update notifications set read_at = now()
   where org_id = p_org and user_id = auth.uid() and read_at is null
     and p_org in (select public.member_org_ids());
  get diagnostics n = row_count;
  return n;
end $$;

-- Invoker: RLS decides what is counted.
create function public.unread_notification_count(p_org uuid)
returns int language sql stable set search_path = public, pg_temp as $$
  select count(*)::int from notifications where org_id = p_org and user_id = auth.uid() and read_at is null
$$;

-- Activity feed: the caller's OWN audit rows in one organization they belong to.
-- (The full audit log still needs audit.read.)
create function public.my_activity(p_org uuid, p_limit int default 50, p_before bigint default null)
returns table (id bigint, table_name text, record_id text, action text, changed jsonb, at timestamptz)
language sql stable security definer set search_path = public, pg_temp as $$
  select l.id, l.table_name, l.record_id, l.action, l.changed, l.at
  from audit_log l
  where l.org_id = p_org and l.actor_id = auth.uid()
    and p_org in (select public.member_org_ids())
    and (p_before is null or l.id < p_before)
  order by l.id desc
  limit greatest(0, least(coalesce(p_limit, 50), 100))
$$;

-- ── Realtime (Supabase). Realtime applies the SELECT policy above to every subscriber. ──
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.notifications;
  else
    raise notice 'publication supabase_realtime not found — Realtime skipped';
  end if;
end $$;

-- ── Function privileges ──────────────────────────────────────
revoke all on function
  public.notify(uuid, uuid, text, text, text, text, text, text, jsonb), public._display_name(uuid),
  public.notify_member_change(), public.notify_security_policy(),
  public.mark_notifications_read(uuid[]), public.mark_all_notifications_read(uuid),
  public.unread_notification_count(uuid), public.my_activity(uuid, int, bigint)
from public, anon, authenticated;
grant execute on function
  public.mark_notifications_read(uuid[]), public.mark_all_notifications_read(uuid),
  public.unread_notification_count(uuid), public.my_activity(uuid, int, bigint)
to authenticated;
