# Phase 04B — Workana

## Goal

Integrar Workana como fuente prioritaria para ventas freelance en España y LATAM.

## Why this source is high priority

Workana publica >25.000 proyectos al mes y tiene una categoría explícita:

```text
Marketing Digital y Ventas
```

La investigación encontró ejemplos públicos de:

```text
Appointment Setter & Closer
Closer de ventas
SDR / Appointment Setter / Closer
Cold Calling
Televentas
Comercial / Vendedor
Lead Generation
```

Es una fuente de alta señal para el nicho inicial.

## Source identity

```text
source_code = workana
source_family = freelance_marketplace
market_focus = ES/LATAM
opportunity_kind = freelance_project
```

## Provider strategy

No se ha identificado durante esta investigación una REST API pública de búsqueda de proyectos equivalente a Freelancer.

### Primary MVP
Public-page/provider adapter.

### Fallback
Hosted browser actor.

El dominio no debe conocer el mecanismo.

## Discovery paths

Priorizar:
- buscador de proyectos;
- categoría Marketing Digital y Ventas;
- subcategorías Comercial / Vendedor y Televentas;
- queries ES + EN;
- páginas de proyecto públicas.

## Queries

```text
closer
closer de ventas
appointment setter
setter
sales closer
SDR
BDR
televentas
telemarketing
cold calling
comercial
vendedor
representante de ventas
lead generation
ventas B2B
ventas high ticket
```

## Mapping

```text
external_id_or_slug
title
description
category
subcategory
skills[]
budget
project_size
published_at
deadline
activity/proposals_count
client_public_signals
source_url
```

## Special parser

Extraer del texto:
- fijo;
- comisión;
- porcentaje de comisión;
- pago por cita;
- pago por cierre;
- high-ticket;
- B2B/B2C;
- horario/zona horaria;
- país objetivo;
- canales de outreach.

## Ranking boost

Dar boost si:

```text
subcategory in {Comercial/Vendedor, Televentas}
AND
role classifier in {closer, appointment_setter, sdr, bdr}
```

## Acceptance

- [ ] recuperar proyectos públicos recientes;
- [ ] query ES y EN;
- [ ] extraer category/subcategory;
- [ ] detectar comisión/base+comisión;
- [ ] detectar estado abierto/evaluando cuando esté disponible;
- [ ] 20 fixtures reales anonimizados;
- [ ] search run no requiere cuenta personal del operador;
- [ ] provider failure produce `partial`, no error global.

## Research references

- https://www.workana.com/es/jobs
- https://www.workana.com/es/work/freelancers
