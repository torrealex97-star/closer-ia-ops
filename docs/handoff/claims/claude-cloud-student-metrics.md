---
agent: claude-cloud
status: in_progress
branch: feat/student-metrics
touches: apps/web/lib/studentMetrics.ts, apps/web/lib/studentDashboard.ts, apps/web/lib/applications.ts, apps/web/app/api/student/progress/, apps/web/app/api/admin/students/, apps/web/components/StudentProgress.tsx, apps/web/components/StudentApplications.tsx, apps/web/components/StudentActivityDashboard.tsx, apps/web/components/StudentsTab.tsx, apps/web/app/globals.css, supabase/migrations/20261025_application_outcomes.sql, tests/db/application_outcomes.sql, tests/admin-auth/studentmetrics.mjs, tests/admin-auth/flow.mjs, tests/admin-auth/ui.mjs, tests/admin-auth/run.sh, docs/decisions/ADR-014-metricas-alumnas-y-gamificacion.md, docs/STATUS.md
date: 2026-10-25
---
Métricas de alumnas derivadas (XP/nivel, maestría, tasa de respuesta, retención, candidatas a derivar), resultados de candidatura declarados por la alumna y ADR-014 (correo entrante con Resend, solo diseño). La migración 20261025 NO se aplica sin orden del dueño. Sin voz, sin auto-apply, sin gasto.
