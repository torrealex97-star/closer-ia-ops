# Phase 06 — Operator Web UI

## Goal
Operar el motor sin API tools.

## Build
- login;
- Search Builder;
- Live Run;
- source progress;
- results table;
- result details;
- selection;
- local filters;
- invalid/duplicate correction;
- sources health page.

## Progressive UX
Usar SSE; fallback polling.

## Acceptance
Un usuario staff:
1. entra;
2. crea query;
3. ve sources avanzando;
4. ve primeros jobs sin esperar final;
5. abre job;
6. entiende por qué hizo match.

## Actualización normativa — ADR-007

Esta fase es admin; P06B define preview y futura alumna. No quitar a admin source/provider/raw ni compartir su DTO con estudiantes. Portal exige auth/roles reales.

Ver [MASTER SPEC](../00_MASTER_SPEC.md) y [PLAN](../../PLAN.md) para dependencias y alcance real.
