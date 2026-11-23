-- Rollback of 20261123001000_notifications.sql
-- WARNING: deletes all notifications and notification settings. Export them first in production.
-- The audit log is not touched.
do $$
begin
  if exists (select 1 from pg_publication_tables
             where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications') then
    alter publication supabase_realtime drop table public.notifications;
  end if;
end $$;
drop trigger if exists notify_member_change on public.organization_members;
drop trigger if exists notify_security_policy on public.organizations;
drop function if exists public.notify_member_change();
drop function if exists public.notify_security_policy();
drop function if exists public.my_activity(uuid, int, bigint);
drop function if exists public.unread_notification_count(uuid);
drop function if exists public.mark_all_notifications_read(uuid);
drop function if exists public.mark_notifications_read(uuid[]);
drop function if exists public.notify(uuid, uuid, text, text, text, text, text, text, jsonb);
drop function if exists public._display_name(uuid);
drop table if exists public.notification_preferences;
drop table if exists public.notifications;
