-- ═════════════════════════════════════════════════════════════
-- TRADECORE AI · Phase 3 · 0020 — B2B Client Finder pipeline (Module 09)
--
-- The business itself (name, city, category, phone, e-mail, website, social, address,
-- source, data quality) lives in the central `companies` table with the 'prospect' role.
-- `leads` adds only the sales pipeline; `lead_activities` is the contact history.
-- Primary market: Azerbaijan (country_code on the company). Contact data is entered by
-- the user from public, legally accessible sources; nothing is collected automatically.
-- ═════════════════════════════════════════════════════════════

create table public.leads (
  id                     uuid primary key default gen_random_uuid(),
  org_id                 uuid not null references public.organizations (id) on delete cascade,
  user_id                uuid not null default auth.uid(),
  company_id             uuid not null references public.companies (id) on delete cascade,
  segment                text not null default 'other'
                         check (segment in ('restaurant', 'cafe', 'hotel', 'retail', 'mall', 'factory', 'manufacturer',
                                            'ad_agency', 'corporate', 'other')),
  is_new_business        boolean not null default false,
  stage                  text not null default 'new'
                         check (stage in ('new', 'contacted', 'interested', 'offer_sent', 'negotiation', 'won', 'lost')),
  services               text[] not null default '{}'
                         check (services <@ array['business_cards', 'brochures', 'catalogues', 'menus', 'packaging', 'labels',
                                                  'stickers', 'banners', 'flyers', 'corporate']::text[]),
  score                  smallint check (score between 0 and 100),
  size                   text check (size is null or size in ('micro', 'small', 'medium', 'large')),
  estimated_value_minor  bigint check (estimated_value_minor is null or estimated_value_minor >= 0),   -- AZN
  next_follow_up         date,
  owner_id               uuid,                                                                         -- responsible member (no FK: Y16)
  lost_reason            text check (lost_reason is null or length(lost_reason) <= 500),
  notes                  text check (notes is null or length(notes) <= 4000),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint leads_company_uq unique (company_id)
);
create index leads_org_stage_idx on public.leads (org_id, stage, next_follow_up);

create table public.lead_activities (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations (id) on delete cascade,
  user_id       uuid not null default auth.uid(),
  lead_id       uuid not null references public.leads (id) on delete cascade,
  kind          text not null check (kind in ('call', 'email', 'visit', 'meeting', 'message', 'offer', 'note')),
  happened_at   timestamptz not null default now(),
  summary       text not null check (length(trim(summary)) between 1 and 4000),
  outcome       text check (outcome is null or length(outcome) <= 300),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index lead_activities_lead_idx on public.lead_activities (lead_id, happened_at desc);

do $$
declare t text;
begin
  foreach t in array array['leads', 'lead_activities'] loop
    execute format('create trigger a_set_org before insert on public.%I for each row execute function public.set_row_org()', t);
    execute format('create trigger a_guard_owner before update on public.%I for each row execute function public.guard_row_owner()', t);
    execute format('create trigger %I before update on public.%I for each row execute function public.set_updated_at()', t || '_updated_at', t);
    execute format('create trigger audit after insert or update or delete on public.%I for each row execute function public.audit_row()', t);
  end loop;
end $$;
create trigger b_same_org before insert or update on public.leads
  for each row execute function public.check_same_org('company_id', 'companies');
create trigger b_same_org before insert or update on public.lead_activities
  for each row execute function public.check_same_org('lead_id', 'leads');

create function public.leads_guard()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if new.company_id is distinct from old.company_id then
    raise exception 'Müştəri namizədinin şirkəti dəyişdirilə bilməz' using errcode = 'insufficient_privilege';
  end if;
  return new;
end $$;
create trigger b_guard before update on public.leads for each row execute function public.leads_guard();
revoke all on function public.leads_guard() from public, anon, authenticated;

alter table public.leads enable row level security;
alter table public.lead_activities enable row level security;
create policy "module read" on public.leads for select to authenticated
  using (org_id in (select public.org_ids_with('data.read')) and (org_id, 'b2b-client-finder'::text) in (select * from public.org_module_access('read')));
create policy "module insert" on public.leads for insert to authenticated
  with check (org_id in (select public.org_ids_with('data.write')) and user_id = auth.uid()
              and (org_id, 'b2b-client-finder'::text) in (select * from public.org_module_access('write')));
create policy "module update" on public.leads for update to authenticated
  using (org_id in (select public.org_ids_with('data.write')) and (org_id, 'b2b-client-finder'::text) in (select * from public.org_module_access('write')))
  with check (org_id in (select public.org_ids_with('data.write')) and (org_id, 'b2b-client-finder'::text) in (select * from public.org_module_access('write')));
create policy "module delete" on public.leads for delete to authenticated
  using (org_id in (select public.org_ids_with('data.write')) and (org_id, 'b2b-client-finder'::text) in (select * from public.org_module_access('write')));

create policy "module read" on public.lead_activities for select to authenticated
  using (org_id in (select public.org_ids_with('data.read')) and (org_id, 'b2b-client-finder'::text) in (select * from public.org_module_access('read')));
create policy "module insert" on public.lead_activities for insert to authenticated
  with check (org_id in (select public.org_ids_with('data.write')) and user_id = auth.uid()
              and (org_id, 'b2b-client-finder'::text) in (select * from public.org_module_access('write')));
-- contact history: the author may correct or remove an entry
create policy "own update" on public.lead_activities for update to authenticated
  using (user_id = auth.uid() and (org_id, 'b2b-client-finder'::text) in (select * from public.org_module_access('write')))
  with check (user_id = auth.uid() and (org_id, 'b2b-client-finder'::text) in (select * from public.org_module_access('write')));
create policy "own delete" on public.lead_activities for delete to authenticated
  using (user_id = auth.uid() and (org_id, 'b2b-client-finder'::text) in (select * from public.org_module_access('write')));

revoke all on public.leads, public.lead_activities from public, anon;
grant select, insert, update, delete on public.leads, public.lead_activities to authenticated;
revoke truncate, references, trigger on public.leads, public.lead_activities from authenticated;
