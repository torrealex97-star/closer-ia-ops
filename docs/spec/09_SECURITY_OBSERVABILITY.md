# Security, Operations and Observability

## Secrets

Server only:

```text
SUPABASE_SECRET_KEY
APIFY_TOKEN
GROQ_API_KEY
OPENAI_API_KEY               # futuro secundario opt-in, no requerido
FREELANCER_OAUTH_*
DISCORD_*
TELEGRAM_*
PUBLISHING_WEBHOOK_SECRET_*
```

Browser:

```text
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
```

No usar legacy `service_role`/`anon` en nuevo código si el proyecto dispone de las nuevas claves.

## RLS

Activar RLS desde primera migración para tablas accesibles por Data API.

La API y worker con secret key realizan sus propios checks de autorización porque bypass RLS.

## Provider credentials

No almacenar cookies/credentials sensibles dentro de `source_providers.config`.

Usar:
- environment/secrets manager;
- `secret_ref`.

## Personal accounts

La operación normal de fuentes críticas no depende de credenciales personales.

Si en futuro una fuente member-only requiere credenciales autorizadas:
- se modela como provider separado;
- secreto aislado;
- capacidad `authenticated_private_data=true`;
- no se convierte en fallback silencioso.

## Data minimization

Para ofertas y contactos:
- almacenar solo datos necesarios para identificar la oportunidad y aplicar/publicar;
- conservar source URL/provenance;
- definir política de retención para raw social data;
- no enriquecer personas por defecto.

## Audit

Registrar:
- cambio de source/provider;
- edición manual de job;
- merge/unmerge;
- cambio de template;
- publicación;
- creación/cambio de schedules.

## Logs

JSON estructurado:

```text
timestamp
level
request_id
search_run_id
connector_run_id
source
provider
event
duration_ms
error_code
```

No loggear:
- tokens;
- cookies;
- raw headers auth;
- descriptions completas salvo debug local controlado.

## Metrics

Por provider:

```text
runs
success_rate
zero_result_rate
p50/p95 latency
items_found
items_accepted
cost
errors_by_code
```

Por búsqueda:

```text
time_to_first_result
time_to_complete
candidates
final_jobs
duplicates
rejected
cost
source_coverage
```

## Orquestación cost-aware (ADR-009)

Por fuente, en `source_stats` (migración 6): `candidates_found`, `qualified_jobs`, `high_quality_jobs`, `cost_eur`, `quality_yield`, `duplicate_ratio`, `failure`, `cost_per_qualified`, `cost_per_high_quality`. Por ejecución, en el resultado de `execute_layered`: capas intentadas (tier, attempted, stop, gap_description) y stats por fuente. Métrica económica principal: `cost_per_high_quality_opportunity`, con objetivo descendente mes a mes. La brecha se registra como texto de negocio (`describe_gap`) para el futuro AgenticGapFillProvider: nunca se lanza una capa de pago sin gap documentado.

## Health

Endpoints:
- `/health/live`
- `/health/ready`

Panel de source health usa métricas persistidas, no solo un ping.

## Alerts MVP

Alertar cuando:
- fuente crítica falla N veces;
- zero results anormal;
- p95 excede umbral;
- coste/run aumenta demasiado;
- webhook failures;
- worker backlog supera umbral.

## Backups

Supabase backups según plan + migrations en git.

Configurable data export para recuperación de mappings de sources/providers.

## Rate limiting

- API user-level para iniciar searches;
- provider-level concurrency;
- publicación rate limit por destination.

No permitir que doble click lance múltiples searches: idempotency key UI/API.

## Groq, DTO y relaciones

Configuración completa/limitadores en [16](16_LLM_PROVIDER_GROQ.md). Telemetría separa adquisición (source/provider/run) e IA (llm_provider/model/task/generation/attempt); conservar ambos aunque la alumna no los vea. Métricas: cache hit, tokens reservados/reportados, coste estimado/real/desconocido, queue time, 429, uncertain, invalid evidence, utilidad por token y fuente.

No usar el secreto local como autenticación del portal. API de alumna con allowlist y autorización por membership/candidata; tests negativos de org y rol. Contactos, consentimientos y evidencias de acuerdos requieren acceso restringido y retención definida. No incluir CV/perfil de candidata en extracción masiva de ofertas.

Auditar activación Groq, cambio de modelos/límites, fallback, aprobación de revisión, atribución, relación verificada/revocada, siguiente paso y envío real. Logs sin prompts/raw completos ni secretos. Contenido scrapeado no instruye al sistema ni habilita tools. Pausar por límite no elimina resultados ya procesados.
