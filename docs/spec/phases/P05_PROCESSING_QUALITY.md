# Phase 05 — Processing, Classification, Dedupe, Ranking

## Goal
Convertir candidatos ruidosos en resultados útiles.

## Build
- deterministic extractors;
- role classifier;
- LLM gateway + structured outputs;
- hard/prefer filters;
- dedupe feature generation;
- safe merge;
- canonical field resolver;
- score calculation;
- result explanation;
- gold set harness.

## LLM requirements
- schema enforced;
- temperature/config fixed;
- prompt version stored;
- timeout/retry;
- token/cost telemetry;
- raw evidence references.

## Acceptance
Gold set inicial:
- classification precision >= 90%;
- recall >= 85%;
- merge precision >= 95%;
- false merge < 1%.

Si no cumple, la fase no termina.

## Actualización normativa — ADR-007

Desglosar P05A Groq y P05B WDCOpportunity; LLMProvider default groq y extracción combinada. Añadir gold set US-only/ES/LATAM/idioma, OTE, actividad y copy factual; score no es probabilidad.

Ver [MASTER SPEC](../00_MASTER_SPEC.md) y [PLAN](../../PLAN.md) para dependencias y alcance real.
