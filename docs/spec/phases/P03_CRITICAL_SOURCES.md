# Phase 03 — Critical Sources

## Goal
Validar el valor del producto con las fuentes esenciales.

## Implement in this order
1. LinkedIn.
2. Upwork.
3. Facebook Groups.
4. Skool.

## Pattern
Para cada source:
- provider A;
- mapping a RawCandidate;
- schema fixture;
- healthcheck;
- timeout;
- cost;
- source query builder;
- contract tests.

Añadir provider B al menos para una fuente crítica durante esta fase para probar fallback real.

## Facebook
Soportar:
- known public group URLs;
- public keyword discovery solo si el provider lo soporta.

## Skool
Soportar:
- configured communities;
- public/community search capabilities según provider.

No introducir una sesión personal como requisito obligatorio.

## Acceptance
La misma SearchDefinition puede disparar las cuatro fuentes.
UI/API de progreso todavía puede ser básica.
Resultados quedan en raw y connector_runs con trazabilidad total.

## Subphases for coding agents

Execute in order:

1. `P03A_LINKEDIN.md`
2. `P03B_UPWORK.md`
3. `P03C_FACEBOOK.md`
4. `P03D_SKOOL.md`

## Actualización normativa — ADR-007

El orden de integración se prioriza según PLAN y yield/acceso; no bloquear Groq/proyección por no activar las cuatro fuentes. Mantenerlas como pendientes hasta canary.

Ver [MASTER SPEC](../00_MASTER_SPEC.md) y [PLAN](../../PLAN.md) para dependencias y alcance real.
