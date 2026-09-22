# Source Expansion Research — Sales Opportunity Engine

**Research date:** 2026-09-22
**Scope:** fuentes adicionales para Closer, Appointment Setter, SDR, BDR, Account Executive, Inside Sales, Cold Calling, Telemarketing, Business Development y ventas por comisión.

## Conclusión ejecutiva

No conviene depender solo de LinkedIn, Facebook, Skool y Upwork. Para este nicho existen varias fuentes con señal muy alta y, en algunos casos, interfaces oficiales extremadamente fáciles de integrar.

### Tier A — implementar pronto

| Source | Tipo | Acceso recomendado | Señal para Sales | Prioridad |
|---|---|---|---:|---:|
| Freelancer.com / Freelancer.es | freelance marketplace | API oficial | alta | A |
| Workana | freelance LATAM/ES | páginas públicas + provider | muy alta | A |
| InfoJobs | job board España | API oficial | alta | A |
| Himalayas | remote job board | API JSON pública | muy alta | A |
| We Work Remotely | remote job board | RSS oficial | alta | A |
| Remote OK | remote job board | JSON/RSS público | alta | A |
| Wellfound | startups | provider/public web | alta para SDR/AE | A |
| PeoplePerHour | freelance marketplace | public web/provider | muy alta | A |
| Guru | freelance marketplace | public web/provider | muy alta | A |
| CommissionCrowd | commission-only sales | public web/provider | extremadamente alta | A |
| Remote Latinos | remote LATAM | public jobs/provider | muy alta | A |

### Tier B — ampliar cobertura

| Source | Tipo | Acceso recomendado | Notas |
|---|---|---|---|
| Working Nomads | remote aggregator | public pages/provider | tiene búsquedas específicas de closer |
| Remotive | remote board | API/RSS oficial | API pública con retraso y requisitos de atribución |
| OnlineJobs.ph | remote marketplace | public pages/provider | gran señal setter/closer, mucha restricción geográfica PH |
| RepVue | sales-specific board | public/provider | AE/SDR y datos de sales |
| Dynamite Jobs | remote board | public/provider | buen complemento SDR/BDR |
| Careerjet | aggregator | API publisher oficial | requiere publisher key + user IP/UA |
| Jooble | aggregator | REST API oficial | clave por país; plan free muy limitado |
| Talent.com | aggregator | publisher API/XML | partnership |
| WhatJobs | aggregator | Feed API/XML | partnership y reglas de redistribución |

## Hallazgos que afectan la arquitectura

### 1. Freelancer.es NO debe ser una fuente diferente

`freelancer.es` es una superficie localizada del ecosistema Freelancer. El sistema debe usar:

```text
source_code = freelancer
locale = es
market = ES
```

y no crear dos fuentes canónicas `freelancer_com` y `freelancer_es`, porque multiplicaría duplicados.

### 2. Las fuentes freelance necesitan un subtipo distinto

Agregar al dominio:

```text
opportunity_kind:
  employment
  freelance_project
  commission_only
  contract
```

y no asumir que toda oportunidad tiene salario anual.

Para freelance se necesitan:

```text
budget_min
budget_max
budget_currency
budget_type: fixed | hourly | commission | unknown
project_duration
bid_deadline
proposals_count
client_country
```

### 3. Commission-only es relevante, no ruido

Para closers y setters el pago puede ser:

```text
base_only
commission_only
base_plus_commission
per_appointment
per_closed_deal
revenue_share
```

La normalización debe poder representar estas estructuras.

### 4. Los agregadores sirven para recall, no para autoridad

Jooble/Careerjet/Talent/WhatJobs pueden encontrar ofertas que no aparecen en las búsquedas directas del momento, pero:

```text
ATS/company page > direct marketplace > specialist board > aggregator
```

para elegir la publicación primaria y validar vigencia.

### 5. Las APIs/RSS públicas son fuentes de bajo mantenimiento

Himalayas, Remote OK y We Work Remotely deben ser de las primeras fuentes complementarias por coste operativo bajo.

## Query expansion recomendada

### Closer

```text
closer
sales closer
high ticket closer
high-ticket closer
remote closer
closing specialist
enrollment advisor
enrollment specialist
sales consultant
inbound closer
DM closer
```

### Setter

```text
appointment setter
setter
DM setter
sales setter
appointment setting
lead setter
booking specialist
appointment booking
```

### SDR / BDR

```text
sales development representative
SDR
business development representative
BDR
outbound sales
inside sales
lead generation specialist
lead qualifier
cold caller
telemarketer
```

### Full-cycle sales

```text
account executive
sales executive
sales representative
business developer
business development
commercial
comercial
ejecutivo comercial
asesor comercial
representante de ventas
televentas
```

## Orden recomendado de rollout

```text
P04A Freelancer
P04B Workana
P04C InfoJobs
P04D Himalayas
P04E Remote feeds (WWR / Remote OK / Remotive)
P04F PeoplePerHour + Guru
P04G Sales-specialist (CommissionCrowd / RepVue / Working Nomads)
P04H LATAM/global remote niche
P04I Aggregator APIs
P04J Wellfound/startups
```

## Referencias de investigación

- Freelancer Developer API: https://developer.freelancer.com/
- Workana jobs: https://www.workana.com/es/jobs
- InfoJobs Developer API: https://developer.infojobs.net/
- Himalayas API: https://himalayas.app/api
- We Work Remotely RSS: https://weworkremotely.com/remote-job-rss-feed
- Remote OK FAQ/API: https://remoteok.com/faq
- Remotive API: https://remotive.com/remote-jobs/api
- PeoplePerHour jobs: https://www.peopleperhour.com/freelance-jobs
- Guru jobs: https://www.guru.com/d/jobs/
- CommissionCrowd opportunities: https://www.commissioncrowd.com/listings/commission-only-sales-opportunities/opportunities/
- Remote Latinos jobs: https://www.remotelatinos.com/jobs
- Jooble REST API docs: https://help.jooble.org/
- Careerjet Publisher API: https://www.careerjet.com/partners/api
- Talent.com Publisher Program: https://employers.talent.com/publishers
- WhatJobs Publisher Program: https://www.whatjobs.com/affiliates

## Ampliación US hispana — revisión vigente

La investigación adicional, prioridades y 17 fichas están en [18_US_HISPANIC_SOURCE_RESEARCH](18_US_HISPANIC_SOURCE_RESEARCH.md). Ese orden de spikes complementa/sustituye la secuencia lineal anterior según yield y acceso público. Las afirmaciones históricas de volumen/API de este archivo deben revalidarse antes de implementar.

Incluye job boards hispanos, redes profesionales, recruiters LATAM→US, ventas/startups y ATS. Mantener marketplaces y feeds existentes con consultas ES/EN. Ninguna fuente añade elegibilidad internacional por pertenecer a un portal latino.
