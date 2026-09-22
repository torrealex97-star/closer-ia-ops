# Connector Architecture and Source Matrix

## Regla central

**Source != Provider.**

Ejemplo:

```text
linkedin
├── apify_provider_a
├── apify_provider_b
└── jobspy
```

El dominio no conoce detalles del proveedor.

## Interface

```python
@dataclass
class ConnectorCapabilities:
    keyword_search: bool
    location_filter: bool
    salary_filter: bool
    date_filter: bool
    remote_filter: bool
    authenticated_private_data: bool
    incremental: bool
    revalidation: bool

class SearchConnector(Protocol):
    source_code: str
    provider_code: str
    capabilities: ConnectorCapabilities

    async def search(
        self,
        query: SourceQuery,
        context: ConnectorContext,
    ) -> SearchBatch: ...

    async def healthcheck(self) -> HealthResult: ...
```

## SearchBatch

```text
provider_run_id
started_at
completed_at
items[]
warnings[]
next_cursor?
cost?
```

`items[]` deben ser `RawCandidate`, no `Job`.

## RawCandidate mínimo

```text
external_id?
source_url?
raw_text?
raw_html?
raw_json?
published_at_hint?
```

## Matriz MVP

| Source | Primario | Fallback | Notas |
|---|---|---|---|
| LinkedIn | provider hosted (Apify) | provider B / JobSpy | no cuenta personal |
| Skool | provider hosted | provider B | distinguir public/member-only capability |
| Facebook Groups | provider hosted public search/known groups | provider B | private no se asume anónimo |
| Upwork | provider hosted | provider B | filtro budget/experience/recency |
| Freelancer | official API | external read provider | OAuth oficial |
| Indeed/Glassdoor/Google | JobSpy/provider | otro provider | complementar cobertura |
| ATS | direct adapters | FreeHire | company source preferred |
| FreeHire | HTTP API | self-host later | gran catálogo ATS |
| Manual | internal | n/a | URL/text/json |

## LinkedIn

Input adapter:
- keywords;
- location;
- remote;
- date;
- salary cuando proveedor lo soporte;
- max results.

Output mapping debe conservar:
- LinkedIn job id;
- apply URL;
- external vs Easy Apply;
- employer;
- salary si pública;
- published time.

No acoplar el schema de un Actor directamente a tablas.

## Facebook

Dos modos:

### Known groups
Se configura una lista de group URLs y se recuperan posts recientes.

### Public keyword discovery
Solo si el proveedor seleccionado ofrece búsqueda pública por keyword.

Después, `is_job_offer` clasifica los posts.

Un post social no se fuerza a tener los mismos campos que un job board; valores ausentes quedan null.

## Skool

Modo:
- community posts;
- opcionalmente search si proveedor lo soporta.

Cada comunidad configurada puede tener:
- slug/url;
- priority;
- market/language hints;
- active;
- provider override.

Capacidad member-only se marca explícitamente. No convertir una dependencia de cookies personales en requisito del MVP.

## Upwork

Mapear:
- fixed vs hourly;
- budget;
- experience;
- skills;
- client location/signals cuando públicos;
- posted_at.

Un proyecto freelance sigue siendo `JobPosting`, con `employment_type=freelance/project`.

## Freelancer

Usar API oficial si cumple búsqueda requerida.

OAuth secret server-side.

## ATS/Company careers

Son preferidos para:
- apply URL;
- status;
- full description;
- published date.

Si un job canónico tiene ATS/company posting, este suele ser primary posting.

## Provider selection

Algoritmo:

```text
providers = active providers ordered by priority

for provider:
  if unhealthy/circuit_open -> skip
  if capabilities don't satisfy minimum query -> skip
  run with timeout
  if success with valid items -> stop for that source
  if retryable failure -> next provider
```

No ejecutar todos los fallbacks simultáneamente salvo configuración de comparación.

## Contract tests

Cada provider debe aprobar fixtures:

- success mapping;
- zero results;
- rate limit;
- timeout;
- malformed item;
- duplicate items;
- missing optional fields;
- provider schema change detection.

## Canary jobs

Cada fuente crítica tiene una búsqueda canary pequeña programada.

Objetivo:
detectar roturas antes de que un operador lance una búsqueda importante.

## Cost safety

Por provider:
- `max_results_default`;
- `max_run_cost` si API lo soporta;
- timeout;
- result cap.

Persistir `actual_cost`.


## Matriz ampliada de fuentes 2026-09-22

| Source | Access | Priority | Role signal |
|---|---|---:|---|
| Freelancer | official API | A | freelance sales |
| Workana | public/provider | A | closer/setter ES/LATAM |
| InfoJobs | official API | A | Spain sales |
| Himalayas | public JSON API | A | remote setter/SDR |
| We Work Remotely | official RSS | A | remote sales |
| Remote OK | public JSON/RSS | A | remote sales |
| Wellfound | hosted/public provider | A | startup SDR/AE |
| PeoplePerHour | public/provider | A | cold calling/closer |
| Guru | public/provider | A | setter/closer |
| CommissionCrowd | public/provider | A | commission sales |
| Remote Latinos | public/provider | A | LATAM closer/setter |
| Working Nomads | public/provider | B | remote closer |
| Remotive | public API/RSS | B | remote sales |
| OnlineJobs.ph | public/provider | B | setter/closer, PH-heavy |
| RepVue | public/provider | B | sales-specific |
| Jooble | official REST API | B | aggregator |
| Careerjet | publisher API | B | aggregator |
| Talent.com | publisher API/XML | B | aggregator |
| WhatJobs | publisher FeedAPI | B | aggregator |

### SourceDistributionPolicy

Toda fuente puede declarar:

```python
@dataclass
class SourceDistributionPolicy:
    requires_attribution: bool = False
    attribution_text: str | None = None
    allow_export: bool = True
    allow_internal_display: bool = True
    allowed_publish_targets: set[str] | None = None
    blocked_publish_targets: set[str] = field(default_factory=set)
```

La publicación externa debe consultarla antes de ejecutar un destino.

### Opportunity kind

Añadir/confirmar:

```text
employment
freelance_project
contract
commission_only
```

y compensación:

```text
base_only
commission_only
base_plus_commission
per_appointment
per_closed_deal
revenue_share
unknown
```
