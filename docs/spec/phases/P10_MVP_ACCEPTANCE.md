# Phase 10 — MVP Acceptance

## Goal
Validar el producto real, no solo la tecnología.

## Test searches
Crear un set de queries reales:
- Closer España remote;
- Setter LATAM;
- SDR Spanish USA;
- Account Executive España;
- broad sales remote.

## Run
Ejecutar varias veces/días para cubrir variabilidad.

## Review
Etiquetado humano de:
- relevancia;
- duplicado;
- active;
- apply path;
- salary correctness;
- source provenance.

## Gates
Los definidos en `10_TESTING_ACCEPTANCE.md`.

## Deliverables
- metrics report;
- provider matrix real;
- cost/search;
- known gaps;
- list of low-quality sources to disable;
- go/no-go para portal de alumnos.

## MVP approved
Solo si el motor produce consistentemente resultados que el equipo publicaría/entregaría sin rehacerlos manualmente de forma sustancial.

## Actualización normativa — ADR-007

Añadir Spanish SDR US-only negativo, setter LATAM bilingüe, empresa US contratando España, hybrid incompatible, OTE y fecha ausente. Reportar admin/preview/portal por separado; ninguna fase nueva se declara implementada por este spec.

Ver [MASTER SPEC](../00_MASTER_SPEC.md) y [PLAN](../../PLAN.md) para dependencias y alcance real.
