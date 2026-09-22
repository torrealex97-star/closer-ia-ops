# Technology and Source Notes — verified 2026-09-22

Este archivo registra hechos externos usados para elegir la arquitectura. Volver a verificarlos antes de integrar cada proveedor porque scrapers/APIs cambian.

## Frameworks

- Next.js 16.3.3 está marcado como Active LTS en el security release de agosto de 2026.
- React 19.3 fue publicado el 9 de septiembre de 2026.
- FastAPI 0.141.1 fue publicado el 29 de julio de 2026.
- Apify Python client 3.2.0 fue publicado el 3 de septiembre de 2026 y requiere Python 3.11+ desde v3.

## Supabase

- Supabase Queues está basado en `pgmq`, es durable y pull-based.
- Un consumer/worker debe extraer y procesar mensajes; la cola por sí sola no ejecuta código.
- Supabase está migrando de `anon/service_role` a `publishable/secret` keys y documenta la deprecación de las legacy keys hacia final de 2026.

## Apify

- Actors pueden invocarse por API.
- Schedules permiten ejecución cron.
- Webhooks pueden dispararse al completar/fallar runs.
- El cliente Python tiene retries/backoff integrados para ciertos errores, pero el dominio igualmente debe imponer timeouts/cost limits.

## Current source feasibility

### LinkedIn
Existen proveedores hosted que consultan LinkedIn Jobs público sin credenciales del operador y aceptan filtros de keyword/location/remote/salary/experience.

### Upwork
Existen providers hosted de jobs públicos sin login del operador con keyword, budget, experience y recency.

### Facebook Groups
Existen providers para grupos públicos sin login del operador. Private/member-only no debe asumirse disponible anónimamente.

### Skool
Existen providers para superficies públicas sin login; member-only requiere capability/credential path separado según proveedor.

### Freelancer.com
Existe API oficial y SDK con búsqueda de Projects; usa OAuth.

### JobSpy
Actualmente soporta LinkedIn global y Indeed/Glassdoor en numerosos países. Se usa como adapter reemplazable, no dependencia central.

### FreeHire
Actualmente publica un catálogo/API de millones de ofertas desde ATS/company careers y se usa como fuente complementaria/bootstrap.

## Rule

No congelar IDs de Actors/vendors en la arquitectura. Guardarlos como configuración de `source_providers`.

## Actualización Groq y US — 2026-09-22

Groq es default objetivo según ADR-007; modelos de producción y structured outputs verificados en documentación oficial enlazada en [16](16_LLM_PROVIDER_GROQ.md). No asumir streaming/tools para JSON strict ni cuotas iguales en todas las cuentas. Revalidar capacidades antes del canary.

Fuentes nuevas y límites de evidencia en [18](18_US_HISPANIC_SOURCE_RESEARCH.md). LatPro redirige a DiversityJobs; HispanicPro remite a Hispanic-Jobs. ATS públicos por empresa tienen documentación oficial; el resto requiere spike y política de distribución. Un actor sugerido no demuestra acceso ni legitimidad del output.

Los números de frameworks del paquete original son históricos: lockfiles y STATUS reflejan runtime; esta actualización no cambia dependencias.
