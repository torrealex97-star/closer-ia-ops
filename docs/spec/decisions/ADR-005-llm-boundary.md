# ADR-005: Deterministic-first, LLM-second

Status: Accepted

## Decision
Extraer primero datos estructurados/deterministas y usar LLM solo para ambigüedad/clasificación/resumen.

## Why
Menor coste, menor latencia, reproducibilidad y menos alucinaciones.

## Consequences
Cada output LLM tiene schema, version, confidence y provenance.

## Extensión aceptada — 2026-09-22

[ADR-007](../../decisions/ADR-007-groq-opportunity-surfaces.md) fija Groq como default detrás de LLMProvider. Se mantiene deterministic-first: todas las tareas que requieren IA usan esa abstracción, no se obliga a enviar campos ya fiables. Salida editorial WDC usa hechos validados; schema no demuestra verdad.
