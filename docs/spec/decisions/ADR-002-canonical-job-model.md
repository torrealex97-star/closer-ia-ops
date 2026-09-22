# ADR-002: RawItem -> JobPosting -> Job

Status: Accepted

## Decision
No mapear una captura directamente a `jobs`.

## Why
La misma oportunidad puede existir en múltiples fuentes y cada publicación tiene lifecycle/provenance independiente.

## Consequences
Más tablas, pero dedupe, audit y revalidación quedan correctos.

## Extensión aceptada — 2026-09-22

[ADR-007](../../decisions/ADR-007-groq-opportunity-surfaces.md) añade WDCOpportunity como proyección posterior versionada. raw/posting/job se conservan incluso para intake directo; ocultar procedencia técnica a alumnas no elimina trazabilidad.
