# Architecture

## Contexto

Volumen esperado inicial: decenas de resultados finales por búsqueda y cientos de candidatos brutos, no millones de eventos. Se optimiza por fiabilidad, cobertura y mantenibilidad.

## Monorepo

```text
opportunity-engine/
├── apps/
│   ├── web/                    # Next.js
│   ├── api/                    # FastAPI
│   └── worker/                 # workers/consumers Python
├── packages/
│   ├── contracts/              # JSON schemas/OpenAPI/shared types generated
│   ├── taxonomy/               # roles/aliases/locations
│   └── config/
├── connectors/
│   ├── linkedin/
│   ├── skool/
│   ├── facebook/
│   ├── upwork/
│   ├── freelancer/
│   ├── jobboards/
│   ├── ats/
│   ├── freehire/
│   └── manual/
├── publishers/
│   ├── discord/
│   ├── telegram/
│   └── webhook/
├── supabase/
│   └── migrations/
├── tests/
│   ├── fixtures/
│   ├── integration/
│   └── e2e/
├── docs/
├── docker-compose.yml
├── AGENTS.md
└── CLAUDE.md
```

## Procesos desplegables

### Web
- Next.js.
- No contiene secretos privilegiados.
- Usa key publicable de Supabase solo para capacidades protegidas por RLS.
- Consume API FastAPI.

### API
- valida usuario;
- CRUD de búsquedas/config;
- inicia runs;
- sirve resultados;
- SSE;
- export/publicación.

### Worker
- consume Supabase Queues;
- lanza búsqueda/orquestación;
- procesa raw items;
- clasifica;
- dedupe;
- revalida;
- publica.

### External provider
Apify u otro proveedor ejecuta scraping/búsqueda. Los resultados regresan por:
- llamada síncrona cuando sea corta;
- polling limitado;
- webhook idempotente para runs largas.

## Cola

Supabase Queues es pull-based; por tanto, **siempre existe un worker consumidor**.

Colas iniciales:

```text
search-run
process-raw
revalidate-job
publish-job
```

No exponer colas al navegador.

## Eventos internos

```text
search.created
connector.started
connector.completed
connector.failed
raw.ingested
posting.created
job.created
job.updated
job.merged
search.partial
search.completed
publication.requested
publication.completed
```

En MVP pueden persistirse en `processing_events` en vez de introducir un event bus separado.

## Search orchestration

El orquestador solo conoce la interfaz de conectores.

Pseudoflujo:

```python
providers = registry.resolve(query.sources)

async with TaskGroup() as tg:
    for source in providers:
        tg.create_task(run_source_with_fallback(source, query))

# cada batch se procesa a medida que llega
```

No esperar al `gather()` completo para empezar procesamiento.

## Provider fallback

```text
Source: LinkedIn

provider A -> healthy -> run
     |
     +-- timeout/error
             |
             v
        provider B -> run
             |
             +-- error -> source failed

otros sources siguen ejecutándose
```

No usar fallback si puede duplicar costes de forma no controlada: cada intento queda registrado y sujeto a presupuesto/limit.

## Circuit breaker

Ventana inicial:

```text
5 ejecuciones recientes
>= 3 fallos => degraded
>= 5 fallos consecutivos => disabled automático durante cooldown
```

Los valores son configuración.

## Idempotency

Keys sugeridas:

```text
raw_item:
  provider + source + external_id + captured_bucket/hash

job_posting:
  source + external_id

apify webhook:
  provider_run_id + event_type

publication:
  destination_id + job_id + template_version + content_hash
```

## Versioning

Guardar:

```text
job_schema_version
normalizer_version
classifier_version
prompt_version
dedupe_version
ranking_version
connector_version
```

No se hace migración silenciosa de resultados históricos.

## Infra de desarrollo

`docker-compose`:
- API;
- worker;
- opcional Postgres local/Supabase CLI compatible;
- web puede correr con package manager.

Los conectores externos se mockean en CI excepto suites contractuales dedicadas.
