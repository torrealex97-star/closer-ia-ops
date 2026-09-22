# Phase 04 — Source Expansion

## Goal

Ampliar cobertura después del núcleo crítico con fuentes de alta señal para Sales y APIs/feeds de bajo mantenimiento.

## Execution order

1. `P04A_FREELANCER.md`
2. `P04B_WORKANA.md`
3. `P04C_INFOJOBS.md`
4. `P04D_HIMALAYAS.md`
5. `P04E_REMOTE_FEEDS.md`
6. `P04F_FREELANCE_MARKETPLACES.md`
7. `P04G_SALES_SPECIALIST.md`
8. `P04H_LATAM_AND_GLOBAL_REMOTE.md`
9. `P04I_AGGREGATOR_APIS.md`
10. `P04J_WELLFOUND_STARTUPS.md`

No es obligatorio desplegar todos antes de P05/P06. El rollout debe medir yield y coste por fuente.

## Stop rule

Una fuente se pausa si durante un periodo de evaluación suficiente:

```text
relevant_jobs / fetched_candidates
```

es muy bajo, su coste por oportunidad útil es alto o su mantenimiento consume más que el valor que aporta.

## Global acceptance

- al menos 5 fuentes complementarias operativas;
- al menos 2 mediante API/RSS oficial;
- mercados España + LATAM + worldwide representados;
- `source != provider`;
- provider errors normalizados;
- no changes in domain model required per connector;
- source yield/cost observability;
- distribution policies respected;
- manual ingest sigue usando el mismo pipeline.

## Actualización normativa — ADR-007

Añadir P04K_US_HISPANIC_SOURCES y fichas de 18. APIs ATS, recruiters y boards hispanos se priorizan por yield/coste; no es necesario completar A–J antes de la proyección WDC.

Ver [MASTER SPEC](../00_MASTER_SPEC.md) y [PLAN](../../PLAN.md) para dependencias y alcance real.
