# Phase 04H — LATAM and Global Remote Niche Sources

## Goal

Añadir fuentes que generan oportunidades remotas para LATAM y mercados internacionales.

# Remote Latinos

## Priority

Alta para el producto futuro orientado a alumnos hispanohablantes.

La página pública de oportunidades incluye actualmente roles como:
- Appointment Setter;
- Remote Sales Closer;
- Account Management;
- Lead Qualifier.

## Source

```text
source_code = remote_latinos
market_focus = LATAM -> US/Canada companies
```

## Provider

Public jobs/provider adapter.

Mapear:
```text
title
category
english_level
employment_type
location_scope
source_url
```

---

# OnlineJobs.ph

## Fit

Tiene enorme densidad de:
- appointment setters;
- DM setters;
- closers;
- cold callers;
- SDR.

## Limitation

Muchos puestos están orientados a candidatos en Filipinas.

Por tanto:
```text
market_eligibility
```
debe ser obligatorio antes de mostrar una oportunidad a alumnos de España/LATAM.

No confundir:
```text
remote = true
```
con:
```text
can_work_from_spain = true
```

## Source

```text
source_code = onlinejobs_ph
market_focus = PH/global selected
```

## Filtering rule

Descartar/penalizar si:
```text
allowed_countries excludes requested_market
```

---

# Somewhere

## Fit

Recruiting remote global, con Sales como categoría y SDR/Sales Rep como roles.

No es tan granular como una fuente freelance, pero puede aportar puestos full-time de buena calidad.

```text
source_code = somewhere
```

## Acceptance

- [ ] Remote Latinos adapter;
- [ ] OnlineJobs adapter;
- [ ] market eligibility parser;
- [ ] Somewhere spike;
- [ ] country restrictions nunca inferidas solo de `remote`;
- [ ] filters Spain/LATAM validated.

## Research references

- https://www.remotelatinos.com/jobs
- https://www.onlinejobs.ph/
- https://somewhere.com/jobs

## Actualización normativa — ADR-007

Ampliar HireLATAM y Hire With Near; fichas Remote Latinos/Somewhere en sources/. LATAM→US e inglés no significa empleo en español o elegible España. Mantener restricción PH explícita.

Ver [MASTER SPEC](../00_MASTER_SPEC.md) y [PLAN](../../PLAN.md) para dependencias y alcance real.
