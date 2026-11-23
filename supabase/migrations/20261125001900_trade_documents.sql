-- ═════════════════════════════════════════════════════════════
-- TRADECORE AI · Phase 3 · 0019 — Trade documents (Modules 02, 06, 09)
--
-- Purchases, sales and commercial offers with their lines, shared by
--   02 wholesale · 06 b2b-trading · 09 b2b-client-finder (offers only)
-- Counterparties are central `companies`, items central `products` (no duplicate catalogues).
-- Posting a purchase / sale to the central ledger (`financial_transactions`) is done by
-- trade_document_post(): once only, by a user with finance.write (the ledger's own RLS applies).
-- ═════════════════════════════════════════════════════════════

create table public.trade_documents (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references public.organizations (id) on delete cascade,
  user_id            uuid not null default auth.uid(),
  module_key         text not null references public.modules (key)
                     check (module_key in ('wholesale', 'b2b-trading', 'b2b-client-finder')),
  kind               text not null check (kind in ('purchase', 'sale', 'offer')),
  number             text not null check (length(trim(number)) between 1 and 60),
  company_id         uuid references public.companies (id) on delete set null,
  counterparty_name  text check (counterparty_name is null or length(counterparty_name) <= 200),
  status             text not null default 'draft'
                     check (status in ('draft', 'sent', 'accepted', 'rejected', 'ordered', 'received', 'delivered', 'paid', 'cancelled')),
  currency           char(3) not null default 'AZN' references public.currencies (code),
  fx_rate_to_base    numeric(18,8) not null default 1 check (fx_rate_to_base > 0),
  doc_date           date not null default current_date,
  due_date           date,
  valid_until        date,
  notes              text check (notes is null or length(notes) <= 4000),
  terms              text check (terms is null or length(terms) <= 4000),
  posted_at          timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint trade_documents_azn_rate check (currency <> 'AZN' or fx_rate_to_base = 1),
  constraint trade_documents_offer_module check (module_key <> 'b2b-client-finder' or kind = 'offer'),
  constraint trade_documents_number_uq unique (org_id, module_key, kind, number)
);
create index trade_documents_org_idx on public.trade_documents (org_id, module_key, kind, doc_date desc);

create table public.trade_document_lines (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references public.organizations (id) on delete cascade,
  user_id           uuid not null default auth.uid(),
  document_id       uuid not null references public.trade_documents (id) on delete cascade,
  product_id        uuid references public.products (id) on delete set null,
  position          integer not null default 1,
  description       text not null check (length(trim(description)) between 1 and 500),
  quantity          numeric(14,3) not null default 1 check (quantity > 0),
  unit              text not null default 'pcs' check (length(unit) between 1 and 20),
  unit_price_minor  bigint not null default 0 check (unit_price_minor >= 0),
  unit_cost_minor   bigint check (unit_cost_minor is null or unit_cost_minor >= 0),
  discount_percent  numeric(6,3) not null default 0 check (discount_percent >= 0 and discount_percent <= 100),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index trade_document_lines_doc_idx on public.trade_document_lines (document_id, position);

do $$
declare t text;
begin
  foreach t in array array['trade_documents', 'trade_document_lines'] loop
    execute format('create trigger a_set_org before insert on public.%I for each row execute function public.set_row_org()', t);
    execute format('create trigger a_guard_owner before update on public.%I for each row execute function public.guard_row_owner()', t);
    execute format('create trigger %I before update on public.%I for each row execute function public.set_updated_at()', t || '_updated_at', t);
    execute format('create trigger audit after insert or update or delete on public.%I for each row execute function public.audit_row()', t);
  end loop;
end $$;
create trigger b_same_org before insert or update on public.trade_documents
  for each row execute function public.check_same_org('company_id', 'companies');
create trigger b_same_org before insert or update on public.trade_document_lines
  for each row execute function public.check_same_org('document_id', 'trade_documents', 'product_id', 'products');

-- Line total in document currency minor units: round(qty × price × (1 − discount%)).
create function public.trade_line_total(l public.trade_document_lines)
returns bigint language sql immutable set search_path = public, pg_temp as $$
  select round(l.quantity * l.unit_price_minor * (100 - l.discount_percent) / 100)::bigint
$$;

-- Guards: a document keeps its module and kind; posted documents keep their figures.
create function public.trade_documents_guard()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if new.module_key is distinct from old.module_key or new.kind is distinct from old.kind then
    raise exception 'Sənədin modulu və növü dəyişdirilə bilməz' using errcode = 'insufficient_privilege';
  end if;
  if old.posted_at is not null and current_user in ('authenticated', 'anon')
     and (new.currency is distinct from old.currency or new.fx_rate_to_base is distinct from old.fx_rate_to_base
          or new.posted_at is distinct from old.posted_at or new.doc_date is distinct from old.doc_date) then
    raise exception 'Maliyyəyə yazılmış sənədin valyutası, məzənnəsi və tarixi dəyişdirilə bilməz' using errcode = 'insufficient_privilege';
  end if;
  if old.posted_at is null and new.posted_at is not null and current_user in ('authenticated', 'anon') then
    raise exception 'Sənəd yalnız "Maliyyəyə yaz" əməliyyatı ilə yazıla bilər' using errcode = 'insufficient_privilege';
  end if;
  return new;
end $$;
create trigger b_guard before update on public.trade_documents for each row execute function public.trade_documents_guard();

create function public.trade_lines_guard()
returns trigger language plpgsql set search_path = public, pg_temp as $$
declare v_posted timestamptz;
begin
  select posted_at into v_posted from trade_documents where id = coalesce(new.document_id, old.document_id);
  if v_posted is not null then
    raise exception 'Maliyyəyə yazılmış sənədin sətirləri dəyişdirilə bilməz' using errcode = 'insufficient_privilege';
  end if;
  if tg_op = 'UPDATE' and new.document_id is distinct from old.document_id then
    raise exception 'Sətir başqa sənədə köçürülə bilməz' using errcode = 'insufficient_privilege';
  end if;
  return coalesce(new, old);
end $$;
create trigger b_guard before insert or update or delete on public.trade_document_lines
  for each row execute function public.trade_lines_guard();
revoke all on function public.trade_documents_guard(), public.trade_lines_guard() from public, anon, authenticated;

alter table public.trade_documents enable row level security;
alter table public.trade_document_lines enable row level security;
create policy "module read" on public.trade_documents for select to authenticated
  using (org_id in (select public.org_ids_with('data.read')) and (org_id, module_key) in (select * from public.org_module_access('read')));
create policy "module insert" on public.trade_documents for insert to authenticated
  with check (org_id in (select public.org_ids_with('data.write')) and user_id = auth.uid() and posted_at is null
              and (org_id, module_key) in (select * from public.org_module_access('write')));
create policy "module update" on public.trade_documents for update to authenticated
  using (org_id in (select public.org_ids_with('data.write')) and (org_id, module_key) in (select * from public.org_module_access('write')))
  with check (org_id in (select public.org_ids_with('data.write')) and (org_id, module_key) in (select * from public.org_module_access('write')));
create policy "module delete" on public.trade_documents for delete to authenticated
  using (posted_at is null and org_id in (select public.org_ids_with('data.write'))
         and (org_id, module_key) in (select * from public.org_module_access('write')));

-- lines follow their document's module
create policy "module read" on public.trade_document_lines for select to authenticated
  using (document_id in (select id from public.trade_documents));
create policy "module insert" on public.trade_document_lines for insert to authenticated
  with check (user_id = auth.uid() and org_id in (select public.org_ids_with('data.write'))
              and exists (select 1 from public.trade_documents d where d.id = document_id
                          and (d.org_id, d.module_key) in (select * from public.org_module_access('write'))));
create policy "module update" on public.trade_document_lines for update to authenticated
  using (org_id in (select public.org_ids_with('data.write'))
         and exists (select 1 from public.trade_documents d where d.id = document_id
                     and (d.org_id, d.module_key) in (select * from public.org_module_access('write'))))
  with check (org_id in (select public.org_ids_with('data.write')));
create policy "module delete" on public.trade_document_lines for delete to authenticated
  using (org_id in (select public.org_ids_with('data.write'))
         and exists (select 1 from public.trade_documents d where d.id = document_id
                     and (d.org_id, d.module_key) in (select * from public.org_module_access('write'))));

revoke all on public.trade_documents, public.trade_document_lines from public, anon;
grant select, insert, update, delete on public.trade_documents, public.trade_document_lines to authenticated;
revoke truncate, references, trigger on public.trade_documents, public.trade_document_lines from authenticated;

-- Post a purchase / sale to the central ledger. SECURITY INVOKER: the caller's own RLS
-- applies (finance.write + module write); posted once, then its figures are locked.
-- Sale → one `sale` transaction; purchase → one `purchase` transaction (document totals).
create function public.trade_document_post(p_document uuid)
returns uuid language plpgsql security invoker set search_path = public, pg_temp as $$
declare d trade_documents; v_total bigint; v_tx uuid;
begin
  select * into d from trade_documents where id = p_document for update;
  if d.id is null then
    raise exception 'Sənəd tapılmadı' using errcode = 'invalid_parameter_value';
  end if;
  if d.kind not in ('purchase', 'sale') then
    raise exception 'Təklif maliyyəyə yazılmır — yalnız alış və satış' using errcode = 'invalid_parameter_value';
  end if;
  if d.posted_at is not null then
    raise exception 'Bu sənəd artıq maliyyəyə yazılıb' using errcode = 'P0001';
  end if;
  if d.status = 'cancelled' then
    raise exception 'Ləğv edilmiş sənəd maliyyəyə yazılmır' using errcode = 'P0001';
  end if;
  select coalesce(sum(public.trade_line_total(l)), 0) into v_total from trade_document_lines l where l.document_id = d.id;
  if v_total <= 0 then
    raise exception 'Sənədin məbləği sıfırdır — əvvəlcə sətir əlavə edin' using errcode = 'P0001';
  end if;
  insert into financial_transactions (org_id, user_id, module_key, kind, amount_minor, currency, fx_rate_to_base,
                                      occurred_on, description, counterparty_id, reference)
    values (d.org_id, auth.uid(), d.module_key, d.kind::text::public.transaction_kind, v_total, d.currency, d.fx_rate_to_base,
            d.doc_date, left(d.number || coalesce(' · ' || d.counterparty_name, ''), 200), d.company_id, 'trade_document:' || d.id)
    returning id into v_tx;
  -- the guard lets only this function set posted_at: it runs as the caller, so mark via a definer helper
  perform public._trade_document_mark_posted(d.id);
  return v_tx;
end $$;

create function public._trade_document_mark_posted(p_document uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare d trade_documents; v_total bigint;
begin
  select * into d from trade_documents where id = p_document;
  if d.id is null or d.org_id not in (select public.org_ids_with('finance.write')) then
    raise exception 'Bu əməliyyat üçün icazəniz yoxdur' using errcode = 'insufficient_privilege';
  end if;
  select coalesce(sum(public.trade_line_total(l)), 0) into v_total from trade_document_lines l where l.document_id = d.id;
  -- only after a ledger row for exactly this document (same org, module, kind and total) exists
  if not exists (select 1 from financial_transactions f
                 where f.reference = 'trade_document:' || d.id and f.org_id = d.org_id and f.module_key = d.module_key
                   and f.kind::text = d.kind and f.amount_minor = v_total) then
    raise exception 'Maliyyə qeydi tapılmadı' using errcode = 'insufficient_privilege';
  end if;
  update trade_documents set posted_at = now() where id = p_document and posted_at is null;
end $$;
revoke all on function public._trade_document_mark_posted(uuid) from public, anon, authenticated;
grant execute on function public._trade_document_mark_posted(uuid) to authenticated;
revoke all on function public.trade_document_post(uuid) from public, anon;
grant execute on function public.trade_document_post(uuid) to authenticated;
revoke all on function public.trade_line_total(public.trade_document_lines) from public, anon;
grant execute on function public.trade_line_total(public.trade_document_lines) to authenticated;
