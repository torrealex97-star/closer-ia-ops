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
WDCOpportunity version aprobada + estado vigente + politica de fuente
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

{{required_attribution_line}}
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

## Separar exportación administrativa y contenido de alumnas

Los campos default anteriores corresponden a exportación técnica interna; no son el payload de alumna. Añadir audience=admin|student, validado contra permisos. student usa allowlist WDCOpportunity; admin mantiene source/provider/provenance. No exportar raw/contactos privados por defecto ni enviarlos en webhook de alumnas.

Template principal: empresa, puesto, condiciones, qué buscan/harías, estado/fecha y siguiente paso; atribución en posición exigida por fuente. source_label no domina pero nunca se elimina si obligatoria. Groq prepara borrador sobre hechos verificados; renderer determinista y versiones aseguran preview == copy == payload.

Gates de publicación: revisión aprobada, oportunidad activa con TTL vigente, elegibilidad compatible, application_type/canal válido, política de distribución permitida y atribución correcta. Incertidumbre o política desconocida bloquea publicación externa. Revocación/cierre retira del feed e inicia actualización del destino si soportada; si no, marca mensaje como desactualizado y avisa a admin, con auditoría.

Idempotencia incluye org + destination + opportunity_id + opportunity_version + template_version + locale + content_hash. Reenvío deliberado requiere nueva acción explícita; revalidar antes de envío. Guardar versión y evidencia exactas de lo publicado.

No decir “WDC te conecta directamente” por tener una URL ATS; aplicar matriz connection_type en [17](17_WDC_OPPORTUNITY_EXPERIENCE.md). No mostrar potencial calculado, frescura inventada ni “empresa recibiendo candidaturas” sin verificación.
