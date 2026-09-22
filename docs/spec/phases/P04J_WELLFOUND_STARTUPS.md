# Phase 04J — Wellfound / Startup Sales

## Goal

Capturar roles de ventas en startups, especialmente SDR, BDR, Account Executive y Appointment Setter.

## Evidence of fit

La investigación encontró ofertas actuales de:
- SDR / Appointment Setter;
- Sales Setter;
- Account Executive;
- roles con base + comisión;
- remote worldwide.

## Source

```text
source_code = wellfound
source_family = startup_job_board
```

## Provider strategy

No se ha confirmado durante esta investigación una API pública de jobs adecuada al caso.

Implementar como:

```text
provider_hosted
  ↓ fallback
public_page_adapter
```

sin ligar el dominio a HTML concreto.

## Mapping

```text
title
company
salary_min
salary_max
equity_min
equity_max
remote_policy
remote_countries[]
preferred_timezones[]
experience_required
employment_type
skills[]
hiring_contact_public?
published_at/reposted_at
source_url
```

## Special value

Wellfound puede aportar:
- salary;
- equity;
- remote countries;
- timezone;
- recruiter/hiring contact visible;
- startup metadata.

## Ranking

Para alumnos junior:

```text
entry level / <= 2 years
```

puede recibir boost configurable.

Para closer/high-ticket:
- no limitar a title exacto;
- clasificar `Account Executive`, `Enrollment`, `Sales Consultant` semánticamente.

## Acceptance

- [ ] provider spike;
- [ ] remote eligibility;
- [ ] salary/equity mapping;
- [ ] SDR/BDR/AE query suite;
- [ ] dedupe against ATS/company careers;
- [ ] fixtures from at least 3 role families.

## Research reference

https://wellfound.com/jobs

## Actualización normativa — ADR-007

Suite Spanish SDR/BDR/AE/enrollment y US-market; evidencia de contratación internacional/idioma antes del feed de alumna. Ficha WELLFOUND en sources/.

Ver [MASTER SPEC](../00_MASTER_SPEC.md) y [PLAN](../../PLAN.md) para dependencias y alcance real.
