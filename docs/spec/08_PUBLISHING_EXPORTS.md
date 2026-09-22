# Publishing and Exports

## Exports

Formatos MVP:
- CSV;
- XLSX;
- JSON.

Campos default:

```text
published_at
discovered_at
role
title
company
country
location
remote
salary_min
salary_max
currency
salary_period
compensation_type
summary
application_url
application_email
source_names
source_urls
ranking_score
```

XLSX se genera server-side; no depender de la UI.

## Publication model

```text
Job(s)
  |
Template renderer
  |
Preview
  |
Destination adapter
  |
PublicationRun
```

## Template

Ejemplo conceptual:

```text
🔥 {{title}} — {{company}}

🌍 {{location_label}}
{{compensation_line}}
{{language_line}}

{{summary}}

👉 Aplicar:
{{application_url}}

Fuente: {{source_label}}
```

Plantillas versionadas.

## Publisher interface

```python
class Publisher(Protocol):
    type: str

    async def validate_destination(...) -> ValidationResult: ...
    async def publish(...) -> PublishResult: ...
```

## MVP destinations

### Discord
Preferir webhook/bot autorizado según necesidad.

### Telegram
Bot API.

### Generic webhook
Permite:
- Make;
- n8n;
- Zapier;
- CRM;
- app propia.

Payload estable y versionado.

## Safety controls

Default MVP:
`manual_review_required=true`.

Saved search puede activar:
`auto_publish=true`
solo después de que un admin configure filtros y destino.

## Idempotency

Reintentar publicación no puede duplicar mensajes.

`publication_runs.content_hash + destination + job` forma la base del control.

## Copy

Botón `Copy formatted` usa exactamente el mismo renderer que publicación.

Evitar que “copy” y “publish” produzcan textos distintos.
