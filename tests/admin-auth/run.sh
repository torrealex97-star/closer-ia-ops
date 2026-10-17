#!/usr/bin/env bash
# Prueba del acceso al panel: arranca la app (next start) con Supabase y motor simulados y lanza flow.mjs.
# Requiere `npm run build` previo. Uso: bash tests/admin-auth/run.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
export PORT=3199
SUPABASE_URL=http://127.0.0.1:8791 SUPABASE_PUBLISHABLE_KEY=anon-key SUPABASE_SERVICE_ROLE_KEY=service-key \
CAREER_ENGINE_URL=http://127.0.0.1:8792 CAREER_ADMIN_TOKEN=engine-token ADMIN_PUBLIC_URL=https://app.test.dev \
STUDENT_AUTH_CACHE_MS=0 APIFY_MONTHLY_BUDGET_USD=5 INGEST_TOKEN=ingest-token-0123456789abcdef0123 CRON_SECRET=cron-secret-0123456789 INFOJOBS_API_BASE=http://127.0.0.1:8791 ADZUNA_API_BASE=http://127.0.0.1:8791 JOOBLE_API_BASE=http://127.0.0.1:8791 APIFY_API_BASE=http://127.0.0.1:8791 SERPAPI_API_BASE=http://127.0.0.1:8791 GROQ_API_BASE=http://127.0.0.1:8791 OPENAI_API_BASE=http://127.0.0.1:8791 \
  npx --no-install next start apps/web --hostname 127.0.0.1 --port "$PORT" > /tmp/admin-auth-next.log 2>&1 &
NEXT_PID=$!
trap 'kill $NEXT_PID 2>/dev/null || true' EXIT
for _ in $(seq 1 40); do curl -s -o /dev/null "http://127.0.0.1:$PORT/" && break; sleep 0.5; done
BASE="http://127.0.0.1:$PORT" node tests/admin-auth/flow.mjs
node --experimental-strip-types tests/admin-auth/parity.mjs 2>/dev/null
node --experimental-strip-types tests/admin-auth/csv.mjs 2>/dev/null
node --experimental-strip-types tests/admin-auth/salary.mjs 2>/dev/null
node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/score.mjs 2>/dev/null
node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/aireview.mjs 2>/dev/null
node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/metrics.mjs 2>/dev/null
node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/ingest.mjs 2>/dev/null
node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/tiers_b2b.mjs 2>/dev/null
node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/application.mjs 2>/dev/null
node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/matching.mjs 2>/dev/null
node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/cronbudget.mjs 2>/dev/null
node tests/admin-auth/gate.mjs
BASE="http://127.0.0.1:$PORT" node tests/admin-auth/ui.mjs
