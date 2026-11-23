#!/usr/bin/env bash
# Phase 3 · Modules 01, 02, 04–10 database suite on a throwaway LOCAL PostgreSQL instance.
# Unix socket in a temp directory only: no network, no Supabase, no Netlify.
#
#   tests/sql/run_modules.sh        full suite:
#        1) all migrations → every older suite (Phase 1, 2A, 2B, İ-3) unchanged + Phase 3 tests
#           + read-only verification scripts
#        2) rollback cycle of 0018–0022: up → data → down → schema == İ-3 schema (pg_dump)
#           → older suites pass → up again → Phase 3 tests pass
#   RED=1 tests/sql/run_modules.sh  Phase 3 tests on the schema WITHOUT 0018–0022 (must fail)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
TMP="$(mktemp -d)"
PORT="${PGPORT_TEST:-55436}"
LAST_MP=20261124001700
FIRST_P3=20261125001800
trap '"$PGBIN/pg_ctl" -D "$TMP/data" stop -m fast >/dev/null 2>&1 || true; rm -rf "$TMP"' EXIT

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
summary() { { grep -E '^\s+[0-9]+ \|\s+[0-9]+ \|' "$1" | tail -1 | awk -F'|' -v n="$2" '{gsub(/ /,""); print n ": passed=" $1 " failed=" $2 " groups=" $3}'; } || true; }

if [[ -n "${RED:-}" ]]; then
  fresh_db; migrate_up "" "$LAST_MP" >/dev/null
  if "${PSQL[@]}" -d t -f "$ROOT/tests/sql/modules_tests.sql" > "$TMP/red.txt" 2>&1; then echo "RED RUN: tests unexpectedly passed"; exit 1; fi
  summary "$TMP/red.txt" "RED RUN"; echo "RED RUN: $(grep -c "| FAIL |" "$TMP/red.txt") failing checks before the stopping error: $(grep -m1 -oE "ERROR: .{0,90}" "$TMP/red.txt")"; echo "RED RUN: tests failed as expected"; exit 0
fi

# 1) Full suite
fresh_db
migrate_up >/dev/null
for v in phase2b_verify marketplace_verify modules_verify; do
  "${PSQL[@]}" -d t -f "$ROOT/supabase/verify/$v.sql" > "$TMP/$v.txt"
  if grep -q "FAIL" "$TMP/$v.txt"; then cat "$TMP/$v.txt"; echo "$v reports FAIL"; exit 1; fi
  echo "$v: $(grep -c PASS "$TMP/$v.txt") checks, all PASS"
done
echo "── Phase 1 tests";   "${PSQL[@]}" -d t -f "$ROOT/tests/sql/tests.sql" | tail -2
echo "── Phase 2A tests";  "${PSQL[@]}" -d t -f "$ROOT/tests/sql/tenancy_tests.sql" | tail -2
echo "── Phase 2B tests";  "${PSQL[@]}" -d t -f "$ROOT/tests/sql/phase2b_tests.sql" | tail -2
echo "── İ-3 marketplace tests"
"${PSQL[@]}" -d t -f "$ROOT/tests/sql/marketplace_tests.sql" > "$TMP/mp.txt" || { cat "$TMP/mp.txt"; exit 1; }
summary "$TMP/mp.txt" "marketplace"
echo "── Phase 3 module tests"
"${PSQL[@]}" -d t -f "$ROOT/tests/sql/modules_tests.sql" > "$TMP/p3.txt" || { grep -E "FAIL|ERROR" "$TMP/p3.txt"; exit 1; }
cp "$TMP/p3.txt" "${P3_REPORT:-/dev/null}" 2>/dev/null || true
summary "$TMP/p3.txt" "phase 3"

# 2) Rollback cycle of 0018–0022
echo "── Phase 3 rollback cycle"
DUMP=("$PGBIN/pg_dump" -h "$TMP" -p "$PORT" -U postgres -d t --schema-only --no-owner --exclude-schema=tm3 --exclude-schema=tmk)
fresh_db
migrate_up "" "$LAST_MP" >/dev/null
"${DUMP[@]}" > "$TMP/schema_mp.sql"
migrate_up "$LAST_MP" >/dev/null
"${PSQL[@]}" -d t -f "$ROOT/tests/sql/modules_tests.sql" > /dev/null   # put data into the new tables
migrate_down "$FIRST_P3"
"${PSQL[@]}" -d t -c "drop schema if exists tm3 cascade" >/dev/null 2>&1
"${DUMP[@]}" > "$TMP/schema_down.sql"
norm() { grep -vE '^\\(un)?restrict ' "$1" | grep -vE '^--|^$'; }
norm "$TMP/schema_mp.sql" > "$TMP/a.sql"; norm "$TMP/schema_down.sql" > "$TMP/b.sql"
if diff -u -B "$TMP/a.sql" "$TMP/b.sql" > "$TMP/schema.diff"; then
  echo "schema after rollback == İ-3 schema (pg_dump identical)"
else
  echo "SCHEMA DIFFERS after rollback:"; cat "$TMP/schema.diff"; exit 1
fi
echo "── İ-3 marketplace tests on the rolled-back schema"
"${PSQL[@]}" -d t -f "$ROOT/tests/sql/marketplace_tests.sql" > "$TMP/mp2.txt" || { grep -E "FAIL|ERROR" "$TMP/mp2.txt"; exit 1; }
summary "$TMP/mp2.txt" "marketplace (rolled back)"
migrate_up "$LAST_MP" >/dev/null
"${PSQL[@]}" -d t -f "$ROOT/supabase/verify/modules_verify.sql" > "$TMP/v2.txt"
if grep -q "FAIL" "$TMP/v2.txt"; then cat "$TMP/v2.txt"; echo "modules_verify after re-apply reports FAIL"; exit 1; fi
echo "re-applied 0018–0022: modules_verify $(grep -c PASS "$TMP/v2.txt") checks, all PASS"
echo "── Phase 3 tests on a fresh database (after the cycle)"
fresh_db; migrate_up >/dev/null
"${PSQL[@]}" -d t -f "$ROOT/tests/sql/modules_tests.sql" > "$TMP/p3b.txt" || { grep -E "FAIL|ERROR" "$TMP/p3b.txt"; exit 1; }
summary "$TMP/p3b.txt" "phase 3"
echo "ALL PHASE 3 DATABASE CHECKS PASSED"
