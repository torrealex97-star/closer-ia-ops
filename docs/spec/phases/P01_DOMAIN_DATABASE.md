# Phase 01 — Domain + Database

## Goal
Implementar schema y contratos base.

## Build
- migrations de core tables;
- enums/check constraints;
- RLS;
- Pydantic models:
  - SearchDefinition
  - SourceQuery
  - RawCandidate
  - JobPostingNormalized
  - CanonicalJob
- repository layer;
- seed de source codes;
- role taxonomy v1.

## Tests
- migrations clean DB;
- RLS smoke;
- model validation;
- raw append-only behavior;
- constraints.

## Acceptance
Crear manualmente:
`source -> provider -> search_run -> connector_run -> raw_item -> posting -> job -> search_result`
con integridad referencial.

## Actualización normativa — ADR-007

Completar extensión P01B: WDCOpportunity versionada, verificaciones, connection_type/application_type, relaciones directas y org_id/FKs; raw sin estados mutables.

Ver [MASTER SPEC](../00_MASTER_SPEC.md) y [PLAN](../../PLAN.md) para dependencias y alcance real.
