# Phase 04F — PeoplePerHour + Guru

## Goal

Añadir marketplaces freelance con alta densidad de trabajos de cold calling, appointment setting, lead generation y closing.

# PeoplePerHour

## Evidence of fit

La plataforma expone búsquedas públicas para:
- Lead Generation;
- Cold Calling;
- Sales & Calls;
- Commission Sales.

Durante la investigación aparecieron ofertas de:
- Appointment Setter;
- High-Ticket Sales Closer;
- B2B cold calling;
- pay-per-appointment.

## Source

```text
source_code = peopleperhour
opportunity_kind = freelance_project
```

## Provider

No se ha identificado API pública de búsqueda adecuada en esta investigación.

Usar:

```text
public_http/provider
  ↓ fallback
hosted_browser_provider
```

## Mapping

```text
title
description
buyer_public_name
budget
budget_type
published_at
proposals_count
remote
source_url
```

## Note

PeoplePerHour prohíbe proyectos puramente commission-only en su policy; aun así existen proyectos con componentes de performance/commission. No asumir que todo "commission" representa comisión exclusiva.

---

# Guru

## Evidence of fit

Guru tiene categorías y páginas específicas de:
- Appointment Setting;
- Cold Calling;
- Telemarketing;
- Sales;
- Lead Generation.

Durante la investigación había proyectos recientes de:
- Appointment Setter – IT Sales;
- Sales Closer – IT Services;
- commission-based outreach.

## Source

```text
source_code = guru
opportunity_kind = freelance_project
```

## Provider

Public-page/provider adapter.

## Mapping

```text
job_id
title
description
budget_type
budget
deadline
published_at
quotes_received
skills[]
employer_public_metrics
source_url
```

## Quality signals

Guardar opcionalmente:

```text
employer_total_spend
employer_jobs_posted
employer_jobs_paid
employer_paid_ratio
```

para futuro `source_trust_score`.

## Acceptance

- [ ] PeoplePerHour connector;
- [ ] Guru connector;
- [ ] keyword expansion sales;
- [ ] budget normalization;
- [ ] recency;
- [ ] proposals/quotes where public;
- [ ] 10+ fixtures por fuente;
- [ ] failures isolated.

## Research references

- https://www.peopleperhour.com/freelance-cold-calling-jobs
- https://www.peopleperhour.com/freelance-commission-sales-jobs
- https://www.guru.com/d/jobs/

## Actualización normativa — ADR-007

Consultas bilingües y clientes US; account/canal externo honestos, empresa desconocida nullable y no derivada del portal. Elegibilidad de trabajador separada.

Ver [MASTER SPEC](../00_MASTER_SPEC.md) y [PLAN](../../PLAN.md) para dependencias y alcance real.
