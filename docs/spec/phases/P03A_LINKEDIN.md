# Phase 03A — LinkedIn

## Goal
Integrar LinkedIn Jobs como fuente crítica sin depender de una cuenta personal.

## Scope
- source `linkedin`;
- provider A hosted;
- provider B config-ready;
- query builder;
- mapper;
- contract fixtures;
- health metric;
- cost/latency capture.

## Query mapping
Mínimo:
- keyword/title;
- location;
- remote;
- posted window;
- experience;
- salary si provider soporta.

## Raw data
Guardar output original completo en `raw_json`.

## Mapping
Priorizar:
- external job id;
- job URL;
- title;
- company;
- location;
- posted time;
- salary;
- description;
- apply URL/method.

## Failure tests
- timeout;
- zero jobs;
- provider malformed item;
- partial missing salary;
- provider 429/5xx.

## Acceptance
Una query `closer + Spain + remote + 72h` devuelve raw items trazables y el provider puede ser reemplazado sin cambiar SearchOrchestrator.

## Actualización normativa — ADR-007

Añadir consultas US ES/EN y evidencia de español/país permitido. ATS de empresa preferido para vigencia; no implica relación WDC. Registrar external_application y proceso real, conservando Easy Apply.

Ver [MASTER SPEC](../00_MASTER_SPEC.md) y [PLAN](../../PLAN.md) para dependencias y alcance real.
