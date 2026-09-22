# Data Model

## Reglas

- UUID para IDs internos.
- UTC en DB.
- JSONB solo para payloads flexibles; campos usados en filtros deben ser columnas.
- `raw_items` append-only.
- FK explícitas.
- índices desde el primer migration para filtros comunes.
- soft/status lifecycle para ofertas; no borrar histórico automáticamente.

## Tablas core

### `sources`

```text
id uuid PK
code text UNIQUE               # linkedin, skool, facebook...
name text
kind text                      # job_board, community, ats, freelance, manual
active boolean
priority smallint
config jsonb
created_at timestamptz
updated_at timestamptz
```

### `source_providers`

```text
id uuid PK
source_id uuid FK
code text
name text
provider_type text             # official_api, apify_actor, library, custom
priority smallint
active boolean
health_status text
capabilities jsonb
timeout_seconds int
max_results_default int
cost_config jsonb
config jsonb
last_healthcheck_at timestamptz
last_success_at timestamptz
last_failure_at timestamptz
failure_streak int
UNIQUE(source_id, code)
```

`config` nunca contiene secretos; almacena referencias/nombres de env vars.

### `saved_searches`

```text
id uuid PK
owner_id uuid
name text
query jsonb
schedule_enabled boolean
schedule_cron text null
timezone text default 'Europe/Madrid'
active boolean
auto_publish_config jsonb null
created_at
updated_at
```

### `search_runs`

```text
id uuid PK
saved_search_id uuid null
owner_id uuid
query jsonb
status text
target_candidates int
started_at
completed_at
candidate_count int
posting_count int
job_count int
error_summary jsonb
estimated_cost numeric(12,4)
actual_cost numeric(12,4)
created_at
```

Estados:
`queued|running|processing|completed|partial|failed|cancelled`.

### `connector_runs`

```text
id uuid PK
search_run_id uuid FK
source_id uuid FK
provider_id uuid FK
status text
provider_run_id text null
query_payload jsonb
started_at
completed_at
items_found int
items_ingested int
items_relevant int
error_code text null
error_message text null
cost numeric(12,4)
latency_ms int
attempt smallint
```

### `raw_items`

```text
id uuid PK
search_run_id uuid null FK
connector_run_id uuid null FK
source_id uuid FK
provider_id uuid FK
external_id text null
source_url text null
content_type text
raw_text text null
raw_html text null
raw_json jsonb null
content_hash text
captured_at timestamptz
schema_hint text null
```

No `updated_at`. El raw no se edita.

### `companies`

```text
id uuid PK
name text
normalized_name text
domain text null
website_url text null
careers_url text null
country_code char(2) null
industry text null
linkedin_url text null
metadata jsonb
created_at
updated_at
```

Índice único parcial por `domain` cuando no es null.

### `job_postings`

Representa una publicación en una fuente.

```text
id uuid PK
raw_item_id uuid FK
source_id uuid FK
provider_id uuid FK
external_id text null
source_url text
canonical_url text null
title text
normalized_title text
company_id uuid null FK
company_name_raw text null
description text
summary text null
role_code text
country_code char(2) null
city text null
location_text text null
remote_mode text null
remote_scope jsonb
employment_type text null
experience_level text null
languages jsonb
salary_min numeric null
salary_max numeric null
salary_currency char(3) null
salary_period text null
compensation_type text null
commission_text text null
application_url text null
application_email text null
published_at timestamptz null
discovered_at timestamptz
last_seen_at timestamptz
status text
field_provenance jsonb
confidence jsonb
schema_version text
normalizer_version text
classifier_version text
```

### `jobs`

Oportunidad canónica deduplicada.

```text
id uuid PK
primary_posting_id uuid FK
company_id uuid null FK
title text
normalized_title text
role_code text
country_code char(2) null
city text null
location_text text null
remote_mode text null
remote_scope jsonb
description text
summary text null
employment_type text null
experience_level text null
languages jsonb
salary_min numeric null
salary_max numeric null
salary_currency char(3) null
salary_period text null
compensation_type text null
application_url text null
application_email text null
published_at timestamptz null
first_seen_at timestamptz
last_seen_at timestamptz
last_checked_at timestamptz null
expired_at timestamptz null
status text
relevance_score numeric(5,4)
freshness_score numeric(5,4)
compensation_score numeric(5,4)
location_score numeric(5,4)
completeness_score numeric(5,4)
source_quality_score numeric(5,4)
confidence_score numeric(5,4)
ranking_score numeric(5,4)
dedupe_version text
ranking_version text
created_at
updated_at
```

### `job_posting_links`

```text
job_id uuid FK
posting_id uuid FK UNIQUE
match_method text
match_score numeric(5,4)
review_status text
linked_at timestamptz
PRIMARY KEY(job_id, posting_id)
```

### `search_results`

No duplicar todos los datos del job. Guardar relación y ranking dentro de esa búsqueda.

```text
search_run_id uuid FK
job_id uuid FK
rank int
ranking_score numeric(5,4)
matched_filters jsonb
explanations jsonb
created_at
PRIMARY KEY(search_run_id, job_id)
```

### `processing_events`

```text
id bigint identity PK
entity_type text
entity_id uuid
event_type text
payload jsonb
created_at timestamptz
```

### `publication_destinations`

```text
id uuid PK
owner_id uuid
name text
type text                  # discord, telegram, webhook
active boolean
config jsonb               # non-secret config
secret_ref text
created_at
updated_at
```

### `publication_runs`

```text
id uuid PK
destination_id uuid FK
job_id uuid FK
search_run_id uuid null FK
template_code text
template_version text
content_hash text
status text
external_message_id text null
request_payload jsonb
response_summary jsonb
error text null
created_at
completed_at
```

### `exports`

```text
id uuid PK
owner_id uuid
search_run_id uuid
format text
job_count int
storage_path text
created_at
expires_at
```

## Tablas/configuración recomendada

### `role_taxonomy`
- role_code
- display_name
- aliases
- include_terms
- exclude_terms
- version

### `source_metrics_daily`
Agregados por fecha/source/provider.

### `app_settings`
Solo valores no secretos y versionados.

## Índices mínimos

```text
job_postings(source_id, external_id)
job_postings(published_at desc)
job_postings(role_code, country_code, published_at desc)
jobs(status, role_code, country_code, published_at desc)
jobs(ranking_score desc)
raw_items(content_hash)
connector_runs(search_run_id, source_id)
search_results(search_run_id, rank)
```

Añadir búsqueda full-text Postgres a título/description si se necesita; no introducir Elastic en MVP.

## RLS

- todas las tablas expuestas al navegador tienen RLS;
- claves secretas de backend bypass RLS y nunca llegan al browser;
- `raw_items`, provider config, costs y eventos son backend/admin only;
- destinos de publicación solo son visibles/editables por su owner/admin.

## Extensión normativa WDC (objetivo, migraciones pendientes)

Todas las entidades privadas anteriores y siguientes incluyen org_id NOT NULL. owner_id no sustituye organización. FKs compuestas (org_id, id), índices con org_id y autorización impiden enlaces cruzados. companies es por organización hasta decidir catálogo común: unicidad (org_id, domain) parcial, no domain global. sources puede ser catálogo público, pero configuración, credenciales, snapshots y resultados son privados por org.

raw no contiene estado mutable: processing_tasks(raw_item_id, stage, status, error, version, timestamps) lo separa. Cada captura nueva crea otro raw; no actualizar payload. connector_runs conserva provider y provider_run_id: scrape_run es su subejecución externa/referencia, no se pierde al cambiar proveedor.

### opportunity_versions y opportunities

opportunities: id, org_id, job_id FK, current_version_id, editorial_status, created_at, updated_at; UNIQUE(org_id, job_id).
opportunity_versions: id, org_id, opportunity_id FK, version, locale, headline, company_name nullable, role, short_summary, what_they_are_looking_for JSON, what_you_would_do JSON, compensation_summary, location_summary, language_requirements JSON, experience_summary, why_it_may_be_interesting JSON, connection_type, application_type, application_url nullable, next_step JSON, field_provenance JSON, generation_id nullable, job_revision_hash, presentation_schema_version, created_by, reviewed_by nullable, reviewed_at nullable, selection_method, selection_policy_version, created_at.
UNIQUE(org_id, opportunity_id, locale, version). Revisiones inmutables; pointer actual cambia con control optimista. Por idioma se selecciona la última revisión aprobada compatible; no mezclar campos de versiones distintas.

published_relative se deriva de published_at en respuesta, nunca se almacena como “hace dos días”. Datos de fecha/actividad vienen del job y su verificación vigente, no de texto LLM cacheado.

### verification_events y elegibilidad

verification_events: id, org_id, job_id, posting_id nullable, checked_at, result (open/closed/unknown), method, evidence_raw_id, valid_until, reason_code, verifier_version.
Estado derivado opportunity_status (active/verifying/closed), last_verified_at, verified_until, status_reason, closed_at. Índice (org_id, opportunity_status, verified_until). Política de conflictos/TTL en [17](17_WDC_OPPORTUNITY_EXPERIENCE.md).

Hechos de elegibilidad en job/posting: employer_country, customer_markets[], allowed_worker_countries[], excluded_worker_countries[], residency_required, work_authorization_requirements, timezone_overlap, languages con required/preferred/level/evidence. allowed vacío = desconocido, nunca worldwide implícito.

Compensación: base_min/max, commission_text/rate nullable, ote_min/max, currency, period, amount_kind, compensation_evidence. No sumar base y OTE ni convertir un presupuesto total en mensual. Potencial es declarado, no predicho.

### Relaciones directas y referencias

| Entidad | Campos y relaciones esenciales |
|---|---|
| companies | id/org, nombre/dominio/identidad; dominio coincidente no crea partnership |
| company_partnerships | company_id, status (pending/verified/revoked/expired), type, evidence_ref, scope, verified_by/at, valid_until |
| recruiters | id/org, company_id nullable, nombre/identidad profesional y estado de verificación |
| company_contacts | company_id, recruiter_id nullable, contacto privado, finalidad/autorización, source/evidence_ref, verified_at; no DTO alumna por defecto |
| direct_opportunities | company_id, job_id, posting_id, partnership_id nullable, recruiter_id nullable, evidence_ref, intake_raw_id, authorized_channel, relationship_status |
| candidate_referrals | opportunity_id/version, candidate_id, consent_ref, partnership/recruiter/channel_ref, status, idempotency_key, requested_at; UNIQUE(org_id,idempotency_key) |
| introductions | referral_id, contact_id, authorized_by, status, external_message_id nullable, sent_at nullable, response_at nullable |

direct_company exige evidence_ref y relationship_status=verified aunque no haya partnership contractual. direct_recruiter exige identidad y autorización para la vacante. Revocación invalida uso futuro; histórico conserva evidencia y revisión anterior. Referrals usan contacto privado server-side, no exponen correo automáticamente.

Referrals: requested → approved → prepared → sent → acknowledged/declined; cancelled/failed posibles. “sent” requiere confirmación del canal, nunca un click. Candidata consiente datos/destinatario; reglas de envío viven fuera de acquisition.

### IA y coste

Ampliar ai_generations actual con provider, task, schema_version, input_hash/config_hash, organization_id equivalente a org_id existente, actual_cost nullable, estimated_cost, pricing_version y estado uncertain. Backfill provider=openai para histórico, sin volver a generar.
llm_attempts: generation_id, attempt, provider/model, provider_request_id, token_usage, latency, status/error, timestamps.
budget_reservations: org/run/generation, token_cap, estimated_cost, status, reserved_at, settled_at; transacciones evitan carreras.
UNIQUE cache por org/task/input_hash/provider/model/prompt/schema/config; no compartir datos entre organizaciones.

### Migración e integridad

Forward-only tras v2 local: ampliar IA → entidades/proyección → backfill como draft/verifying/external_application sin inventar relaciones → preview → habilitar publicación tras revisión. Si no se puede determinar modalidad de candidatura, application_type=unknown y CTA deshabilitado. No marcar automáticamente todo el histórico como active. RLS de portal exige org/membership y approved/published; raw, contactos, costes y relaciones privadas son admin-only.

### Empleo y proyectos freelance

Mantener opportunity_kind=employment|freelance_project|contract|commission_only y compensation_type=base_only|commission_only|base_plus_commission|per_appointment|per_closed_deal|revenue_share|ote|unknown. Commission-only puede ser relevante, según filtros explícitos; no es motivo automático de rechazo. budget_min/max/currency/type (fixed/hourly/commission/unknown), project_duration, bid_deadline y proposals_count pertenecen a proyectos; no convertirlos en salario periódico.
