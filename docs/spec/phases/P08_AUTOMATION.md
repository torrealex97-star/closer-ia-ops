# Phase 08 — Saved Searches + Automation

## Goal
Pasar de búsqueda manual a suministro diario.

## Build
- CRUD saved searches;
- schedule;
- run now;
- search history;
- diff/new since last run;
- revalidation jobs;
- optional auto-publish with explicit admin flag.

## Scheduling
El scheduler solo inicia SearchRuns; no duplica lógica de búsqueda.

## Acceptance
Una búsqueda guardada:
- corre manualmente;
- corre por schedule;
- identifica nuevas oportunidades;
- no duplica jobs/postings;
- puede publicar solo nuevas si se configura.

## Actualización normativa — ADR-007

Distinguir descubierto nuevo, republicado y publicado original; verificación TTL actualiza estado sin rejuvenecer fecha. Presupuesto Groq y scraper por org/run/día. No auto-publicar verifying.

## Actualización normativa — ADR-009

Distinguimos dos modos: Background Discovery (la recogida diaria de ADR-008 alimenta el catálogo local con fuentes gratuitas en paralelo) y On-Demand (la búsqueda interactiva consulta primero el catálogo; las capas de pago solo si el Quality Gate detecta gap y cabe en el presupuesto). El scheduler nunca lanza capas caras: la recogida diaria es gratuita por diseño y el escalado lo decide el orquestador, no el horario.

Ver [MASTER SPEC](../00_MASTER_SPEC.md) y [PLAN](../../PLAN.md) para dependencias y alcance real.
