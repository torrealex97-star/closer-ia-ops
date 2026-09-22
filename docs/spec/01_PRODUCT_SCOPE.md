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
