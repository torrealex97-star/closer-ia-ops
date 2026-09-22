# Product Scope

## Propuesta de valor

Convertir una intención de búsqueda en una lista pequeña de oportunidades accionables sin recorrer manualmente múltiples webs/comunidades.

## Usuario MVP

Operador/admin interno.

No hay portal de alumnos en MVP.

## Jobs to be done

1. “Quiero encontrar ahora ofertas de Closer en España/remoto que cumplan mis condiciones.”
2. “Quiero saber de qué fuente proviene cada una.”
3. “No quiero revisar 300 publicaciones repetidas o irrelevantes.”
4. “Quiero exportarlas o publicarlas inmediatamente.”
5. “Quiero guardar la búsqueda para repetirla automáticamente.”

## Habilidades funcionales de la app

### Search
- búsqueda multi-fuente;
- selección de fuentes;
- filtros obligatorios/preferidos;
- búsqueda progresiva.

### Intelligence
- extracción;
- normalización;
- clasificación;
- tagging;
- dedupe;
- ranking;
- vigencia.

### Operations
- source health;
- fallback de proveedor;
- costes;
- reintentos;
- auditoría.

### Distribution
- preview;
- copy;
- CSV/XLSX/JSON;
- Discord;
- Telegram;
- generic webhook/API.

### Automation
- saved searches;
- schedules;
- revalidation;
- publicación opcional tras reglas.

## Filtros MVP

```text
query/keywords
role_codes[]
country_codes[]
location_text
remote_mode[]        remote/hybrid/onsite
remote_scope[]
language_codes[]
experience_levels[]
employment_types[]
posted_within_hours
salary_min
salary_max
salary_currency
salary_period
compensation_types[]
source_codes[]
include_terms[]
exclude_terms[]
salary_filter_mode   strict/prefer
```

## Semántica de filtros

### Hard
Si no se cumple, se descarta.

Ejemplos:
- país permitido;
- antigüedad;
- fuentes seleccionadas;
- término excluido.

### Prefer
Afecta ranking, no elimina cuando el campo falta.

Ejemplo:
- salario >= 2.000 si muchas fuentes no publican salario.

El formulario debe hacer visible esta diferencia.

## Taxonomía inicial Sales

```text
closer
appointment_setter
sdr
bdr
account_executive
sales_representative
commercial
business_development
sales_manager
customer_success
other_sales
not_relevant
```

Aliases se guardan en configuración, no hardcodeados en conectores.

## Mercados iniciales

1. España.
2. Estados Unidos orientado a español/hispano.
3. LATAM.
4. Global remoto compatible con España/LATAM.

## Fuera de alcance funcional del MVP

- CV builder;
- ATS para candidatos;
- chat entre alumnos/empresas;
- pagos;
- autoapply;
- outreach automático;
- marketplace público.

## Revisión WDC: admin y alumna

El MVP local sigue siendo administrativo; preparar ahora modelo/DTO y preview de alumna, sin afirmar que existe portal/login. La experiencia objetivo prioriza empresa, rol, condiciones, vigencia y siguiente paso, conforme a [17](17_WDC_OPPORTUNITY_EXPERIENCE.md). La procedencia completa sigue disponible para admin.

Groq es proveedor principal de todas las tareas IA mediante LLMProvider; ver [16](16_LLM_PROVIDER_GROQ.md). El código OpenAI actual es transitorio, no decisión de proveedor futuro.

Extender mercados a Europa en español y US hispano/internacional con búsqueda ES/EN. Añadir dm_setter, enrollment_advisor, sales_consultant, cold_caller, lead_generation y telemarketing a la taxonomía configurable; no clasificar cualquier soporte/marketing como ventas. manager/customer_success solo en perfiles ampliados.

Nuevos filtros: customer_market, employer_country, allowed_worker_countries, residency_required, work_authorization, timezone_overlap, spanish_requirement (required/preferred/unknown), english_level, connection_type, opportunity_status y verified_within_hours. La lista actual de filtros es objetivo de contrato; STATUS describe lo disponible.
