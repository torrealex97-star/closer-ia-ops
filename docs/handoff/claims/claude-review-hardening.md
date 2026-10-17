---
agent: claude-cloud
status: validated
branch: fix/review-hardening
touches: apps/web/lib/urlGuard.ts, apps/web/lib/aiReview.ts, apps/web/lib/external.ts, apps/web/lib/externalSurface.ts, apps/web/lib/collectors.ts, apps/web/lib/apify.ts, apps/web/lib/cronBudget.ts, apps/web/lib/adminAuth.ts, apps/web/app/api/backend, apps/web/app/api/admin/external, apps/web/app/api/admin/apify, apps/web/components/ApifyTab.tsx, apps/web/app/globals.css, tests/admin-auth
date: 2026-10-17
---
Correcciones de la revisión de código (SSRF en verificación, fallos que fallaban abiertos, cookies del proxy, reloj en acciones del panel).
