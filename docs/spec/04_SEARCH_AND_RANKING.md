# Search, Filtering, Classification, Dedupe and Ranking

## Objetivo

Recuperar con alta cobertura y después reducir ruido.

No detener búsqueda al encontrar 20 ofertas brutas.

## SearchDefinition

Ejemplo:

```json
{
  "role_codes": ["closer"],
  "keywords": ["high ticket"],
  "country_codes": ["ES"],
  "remote_mode": ["remote"],
  "languages": ["es"],
  "salary_min": 2000,
  "salary_currency": "EUR",
  "salary_period": "month",
  "salary_filter_mode": "prefer",
  "posted_within_hours": 72,
  "source_codes": ["linkedin", "skool", "facebook", "upwork", "freelancer"],
  "target_candidates": 200,
  "target_results": 30
}
```

## Candidate budget

`target_candidates` se reparte por fuente con pesos configurables.

Ejemplo inicial para 200:

```text
LinkedIn    50
Skool       35
Facebook    35
Upwork      35
Freelancer  20
ATS/others  25
```

No es una garantía. Los conectores pueden devolver menos.

## Query expansion

El orquestador genera consultas por source a partir de:
- role aliases;
- keywords del usuario;
- idioma/mercado;
- include/exclude terms.

No usar un LLM para inventar decenas de consultas en cada run. La taxonomía versionada produce comportamiento reproducible.

## Procesamiento

### Paso A — extracción determinista
Prioridad:
1. JSON/API fields;
2. JSON-LD `JobPosting`;
3. metadata;
4. parser de proveedor;
5. regex controlada para emails/salario/fecha.

### Paso B — hard filters
Descartar solo cuando el dato es suficientemente fiable.

Ejemplo:
`country=ES` hard se puede cumplir por:
- ubicación explícita ES;
- remote_scope incluye ES;
- global remoto permitido por query.

No inferir geografía desde el idioma.

### Paso C — IA
Usar para:
- ¿es oportunidad laboral/proyecto real?
- role_code;
- resumen;
- requisitos;
- remoto/alcance cuando texto lo describe;
- estructura de compensación si está en lenguaje natural.

Salida JSON validada por Pydantic.

La IA devuelve:
- value;
- confidence;
- evidence excerpt/location en raw.

Si confidence baja, no convertirlo en hard fact.

## Dedupe

### Exact
- mismo source/external_id => misma publicación;
- misma canonical_url => misma publicación/candidato fuerte.

### Determinista cross-source
Score por señales:
- dominio/empresa;
- título normalizado;
- ubicación;
- salary;
- fecha;
- fingerprint de descripción.

### Semántica
Solo para generar un `duplicate candidate`.

Umbrales iniciales:
- `>= 0.95` + empresa/dominio iguales: auto-link permitido.
- `0.80–0.95`: mantener separados o review candidate.
- `< 0.80`: no merge.

Los umbrales se calibran con el gold set.

## Fusión de campos

El `Job` canónico no copia ciegamente el primer posting.

Prioridad por campo:

```text
application_url:
  careers/ATS company > LinkedIn > aggregator > social post

published_at:
  provider exact date > parsed text > discovered_at

salary:
  structured provider field > explicit text extraction > null

description:
  company/ATS original > source with full text > longest trusted posting
```

Guardar provenance.

## Freshness

```text
freshness_score:
<= 24h   1.00
<= 72h   0.90
<= 7d    0.70
<= 14d   0.40
> 14d    0.20
unknown  0.35
```

Configurable.

## Compensation match

Convertir para comparación solo cuando:
- currency/period conocidos;
- conversión está permitida por config;
- no mezclar OTE con base.

Guardar original.

Para ventas:
- `base`
- `commission_only`
- `base_plus_commission`
- `ote`
- `unknown`

## Ranking

Default:

```text
0.35 relevance
0.20 freshness
0.15 compensation
0.10 location
0.10 completeness
0.05 source quality
0.05 confidence
```

Relevance nunca se sustituye por popularidad de fuente.

## Result explanation

Cada resultado debe poder mostrar algo como:

```text
92% match
- Role: Closer ✓
- Remote from Spain ✓
- Posted: 11h ago ✓
- Salary: unknown (preferred filter, not strict)
- Spanish: required ✓
- Sources: LinkedIn + company careers
```

## Limitar resultados

1. filtrar hard fails;
2. ordenar ranking;
3. devolver `target_results`;
4. permitir “ver todos” los candidatos aceptados.

Nunca inventar 30 resultados si solo hay 12 válidos.
