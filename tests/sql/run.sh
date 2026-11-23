#!/usr/bin/env bash
# Runs all migrations + tests on a throwaway local PostgreSQL instance.
#   tests/sql/run.sh            full suite (Phase 1 tests, tenancy tests, permission sync, rollback cycle)
#   UPTO=20261121000400 tests/sql/run.sh   apply migrations only up to that version (used to show tests fail first)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
TMP="$(mktemp -d)"
PORT="${PGPORT_TEST:-55432}"
trap '"$PGBIN/pg_ctl" -D "$TMP/data" stop -m fast >/dev/null 2>&1 || true; rm -rf "$TMP"' EXIT

"$PGBIN/initdb" -D "$TMP/data" -U postgres -A trust >/dev/null
"$PGBIN/pg_ctl" -D "$TMP/data" -o "-p $PORT -k $TMP -c listen_addresses=''" -l "$TMP/log" start >/dev/null
PSQL=(psql -h "$TMP" -p "$PORT" -U postgres -v ON_ERROR_STOP=1 -q)

fresh_db() { "${PSQL[@]}" -d postgres -c "drop database if exists t" -c "create database t" >/dev/null; "${PSQL[@]}" -d t -f "$ROOT/tests/sql/auth_stub.sql"; }
migrate_up() {
  for f in "$ROOT"/supabase/migrations/*.sql; do
    v="$(basename "$f" | cut -d_ -f1)"
    if [[ -n "${UPTO:-}" && "$v" > "$UPTO" ]]; then continue; fi
    if [[ -n "${FROM:-}" && ! "$v" > "$FROM" ]]; then continue; fi
    echo "→ migrate $(basename "$f")"
    "${PSQL[@]}" -d t -f "$f"
  done
}
migrate_down() {
  for f in $(ls "$ROOT"/supabase/rollback/*.down.sql | sort -r); do
    v="$(basename "$f" | cut -d_ -f1)"
    if [[ "$v" < "$1" ]]; then continue; fi
    echo "← rollback $(basename "$f")"
    "${PSQL[@]}" -d t -f "$f"
  done
}

# 1) Full suite on a fresh database
fresh_db
migrate_up
echo "── Phase 1 tests"
"${PSQL[@]}" -d t -f "$ROOT/tests/sql/tests.sql"
echo "── Phase 2A tenancy tests"
"${PSQL[@]}" -d t -f "$ROOT/tests/sql/tenancy_tests.sql"
[[ -n "${UPTO:-}" ]] && exit 0

# 2) Role → permission seed matches shared/permissions.js
echo "── permission matrix sync"
node "$ROOT/scripts/permission-pairs.mjs" > "$TMP/expected.txt"
"${PSQL[@]}" -d t -At -c "select r.key || ':' || rp.permission_key from public.role_permissions rp join public.roles r on r.id = rp.role_id where r.org_id is null order by 1" > "$TMP/actual.txt"
LC_ALL=C sort "$TMP/expected.txt" -o "$TMP/expected.txt"; LC_ALL=C sort "$TMP/actual.txt" -o "$TMP/actual.txt"
diff "$TMP/expected.txt" "$TMP/actual.txt" && echo "permission matrix in sync ($(wc -l < "$TMP/actual.txt") pairs)"

# 3) Rollback cycle: up → data → down (Phase 2A) → data intact → up → tests pass
echo "── rollback cycle"
fresh_db
UPTO=20261121000400 migrate_up >/dev/null
"${PSQL[@]}" -d t -f "$ROOT/tests/sql/rollback_seed.sql"
FROM=20261121000400 migrate_up >/dev/null
"${PSQL[@]}" -d t -f "$ROOT/tests/sql/rollback_check.sql" -v phase=after_up
migrate_down 20261122000500
"${PSQL[@]}" -d t -f "$ROOT/tests/sql/rollback_check.sql" -v phase=after_down
FROM=20261121000400 migrate_up >/dev/null
"${PSQL[@]}" -d t -f "$ROOT/tests/sql/rollback_check.sql" -v phase=after_reup
echo "ALL DATABASE CHECKS PASSED"
