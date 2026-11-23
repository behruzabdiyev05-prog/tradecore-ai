#!/usr/bin/env bash
# İ-3 · DropPilot parity of the order-import freezing rules (database level).
# Runs DropPilot's OWN dp_upsert_shopify_order_lines (from a local copy of its sql/ folder) and
# TRADECORE's marketplace_upsert_shopify_order on the same 4 Shopify deliveries, each in a throwaway
# LOCAL PostgreSQL database, and compares the stored figures line by line (in qəpik).
# Nothing connects to Supabase, Shopify or the network; DropPilot's files are only read.
#
#   DROPPILOT_DIR=/path/to/dp_stage7 tests/sql/marketplace_parity.sh
# Without DROPPILOT_DIR the script explains itself and exits 0 (it is an extra check, not part of CI).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
if [[ -z "${DROPPILOT_DIR:-}" || ! -f "${DROPPILOT_DIR}/sql/DROPPILOT_STAGE70_MIGRATION.sql" ]]; then
  echo "skip: set DROPPILOT_DIR to a local copy of DropPilot (folder with sql/ and tests/sql/)"; exit 0
fi
PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
TMP="$(mktemp -d)"; PORT="${PGPORT_TEST:-55435}"
trap '"$PGBIN/pg_ctl" -D "$TMP/data" stop -m fast >/dev/null 2>&1 || true; rm -rf "$TMP"' EXIT
"$PGBIN/initdb" -D "$TMP/data" -U postgres -A trust >/dev/null
"$PGBIN/pg_ctl" -D "$TMP/data" -o "-p $PORT -k $TMP -c listen_addresses=''" -l "$TMP/log" start >/dev/null
PSQL=(psql -h "$TMP" -p "$PORT" -U postgres -v ON_ERROR_STOP=1 -q)
"${PSQL[@]}" -d postgres -c "create database dp" -c "create database tc" >/dev/null

# Four deliveries of the same Shopify order (AZN amounts as the server computed them; rate changes 1.70 → 1.80 → 1.83 → 1.79).
# Line 3 appears only from the 2nd delivery (an order edited in Shopify) — its own rate (1.80) must stay frozen.
# D3 deliberately omits line 3; the last delivery carries every line, as a real Shopify webhook does.
D1='[{"l":"1","p":"1","q":2,"sale":85.00,"ship":8.50,"fee":3.00,"refund":0,"cost":38.00,"miss":false},
     {"l":"2","p":null,"q":1,"sale":17.00,"ship":0,"fee":0.50,"refund":0,"cost":0,"miss":true}]'
D2='[{"l":"1","p":"1","q":2,"sale":99.99,"ship":9.99,"fee":9.99,"refund":18.00,"cost":99.99,"miss":false},
     {"l":"2","p":null,"q":1,"sale":17.00,"ship":0,"fee":0.50,"refund":0,"cost":9.00,"miss":false},
     {"l":"3","p":"2","q":1,"sale":18.00,"ship":0,"fee":0.60,"refund":0,"cost":12.00,"miss":false}]'
D3='[{"l":"1","p":"1","q":2,"sale":85.00,"ship":8.50,"fee":3.00,"refund":18.35,"cost":38.00,"miss":false},
     {"l":"2","p":null,"q":1,"sale":17.00,"ship":0,"fee":0.50,"refund":0,"cost":12.00,"miss":false}]'
D4='[{"l":"1","p":"1","q":2,"sale":85.00,"ship":8.50,"fee":3.00,"refund":18.35,"cost":38.00,"miss":false},
     {"l":"2","p":null,"q":1,"sale":17.00,"ship":0,"fee":0.50,"refund":0,"cost":12.00,"miss":false},
     {"l":"3","p":"2","q":1,"sale":18.00,"ship":0,"fee":0.60,"refund":7.77,"cost":12.00,"miss":false}]'

# ── DropPilot (its own migrations + its own function) ──
DP="$DROPPILOT_DIR"
"${PSQL[@]}" -d dp -f "$DP/tests/sql/00_supabase_stub.sql"
sed "s/__IDTYPE__/uuid primary key default gen_random_uuid()/; s/__FKTYPE__/uuid/" "$DP/tests/sql/01_base_tables.sql" | "${PSQL[@]}" -d dp
for f in DROPPILOT_STAGE65_ALL_IN_ONE DROPPILOT_STAGE70_MIGRATION DROPPILOT_STAGE74_PRODUCTS DROPPILOT_STAGE76_SUPPLIERS \
         DROPPILOT_STAGE77_ORDERS DROPPILOT_STAGE78_SHIPPING DROPPILOT_STAGE79_FINANCE DROPPILOT_STAGE710_REPORTS; do
  "${PSQL[@]}" -d dp -f "$DP/sql/$f.sql" >/dev/null
done
"${PSQL[@]}" -d dp <<'SQL'
insert into auth.users values ('d0000000-0000-0000-0000-000000000001');
insert into public.products (id, user_id, name, source, external_id) values
  ('d1000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', 'P1', 'shopify', 'gid://shopify/Product/1'),
  ('d1000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000001', 'P2', 'shopify', 'gid://shopify/Product/2');
SQL
cat > "$TMP/dp.sql" <<SQL
create function pg_temp.deliver(d jsonb, fx numeric, st text, fin text) returns jsonb language sql as \$f\$
  select public.dp_upsert_shopify_order_lines(jsonb_agg(jsonb_build_object(
    'user_id', 'd0000000-0000-0000-0000-000000000001', 'order_number', '#1001', 'customer_name', 'A',
    'product_id', case when x->>'p' is null then null else 'd1000000-0000-0000-0000-00000000000' || (x->>'p') end,
    'quantity', x->'q', 'sale_total', x->'sale', 'cost_total', x->'cost', 'status', st,
    'external_id', 'gid://shopify/LineItem/' || (x->>'l'), 'shopify_order_id', 'gid://shopify/Order/1001',
    'shopify_financial_status', fin, 'shopify_fulfillment_status', 'UNFULFILLED', 'currency', 'USD', 'fx_rate', fx,
    'shipping_income', x->'ship', 'tax_total', 0, 'discount_total', 0, 'fee_total', x->'fee', 'refund_total', x->'refund',
    'cost_missing', x->'miss')))
  from jsonb_array_elements(d) x \$f\$;
select pg_temp.deliver('$D1', 1.70, 'processing', 'PAID');
select pg_temp.deliver('$D2', 1.80, 'problem', 'PARTIALLY_REFUNDED');
select pg_temp.deliver('$D3', 1.83, 'problem', 'PARTIALLY_REFUNDED');
select pg_temp.deliver('$D4', 1.79, 'complete', 'PARTIALLY_REFUNDED');
\pset format unaligned
\pset tuples_only on
select replace(external_id, 'gid://shopify/LineItem/', 'L') || '|' || round(sale_total * 100) || '|' || round(shipping_income * 100) || '|'
       || round(fee_total * 100) || '|' || round(refund_total * 100) || '|' || round(cost_total * 100) || '|' || cost_missing || '|' || status
       || '|' || fx_rate::numeric(6,2)
  from public.orders order by external_id;
SQL
"${PSQL[@]}" -d dp -f "$TMP/dp.sql" | grep '^L' > "$TMP/dp.txt"

# ── TRADECORE (all migrations + marketplace_upsert_shopify_order) ──
"${PSQL[@]}" -d tc -f "$ROOT/tests/sql/auth_stub.sql"
"${PSQL[@]}" -d tc -f "$ROOT/tests/sql/supabase_stub_2b.sql" 2>&1 | grep -v 'wal_level' || true
"${PSQL[@]}" -d tc -f "$ROOT/tests/sql/supabase_stub_marketplace.sql"
for f in "$ROOT"/supabase/migrations/*.sql; do "${PSQL[@]}" -d tc -f "$f" >/dev/null; done
cat > "$TMP/tc.sql" <<SQL
insert into auth.users (id, email, raw_user_meta_data)
  values ('e9000000-0000-0000-0000-000000000001', 'parity@test.local', '{"full_name":"Parity","company_name":"Parity MMC"}');
insert into public.integrations (org_id, user_id, provider, status, config)
  select active_org_id, id, 'shopify', 'connected', '{"shop_domain":"parity.myshopify.com","currency":"USD"}'
  from public.profiles where id = 'e9000000-0000-0000-0000-000000000001';
create temp table ctx as select p.active_org_id as org, i.id as integ from public.profiles p
  join public.integrations i on i.org_id = p.active_org_id where p.id = 'e9000000-0000-0000-0000-000000000001';
select public.marketplace_upsert_catalog(org, integ, '[{"external_id":"gid://shopify/Product/1","name":"P1"},{"external_id":"gid://shopify/Product/2","name":"P2"}]') from ctx;
create function pg_temp.deliver(d jsonb, fx numeric, st text, fin text) returns jsonb language sql as \$f\$
  select public.marketplace_upsert_shopify_order((select org from ctx), (select integ from ctx),
    jsonb_build_object('external_id', 'gid://shopify/Order/1001', 'order_number', '#1001', 'customer_name', 'A', 'currency', 'USD',
                       'fx_rate', fx, 'status', st, 'financial_status', fin, 'fulfillment_status', 'UNFULFILLED'),
    (select jsonb_agg(jsonb_build_object(
       'external_id', 'gid://shopify/LineItem/' || (x->>'l'),
       'listing_external_id', case when x->>'p' is null then 'gid://shopify/Product/999' else 'gid://shopify/Product/' || (x->>'p') end,
       'quantity', x->'q', 'sale_azn_minor', round((x->>'sale')::numeric * 100), 'shipping_income_azn_minor', round((x->>'ship')::numeric * 100),
       'fee_azn_minor', round((x->>'fee')::numeric * 100), 'refund_azn_minor', round((x->>'refund')::numeric * 100),
       'cost_azn_minor', round((x->>'cost')::numeric * 100), 'cost_missing', x->'miss')) from jsonb_array_elements(d) x))
\$f\$;
select pg_temp.deliver('$D1', 1.70, 'processing', 'PAID');
select pg_temp.deliver('$D2', 1.80, 'problem', 'PARTIALLY_REFUNDED');
select pg_temp.deliver('$D3', 1.83, 'problem', 'PARTIALLY_REFUNDED');
select pg_temp.deliver('$D4', 1.79, 'complete', 'PARTIALLY_REFUNDED');
\pset format unaligned
\pset tuples_only on
select replace(l.external_id, 'gid://shopify/LineItem/', 'L') || '|' || l.sale_azn_minor || '|' || l.shipping_income_azn_minor || '|'
       || l.fee_azn_minor || '|' || l.refund_azn_minor || '|' || l.cost_azn_minor || '|' || l.cost_missing || '|' || o.status
       || '|' || l.fx_rate_to_base::numeric(6,2)
  from public.marketplace_order_lines l join public.marketplace_orders o on o.id = l.order_id order by l.external_id;
SQL
"${PSQL[@]}" -d tc -f "$TMP/tc.sql" | grep '^L' > "$TMP/tc.txt"

echo "line|sale|shipping|fee|refund|cost|cost_missing|status|frozen rate   (qəpik)"
echo "── DropPilot dp_upsert_shopify_order_lines";      cat "$TMP/dp.txt"
echo "── TRADECORE marketplace_upsert_shopify_order";   cat "$TMP/tc.txt"
if diff -u "$TMP/dp.txt" "$TMP/tc.txt"; then
  echo "PARITY OK: $(wc -l < "$TMP/tc.txt") lines identical after 4 deliveries"
else
  echo "PARITY MISMATCH"; exit 1
fi
