# Phase 02 — Search Orchestrator + Mock Connectors

## Goal
Probar el flujo completo antes de depender de scrapers reales.

## Build
- connector registry;
- provider selection;
- async parallel execution;
- timeout/fallback;
- search-run queue;
- worker consumer;
- SSE/poll status API;
- 3 mock connectors:
  - success fast;
  - success slow;
  - failure/timeout.

## Required behavior
- results procesan por batch;
- partial success;
- cancellation best-effort;
- run metrics.

## Acceptance
Búsqueda con 3 mocks:
- fast results visibles antes de slow;
- failed source genera warning;
- final status `partial`;
- ningún raw duplicado por retry.

## Actualización normativa — ADR-007

Separar adquisición de cola IA/proyección; backpressure por proveedor/modelo y presupuesto; primeros resultados deterministas no esperan Groq. Suite ES/EN y restricciones de trabajador distintas del mercado US.

Ver [MASTER SPEC](../00_MASTER_SPEC.md) y [PLAN](../../PLAN.md) para dependencias y alcance real.
