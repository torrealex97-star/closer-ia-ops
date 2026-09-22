# ADR-005: Deterministic-first, LLM-second

Status: Accepted

## Decision
Extraer primero datos estructurados/deterministas y usar LLM solo para ambigüedad/clasificación/resumen.

## Why
Menor coste, menor latencia, reproducibilidad y menos alucinaciones.

## Consequences
Cada output LLM tiene schema, version, confidence y provenance.
