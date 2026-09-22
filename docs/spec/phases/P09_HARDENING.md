# Phase 09 — Security, Observability, Resilience

## Goal
Preparar operación diaria.

## Build
- provider metrics;
- circuit breaker;
- canary searches;
- alerts;
- rate limits;
- audit log;
- backup/runbook;
- RLS review;
- secret rotation doc;
- cost dashboards/query.

## Chaos tests
- provider 500;
- provider timeout;
- malformed schema;
- webhook duplicated;
- worker restarted mid-message;
- LLM unavailable;
- DB transient error.

## Acceptance
No scenario individual produce pérdida silenciosa o búsqueda completa fallida cuando otros sources funcionan.

## Actualización normativa — ADR-007

Añadir cuota/tokens/coste/uncertain Groq, fuga DTO, revocación de relación, verificación caducada y publicación obsoleta. Reinicio no repite solicitudes inciertas facturables.

Ver [MASTER SPEC](../00_MASTER_SPEC.md) y [PLAN](../../PLAN.md) para dependencias y alcance real.
