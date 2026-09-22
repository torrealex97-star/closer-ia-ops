# API Contracts

Prefix: `/v1`

## Authentication

MVP interno:
- Supabase Auth;
- roles `admin`, `staff`;
- API verifica JWT;
- acciones server-to-server usan secret independiente.

## Searches

### `POST /search-runs`

Request:

```json
{
  "query": {
    "role_codes": ["closer"],
    "keywords": ["high ticket"],
    "country_codes": ["ES"],
    "remote_mode": ["remote"],
    "salary_min": 2000,
    "salary_currency": "EUR",
    "salary_period": "month",
    "salary_filter_mode": "prefer",
    "posted_within_hours": 72,
    "source_codes": ["linkedin", "skool", "facebook", "upwork"],
    "target_candidates": 200,
    "target_results": 30
  }
}
```

Response `202`:

```json
{
  "id": "uuid",
  "status": "queued"
}
```

### `GET /search-runs/{id}`

Devuelve:
- status;
- counts;
- source progress;
- timings;
- cost;
- warnings.

### `GET /search-runs/{id}/results`

Params:
- page;
- page_size;
- sort;
- role/source/status.

### `GET /search-runs/{id}/events`

SSE.

Events:
- `run-status`;
- `connector-status`;
- `result-upsert`;
- `metrics`;
- `done`.

Fallback frontend: polling a `GET /search-runs/{id}`.

### `POST /search-runs/{id}/cancel`

Best-effort.

## Saved searches

```text
POST   /saved-searches
GET    /saved-searches
GET    /saved-searches/{id}
PATCH  /saved-searches/{id}
DELETE /saved-searches/{id}
POST   /saved-searches/{id}/run
```

## Jobs

```text
GET   /jobs
GET   /jobs/{id}
PATCH /jobs/{id}                # staff corrections/status
POST  /jobs/{id}/revalidate
POST  /jobs/{id}/mark-invalid
```

## Sources

```text
GET  /sources
GET  /sources/{code}/providers
POST /sources/{code}/healthcheck
```

Admin-only para edición de provider config.

## Manual ingest

### `POST /ingest`

Acepta uno:
- URL;
- text;
- JSON.

Produce `raw_item` y lo procesa por el pipeline normal.

## Exports

### `POST /exports`

```json
{
  "search_run_id": "uuid",
  "job_ids": ["uuid"],
  "format": "xlsx"
}
```

Formatos:
`csv|xlsx|json`.

## Publication

### `POST /publication-previews`

```json
{
  "job_ids": ["uuid"],
  "template_code": "sales_standard",
  "destination_id": "uuid"
}
```

### `POST /publications`

```json
{
  "job_ids": ["uuid"],
  "template_code": "sales_standard",
  "destination_id": "uuid",
  "idempotency_key": "..."
}
```

### `GET /publication-runs/{id}`

## Provider webhooks

### `POST /webhooks/apify`

- verifica secret;
- idempotente por run/event;
- no confía en IDs del cliente;
- obtiene/valida dataset asociado;
- actualiza connector run;
- encola procesamiento.

## Errors

Formato único:

```json
{
  "error": {
    "code": "CONNECTOR_TIMEOUT",
    "message": "Human-safe message",
    "details": {},
    "request_id": "..."
  }
}
```

Nunca devolver secreto/provider raw error completo a usuarios normales.

## OpenAPI

FastAPI es la fuente del contrato backend.

Frontend genera tipos desde OpenAPI en CI/build; no mantener interfaces duplicadas a mano.
