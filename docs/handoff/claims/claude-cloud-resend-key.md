---
agent: claude-cloud
status: validated
branch: feat/resend-key
touches: apps/web/lib/integrations.ts, apps/web/components/ApisTab.tsx, apps/web/app/api/admin/connections/route.ts, supabase/migrations/20261026_integration_resend.sql, tests/admin-auth/flow.mjs, tests/admin-auth/mock-services.mjs, tests/admin-auth/run.sh
date: 2026-10-25
---
Permite guardar y probar la clave de Resend en Panel → APIs (sin conectarla a nada). Migración del CHECK escrita, sin aplicar.
