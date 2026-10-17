---
agent: claude-cloud
status: validated
branch: feat/cron-budget
pr: 9
touches: apps/web/lib/cronBudget.ts, apps/web/app/api/cron/collect, apps/web/lib/collectors.ts, apps/web/lib/aiReview.ts, apps/web/lib/apify.ts, apps/web/lib/external.ts, tests/admin-auth/cronbudget.mjs
date: 2026-10-17
---
Incremento 1.4 (PR 9, espera revisión): presupuesto de tiempo compartido del cron diario (corte declarado, reanudable) y escrituras del revisor IA atómicas con guarda de estado. Rama desde `main`, independiente de la pila de docs.
