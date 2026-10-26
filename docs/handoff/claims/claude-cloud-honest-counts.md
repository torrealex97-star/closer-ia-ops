---
agent: claude-cloud
status: in_progress
branch: fix/recuentos-honestos
touches: apps/web/lib/applications.ts, apps/web/lib/supabaseAuth.ts, apps/web/lib/aiReview.ts, apps/web/lib/practiceBudget.ts, apps/web/lib/urlGuard.ts, apps/web/app/api/admin/students/route.ts, apps/web/app/api/student/applications/route.ts, apps/web/app/api/student/progress/route.ts, apps/web/app/api/practice/route.ts, apps/web/components/StudentsTab.tsx, apps/web/components/StudentProgress.tsx, tests/admin-auth/applications-paging.mjs, tests/admin-auth/practicebudget.mjs, tests/admin-auth/aireview.mjs, tests/admin-auth/hardening.mjs, tests/admin-auth/mock-services.mjs, tests/admin-auth/run.sh, tests/handoff.mjs, scripts/handoff.mjs, docs/STATUS.md
date: 2026-10-26
---
Revisión profunda: recuentos de candidaturas que ya no se cortan en silencio (paginador único), tope por IP de la sala de práctica no falseable y una IPv4 mapeada en IPv6 que pasaba por pública. Sin cambios de contrato público ni DDL.
