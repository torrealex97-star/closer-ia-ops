---
agent: claude-cloud
status: validated
branch: feat/student-login-flag
touches: apps/web/app/page.tsx, apps/web/app/api/backend/[...path]/route.ts, apps/web/lib/studentAuth.ts, tests/admin-auth/gate.mjs, tests/admin-auth/run.sh, docs/ACTIVE_HANDOFF.md
date: 2026-10-17
---
Interruptor STUDENT_LOGIN_REQUIRED (apagado por defecto) que protege `/` y la búsqueda hospedada.
