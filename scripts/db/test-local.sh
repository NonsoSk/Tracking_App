#!/usr/bin/env bash
# Build a throw-away database from the migrations and run the pgTAP suite.
#
#   PGHOST=/tmp PGPORT=54329 PGUSER=postgres scripts/db/test-local.sh
#
# Needs PostgreSQL 15+ with the pgtap and pg_trgm extensions, and pg_prove.
# A Supabase shim (supabase/tests/_shim) stands in for Supabase's auth schema
# and roles, so the migrations run unmodified here and on Supabase.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DB="${TEST_DB:-ipl_grievance_test}"
export PGUSER="${PGUSER:-postgres}"
PSQL=(psql -X -q -v ON_ERROR_STOP=1 -d "$DB")

dropdb --if-exists "$DB"
createdb "$DB"
"${PSQL[@]}" -f "$ROOT/supabase/tests/_shim/supabase_shim.sql"
"${PSQL[@]}" -c "create extension if not exists pgtap with schema extensions"

for f in "$ROOT"/supabase/migrations/*.sql; do
  echo "migrate  $(basename "$f")"
  "${PSQL[@]}" -f "$f"
done

"${PSQL[@]}" -f "$ROOT/supabase/tests/_shim/test_helpers.sql"

if [[ "${1:-}" == "--migrate-only" ]]; then exit 0; fi
pg_prove -d "$DB" --ext .sql "$ROOT"/supabase/tests/*.test.sql
