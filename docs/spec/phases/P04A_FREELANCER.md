# Phase 04A — Freelancer.com / Freelancer.es

## Goal

Integrar Freelancer como marketplace global de proyectos freelance de ventas sin duplicar sus superficies localizadas.

## Why

Freelancer dispone de:
- API oficial para desarrolladores;
- más de 3.000 categorías;
- búsqueda pública con filtros de keyword, ubicación, presupuesto, skills, idioma y estado;
- categoría Sales & Marketing;
- mercado global y versión localizada en español.

`freelancer.es` debe considerarse el mismo source que `freelancer.com`.

## Source identity

```text
source_code = freelancer
source_family = freelance_marketplace
opportunity_kind = freelance_project
```

Nunca crear:

```text
freelancer_com
freelancer_es
```

como fuentes diferentes.

## Provider strategy

### Primary
Freelancer official API.

### Fallback
Hosted/read provider o public-page adapter aislado detrás de la misma interfaz.

## Searches

Ejecutar query expansion:

```text
closer
sales closer
appointment setter
appointment setting
cold calling
telemarketing
lead generation
sales
business development
SDR
BDR
account executive
comercial
ventas
televentas
```

Combinar términos; no disparar todas las queries si la API permite skills/categories.

## Mapping

Persistir cuando exista:

```text
external_id
title
description
project_url
published_at
bid_deadline
budget_min
budget_max
budget_currency
budget_type
skills[]
client_country
language
project_type
proposals_count
```

Normalizar:

```text
employment_type = freelance
opportunity_kind = freelance_project
```

## Search filters

Traducir `SearchRequest` a:
- keywords;
- sales/marketing skills;
- language;
- project status = open;
- min/max budget;
- hourly/fixed;
- location si es aplicable;
- recency.

## Deduplication

Primary:

```text
source=freelancer + external_id
```

Cross-source:

```text
company/client identity when available
+ normalized title
+ description fingerprint
```

Los proyectos freelance sin empresa pública deben deduplicarse conservadoramente.

## Freshness

Preferir proyectos:
- abiertos;
- publicados recientemente;
- con deadline activo.

Actualizar status a `expired/removed` cuando deje de aceptar propuestas.

## Acceptance

- [ ] official API spike documentado;
- [ ] búsquedas ES/EN;
- [ ] filtros de presupuesto;
- [ ] fixed/hourly diferenciados;
- [ ] ninguna duplicación entre `.com` y `.es`;
- [ ] 20 fixtures de Sales;
- [ ] contract tests;
- [ ] una búsqueda `appointment setter` devuelve RawCandidates válidos;
- [ ] provider fallback no cambia el dominio.

## Research reference

https://developer.freelancer.com/

## Actualización normativa — ADR-007

Extender suite ES/EN a clientes US; no inferir español por locale=.es ni elegibilidad por client_country. marketplace_application, atribución y cuenta de candidata explícitas.

Ver [MASTER SPEC](../00_MASTER_SPEC.md) y [PLAN](../../PLAN.md) para dependencias y alcance real.
