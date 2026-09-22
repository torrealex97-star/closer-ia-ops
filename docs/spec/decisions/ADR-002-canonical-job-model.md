# ADR-002: RawItem -> JobPosting -> Job

Status: Accepted

## Decision
No mapear una captura directamente a `jobs`.

## Why
La misma oportunidad puede existir en múltiples fuentes y cada publicación tiene lifecycle/provenance independiente.

## Consequences
Más tablas, pero dedupe, audit y revalidación quedan correctos.
