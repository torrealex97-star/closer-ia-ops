---
agent: claude-cloud
status: validated
pr: 33
branch: feat/coordinator-dashboard
touches: apps/web/lib/studentDashboard.ts, apps/web/components/StudentActivityDashboard.tsx, apps/web/components/StudentsTab.tsx, apps/web/app/globals.css, tests/admin-auth/dashboard.mjs, tests/admin-auth/ui.mjs, tests/admin-auth/run.sh, docs/STATUS.md
date: 2026-10-24
---
Panel de coordinación en la pestaña Alumnas (inspirado en ManagerDashboardView de closer-ai-coach): embudo de activación, cobertura por módulo de Formación, distribución de notas de práctica y quién necesita un empujón. Solo datos reales de GET /api/admin/students; huecos como «—»; sin distribuciones con menos de 5 alumnas con actividad.
