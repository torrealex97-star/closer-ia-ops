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
# Motor en pausa por cuota (429 + texto plano, como responde la plataforma de verdad) o caído (500): la
# causa tiene que llegar en JSON al panel y a la alumna, sin ceros falsos ni mensajes que culpen a quien usa la app.
BASE="http://127.0.0.1:$PORT" node tests/admin-auth/enginepause.mjs
# Aviso del motor: un aviso por estado, al propietario y por correo solo si hay clave de Resend; sin
# historial (migración sin aplicar) se declara y no se envía nada en vez de repetirlo en cada comprobación.
BASE="http://127.0.0.1:$PORT" node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/enginealert.mjs
node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/parity.mjs
node --experimental-strip-types tests/admin-auth/csv.mjs
node --experimental-strip-types tests/admin-auth/salary.mjs
node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/score.mjs
node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/aireview.mjs
# Cualificación automática: lo claro se aprueba y lo dudoso ACABA en la cola humana (no en borrador).
node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/autoreview.mjs
# Auditoría del catálogo (SOLO LECTURA): lo ya aprobado que la regla retiraría, con su motivo y sin escribir nada.
node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/ruleaudit.mjs
node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/metrics.mjs
# Cifras por fuente: las cuenta la base (count=exact), sin traer la tabla ni cortarse en 5.000.
node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/sources.mjs
node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/agreement.mjs
node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/hardening.mjs
node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/ingest.mjs
node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/tiers_b2b.mjs
node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/application.mjs
# Candidaturas por páginas: PostgREST corta en 1.000 filas y el recuento salía corto sin decirlo.
node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/applications-paging.mjs
node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/matching.mjs
node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/cronbudget.mjs
node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/training.mjs
node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/activity.mjs
node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/dashboard.mjs
node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/studentmetrics.mjs
node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/retention.mjs
node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/googlejobs.mjs
node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/fallback.mjs
# Workana como portal de Apify: plantilla propia, sin país ISO roto y presupuesto que no es salario.
node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/workana.mjs
# Panel: los conectores del motor se cruzan con el catálogo por portal (Himalayas no es «fuera del cloud»).
node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/families.mjs
node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/surface.mjs
node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/market.mjs
# El motor retira en bloque lo que descarta (no lo deja en la cola humana): prueba de conducta con D1 simulado.
node --experimental-strip-types tests/engine/activate.mjs
# Búsquedas de closer del motor: vocabulario en español, rotación por día y extractores con `q`.
node --experimental-strip-types tests/engine/terms.mjs
# Cuota de escritura de la plataforma (100.000 filas/mes): el motor se para antes de que la pausa deje el sitio sin servir.
node --experimental-strip-types tests/engine/writebudget.mjs
node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/offerrisk.mjs
node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/offertags.mjs
node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/voice.mjs
node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/practice.mjs
# Topes de la sala: la IP del limitador no puede salir de una cabecera que elija el cliente.
node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/practicebudget.mjs
node tests/secrets.mjs
node tests/admin-auth/gate.mjs
node spikes/voice/tests/voice.mjs
BASE="http://127.0.0.1:$PORT" node tests/admin-auth/ui.mjs
