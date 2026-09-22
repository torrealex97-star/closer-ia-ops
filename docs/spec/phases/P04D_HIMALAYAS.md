# Phase 04D — Himalayas

## Goal

Añadir una de las fuentes con mejor relación señal/esfuerzo para trabajos remotos de Sales.

## Why

Himalayas dispone de API JSON pública:
- sin API key;
- búsqueda por keyword;
- país;
- worldwide;
- seniority;
- employment type;
- timezone;
- salary fields;
- application link.

La investigación encontró cientos de resultados relacionados con Appointment Setting y cerca de mil resultados de SDR.

## Source identity

```text
source_code = himalayas
source_family = remote_job_board
opportunity_kind = employment
```

## API

### Search

```text
GET /jobs/api/search
```

### Full feed

```text
GET /jobs/api
```

Usar search para consultas bajo demanda.

## Useful filters

Mapear:
- `q`;
- `country`;
- `worldwide`;
- `seniority`;
- `employment_type`;
- `timezone`;
- `sort=recent`.

## Mapping

La API ya expone campos casi canónicos:

```text
guid
title
companyName
employmentType
minSalary
maxSalary
salaryPeriod
currency
seniority
locationRestrictions[]
timezoneRestrictions[]
categories[]
description
pubDate
expiryDate
applicationLink
```

## Attribution

Conservar:
```text
source = Himalayas
source_url
```

y cumplir el requisito de atribución/link back cuando sus datos se muestren.

## Cache

La API pública indica que el dataset se refresca aproximadamente cada 24h.

No tiene sentido consultarla agresivamente.

Implementar:
```text
source cache TTL >= 15 min
```

para búsquedas repetidas y un sync diario opcional.

## Search examples

```text
appointment setter
high ticket
sales closer
sales development representative
business development representative
account executive
inside sales
cold calling
```

## Acceptance

- [ ] no auth requerida;
- [ ] query + location/country;
- [ ] worldwide;
- [ ] salary fields;
- [ ] pagination;
- [ ] 429 handling;
- [ ] attribution metadata;
- [ ] fixtures;
- [ ] >1 role family probado.

## Research reference

https://himalayas.app/api
