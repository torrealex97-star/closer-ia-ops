---
agent: claude-cloud
status: validated
branch: fix/engine-alert-repeat
touches: apps/web/lib/engineAlert.ts, tests/admin-auth/enginealert.mjs
date: 2026-10-31
---
El aviso del motor ya no se repite en la tercera comprobación de un mismo estado (sesión 130).
