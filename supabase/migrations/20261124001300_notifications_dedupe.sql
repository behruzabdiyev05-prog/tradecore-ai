-- ═════════════════════════════════════════════════════════════
-- TRADECORE AI · Migration 0013 · İ-3 (Modul 03) — notification de-duplication
--  • notifications.dedupe_key (nullable) + partial unique index        (İ-2 §3, approved)
--  • notify_once()        — notify() that never sends the same key twice to the same member
--  • notify_marketplace() — sends to every active member who may WRITE in Modul 03 (Q3)
-- Additive only: no existing column, policy or function is changed. notify() is reused as is.
-- Rollback: supabase/rollback/20261124001300_notifications_dedupe.down.sql
-- ═════════════════════════════════════════════════════════════

alter table public.notifications
  add column dedupe_key text check (dedupe_key is null or length(dedupe_key) between 1 and 200);

create unique index notifications_dedupe_uq
  on public.notifications (org_id, user_id, dedupe_key) where dedupe_key is not null;

-- Same arguments as notify() + p_dedupe. NULL p_dedupe = plain notify().
-- Returns the new id, or NULL when nothing was sent (duplicate, preference off, not a member).
create function public.notify_once(p_org uuid, p_user uuid, p_type text, p_title text, p_body text,
                                   p_link text, p_entity_type text, p_entity_id text, p_data jsonb, p_dedupe text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid;
begin
  if p_dedupe is null then
    return public.notify(p_org, p_user, p_type, p_title, p_body, p_link, p_entity_type, p_entity_id, p_data);
  end if;
  if exists (select 1 from notifications where org_id = p_org and user_id = p_user and dedupe_key = p_dedupe) then
    return null;
  end if;
  v_id := public.notify(p_org, p_user, p_type, p_title, p_body, p_link, p_entity_type, p_entity_id, p_data);
  if v_id is not null then
    begin
      update notifications set dedupe_key = p_dedupe where id = v_id;
    exception when unique_violation then
      -- a concurrent call won the race: keep exactly one
      delete from notifications where id = v_id;
      return null;
    end;
  end if;
  return v_id;
end $$;

-- Recipients (Q3): active members of an active organization whose role holds module.marketplace.write
-- and whose plan includes Modul 03. Each member's own notification preferences still apply (inside notify()).
create function public.notify_marketplace(p_org uuid, p_type text, p_title text, p_body text, p_link text,
                                          p_entity_type text, p_entity_id text, p_data jsonb, p_dedupe text)
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare r record; n integer := 0;
begin
  if not exists (select 1 from organization_subscriptions s join plans p on p.id = s.plan_id
                 where s.org_id = p_org and s.status in ('active', 'past_due') and 'marketplace' = any (p.modules)) then
    return 0;
  end if;
  for r in
    select m.user_id
    from organization_members m
    join organizations o on o.id = m.org_id and o.status = 'active'
    join role_permissions rp on rp.role_id = m.role_id and rp.permission_key = 'module.marketplace.write'
    where m.org_id = p_org and m.status = 'active'
  loop
    if public.notify_once(p_org, r.user_id, p_type, p_title, p_body, p_link, p_entity_type, p_entity_id, p_data, p_dedupe) is not null then
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;

-- Internal only: no client (anon/authenticated) may create notifications.
revoke all on function
  public.notify_once(uuid, uuid, text, text, text, text, text, text, jsonb, text),
  public.notify_marketplace(uuid, text, text, text, text, text, text, jsonb, text)
from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function
      public.notify_once(uuid, uuid, text, text, text, text, text, text, jsonb, text),
      public.notify_marketplace(uuid, text, text, text, text, text, text, jsonb, text)
    to service_role;
  end if;
end $$;
