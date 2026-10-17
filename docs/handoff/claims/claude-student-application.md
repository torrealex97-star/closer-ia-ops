---
agent: claude-cloud
status: validated
branch: feat/student-application
pr: 13
touches: apps/web/lib/applicationProfile.ts, apps/web/lib/applications.ts, apps/web/app/api/student/application-profile, apps/web/app/api/student/applications, apps/web/components/StudentPortal.tsx, supabase/migrations/20261017_student_application_profile.sql, tests/db, tests/admin-auth, docs/decisions/ADR-012-assisted-applications.md, table:student_application_profiles, table:student_applications
date: 2026-10-17
depends_on: claude-metrics-panel
---
Incremento 3.2: formulario base de la alumna (fuente única de datos para cualquier formulario) + candidatura ASISTIDA (borrador determinista, datos para copiar, seguimiento de estado). Nada se envía ni se rellena automáticamente; la automatización futura queda preparada (consentimiento aparte) y sin activar.
