#!/usr/bin/env bash
# Runs SQL on the live Supabase project through the Management API, for changes the Supabase connector holds
# (any statement with drop or delete waits there for a confirmation a cloud session can't give).
#
#   scripts/db.sh query "select 1"                 run a statement, print the rows as JSON
#   scripts/db.sh file path/to.sql                  run a whole file as one request
#   scripts/db.sh migrate supabase/migrations/20261005000NNN_name.sql
#                                                   run a migration file and record it in schema_migrations
#
# Needs SUPABASE_ACCESS_TOKEN (a Supabase personal access token) in the environment: the cloud environment's
# settings, never the repo or the chat. The project defaults to SaK's; override with SUPABASE_PROJECT.
set -euo pipefail
: "${SUPABASE_ACCESS_TOKEN:?set SUPABASE_ACCESS_TOKEN in the environment settings}"
PROJECT="${SUPABASE_PROJECT:-quakdkzdafzlhgjvmypg}"

run() {
  python3 -c 'import json,sys; print(json.dumps({"query": sys.stdin.read()}))' |
    curl -sS --fail-with-body -X POST "https://api.supabase.com/v1/projects/$PROJECT/database/query" \
      -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H 'Content-Type: application/json' --data-binary @-
  echo
}

case "${1:-}" in
  query) printf '%s' "$2" | run ;;
  file) run < "$2" ;;
  migrate)
    f="$2"; base="$(basename "$f" .sql)"; version="${base%%_*}"; name="${base#*_}"
    # the file and its schema_migrations row go in one request, so a failure leaves neither
    { cat "$f"; printf '\n;\ninsert into supabase_migrations.schema_migrations (version, name, statements)\n'
      printf "select '%s', '%s', array['applied with scripts/db.sh from supabase/migrations/%s.sql']\n" "$version" "$name" "$base"
      printf "where not exists (select 1 from supabase_migrations.schema_migrations where name = '%s');\n" "$name"; } | run ;;
  *) echo "usage: scripts/db.sh query \"<sql>\" | file <path> | migrate <migration file>" >&2; exit 2 ;;
esac
