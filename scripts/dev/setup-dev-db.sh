#!/usr/bin/env bash
# Build a local development database (ipl_dev) with demo accounts. DEV ONLY.
# Optional: IMPORT_SQL=path/to/import_batch.sql to load the historical data too.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DB="${DEV_DB:-ipl_dev}"
export PGUSER="${PGUSER:-postgres}"
PSQL=(psql -X -q -v ON_ERROR_STOP=1 -d "$DB")
dropdb --if-exists "$DB"; createdb "$DB"
"${PSQL[@]}" -f "$ROOT/supabase/tests/_shim/supabase_shim.sql"
for f in "$ROOT"/supabase/migrations/*.sql; do "${PSQL[@]}" -f "$f"; done
"${PSQL[@]}" -f "$ROOT/tools/dev-api/setup-dev-db.sql"
"${PSQL[@]}" -f "$ROOT/tools/dev-api/seed-dev.sql"
if [[ -n "${IMPORT_SQL:-}" ]]; then "${PSQL[@]}" -1 -f "$IMPORT_SQL"; fi
echo "dev database $DB ready"
