---
agent: claude-cloud
status: in_progress
branch: feat/student-activity
touches: apps/web/lib/studentActivity.ts, apps/web/app/api/student/, apps/web/app/api/admin/students/, apps/web/components/StudentProgress.tsx, apps/web/components/StudentsTab.tsx, apps/web/components/StudentTraining.tsx, supabase/migrations/20261024_student_activity.sql, tests/admin-auth/activity.mjs, tests/db/student_activity.sql
date: 2026-10-24
---
Reconstruye la actividad y el progreso de alumnas que los tests de main esperaban y nunca se subieron (sustituye a la PR #28). La migración NO está aplicada: exige orden del dueño. Siguiente: módulos «cierres» y «descubrimiento» (contenido en closer-ai-coach/src/data/salesMethodology.ts) y dashboards.
