-- ═════════════════════════════════════════════════════════════
-- TRADECORE AI · Migration 0017 · İ-3 (Modul 03) — functions and behaviour triggers
--  İ-2 design §5, §6, D1–D7, Y1–Y15.
--  Server only (service_role; the Netlify server key) — every one takes p_org and checks
--  that each row belongs to that organization (Y6); clients cannot execute them:
--    marketplace_upsert_catalog · marketplace_upsert_shopify_order · marketplace_apply_inventory
--    integration_event_store · integration_event_finish · integration_events_purge (D3)
--  User functions (the caller's own JWT; permission, plan and 2FA checked inside):
--    marketplace_create_manual_order (D4, D7) · marketplace_history · marketplace_store_status (Y7)
--    marketplace_delete_listing (D6, SECURITY INVOKER: the caller's own RLS applies)
--  Guard: marketplace_blocked_shop() — the live NovaNest shop can never be used (Y13).
--  Triggers: variant stock roll-up · low-stock notification · supplier price history + notification.
--  Calculations are NOT done here: the server passes AZN amounts computed by shared/marketplace
--  (DropPilot formulas, İ-2 §6). The database only applies the freezing rules (DropPilot parity).
-- Rollback: supabase/rollback/20261124001700_marketplace_functions.down.sql
-- ═════════════════════════════════════════════════════════════

-- ── 1. Live shop guard (Y13) ─────────────────────────────────
create function public.marketplace_blocked_shop(p_domain text)
returns boolean language sql immutable set search_path = pg_catalog, pg_temp as $$
  select lower(trim(coalesce(p_domain, ''))) = any (array['novanest991.myshopify.com'])
$$;

-- Connected Shopify integration of p_org, or an error (wrong org, not connected, blocked shop).
create function public._marketplace_integration(p_org uuid, p_integration uuid)
returns public.integrations language plpgsql stable security definer set search_path = public, pg_temp as $$
declare r integrations;
begin
  select * into r from integrations where id = p_integration;
  if r.id is null or r.org_id is distinct from p_org then
    raise exception 'İnteqrasiya bu şirkətə aid deyil' using errcode = 'insufficient_privilege';
  end if;
  if public.marketplace_blocked_shop(r.config ->> 'shop_domain') then
    raise exception 'Bu Shopify mağazası qadağan siyahısındadır (canlı mağaza): %', r.config ->> 'shop_domain'
      using errcode = 'insufficient_privilege';
  end if;
  if r.provider <> 'shopify' or r.status <> 'connected' then
    raise exception 'Shopify inteqrasiyası qoşulu deyil' using errcode = 'object_not_in_prerequisite_state';
  end if;
  return r;
end $$;

-- ── 2. Catalog import (DropPilot syncProducts): costs are never overwritten ──
create function public.marketplace_upsert_catalog(p_org uuid, p_integration uuid, p_products jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  integ integrations := public._marketplace_integration(p_org, p_integration);
  p jsonb; v jsonb; v_listing uuid; v_product uuid; n_p int := 0; n_v int := 0;
begin
  if jsonb_typeof(coalesce(p_products, 'null'::jsonb)) <> 'array' then
    raise exception 'Məhsul siyahısı massiv olmalıdır' using errcode = 'invalid_parameter_value';
  end if;
  for p in select * from jsonb_array_elements(p_products) loop
    if coalesce(p ->> 'external_id', '') = '' or coalesce(trim(p ->> 'name'), '') = '' then
      raise exception 'Məhsulun Shopify ID-si və adı məcburidir' using errcode = 'invalid_parameter_value';
    end if;
    v_listing := null; v_product := null;
    select id, product_id into v_listing, v_product from marketplace_listings
      where org_id = p_org and channel = 'shopify' and external_id = p ->> 'external_id';
    if v_listing is null then
      insert into products (org_id, user_id, origin_module, name, source, source_url, data_quality, retrieved_at)
        values (p_org, integ.user_id, 'marketplace', left(trim(p ->> 'name'), 500), 'shopify', p ->> 'admin_url', 'verified', now())
        returning id into v_product;
      insert into marketplace_listings (org_id, user_id, product_id, channel, external_id, admin_url, image_url, supplier_name,
                                        sale_azn_minor, stock, status, variant_count, inventory_item_id, location_id)
        values (p_org, integ.user_id, v_product, 'shopify', p ->> 'external_id', p ->> 'admin_url', p ->> 'image_url',
                coalesce(nullif(p ->> 'vendor', ''), 'Shopify'), coalesce((p ->> 'sale_azn_minor')::bigint, 0),
                greatest(0, coalesce((p ->> 'stock')::int, 0)), coalesce(p ->> 'status', 'active'),
                coalesce((p ->> 'variant_count')::int, 0), p ->> 'inventory_item_id', p ->> 'location_id')
        returning id into v_listing;
    else
      update products set name = left(trim(p ->> 'name'), 500), source_url = coalesce(p ->> 'admin_url', source_url), retrieved_at = now()
        where id = v_product;
      -- purchase / shipping / other costs are NOT touched (entered in TRADECORE)
      update marketplace_listings set
          admin_url = coalesce(p ->> 'admin_url', admin_url), image_url = p ->> 'image_url',
          supplier_name = coalesce(nullif(p ->> 'vendor', ''), 'Shopify'),
          sale_azn_minor = coalesce((p ->> 'sale_azn_minor')::bigint, sale_azn_minor),
          stock = greatest(0, coalesce((p ->> 'stock')::int, stock)), status = coalesce(p ->> 'status', status),
          variant_count = coalesce((p ->> 'variant_count')::int, variant_count),
          inventory_item_id = p ->> 'inventory_item_id', location_id = p ->> 'location_id'
        where id = v_listing;
    end if;
    for v in select * from jsonb_array_elements(coalesce(p -> 'variants', '[]'::jsonb)) loop
      if coalesce(v ->> 'external_id', '') = '' then
        raise exception 'Variantın Shopify ID-si məcburidir' using errcode = 'invalid_parameter_value';
      end if;
      insert into marketplace_variants (org_id, user_id, listing_id, external_id, title, sku, position, price_azn_minor, stock,
                                        inventory_item_id, location_id)
        values (p_org, integ.user_id, v_listing, v ->> 'external_id', v ->> 'title', nullif(v ->> 'sku', ''),
                coalesce((v ->> 'position')::int, 1), coalesce((v ->> 'price_azn_minor')::bigint, 0),
                greatest(0, coalesce((v ->> 'stock')::int, 0)), v ->> 'inventory_item_id', v ->> 'location_id')
        on conflict (org_id, external_id) do update set
          title = excluded.title, sku = excluded.sku, position = excluded.position, price_azn_minor = excluded.price_azn_minor,
          stock = excluded.stock, inventory_item_id = excluded.inventory_item_id, location_id = excluded.location_id
          where marketplace_variants.listing_id = excluded.listing_id;      -- variant costs are NOT touched
      n_v := n_v + 1;
    end loop;
    -- listing stock = sum of its variants (DropPilot recomputeProductStock), when it has variants
    update marketplace_listings l set stock = s.total,
           status = case when l.status = 'draft' then 'draft' when s.total <= 0 then 'out_of_stock' else 'active' end
      from (select coalesce(sum(stock), 0)::int as total, count(*) as n from marketplace_variants where listing_id = v_listing) s
      where l.id = v_listing and s.n > 0 and (l.stock is distinct from s.total);
    n_p := n_p + 1;
  end loop;
  return jsonb_build_object('products', n_p, 'variants', n_v);
end $$;

-- ── 3. Order import (DropPilot dp_upsert_shopify_order_lines, header + lines, Q1) ──
-- New order / line: written with its frozen snapshot. Repeat delivery: only statuses, customer and
-- refund change; the refund is converted with the ORIGINAL rate; a missing cost is filled once.
create function public.marketplace_upsert_shopify_order(p_org uuid, p_integration uuid, p_order jsonb, p_lines jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  integ integrations := public._marketplace_integration(p_org, p_integration);
  o marketplace_orders; ln marketplace_order_lines; l jsonb; v_listing uuid; v_variant uuid;
  v_cur text := upper(coalesce(nullif(trim(p_order ->> 'currency'), ''), 'AZN'));
  v_fx numeric := coalesce((p_order ->> 'fx_rate')::numeric, 1);
  v_lines jsonb := coalesce(p_lines, '[]'::jsonb);
  ins int := 0; upd int := 0; unmatched int := 0; missing int := 0;
begin
  if coalesce(p_order ->> 'external_id', '') = '' then
    raise exception 'Sifarişin Shopify ID-si məcburidir' using errcode = 'invalid_parameter_value';
  end if;
  if not exists (select 1 from currencies where code = v_cur) then          -- Y9
    raise exception 'Valyuta dəstəklənmir: %. Qəbul olunan valyutalar: %', v_cur,
      (select string_agg(code, ', ' order by code) from currencies) using errcode = 'invalid_parameter_value';
  end if;
  if v_fx <= 0 or (v_cur = 'AZN' and v_fx <> 1) then
    raise exception 'Məzənnə yanlışdır: % (%)', v_fx, v_cur using errcode = 'invalid_parameter_value';
  end if;
  if jsonb_typeof(v_lines) <> 'array' then
    raise exception 'Sifariş sətirləri massiv olmalıdır' using errcode = 'invalid_parameter_value';
  end if;

  select * into o from marketplace_orders where org_id = p_org and external_id = p_order ->> 'external_id';
  if o.id is null then
    insert into marketplace_orders (org_id, user_id, channel, order_number, external_id, customer_name, customer_email, currency,
                                    fx_rate_to_base, presentment_currency, status, financial_status, fulfillment_status,
                                    placed_at, financials_locked_at)
      values (p_org, integ.user_id, 'shopify', coalesce(nullif(trim(p_order ->> 'order_number'), ''), p_order ->> 'external_id'),
              p_order ->> 'external_id', coalesce(nullif(trim(p_order ->> 'customer_name'), ''), 'Shopify müştərisi'),
              nullif(p_order ->> 'customer_email', ''), v_cur, v_fx, nullif(upper(p_order ->> 'presentment_currency'), ''),
              coalesce(p_order ->> 'status', 'processing'), p_order ->> 'financial_status', p_order ->> 'fulfillment_status',
              coalesce((p_order ->> 'placed_at')::timestamptz, now()), now())
      returning * into o;
  else
    -- archived_at, tracking, notes, currency, rate and date are never touched by an import (D2, D1)
    update marketplace_orders set
        status = coalesce(p_order ->> 'status', status),
        financial_status = coalesce(p_order ->> 'financial_status', financial_status),
        fulfillment_status = coalesce(p_order ->> 'fulfillment_status', fulfillment_status),
        customer_name = coalesce(nullif(trim(p_order ->> 'customer_name'), ''), customer_name),
        customer_email = coalesce(nullif(p_order ->> 'customer_email', ''), customer_email)
      where id = o.id
      returning * into o;
  end if;

  for l in select * from jsonb_array_elements(v_lines) loop
    if coalesce(l ->> 'external_id', '') = '' then
      raise exception 'Sifariş sətrinin Shopify ID-si məcburidir' using errcode = 'invalid_parameter_value';
    end if;
    v_listing := null; v_variant := null; ln := null;
    select id into v_listing from marketplace_listings
      where org_id = p_org and channel = 'shopify' and external_id = l ->> 'listing_external_id';
    if nullif(l ->> 'variant_external_id', '') is not null then
      select id into v_variant from marketplace_variants where org_id = p_org and external_id = l ->> 'variant_external_id';
    end if;
    select * into ln from marketplace_order_lines where org_id = p_org and external_id = l ->> 'external_id';
    if ln.id is null then
      insert into marketplace_order_lines (org_id, user_id, order_id, external_id, listing_id, variant_id, shopify_variant_id,
                                           line_title, quantity, fx_rate_to_base, sale_azn_minor, shipping_income_azn_minor, tax_azn_minor,
                                           discount_azn_minor, fee_azn_minor, refund_azn_minor, cost_azn_minor, cost_missing)
        values (p_org, integ.user_id, o.id, l ->> 'external_id', v_listing, v_variant, nullif(l ->> 'variant_external_id', ''),
                left(l ->> 'line_title', 500), greatest(1, coalesce((l ->> 'quantity')::int, 1)), v_fx,
                coalesce((l ->> 'sale_azn_minor')::bigint, 0), coalesce((l ->> 'shipping_income_azn_minor')::bigint, 0),
                coalesce((l ->> 'tax_azn_minor')::bigint, 0), coalesce((l ->> 'discount_azn_minor')::bigint, 0),
                coalesce((l ->> 'fee_azn_minor')::bigint, 0), coalesce((l ->> 'refund_azn_minor')::bigint, 0),
                coalesce((l ->> 'cost_azn_minor')::bigint, 0), coalesce((l ->> 'cost_missing')::boolean, false));
      ins := ins + 1;
    else
      if ln.order_id <> o.id then
        raise exception 'Sətir başqa sifarişə aiddir: %', l ->> 'external_id' using errcode = 'invalid_parameter_value';
      end if;
      update marketplace_order_lines set
          line_title = coalesce(left(l ->> 'line_title', 500), line_title),
          listing_id = coalesce(listing_id, v_listing),
          variant_id = coalesce(variant_id, v_variant),
          shopify_variant_id = coalesce(shopify_variant_id, nullif(l ->> 'variant_external_id', '')),
          -- refund is a new event: AZN at today's rate → shop currency → AZN at the line's ORIGINAL (frozen) rate
          refund_azn_minor = round(coalesce((l ->> 'refund_azn_minor')::numeric, 0) / v_fx * fx_rate_to_base)::bigint,
          -- cost is filled only once, when it was missing at import time
          cost_azn_minor = case when cost_missing and not coalesce((l ->> 'cost_missing')::boolean, true)
                                then coalesce((l ->> 'cost_azn_minor')::bigint, 0) else cost_azn_minor end,
          cost_missing = cost_missing and coalesce((l ->> 'cost_missing')::boolean, true)
        where id = ln.id;
      upd := upd + 1;
    end if;
    if v_listing is null then unmatched := unmatched + 1; end if;
    if coalesce((l ->> 'cost_missing')::boolean, false) then missing := missing + 1; end if;
  end loop;

  if unmatched > 0 then
    perform public.notify_marketplace(p_org, 'marketplace.unmatched_line',
      format('Sifariş %s: %s sətrin məhsulu Modul 03-də yoxdur', o.order_number, unmatched),
      'Sətir idxal edildi, amma maya dəyəri 0-dır. Məhsulları sinxronlaşdırın və alış qiymətini daxil edin.',
      '/m/marketplace?tab=orders&order=' || o.id, 'marketplace_order', o.id::text,
      jsonb_build_object('order_number', o.order_number, 'count', unmatched, 'severity', 'warning'),
      'unmatched:' || o.external_id);
  end if;
  return jsonb_build_object('order_id', o.id, 'inserted', ins, 'updated', upd, 'unmatched', unmatched, 'missing_cost', missing);
end $$;

-- ── 4. Inventory webhook (DropPilot inventory_levels/update) ──
create function public.marketplace_apply_inventory(p_org uuid, p_integration uuid, p_item text, p_location text, p_available integer)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  integ integrations := public._marketplace_integration(p_org, p_integration);
  v marketplace_variants; v_listing uuid; v_qty int := greatest(0, coalesce(p_available, 0));
begin
  select * into v from marketplace_variants
    where org_id = p_org and inventory_item_id = p_item and (location_id is null or location_id = p_location)
    order by created_at limit 1;
  if v.id is not null then
    update marketplace_variants set stock = v_qty where id = v.id;      -- listing total follows (roll-up trigger)
    return jsonb_build_object('status', 'processed', 'variant_id', v.id,
                              'listing_stock', (select stock from marketplace_listings where id = v.listing_id));
  end if;
  -- products imported without variants
  select id into v_listing from marketplace_listings
    where org_id = p_org and channel = 'shopify' and inventory_item_id = p_item and location_id = p_location
    order by created_at limit 1;
  if v_listing is not null then
    update marketplace_listings set stock = v_qty,
           status = case when status = 'draft' then 'draft' when v_qty <= 0 then 'out_of_stock' else 'active' end
      where id = v_listing;
    return jsonb_build_object('status', 'processed', 'listing_id', v_listing, 'listing_stock', v_qty);
  end if;
  return jsonb_build_object('status', 'ignored', 'note', 'İnventar elementi Modul 03-də tapılmadı');
end $$;

-- ── 5. Webhook journal (DropPilot handleWebhook / runAndRecord) ──
-- The shop is mapped to its organization only through a CONNECTED integration; a blocked (live)
-- or unconnected shop is never stored. The same delivery id is stored once.
create function public.integration_event_store(p_provider text, p_external_id text, p_shop text, p_topic text,
                                               p_payload jsonb, p_sha256 text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare integ integrations; e integration_events; v_shop text := lower(trim(coalesce(p_shop, '')));
begin
  if p_provider is distinct from 'shopify' then
    raise exception 'Dəstəklənməyən provayder: %', p_provider using errcode = 'invalid_parameter_value';
  end if;
  if public.marketplace_blocked_shop(v_shop) then
    return jsonb_build_object('stored', false, 'reason', 'blocked_shop');
  end if;
  select * into integ from integrations
    where provider = 'shopify' and lower(config ->> 'shop_domain') = v_shop and status = 'connected';
  if integ.id is null then
    return jsonb_build_object('stored', false, 'reason', 'not_connected');
  end if;
  insert into integration_events (org_id, user_id, integration_id, provider, external_id, topic, shop_domain, payload,
                                  payload_sha256, status)
    values (integ.org_id, integ.user_id, integ.id, p_provider, p_external_id, p_topic, v_shop, p_payload, lower(p_sha256), 'processing')
    on conflict (provider, external_id) do nothing
    returning * into e;
  if e.id is not null then
    return jsonb_build_object('stored', true, 'duplicate', false, 'id', e.id, 'status', e.status, 'org_id', e.org_id,
                              'integration_id', e.integration_id);
  end if;
  select * into e from integration_events where provider = p_provider and external_id = p_external_id;
  return jsonb_build_object('stored', false, 'duplicate', true, 'id', e.id, 'status', e.status, 'org_id', e.org_id,
                            'integration_id', e.integration_id);
end $$;

-- Records one processing attempt. Backoff is computed by the server (DropPilot nextRetryDelayMs).
-- After the 5th failure: one sync_failed notification to the Modul 03 writers.
create function public.integration_event_finish(p_id bigint, p_status text, p_error text, p_next_retry timestamptz)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare e integration_events;
begin
  if p_status not in ('processing', 'processed', 'failed', 'ignored') then
    raise exception 'Yanlış status: %', p_status using errcode = 'invalid_parameter_value';
  end if;
  update integration_events set
      status = p_status, attempts = least(5, attempts + 1), last_error = left(p_error, 1000), last_attempt_at = now(),
      processed_at = case when p_status in ('processed', 'ignored') then now() else processed_at end,
      next_retry_at = case when p_status = 'failed' and attempts + 1 < 5 then p_next_retry end
    where id = p_id
    returning * into e;
  if e.id is null then
    raise exception 'Hadisə tapılmadı: %', p_id using errcode = 'invalid_parameter_value';
  end if;
  if e.status = 'failed' and e.attempts >= 5 then
    perform public.notify_marketplace(e.org_id, 'marketplace.sync_failed', format('Shopify hadisəsi emal edilmədi (%s)', e.topic),
      format('5 cəhddən sonra xəta: %s', coalesce(e.last_error, '')), '/m/marketplace?tab=store', 'integration_event', e.id::text,
      jsonb_build_object('topic', e.topic, 'severity', 'error'), 'webhook_failed:' || e.id);
  end if;
end $$;

-- D3: after p_days (30) without activity only the payload is removed; date, topic and status stay.
-- Orders, lines and customer name / e-mail live in their own tables and are not touched.
create function public.integration_events_purge(p_days integer default 30)
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare n integer;
begin
  update integration_events set payload = null, payload_purged_at = now()
    where payload is not null
      and coalesce(last_attempt_at, received_at) < now() - make_interval(days => greatest(1, coalesce(p_days, 30)));
  get diagnostics n = row_count;
  return n;
end $$;

-- ── 6. User functions ────────────────────────────────────────
-- D4 + D7: a manual order and its stock decrease in one transaction. If any line lacks stock,
-- nothing is written. Clients have no direct INSERT on orders/lines, so this is the only path.
create function public.marketplace_create_manual_order(p_org uuid, p_order jsonb, p_lines jsonb)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_order uuid; l jsonb; lst marketplace_listings; vr marketplace_variants; v_qty int;
begin
  if p_org is null or p_org not in (select public.org_ids_with('data.write'))
     or (p_org, 'marketplace'::text) not in (select * from public.org_module_access('write')) then
    raise exception 'Bu şirkətdə sifariş yaratmaq icazəniz yoxdur' using errcode = 'insufficient_privilege';
  end if;
  if jsonb_typeof(coalesce(p_lines, 'null'::jsonb)) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'Sifarişdə ən azı bir sətir olmalıdır' using errcode = 'invalid_parameter_value';
  end if;
  begin
    insert into marketplace_orders (org_id, user_id, channel, order_number, customer_name, customer_email, status,
                                    tracking_number, note)
      values (p_org, auth.uid(), 'manual', trim(p_order ->> 'order_number'), trim(p_order ->> 'customer_name'),
              nullif(p_order ->> 'customer_email', ''), coalesce(p_order ->> 'status', 'processing'),
              nullif(p_order ->> 'tracking_number', ''), nullif(p_order ->> 'note', ''))
      returning id into v_order;
  exception when unique_violation then
    raise exception 'Bu nömrəli sifariş artıq var: %', trim(p_order ->> 'order_number') using errcode = 'unique_violation';
  end;
  for l in select * from jsonb_array_elements(p_lines) loop
    v_qty := coalesce((l ->> 'quantity')::int, 1);
    if v_qty <= 0 then
      raise exception 'Miqdar müsbət olmalıdır' using errcode = 'invalid_parameter_value';
    end if;
    lst := null; vr := null;
    select * into lst from marketplace_listings where id = (l ->> 'listing_id')::uuid and org_id = p_org for update;
    if lst.id is null then
      raise exception 'Məhsul bu şirkətdə tapılmadı' using errcode = 'insufficient_privilege';
    end if;
    if nullif(l ->> 'variant_id', '') is not null then
      select * into vr from marketplace_variants where id = (l ->> 'variant_id')::uuid and listing_id = lst.id for update;
      if vr.id is null then
        raise exception 'Variant bu məhsula aid deyil' using errcode = 'invalid_parameter_value';
      end if;
      if vr.stock < v_qty then
        raise exception 'Stok kifayət etmir. Mövcud stok: %', vr.stock using errcode = 'P0001';
      end if;
      update marketplace_variants set stock = stock - v_qty where id = vr.id;
    else
      if lst.stock < v_qty then
        raise exception 'Stok kifayət etmir. Mövcud stok: %', lst.stock using errcode = 'P0001';
      end if;
      update marketplace_listings set stock = stock - v_qty,
             status = case when status = 'draft' then 'draft' when stock - v_qty <= 0 then 'out_of_stock' else status end
        where id = lst.id;
    end if;
    insert into marketplace_order_lines (org_id, user_id, order_id, listing_id, variant_id, shopify_variant_id, line_title,
                                         quantity, sale_azn_minor, cost_azn_minor)
      values (p_org, auth.uid(), v_order, lst.id, vr.id, vr.external_id,
              coalesce(nullif(left(l ->> 'line_title', 500), ''), (select left(name, 500) from products where id = lst.product_id)),
              v_qty, coalesce((l ->> 'sale_azn_minor')::bigint, 0), coalesce((l ->> 'cost_azn_minor')::bigint, 0));
  end loop;
  return v_order;
end $$;

-- Price / status history for one Modul 03 row, from the audit log, limited to non-sensitive columns.
-- Visible to anyone who may read Modul 03 in that organization (the full audit log needs audit.read).
create function public.marketplace_history(p_entity text, p_id uuid)
returns table (changed_at timestamptz, actor_id uuid, action text, changed jsonb)
language plpgsql stable security definer set search_path = public, pg_temp as $$
#variable_conflict use_column
declare v_table text; v_cols text[]; v_org uuid;
begin
  case p_entity
    when 'listing' then v_table := 'marketplace_listings';
      v_cols := array['purchase_azn_minor','shipping_azn_minor','other_azn_minor','sale_azn_minor','status','stock','low_stock_threshold'];
    when 'variant' then v_table := 'marketplace_variants';
      v_cols := array['price_azn_minor','purchase_azn_minor','shipping_azn_minor','other_azn_minor','stock'];
    when 'order' then v_table := 'marketplace_orders';
      v_cols := array['status','financial_status','fulfillment_status','tracking_number','carrier','shipped_at','delivered_at',
                      'archived_at','note'];
    when 'order_line' then v_table := 'marketplace_order_lines';
      v_cols := array['sale_azn_minor','cost_azn_minor','refund_azn_minor','cost_missing','supplier_order_number',
                      'supplier_order_status','supplier_ordered_at','supplier_paid_azn_minor'];
    else return;
  end case;
  execute format('select org_id from public.%I where id = $1', v_table) into v_org using p_id;
  if v_org is null then   -- deleted row: its organization is in the audit log itself
    select a.org_id into v_org from audit_log a where a.table_name = v_table and a.record_id = p_id::text limit 1;
  end if;
  if v_org is null or v_org not in (select public.org_ids_with('data.read'))
     or (v_org, 'marketplace'::text) not in (select * from public.org_module_access('read')) then
    return;
  end if;
  return query
    select a.at, a.actor_id, a.action, f.c
    from audit_log a
    cross join lateral (select coalesce(jsonb_object_agg(k.key, a.changed -> k.key), '{}'::jsonb) as c
                        from jsonb_object_keys(a.changed) as k(key) where k.key = any (v_cols)) f
    where a.org_id = v_org and a.table_name = v_table and a.record_id = p_id::text and f.c <> '{}'::jsonb
    order by a.at desc, a.id desc
    limit 200;
end $$;

-- Y7: store status for every Modul 03 reader — counts and times only, never the payloads.
create function public.marketplace_store_status(p_org uuid)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if p_org is null or p_org not in (select public.org_ids_with('data.read'))
     or (p_org, 'marketplace'::text) not in (select * from public.org_module_access('read')) then
    return null;
  end if;
  return jsonb_build_object(
    'connected', exists (select 1 from integrations where org_id = p_org and provider = 'shopify' and status = 'connected'),
    'last_event_at', (select max(received_at) from integration_events where org_id = p_org),
    'failed_events', (select count(*) from integration_events where org_id = p_org and status = 'failed'));
end $$;

-- D6: delete a Modul 03 product. SECURITY INVOKER — the caller's own RLS applies to every statement.
create function public.marketplace_delete_listing(p_listing uuid)
returns void language plpgsql security invoker set search_path = public, pg_temp as $$
declare v marketplace_listings; n bigint; v_origin text;
begin
  select * into v from marketplace_listings where id = p_listing;
  if v.id is null then
    raise exception 'Məhsul tapılmadı' using errcode = 'invalid_parameter_value';
  end if;
  if v.org_id not in (select public.org_ids_with('data.write'))
     or (v.org_id, 'marketplace'::text) not in (select * from public.org_module_access('write')) then
    raise exception 'Bu məhsulu silmək icazəniz yoxdur' using errcode = 'insufficient_privilege';
  end if;
  select count(*) into n from marketplace_order_lines where listing_id = p_listing;
  if n > 0 then
    raise exception 'Bu məhsulun % sifariş sətri var. Sifariş tarixçəsi itməsin deyə onu silmək olmur. Qaralama edə bilərsiniz.', n
      using errcode = 'P0001', hint = 'draft';
  end if;
  select origin_module into v_origin from products where id = v.product_id;
  delete from supplier_offers where product_id = v.product_id and origin_module = 'marketplace';
  delete from marketplace_listings where id = p_listing;
  if v_origin = 'marketplace' then
    delete from products where id = v.product_id;
  end if;
end $$;

-- ── 7. Behaviour triggers ────────────────────────────────────
-- Listing stock = sum of its variants (DropPilot recomputeProductStock); a draft stays a draft.
create function public.marketplace_variant_rollup()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_listing uuid := coalesce(new.listing_id, old.listing_id); v_total int;
begin
  select coalesce(sum(stock), 0)::int into v_total from marketplace_variants where listing_id = v_listing;
  update marketplace_listings set stock = v_total,
         status = case when status = 'draft' then 'draft' when v_total <= 0 then 'out_of_stock' else 'active' end
    where id = v_listing
      and (stock is distinct from v_total
           or (status <> 'draft' and status is distinct from (case when v_total <= 0 then 'out_of_stock' else 'active' end)));
  return null;
end $$;

-- One notification per crossing of the threshold (DropPilot dp_low_stock_trigger).
create function public.marketplace_low_stock()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_thr int; v_name text;
begin
  if tg_op = 'UPDATE' and new.stock is not distinct from old.stock then return null; end if;
  select coalesce(new.low_stock_threshold, (select s.low_stock_threshold from marketplace_settings s where s.org_id = new.org_id), 5)
    into v_thr;
  if new.stock <= v_thr and (tg_op = 'INSERT' or old.stock > v_thr) then
    select name into v_name from products where id = new.product_id;
    perform public.notify_marketplace(new.org_id, 'marketplace.low_stock', 'Stok azdır: ' || coalesce(v_name, 'məhsul'),
      format('Qalıq: %s ədəd (hədd: %s).', new.stock, v_thr), '/m/marketplace?tab=products&listing=' || new.id,
      'marketplace_listing', new.id::text,
      jsonb_build_object('stock', new.stock, 'threshold', v_thr, 'severity', case when new.stock <= 0 then 'error' else 'warning' end),
      'low_stock:' || new.id || ':' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSUS'));
  end if;
  return null;
end $$;

-- Price history on every price change + a notification when the AZN price changes (DropPilot dp_supplier_price_trigger).
create function public.supplier_offer_price_log()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_name text;
begin
  if tg_op = 'INSERT' or new.price_minor is distinct from old.price_minor or new.shipping_minor is distinct from old.shipping_minor
     or new.currency is distinct from old.currency or new.fx_rate_to_base is distinct from old.fx_rate_to_base then
    insert into supplier_offer_prices (org_id, offer_id, currency, price_minor, shipping_minor, fx_rate_to_base,
                                       price_azn_minor, shipping_azn_minor, recorded_by)
      values (new.org_id, new.id, new.currency, new.price_minor, new.shipping_minor, new.fx_rate_to_base,
              new.price_azn_minor, new.shipping_azn_minor, auth.uid());
  end if;
  if tg_op = 'UPDATE' and new.origin_module = 'marketplace'
     and (new.price_azn_minor is distinct from old.price_azn_minor or new.shipping_azn_minor is distinct from old.shipping_azn_minor) then
    select name into v_name from products where id = new.product_id;
    perform public.notify_marketplace(new.org_id, 'marketplace.supplier_price', 'Təchizatçı qiyməti dəyişdi: ' || coalesce(v_name, 'məhsul'),
      format('Qiymət %s → %s AZN, çatdırılma %s → %s AZN.',
             to_char(old.price_azn_minor / 100.0, 'FM999999990.00'), to_char(new.price_azn_minor / 100.0, 'FM999999990.00'),
             to_char(old.shipping_azn_minor / 100.0, 'FM999999990.00'), to_char(new.shipping_azn_minor / 100.0, 'FM999999990.00')),
      '/m/marketplace?tab=suppliers', 'supplier_offer', new.id::text,
      jsonb_build_object('old_azn_minor', old.price_azn_minor, 'new_azn_minor', new.price_azn_minor, 'severity', 'warning'),
      'supplier_price:' || new.id || ':' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSUS'));
  end if;
  return null;
end $$;

create trigger marketplace_variant_rollup after insert or update of stock or delete on public.marketplace_variants
  for each row execute function public.marketplace_variant_rollup();
create trigger marketplace_low_stock after insert or update of stock on public.marketplace_listings
  for each row execute function public.marketplace_low_stock();
create trigger supplier_offer_price_log after insert or update on public.supplier_offers
  for each row execute function public.supplier_offer_price_log();

-- ── 8. Privileges ────────────────────────────────────────────
revoke all on function
  public.marketplace_blocked_shop(text),
  public._marketplace_integration(uuid, uuid),
  public.marketplace_upsert_catalog(uuid, uuid, jsonb),
  public.marketplace_upsert_shopify_order(uuid, uuid, jsonb, jsonb),
  public.marketplace_apply_inventory(uuid, uuid, text, text, integer),
  public.integration_event_store(text, text, text, text, jsonb, text),
  public.integration_event_finish(bigint, text, text, timestamptz),
  public.integration_events_purge(integer),
  public.marketplace_create_manual_order(uuid, jsonb, jsonb),
  public.marketplace_history(text, uuid),
  public.marketplace_store_status(uuid),
  public.marketplace_delete_listing(uuid),
  public.marketplace_variant_rollup(),
  public.marketplace_low_stock(),
  public.supplier_offer_price_log()
from public, anon, authenticated;

grant execute on function
  public.marketplace_blocked_shop(text),
  public.marketplace_create_manual_order(uuid, jsonb, jsonb),
  public.marketplace_history(text, uuid),
  public.marketplace_store_status(uuid),
  public.marketplace_delete_listing(uuid)
to authenticated;

do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function
      public.marketplace_blocked_shop(text),
      public.marketplace_upsert_catalog(uuid, uuid, jsonb),
      public.marketplace_upsert_shopify_order(uuid, uuid, jsonb, jsonb),
      public.marketplace_apply_inventory(uuid, uuid, text, text, integer),
      public.integration_event_store(text, text, text, text, jsonb, text),
      public.integration_event_finish(bigint, text, text, timestamptz),
      public.integration_events_purge(integer)
    to service_role;
  end if;
end $$;
