---
agent: claude-cloud
status: validated
branch: feat/student-auth
pr: 5
touches: apps/web/lib/students.ts, apps/web/lib/studentAuth.ts, apps/web/app/api/student, apps/web/app/api/admin/students, apps/web/app/alumna, apps/web/components/StudentPortal.tsx, apps/web/components/StudentsTab.tsx, supabase/migrations/20261017_student_auth_foundation.sql, table:students, table:student_profiles
date: 2026-10-17
---
Login de alumnas por invitación, perfil propio y RLS (2.1). Migración YA aplicada en Supabase. Espera la revisión del dueño y que permita la URL de redirección en Supabase.
