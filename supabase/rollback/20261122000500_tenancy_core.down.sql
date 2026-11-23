-- Rollback of 20261122000500_tenancy_core.sql
-- Organizations, memberships, invites and plans are removed. Business rows were
-- already detached from organizations by the 0007 rollback, so no business data is lost.
alter table public.profiles drop column active_org_id;
drop table public.organization_subscriptions;
drop table public.plans;
drop table public.organization_invites;
drop table public.organization_members;
drop table public.role_permissions;
drop table public.roles;
drop table public.permissions;
drop table public.organizations;
