-- ═════════════════════════════════════════════════════════════
-- TRADECORE AI · Migration 0011 · Phase 2B — Global search
--  • az_fold(): Azerbaijani letters → plain Latin ("Şəhər" ≈ "seher"), lower case
--  • pg_trgm trigram indexes (typo tolerance)
--  • global_search(): see "Why SECURITY DEFINER" below.
--
-- Why SECURITY DEFINER (deviation from the plan, which said "security invoker"):
--   Under RLS PostgreSQL only uses LEAKPROOF functions/operators as index conditions
--   (a security-barrier rule). az_fold(), LIKE and the pg_trgm operators are not
--   leakproof, and marking them so needs superuser (not available on Supabase).
--   As an invoker function every search was a full scan (measured 170–330 ms over
--   3 × 10 000 rows; target 300 ms). As a definer the trigram indexes are used.
--   The function therefore applies EXACTLY the read conditions of the source tables'
--   RLS policies itself (same helper functions; 2FA gate included):
--     companies, products : org_id in org_ids_with('data.read')
--     saved_items         : the above + (org_id, module_key) in org_module_access('read')
--     notifications       : user_id = auth.uid() and org_id in member_org_ids()
--     members             : org_id in org_ids_with('members.read')
--   tests/sql/phase2b_tests.sql (scenario 33) checks for every test user that each
--   returned row is also visible to that user through plain RLS-governed SELECTs.
-- Rollback: supabase/rollback/20261123001100_search.down.sql
-- ═════════════════════════════════════════════════════════════

create schema if not exists extensions;
grant usage on schema extensions to anon, authenticated;
create extension if not exists pg_trgm with schema extensions;
-- Resolve gin_trgm_ops / word_similarity whether pg_trgm lives in `extensions` (Supabase) or `public`.
select set_config('search_path', 'public, extensions', false);

-- plpgsql (not an inlined SQL function) with COST 100: tells the planner that evaluating it on
-- every row is expensive, so it prefers the trigram index over scanning the table.
create function public.az_fold(p text)
returns text language plpgsql immutable parallel safe cost 100 set search_path = pg_catalog, pg_temp as $$
begin
  return lower(translate(coalesce(p, ''), 'ƏəİıÖöÜüŞşÇçĞğ', 'eeiioouussccgg'));
end $$;

create index companies_search_trgm   on public.companies   using gin (public.az_fold(name || ' ' || coalesce(legal_name, '') || ' ' || coalesce(city, '')) gin_trgm_ops);
create index products_search_trgm    on public.products    using gin (public.az_fold(name || ' ' || coalesce(sku, '')) gin_trgm_ops);
create index saved_items_search_trgm on public.saved_items using gin (public.az_fold(title) gin_trgm_ops);

create function public.global_search(p_org uuid, p_query text, p_limit int default 20)
returns table (kind text, id text, title text, subtitle text, link text, score real)
language plpgsql stable security definer set search_path = public, extensions, pg_temp as $$
declare
  v_q    text := trim(public.az_fold(left(coalesce(p_query, ''), 100)));
  v_lim  int  := least(greatest(coalesce(p_limit, 20), 0), 50);
  v_pat  text;
  v_fz   text;      -- fuzzy (typo) term: only for 4+ letters/digits, else '' (matches nothing)
  v_data boolean;   -- = RLS of companies / products / saved_items
  v_mem  boolean;   -- = RLS of notifications (active member, 2FA gate)
  v_team boolean;   -- = members.read
  v_mods text[];    -- = org_module_access('read') for this org
begin
  if length(v_q) < 2 or v_lim = 0 or p_org is null or auth.uid() is null then return; end if;
  v_mem  := p_org in (select public.member_org_ids());
  if not v_mem then return; end if;
  v_data := p_org in (select public.org_ids_with('data.read'));
  v_team := p_org in (select public.org_ids_with('members.read'));
  v_mods := array(select a.module_key from public.org_module_access('read') a where a.org_id = p_org);
  -- the query is data, never a pattern: escape LIKE wildcards
  v_pat := '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  v_fz  := case when length(regexp_replace(v_q, '[^[:alnum:]]', '', 'g')) >= 4 then v_q else '' end;

  return query
  select r.k, r.i, r.t, r.st, r.l, r.sc from (
    (select 'company'::text, c.id::text, c.name, c.city,
            coalesce('/m/' || c.origin_module, '/search'),
            case when x.e like v_pat then 1.0::real else word_similarity(v_fz, x.e) end
       from companies c
       cross join lateral (select public.az_fold(c.name || ' ' || coalesce(c.legal_name, '') || ' ' || coalesce(c.city, '')) e) x
      where v_data and c.org_id = p_org
        and (public.az_fold(c.name || ' ' || coalesce(c.legal_name, '') || ' ' || coalesce(c.city, '')) like v_pat
             or v_fz <% public.az_fold(c.name || ' ' || coalesce(c.legal_name, '') || ' ' || coalesce(c.city, '')))
      order by 6 desc limit v_lim)
    union all
    (select 'product'::text, pr.id::text, pr.name, pr.sku,
            coalesce('/m/' || pr.origin_module, '/search'),
            case when x.e like v_pat then 1.0::real else word_similarity(v_fz, x.e) end
       from products pr
       cross join lateral (select public.az_fold(pr.name || ' ' || coalesce(pr.sku, '')) e) x
      where v_data and pr.org_id = p_org
        and (public.az_fold(pr.name || ' ' || coalesce(pr.sku, '')) like v_pat
             or v_fz <% public.az_fold(pr.name || ' ' || coalesce(pr.sku, '')))
      order by 6 desc limit v_lim)
    union all
    (select 'saved_item'::text, s.id::text, s.title, s.module_key, '/m/' || s.module_key,
            case when public.az_fold(s.title) like v_pat then 1.0::real else word_similarity(v_fz, public.az_fold(s.title)) end
       from saved_items s
      where v_data and s.org_id = p_org and s.module_key = any (v_mods)
        and (public.az_fold(s.title) like v_pat or v_fz <% public.az_fold(s.title))
      order by 6 desc limit v_lim)
    union all
    (select 'notification'::text, n.id::text, n.title, n.type, coalesce(n.link, '/notifications'),
            case when public.az_fold(n.title) like v_pat then 1.0::real else word_similarity(v_fz, public.az_fold(n.title)) end
       from notifications n
      where n.org_id = p_org and n.user_id = auth.uid()
        and (public.az_fold(n.title) like v_pat or v_fz <% public.az_fold(n.title))
      order by 6 desc limit v_lim)
    union all
    (select 'member'::text, m.user_id::text, coalesce(nullif(trim(p.full_name), ''), u.email::text), u.email::text,
            '/settings/team'::text,
            case when x.e like v_pat then 1.0::real else word_similarity(v_fz, x.e) end
       from organization_members m
       join auth.users u on u.id = m.user_id
       left join profiles p on p.id = m.user_id
       cross join lateral (select public.az_fold(coalesce(p.full_name, '') || ' ' || coalesce(u.email::text, '')) e) x
      where v_team and m.org_id = p_org and (x.e like v_pat or v_fz <% x.e)
      order by 6 desc limit v_lim)
  ) r (k, i, t, st, l, sc)   -- own names: the OUT parameters (kind, id, …) would be ambiguous
  order by r.sc desc, r.t
  limit v_lim;
end $$;

reset search_path;

revoke all on function public.global_search(uuid, text, int) from public, anon, authenticated;
grant execute on function public.global_search(uuid, text, int) to authenticated;
grant execute on function public.az_fold(text) to authenticated;
