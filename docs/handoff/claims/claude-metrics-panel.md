---
agent: claude-cloud
status: validated
branch: feat/metrics-panel-design
touches: apps/web/components/MetricsPanel.tsx, tests/admin-auth/ui.mjs, docs/STATUS.md
date: 2026-10-17
depends_on: claude-housekeeping
---
Aplica `dashboard-design` al panel de métricas (único gráfico real): eje y etiquetas, tabla alternativa, estados vacío/error/parcial, tokens en vez de currentColor. Sin cambios de API ni de colores del tema.
