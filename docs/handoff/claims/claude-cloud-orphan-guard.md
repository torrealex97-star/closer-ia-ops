---
agent: claude-cloud
status: in_progress
branch: docs/orphan-guard
touches: AGENTS.md, docs/handoff/README.md, tests/orphan-refs.mjs, tests/admin-auth/run.sh
date: 2026-10-24
---
Regla y chequeo para que no se vuelva a subir un test o una nota sin su código: tests/orphan-refs.mjs falla (con un mensaje legible) si flow.mjs/ui.mjs llaman a rutas /api inexistentes o run.sh invoca ficheros que no existen. Quita el 2>/dev/null de run.sh.
