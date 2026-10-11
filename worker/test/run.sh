#!/bin/bash
# npm run test:live: the live rooms (worker/live.ts, worker/draft.ts, worker/pool.ts) under wrangler dev, reading from a stand-in database
# (live-mock.mjs), driven by live.test.mjs. Needs a built site in dist/ (npm run build).
set -e
cd "$(dirname "$0")/../.."
DAY=$(TZ=America/New_York date +%F)
node worker/test/live-mock.mjs "$DAY" > /dev/null 2>&1 & MOCK=$!
# in a process group of its own, so the cleanup stops wrangler and the runtime it starts
setsid npx -y wrangler@4 dev --port 8787 --ip 127.0.0.1 --var SUPABASE_URL:http://127.0.0.1:8799 > /dev/null 2>&1 & DEV=$!
trap 'kill $MOCK 2>/dev/null; kill -- -$DEV 2>/dev/null; rm -f worker/test/.live-state.json' EXIT
for i in $(seq 1 60); do curl -s -o /dev/null http://127.0.0.1:8787/ && break; sleep 2; done
node worker/test/live.test.mjs "$DAY"
node worker/test/draft.test.mjs
node worker/test/pool.test.mjs "$DAY"
