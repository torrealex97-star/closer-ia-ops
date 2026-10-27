---
agent: codebuff
status: in_progress
branch: feat/aviso-motor
touches: apps/web/lib/engineHealth.ts, apps/web/lib/engineAlert.ts, apps/web/app/api/admin/alerts/route.ts, apps/web/app/api/admin/overview/route.ts, apps/web/app/api/cron/collect/route.ts, apps/web/components/EngineAlertBanner.tsx, apps/web/components/AdminShell.tsx, apps/web/components/ApisTab.tsx, apps/web/app/globals.css, supabase/migrations/20261029_engine_alerts.sql, tests/db/engine_alerts.sql, tests/admin-auth/enginealert.mjs, tests/admin-auth/mock-services.mjs, tests/admin-auth/run.sh, tests/admin-auth/ui.mjs, tests/orphan-refs.mjs, docs/decisions/ADR-016-avisos-del-motor-por-correo.md, docs/OWNER_GUIDE.md, docs/ACTIVE_HANDOFF.md, .env.example, docs/STATUS.md
date: 2026-10-27
---
Aviso del motor: el panel lo enseña en **cualquier** pestaña (no solo en «Fuentes») cuando el motor se pausa
por cuota o deja de responder, y avisa **por correo al propietario** si hay clave de Resend guardada. Sonda
única de salud (`engineHealth.ts`), historial `engine_alerts` con un aviso por estado, y la misma comprobación
desde el cron diario («Comprobar ahora» en el panel). Decisión y límites: ADR-016.

NO se toca: el motor cloud (sigue en pausa por cuota hasta el reinicio del mes), `STUDENT_LOGIN_REQUIRED`, el
revisor IA en `live`, la cuota de D1, ni ningún aviso o envío a alumnas.

Bloqueo: la migración `20261029_engine_alerts.sql` la aplica el propietario, por orden expresa (AGENTS.md). Sin
ella el panel avisa en pantalla y **declara por qué no envía correo** (sin registro el aviso se repetiría).

Siguiente acción exacta: pedir la orden para aplicar la migración y para poner `RESEND_FROM` (dominio
verificado); después, comprobar en producción con la sesión del propietario que la banda sale en Resumen y que
«Comprobar ahora» envía el correo o dice exactamente por qué no. Con Vercel Pro, decidir la pasada horaria.
