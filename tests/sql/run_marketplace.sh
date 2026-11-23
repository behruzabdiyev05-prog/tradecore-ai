#!/usr/bin/env bash
# İ-3 · Modul 03 (Marketplace) database suite on a throwaway LOCAL PostgreSQL instance.
# Connects only through a Unix socket in a temp directory: no network, no Supabase, no Netlify.
#
#   tests/sql/run_marketplace.sh        full suite:
#        0) safety: the live DropPilot project ref must not appear in this repository or in .env
#        1) all migrations + stubs → Phase 1, 2A, 2B tests (unchanged) + İ-3 marketplace tests
#           + both read-only verification scripts
#        2) rollback cycle of 0013–0017: up → data → down → schema == Phase 2B schema (pg_dump),
#           2B data intact, 2B tests pass → up again → marketplace tests pass
#   RED=1 tests/sql/run_marketplace.sh  run the İ-3 tests on the schema WITHOUT 0013–0017
#                                       (proves the tests fail before the implementation)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
TMP="$(mktemp -d)"
PORT="${PGPORT_TEST:-55434}"
LAST_2B=20261123001200
FIRST_MP=20261124001300
DROPPILOT_LIVE_REF="rfnkpjzkonnlsdlvklcd"   # DropPilot's live Supabase project — must never be used here
trap '"$PGBIN/pg_ctl" -D "$TMP/data" stop -m fast >/dev/null 2>&1 || true; rm -rf "$TMP"' EXIT

# 0) Safety
if grep -rIl --exclude-dir=node_modules --exclude="$(basename "$0")" "$DROPPILOT_LIVE_REF" "$ROOT" >/dev/null 2>&1; then
  echo "STOP: the live DropPilot project ref was found in this repository:"; grep -rIl --exclude-dir=node_modules --exclude="$(basename "$0")" "$DROPPILOT_LIVE_REF" "$ROOT"; exit 2
fi
if [[ -f "$ROOT/.env" ]] && grep -q "$DROPPILOT_LIVE_REF" "$ROOT/.env"; then
  echo "STOP: .env points to the live DropPilot project"; exit 2
fi
echo "safety: no live DropPilot reference; local socket only ($TMP)"

"$PGBIN/initdb" -D "$TMP/data" -U postgres -A trust >/dev/null
"$PGBIN/pg_ctl" -D "$TMP/data" -o "-p $PORT -k $TMP -c listen_addresses=''" -l "$TMP/log" start >/dev/null
PSQL=(psql -h "$TMP" -p "$PORT" -U postgres -v ON_ERROR_STOP=1 -q)

fresh_db() {
  "${PSQL[@]}" -d postgres -c "drop database if exists t" -c "create database t" >/dev/null
  "${PSQL[@]}" -d t -f "$ROOT/tests/sql/auth_stub.sql"
  "${PSQL[@]}" -d t -f "$ROOT/tests/sql/supabase_stub_2b.sql" 2>&1 | grep -v 'wal_level' || true
  "${PSQL[@]}" -d t -f "$ROOT/tests/sql/supabase_stub_marketplace.sql"
}
migrate_up() {   # $1 = from (exclusive, may be empty)  $2 = upto (inclusive, may be empty)
  for f in "$ROOT"/supabase/migrations/*.sql; do
    v="$(basename "$f" | cut -d_ -f1)"
    if [[ -n "${2:-}" && "$v" > "$2" ]]; then continue; fi
    if [[ -n "${1:-}" && ! "$v" > "$1" ]]; then continue; fi
    echo "→ migrate $(basename "$f")"
    "${PSQL[@]}" -d t -f "$f"
  done
}
migrate_down() {   # every rollback script with version >= $1, newest first
  for f in $(ls "$ROOT"/supabase/rollback/*.down.sql | sort -r); do
    v="$(basename "$f" | cut -d_ -f1)"
    if [[ "$v" < "$1" ]]; then continue; fi
    echo "← rollback $(basename "$f")"
    "${PSQL[@]}" -d t -f "$f"
  done
}

if [[ -n "${RED:-}" ]]; then
  fresh_db
  migrate_up "" "$LAST_2B" >/dev/null
  echo "── İ-3 marketplace tests on the schema WITHOUT migrations 0013–0017 (expected to FAIL)"
  if "${PSQL[@]}" -d t -f "$ROOT/tests/sql/marketplace_tests.sql" > "$TMP/red.txt" 2>&1; then
    echo "RED RUN: tests unexpectedly passed"; exit 1
  fi
  grep -E '^\s+[0-9]+ \|\s+[0-9]+ \|' "$TMP/red.txt" | tail -1 | awk -F'|' '{gsub(/ /,""); print "RED RUN: passed=" $1 " failed=" $2 " groups=" $3}'
  grep -E 'MARKETPLACE TESTS FAILED' "$TMP/red.txt" | sed 's/^.*ERROR: */RED RUN: /'
  echo "RED RUN: tests failed as expected"
  exit 0
fi

# 1) Full suite
fresh_db
migrate_up
# The read-only verification scripts are meant for a FRESH test project: run them before any test data exists.
for v in phase2b_verify marketplace_verify; do
  "${PSQL[@]}" -d t -f "$ROOT/supabase/verify/$v.sql" > "$TMP/$v.txt"
  if grep -q "FAIL" "$TMP/$v.txt"; then cat "$TMP/$v.txt"; echo "$v reports FAIL"; exit 1; fi
  echo "$v: $(grep -c PASS "$TMP/$v.txt") checks, all PASS"
done
echo "── Phase 1 tests";   "${PSQL[@]}" -d t -f "$ROOT/tests/sql/tests.sql" | tail -2
echo "── Phase 2A tests";  "${PSQL[@]}" -d t -f "$ROOT/tests/sql/tenancy_tests.sql" | tail -2
echo "── Phase 2B tests";  "${PSQL[@]}" -d t -f "$ROOT/tests/sql/phase2b_tests.sql" | tail -2
echo "── İ-3 marketplace tests"
"${PSQL[@]}" -d t -f "$ROOT/tests/sql/marketplace_tests.sql" > "$TMP/mp.txt" || { cat "$TMP/mp.txt"; exit 1; }
cp "$TMP/mp.txt" "${MP_REPORT:-/dev/null}" 2>/dev/null || true
grep -E '^\s+[0-9]+ \|\s+[0-9]+ \|' "$TMP/mp.txt" | tail -1 | awk -F'|' '{gsub(/ /,""); print "marketplace: passed=" $1 " failed=" $2 " groups=" $3}'
tail -2 "$TMP/mp.txt"

# 2) Rollback cycle of 0013–0017
echo "── İ-3 rollback cycle"
DUMP=("$PGBIN/pg_dump" -h "$TMP" -p "$PORT" -U postgres -d t --schema-only --no-owner --exclude-schema=rbmp)
fresh_db
migrate_up "" "$LAST_2B" >/dev/null
"${PSQL[@]}" -d t -v with_mp=false -f "$ROOT/tests/sql/rollback_seed_mp.sql"
"${DUMP[@]}" > "$TMP/schema_2b.sql"
migrate_up "$LAST_2B" >/dev/null
"${PSQL[@]}" -d t -v with_mp=true -f "$ROOT/tests/sql/rollback_seed_mp.sql"
"${PSQL[@]}" -d t -f "$ROOT/tests/sql/rollback_check_mp.sql" -v phase=after_up
migrate_down "$FIRST_MP"
"${PSQL[@]}" -d t -f "$ROOT/tests/sql/rollback_check_mp.sql" -v phase=after_down
"${DUMP[@]}" > "$TMP/schema_down.sql"
norm() { grep -vE '^\\(un)?restrict ' "$1" | grep -vE '^--|^$'; }
norm "$TMP/schema_2b.sql" > "$TMP/a.sql"; norm "$TMP/schema_down.sql" > "$TMP/b.sql"
if diff -u -B "$TMP/a.sql" "$TMP/b.sql" > "$TMP/schema.diff"; then
  echo "schema after rollback == Phase 2B schema (pg_dump identical)"
else
  echo "SCHEMA DIFFERS after rollback:"; cat "$TMP/schema.diff"; exit 1
fi
echo "── Phase 2B tests on the rolled-back schema"
"${PSQL[@]}" -d t -f "$ROOT/tests/sql/phase2b_tests.sql" | tail -2
migrate_up "$LAST_2B" >/dev/null
"${PSQL[@]}" -d t -f "$ROOT/tests/sql/rollback_check_mp.sql" -v phase=after_reup
echo "── İ-3 marketplace tests after re-applying"
"${PSQL[@]}" -d t -f "$ROOT/tests/sql/marketplace_tests.sql" | tail -2
echo "ALL İ-3 MARKETPLACE DATABASE CHECKS PASSED"
