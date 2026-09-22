# Phase 04G — Sales-Specialist Sources

## Goal

Añadir fuentes cuya audiencia está específicamente relacionada con ventas.

# CommissionCrowd

## Priority

Muy alta para:

```text
commission-only sales
independent sales agent
B2B sales
freelance sales representative
```

La plataforma muestra cientos de oportunidades y está diseñada expresamente para comerciales independientes por comisión.

## Source

```text
source_code = commissioncrowd
opportunity_kind = commission_only
```

## Special fields

```text
territory
industry
agent_type
commission_rate
commission_text
deal_value
recurring_commission
company
description
```

## Ranking

NO penalizar automáticamente `commission_only`.

El usuario debe poder filtrar:

```text
accept_commission_only = true/false
min_commission_percent
base_required = true/false
```

---

# RepVue

## Fit

Sales job board especializado con categorías como:
- Account Executive;
- Sales Development Representative;
- Account Manager;
- Sales Leadership;
- Sales Engineer;
- Partner/Channel Sales.

Además puede aportar señal salarial/empresa.

## Source

```text
source_code = repvue
source_family = specialist_sales_job_board
```

## Provider

Public/provider adapter. No asumir API pública hasta verificar una interfaz oficial en el spike.

---

# Working Nomads

## Fit

Tiene páginas específicas para:
- Remote Closer;
- SaaS Sales;
- Sales;
- Channel Sales;
- Sales Support.

## Source

```text
source_code = workingnomads
source_family = remote_job_board
```

## Use

Buena fuente de recall. Si el resultado apunta a una vacante que ya existe en ATS/company source, el ATS gana como primary posting.

## Acceptance

- [ ] CommissionCrowd integrado;
- [ ] comisión modelada correctamente;
- [ ] RepVue spike/provider;
- [ ] Working Nomads connector;
- [ ] specialist-source boost configurable;
- [ ] dedupe contra ATS/job boards.

## Research references

- https://www.commissioncrowd.com/listings/commission-only-sales-opportunities/opportunities/
- https://www.repvue.com/sales-jobs
- https://www.workingnomads.com/remote-closer-jobs
