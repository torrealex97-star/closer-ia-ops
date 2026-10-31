---
agent: claude-cloud
status: validated
branch: fix/export-sin-cors
touches: tests/engine/export.mjs
date: 2026-10-31
---
`/api/export` del motor sin CORS (sesión 132); la edición de `sites/engine/worker.js` es de una línea y se declara aquí sin reclamarla (la ficha de otro agente la cubre).
