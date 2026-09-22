# ADR-003: Provider fallback per source

Status: Accepted

## Decision
Cada source resuelve uno o varios providers ordenados por prioridad y salud.

## Why
Scrapers externos cambian o fallan. El producto no puede depender de una implementación.

## Consequences
Se requiere registry, health metrics y contract tests.
