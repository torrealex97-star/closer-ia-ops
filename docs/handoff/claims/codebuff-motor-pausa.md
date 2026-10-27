---
agent: codebuff
status: in_progress
branch: main
touches: apps/web/app/api/admin/, apps/web/app/api/backend/, apps/web/components/IntegrationSettings.tsx, apps/web/components/SummaryTab.tsx, apps/web/components/AdminShell.tsx, tests/admin-auth/mock-services.mjs, tests/admin-auth/enginepause.mjs, tests/admin-auth/ui.mjs, tests/admin-auth/run.sh, tests/browser/workspace.spec.ts, docs/STATUS.md
date: 2026-10-27
---
Dos defectos medidos en producción, los dos sobre «lo que la app dice cuando algo no va»: (1) el motor está
publicado pero **en pausa por cuota de hosting** del mes (100.604/100.000 escrituras D1, reinicio el 1 de
noviembre): responde **429 con texto plano** y el proxy reenviaba ese cuerpo, así que el panel mostraba «La
consulta falló.», las cifras se quedaban en «…» o en cero falso y la alumna leía «Revisa los campos e
inténtalo otra vez»; ahora la causa llega en JSON (`engine_reason`, `engine_down`) y el hueco va con «—» y su
explicación. (2) El selector de proveedor de IA volvía solo a Groq cuando la lectura inicial llegaba después
del cambio (carrera real, medida: 300-600 ms), dejando la clave escrita bajo el proveedor equivocado.

NO se toca: el motor (sigue en pausa hasta el reinicio de cuota, es decisión del dueño pasar a plan de pago),
`Reset`/`STUDENT_LOGIN_REQUIRED`, ni ninguna migración. NO se declara PASS en: Apify, Groq, Resend, ni en un
envío real de correo.
