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
