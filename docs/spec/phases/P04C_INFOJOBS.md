# Phase 04C — InfoJobs

## Goal

Añadir una fuente oficial y de alta calidad para España.

## Why

InfoJobs ofrece API oficial y una operación pública `GET /offer` para:
- keyword;
- provincia;
- categorías;
- faceted search;
- listado de ofertas.

Las llamadas requieren credenciales de aplicación, pero la búsqueda de ofertas no requiere autorización del usuario final.

## Source identity

```text
source_code = infojobs
source_family = job_board
market_focus = ES
opportunity_kind = employment
```

## Access

### Official API

Registrar aplicación y guardar server-side:

```text
INFOJOBS_CLIENT_ID
INFOJOBS_CLIENT_SECRET
```

No exponer al browser.

## Search endpoint

Conceptualmente:

```text
GET https://api.infojobs.net/api/9/offer
```

El agente implementador debe validar la versión vigente de la operación en la documentación antes de fijarla en código.

## Query expansion

En España probar:

```text
closer
sales closer
appointment setter
SDR
BDR
account executive
inside sales
comercial
ejecutivo comercial
asesor comercial
representante de ventas
teleoperador ventas
televentas
desarrollo de negocio
business development
```

## Mapping

```text
offer_id
title
company
province
city
category
subcategory
published_at
updated_at
contract_type
workday
salary_min
salary_max
salary_period
experience
requirements
description
apply_url
```

## Authority

Si la oferta de InfoJobs apunta a una empresa/ATS que también está en el sistema:

```text
ATS/company posting > InfoJobs posting
```

para vigencia y apply URL cuando haya contradicción.

## Acceptance

- [ ] app credentials configurables;
- [ ] search without candidate OAuth;
- [ ] búsquedas por q/province;
- [ ] paginación;
- [ ] response fixture tests;
- [ ] rate/error handling;
- [ ] salary/location mapping;
- [ ] resultados integrados con dedupe cross-source.

## Research references

- https://developer.infojobs.net/
- https://developer.infojobs.net/documentation/operation/offer-list-9.xhtml

## Actualización normativa — ADR-007

Estado real: asistente Apify local preparado; API oficial de esta fase sigue pendiente de validar credenciales/operación. No confundir esa ruta objetivo con integración oficial ya existente.

Ver [MASTER SPEC](../00_MASTER_SPEC.md) y [PLAN](../../PLAN.md) para dependencias y alcance real.
