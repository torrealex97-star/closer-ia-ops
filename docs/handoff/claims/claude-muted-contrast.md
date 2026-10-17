---
agent: claude-cloud
status: validated
branch: fix/muted-contrast
touches: apps/web/app/globals.css, scripts/check-design.mjs, tests/design.mjs, tests/admin-auth/ui.mjs, .agents/skills/dashboard-design/SKILL.md, docs/STATUS.md
date: 2026-10-17
---
`--muted` → `--secondary` en todo el texto pequeño (decisión del dueño); `--muted` solo para iconos, con guardia en `npm run design`.
