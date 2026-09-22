# Phase 04I — Aggregator APIs

## Goal

Aumentar recall con APIs de agregadores sin convertirlos en fuente de verdad.

## Authority rule

```text
company ATS
  > direct job board / marketplace
  > specialist board
  > aggregator
```

Los agregadores sirven para descubrir, no para sobrescribir mejores fuentes.

# Jooble

## Access

REST API oficial.

## Important constraints

- API key por dominio/país;
- una key US no sirve para España;
- el plan gratuito documentado actualmente tiene un límite total muy bajo de requests.

## Query

```json
{
  "keywords": "appointment setter",
  "location": "Spain",
  "salary": 2000,
  "page": 1
}
```

## Source

```text
source_code = jooble
source_family = aggregator
```

---

# Careerjet

## Access

Publisher API oficial.

Permite:
- keywords;
- location;
- contract type;
- work hours;
- sort;
- salary;
- pagination.

Requiere:
```text
api_key
user_ip
user_agent
referer
```

Esto significa que para búsquedas iniciadas por usuario hay que propagar correctamente metadata de request y revisar el modelo de uso del publisher account.

---

# Talent.com

## Access

Publisher program:
- Job API;
- XML feeds;
- affiliate URLs.

No construir integración hasta obtener las credenciales/partnership necesarias.

---

# WhatJobs

## Access

Publisher FeedAPI JSON/XML.

La política incluye requisitos específicos de refresco y redistribución.

Persistir `distribution_policy`.

---

# Adzuna

Mantener como candidato de Tier B.

Antes de implementar:
- verificar producto/API de job listings disponible para el mercado objetivo;
- costes/licencia;
- campos y límites actuales.

No acoplar el MVP a Adzuna Intelligence.

## Dedupe

Los agregadores producirán mucho solapamiento.

Antes de LLM:
1. source external ID;
2. canonical outbound URL;
3. final destination domain;
4. title/company/location fingerprint.

## Search budget

No consultar todos los agregadores en cada búsqueda si las fuentes directas ya alcanzan el target.

Orchestrator policy:

```text
critical/direct sources
   ↓
if candidates < recall_target
   ↓
aggregators
```

## Acceptance

- [ ] Jooble API spike;
- [ ] Careerjet API spike;
- [ ] configurable country keys;
- [ ] distribution policies;
- [ ] aggregators triggered conditionally;
- [ ] canonical destination resolution;
- [ ] dedupe measured.

## Research references

- https://help.jooble.org/
- https://www.careerjet.com/partners/api
- https://employers.talent.com/publishers
- https://www.whatjobs.com/affiliates

## Actualización normativa — ADR-007

Queries US hispanas con key/país si aplica; dedupe al destino corporativo, conservando proveedor y atribución. No generar relación directa por resolver enlace ATS.

Ver [MASTER SPEC](../00_MASTER_SPEC.md) y [PLAN](../../PLAN.md) para dependencias y alcance real.
