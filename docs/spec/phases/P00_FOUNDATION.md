# Phase 00 — Foundation

## Goal
Crear el monorepo ejecutable, tooling y CI sin lógica de negocio real.

## Build
- apps/web Next.js 16.3.3 + React 19.3;
- apps/api FastAPI 0.141.1;
- apps/worker Python;
- package/contracts;
- connector/publisher folders;
- Supabase local/project config;
- env examples;
- docker compose;
- lint/format/typecheck/test;
- CI.

## Decisions
- package manager JS;
- Python version común >= 3.11;
- lockfiles;
- deployment environments dev/staging/prod.

## Required env names
Solo placeholders. Nunca valores reales.

## Acceptance
- web arranca;
- API `/health/live`;
- worker arranca y hace health;
- CI verde;
- no secrets en repo;
- version pinning en lockfiles.

## Do not
No integrar sources todavía.

## Actualización normativa — ADR-007

Añadir placeholders Groq/LLMProvider de 16 y capability config, sin secretos ni dependencia de OpenAI por defecto. Mantener lockfiles reales y ADR-006 local.

Ver [MASTER SPEC](../00_MASTER_SPEC.md) y [PLAN](../../PLAN.md) para dependencias y alcance real.
