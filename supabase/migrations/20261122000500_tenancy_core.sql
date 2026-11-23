-- ═════════════════════════════════════════════════════════════
-- TRADECORE AI · Migration 0005 · Phase 2A — Tenancy core
-- Organizations, members, roles, permissions, invites, plans.
-- Policies for these tables are created in 0006 (they need the helper functions).
-- Rollback: supabase/rollback/20261122000500_tenancy_core.down.sql
-- ═════════════════════════════════════════════════════════════

create table public.organizations (
  id             uuid primary key default gen_random_uuid(),
  name           text not null check (length(trim(name)) between 1 and 200),
  status         text not null default 'active' check (status in ('active', 'suspended')),
  base_currency  char(3) not null default 'AZN' references public.currencies (code),
  created_by     uuid references auth.users (id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create trigger organizations_updated_at before update on public.organizations
  for each row execute function public.set_updated_at();

-- ── Permission catalogue (keys mirror shared/permissions.js) ──
create table public.permissions (
  key          text primary key check (key ~ '^[a-z0-9_-]+(\.[a-z0-9_-]+)+$'),
  description  text
);

insert into public.permissions (key, description) values
  ('org.manage',          'Şirkət parametrləri'),
  ('billing.manage',      'Plan və abunə'),
  ('members.read',        'Komanda siyahısı'),
  ('members.manage',      'Dəvət, rol, dayandırma'),
  ('audit.read',          'Audit jurnalı'),
  ('finance.read',        'Maliyyəni görmək'),
  ('finance.write',       'Maliyyə əməliyyatları'),
  ('data.read',           'Şirkətlər, məhsullar, saxlanılmış qeydlər'),
  ('data.write',          'Ortaq məlumatı dəyişmək'),
  ('integrations.manage', 'İnteqrasiyalar'),
  ('ares.use',            'ARES-dən istifadə');
insert into public.permissions (key, description)
  select 'module.' || m.key || '.' || a.action, m.name || ' — ' || a.label
  from public.modules m
  cross join (values ('read', 'görmək'), ('write', 'işləmək')) a(action, label);

-- ── Roles: org_id NULL = system role (immutable) ─────────────
create table public.roles (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid references public.organizations (id) on delete cascade,
  key         text not null check (key ~ '^[a-z0-9_-]+$'),
  name        text not null,
  rank        smallint not null default 100,   -- lower = more authority
  is_system   boolean not null default false,
  created_at  timestamptz not null default now(),
  constraint system_roles_have_no_org check (is_system = (org_id is null))
);
create unique index roles_system_key_uidx on public.roles (key) where org_id is null;
create unique index roles_org_key_uidx on public.roles (org_id, key) where org_id is not null;

create table public.role_permissions (
  role_id         uuid not null references public.roles (id) on delete cascade,
  permission_key  text not null references public.permissions (key) on delete cascade,
  primary key (role_id, permission_key)
);

insert into public.roles (key, name, rank, is_system) values
  ('owner', 'Sahib', 10, true),
  ('admin', 'Admin', 20, true),
  ('manager', 'Menecer', 30, true),
  ('employee', 'İşçi', 40, true),
  ('viewer', 'Müşahidəçi', 50, true);

-- Approved matrix (Phase 2A decision A) — verified against shared/permissions.js by tests/sql/run.sh
insert into public.role_permissions (role_id, permission_key)
select r.id, p.key
from public.roles r
join public.permissions p on
  case r.key
    when 'owner'    then true
    when 'admin'    then p.key <> 'billing.manage'
    when 'manager'  then p.key in ('members.read','finance.read','finance.write','data.read','data.write','ares.use')
                         or p.key like 'module.%'
    when 'employee' then p.key in ('members.read','data.read','data.write','ares.use')
                         or p.key like 'module.%'
    when 'viewer'   then p.key in ('members.read','finance.read','data.read','ares.use')
                         or p.key like 'module.%.read'
  end
where r.org_id is null;

-- ── Membership ───────────────────────────────────────────────
create table public.organization_members (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  role_id     uuid not null references public.roles (id),
  status      text not null default 'active' check (status in ('active', 'suspended')),
  invited_by  uuid references auth.users (id) on delete set null,
  joined_at   timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (org_id, user_id)
);
create index organization_members_user_idx on public.organization_members (user_id, org_id) where status = 'active';
create trigger organization_members_updated_at before update on public.organization_members
  for each row execute function public.set_updated_at();

-- ── Invites (token stored only as SHA-256 hash) ──────────────
create table public.organization_invites (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations (id) on delete cascade,
  email        text not null check (email = lower(trim(email)) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  role_id      uuid not null references public.roles (id),
  token_hash   bytea not null unique,
  expires_at   timestamptz not null default now() + interval '7 days',
  accepted_at  timestamptz,
  accepted_by  uuid references auth.users (id) on delete set null,
  revoked_at   timestamptz,
  created_by   uuid references auth.users (id) on delete set null,
  created_at   timestamptz not null default now()
);
create index organization_invites_org_idx on public.organization_invites (org_id, created_at desc);

-- ── Plans & subscriptions ────────────────────────────────────
create table public.plans (
  id          uuid primary key default gen_random_uuid(),
  key         text not null unique,
  name        text not null,
  modules     text[] not null default '{}',
  limits      jsonb not null default '{}'::jsonb,   -- e.g. {"max_members": 10}; absent = unlimited
  created_at  timestamptz not null default now()
);

-- Decision C: one internal plan, every module open, no limits.
insert into public.plans (key, name, modules)
  select 'internal', 'Daxili plan', array_agg(key order by sort_order) from public.modules;

create table public.organization_subscriptions (
  org_id              uuid primary key references public.organizations (id) on delete cascade,
  plan_id             uuid not null references public.plans (id),
  status              text not null default 'active' check (status in ('active', 'past_due', 'canceled')),
  current_period_end  timestamptz,
  updated_at          timestamptz not null default now()
);
create trigger organization_subscriptions_updated_at before update on public.organization_subscriptions
  for each row execute function public.set_updated_at();

-- ── Active organization per user ─────────────────────────────
alter table public.profiles add column active_org_id uuid references public.organizations (id) on delete set null;

-- ── RLS on (policies in 0006) + least-privilege grants ───────
alter table public.organizations              enable row level security;
alter table public.permissions                enable row level security;
alter table public.roles                      enable row level security;
alter table public.role_permissions           enable row level security;
alter table public.organization_members       enable row level security;
alter table public.organization_invites       enable row level security;
alter table public.plans                      enable row level security;
alter table public.organization_subscriptions enable row level security;

-- Supabase grants ALL to anon/authenticated by default: revoke first, then grant the minimum.
revoke all on public.organizations, public.permissions, public.roles, public.role_permissions,
              public.organization_members, public.organization_invites, public.plans,
              public.organization_subscriptions from anon, authenticated;

grant select on public.organizations, public.permissions, public.roles, public.role_permissions,
               public.organization_members, public.plans, public.organization_subscriptions to authenticated;
grant update (name, base_currency) on public.organizations to authenticated;
-- token_hash is deliberately NOT readable
grant select (id, org_id, email, role_id, expires_at, accepted_at, accepted_by, revoked_at, created_by, created_at)
  on public.organization_invites to authenticated;
