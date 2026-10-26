#!/usr/bin/env bash
# Prueba del acceso al panel: arranca la app (next start) con Supabase y motor simulados y lanza flow.mjs.
# Requiere `npm run build` previo. Uso: bash tests/admin-auth/run.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
export NODE_NO_WARNINGS=1
# Antes de arrancar nada: ninguna prueba puede llamar a una ruta o fichero que no esté en el repositorio (y el chequeo se prueba a sí mismo).
node tests/orphan-refs.selftest.mjs
node tests/orphan-refs.mjs
export PORT=3199
SUPABASE_URL=http://127.0.0.1:8791 SUPABASE_PUBLISHABLE_KEY=anon-key SUPABASE_SERVICE_ROLE_KEY=service-key \
CAREER_ENGINE_URL=http://127.0.0.1:8792 CAREER_ADMIN_TOKEN=engine-token ADMIN_PUBLIC_URL=https://app.test.dev \
URL_GUARD_TEST_ALLOW=127.0.0.1:8792 STUDENT_AUTH_CACHE_MS=0 APIFY_MONTHLY_BUDGET_USD=5 INGEST_TOKEN=ingest-token-0123456789abcdef0123 CRON_SECRET=cron-secret-0123456789 INFOJOBS_API_BASE=http://127.0.0.1:8791 ADZUNA_API_BASE=http://127.0.0.1:8791 JOOBLE_API_BASE=http://127.0.0.1:8791 APIFY_API_BASE=http://127.0.0.1:8791 SERPAPI_API_BASE=http://127.0.0.1:8791 SERPAPI_JOBS_MAX_DORKS=0 GROQ_API_BASE=http://127.0.0.1:8791 OPENAI_API_BASE=http://127.0.0.1:8791 RESEND_API_BASE=http://127.0.0.1:8791 \
  npx --no-install next start apps/web --hostname 127.0.0.1 --port "$PORT" > /tmp/admin-auth-next.log 2>&1 &
NEXT_PID=$!
trap 'kill $NEXT_PID 2>/dev/null || true' EXIT
for _ in $(seq 1 40); do curl -s -o /dev/null "http://127.0.0.1:$PORT/" && break; sleep 0.5; done
BASE="http://127.0.0.1:$PORT" node tests/admin-auth/flow.mjs
node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/parity.mjs
node --experimental-strip-types tests/admin-auth/csv.mjs
node --experimental-strip-types tests/admin-auth/salary.mjs
node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/score.mjs
node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/aireview.mjs
node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/metrics.mjs
node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/agreement.mjs
node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/hardening.mjs
node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/ingest.mjs
node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/tiers_b2b.mjs
node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/application.mjs
node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/matching.mjs
node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/cronbudget.mjs
node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/training.mjs
node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/activity.mjs
node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/dashboard.mjs
node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/studentmetrics.mjs
node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/retention.mjs
node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/googlejobs.mjs
node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/fallback.mjs
node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/surface.mjs
node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/market.mjs
node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/offerrisk.mjs
node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/voice.mjs
node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/practice.mjs
node tests/admin-auth/gate.mjs
node spikes/voice/tests/voice.mjs
BASE="http://127.0.0.1:$PORT" node tests/admin-auth/ui.mjs
