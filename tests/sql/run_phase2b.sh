#!/usr/bin/env bash
# Phase 2B database suite on a throwaway local PostgreSQL instance.
# (tests/sql/run.sh is unchanged and still runs the Phase 1 + 2A suite — now over all migrations.)
#
#   tests/sql/run_phase2b.sh          full 2B suite:
#        1) all migrations + Supabase stubs → Phase 1, 2A and 2B tests
#        2) preferences: database rule == shared/preferences.js
#        3) rollback cycle of the 2B migrations: up → 2B data → down → 2A tests pass → up → 2B tests pass
#   RED=1 tests/sql/run_phase2b.sh    run the 2B tests on the schema WITHOUT the 2B migrations
#                                     (proves the tests fail before the implementation)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
TMP="$(mktemp -d)"
PORT="${PGPORT_TEST:-55433}"
FIRST_2B=20261123000900
LAST_2A=20261122000800
trap '"$PGBIN/pg_ctl" -D "$TMP/data" stop -m fast >/dev/null 2>&1 || true; rm -rf "$TMP"' EXIT

"$PGBIN/initdb" -D "$TMP/data" -U postgres -A trust >/dev/null
"$PGBIN/pg_ctl" -D "$TMP/data" -o "-p $PORT -k $TMP -c listen_addresses=''" -l "$TMP/log" start >/dev/null
PSQL=(psql -h "$TMP" -p "$PORT" -U postgres -v ON_ERROR_STOP=1 -q)

fresh_db() {
  "${PSQL[@]}" -d postgres -c "drop database if exists t" -c "create database t" >/dev/null
  "${PSQL[@]}" -d t -f "$ROOT/tests/sql/auth_stub.sql"
  "${PSQL[@]}" -d t -f "$ROOT/tests/sql/supabase_stub_2b.sql" 2>&1 | grep -v 'wal_level' || true
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
  migrate_up "" "$LAST_2A" >/dev/null
  echo "── Phase 2B tests on the schema WITHOUT the 2B migrations (expected to FAIL)"
  "${PSQL[@]}" -d t -f "$ROOT/tests/sql/phase2b_tests.sql" || { echo "RED RUN: tests failed as expected"; exit 0; }
  echo "RED RUN: tests unexpectedly passed"; exit 1
fi

# 1) Full suite
fresh_db
migrate_up
echo "── Phase 1 tests";        "${PSQL[@]}" -d t -f "$ROOT/tests/sql/tests.sql"
echo "── Phase 2A tests";       "${PSQL[@]}" -d t -f "$ROOT/tests/sql/tenancy_tests.sql"
echo "── Phase 2B tests";       "${PSQL[@]}" -d t -f "$ROOT/tests/sql/phase2b_tests.sql"

echo "── read-only Supabase verification script (supabase/verify/phase2b_verify.sql)"
"${PSQL[@]}" -d t -f "$ROOT/supabase/verify/phase2b_verify.sql" > "$TMP/verify.txt"
if grep -q "FAIL" "$TMP/verify.txt"; then cat "$TMP/verify.txt"; echo "verification script reports FAIL"; exit 1; fi
echo "verification script: $(grep -c PASS "$TMP/verify.txt") checks, all PASS"

# 2) Preferences rule in the database == shared/preferences.js
echo "── preferences rule sync"
node "$ROOT/scripts/preference-cases.mjs" > "$TMP/cases.tsv"
fails=0; total=0
while IFS=$'\t' read -r expected json; do
  total=$((total + 1))
  got="$("${PSQL[@]}" -d t -At -c "select public.valid_preferences(\$j\$${json}\$j\$::jsonb)")"
  if [[ "$got" != "$expected" ]]; then echo "MISMATCH js=$expected db=$got  $json"; fails=$((fails + 1)); fi
done < "$TMP/cases.tsv"
[[ $fails -eq 0 ]] || { echo "preferences rule out of sync ($fails/$total)"; exit 1; }
echo "preferences rule in sync ($total cases)"

# 3) Rollback cycle of the 2B migrations
#    schema after "down" must equal the Phase 2A schema exactly (pg_dump --schema-only diff)
echo "── 2B rollback cycle"
DUMP=("$PGBIN/pg_dump" -h "$TMP" -p "$PORT" -U postgres -d t --schema-only --no-owner --exclude-schema=rb2b)
fresh_db
migrate_up "" "$LAST_2A" >/dev/null
"${PSQL[@]}" -d t -v with_2b=false -f "$ROOT/tests/sql/rollback_seed_2b.sql"
"${DUMP[@]}" > "$TMP/schema_2a.sql"
migrate_up "$LAST_2A" >/dev/null
"${PSQL[@]}" -d t -v with_2b=true -f "$ROOT/tests/sql/rollback_seed_2b.sql"
"${PSQL[@]}" -d t -f "$ROOT/tests/sql/rollback_check_2b.sql" -v phase=after_up
migrate_down "$FIRST_2B"
"${PSQL[@]}" -d t -f "$ROOT/tests/sql/rollback_check_2b.sql" -v phase=after_down
"${DUMP[@]}" > "$TMP/schema_down.sql"
# Normalise: drop pg_dump's random \restrict tokens and the one deliberate leftover —
# the pg_trgm extension + `extensions` schema (see the 0011 rollback script).
norm() { grep -vE '^\\(un)?restrict |^(CREATE|COMMENT ON) EXTENSION .*pg_trgm|^CREATE SCHEMA extensions;|^GRANT USAGE ON SCHEMA extensions TO ' "$1" | grep -vE '^--|^$'; }   # comments and blank lines carry no schema
norm "$TMP/schema_2a.sql" > "$TMP/a.sql"; norm "$TMP/schema_down.sql" > "$TMP/b.sql"
if diff -u -B "$TMP/a.sql" "$TMP/b.sql" > "$TMP/schema.diff"; then
  echo "schema after rollback == Phase 2A schema (pg_dump identical; pg_trgm kept on purpose)"
else
  echo "SCHEMA DIFFERS after rollback:"; cat "$TMP/schema.diff"; exit 1
fi
echo "── Phase 2A tests on the rolled-back schema"
"${PSQL[@]}" -d t -f "$ROOT/tests/sql/tenancy_tests.sql" | tail -3
migrate_up "$LAST_2A" >/dev/null
"${PSQL[@]}" -d t -f "$ROOT/tests/sql/rollback_check_2b.sql" -v phase=after_reup
echo "── Phase 2B tests after re-applying"
"${PSQL[@]}" -d t -f "$ROOT/tests/sql/phase2b_tests.sql" | tail -3
echo "ALL PHASE 2B DATABASE CHECKS PASSED"
