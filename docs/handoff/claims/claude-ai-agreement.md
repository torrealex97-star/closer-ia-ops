---
agent: claude-cloud
status: validated
branch: feat/ai-agreement-report
depends_on: claude-login-flag
touches: apps/web/lib/aiAgreement.ts, apps/web/components/AiAgreement.tsx, apps/web/components/ExternalTab.tsx, apps/web/app/api/admin/ai-agreement/route.ts, tests/admin-auth/agreement.mjs, tests/admin-auth/flow.mjs, tests/admin-auth/ui.mjs
date: 2026-10-17
---
Informe de acuerdo IA vs. personas (puerta de salida de shadow → live).
