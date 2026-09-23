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

## Cost tier por conector (ADR-009)

Cada conector declara o hereda un `cost_tier` (free/low/medium/high/premium) que el orquestador usa para ejecutar por capas. Por defecto: feeds/APIs públicos → `free`; conexiones Apify → `low`. La asignación explícita es configuración (`integration_settings`, provider `source-tier`), nunca código. Los conectores caros son fallback de gap filling; solo se ejecutan cuando el Quality Gate determina que falta calidad para el SearchGoal y cabe en el presupuesto diario.

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

## Keywords para proveedores (ADR-010)

Los inputs de Actores/scrappers (keywords, searchQueries, startUrls) se rellenan desde el **vocabulario canónico** (`apps/api/career/vocabulary.py`), no desde listas hardcodeadas:

- `GET /v1/profile-terms` expone cada familia (digital_sales, closer, setter, cold_caller, account_executive, sdr) con etiqueta y términos ordenados por preferencia (la "lista mínima" primero: closer, closer de ventas, high ticket closer… asesor de admisiones, admissions advisor, enrollment advisor, sales advisor, patient coordinator, treatment coordinator…).
- El asistente guiado muestra un selector "Perfil de búsqueda" y rellena los términos con la familia elegida; siempre editable. El formulario avanzado usa el mismo vocabulario en sus presets (p. ej. InfoJobs).
- `prepare_input` envía los términos tal cual: si el Actor acepta array van todos; si acepta uno solo se usa el primero **sin descartar el resto en silencio** (se exige enlaces filtrados o se avisa).
- `KEYWORDS` en `integrations.py` se deriva del vocabulario; ampliar la taxonomía actualiza búsqueda, clasificación y inputs juntos.
- Las búsquedas preparadas por fuente (`wdc_source_presets.json`) siguen esta misma taxonomía con las combinaciones recomendadas (cargo + sector + modalidad).

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

## Ampliación US y separación de presentación

Matriz/fichas por fuente en [18](18_US_HISPANIC_SOURCE_RESEARCH.md). Reutilizar conectores de mercados actuales con SourceQuery ES/EN antes de duplicar implementaciones. APIs ATS por tenant y recruiters LATAM→US priorizados; job boards hispanos amplían descubrimiento, sin inferir elegibilidad.

Capacidades adicionales: public_without_personal_account, application_requires_candidate_account, worker_country_filter, language_filter, status_revalidation, redistribution_policy_known. Estado de integración: researched → spike → contract_tested → canary_verified → enabled; una ficha documental no pasa automáticamente a enabled. URL/Actor configurables y validados por fuente; no dar por compatible un Actor por coincidir solo en título del Store.

SourceDistributionPolicy distingue internal_admin_display, student_display, external_publish, export, requires_attribution, attribution_text/url/placement, allowed/blocked_targets, verified_at y terms_url. Política desconocida no habilita redistribución externa. Registro de alias/sindicación: LatPro→DiversityJobs, board HispanicPro→Hispanic-Jobs. Fuentes duplicadas no multiplican presupuesto.

Conector entrega raw con fuente/proveedor/run/version/query completos; jamás decide copy WDC, relación directa o next_step. country del cliente no se mapea a country permitido del trabajador. Oportunidad de empresa directa entra por conector intake interno con raw y canal autorizado.
