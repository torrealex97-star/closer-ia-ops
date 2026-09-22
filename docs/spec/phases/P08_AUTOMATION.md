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
