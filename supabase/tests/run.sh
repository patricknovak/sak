#!/usr/bin/env bash
# Runs the database rules test against a throwaway local Postgres database.
#   PGHOST=/tmp PGPORT=5433 PGUSER=postgres bash supabase/tests/run.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
PSQL="psql -v ON_ERROR_STOP=1 -q"
$PSQL -d postgres -c "drop database if exists sak_test" -c "create database sak_test"
$PSQL -d sak_test -f supabase/tests/supabase-stubs.sql 2>/dev/null
for f in $(ls supabase/migrations/*.sql | grep -v _cron) supabase/seed/players-*.sql supabase/seed/rosters-2025-26.sql; do
  $PSQL -d sak_test -f "$f"
done
$PSQL -d sak_test -f supabase/tests/flow.sql > /tmp/sak-flow.out
echo "database flow test passed"
