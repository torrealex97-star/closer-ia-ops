# Search, Filtering, Classification, Dedupe and Ranking

## Objetivo

Recuperar con alta cobertura y después reducir ruido.

No detener búsqueda al encontrar 20 ofertas brutas.

## Objetivo por calidad y coste (ADR-009)

El criterio de parada depende del resultado final, no del volumen bruto. El orquestador ejecuta capas de coste (free → low → medium → high → premium) y tras cada capa evalúa un SearchGoal configurable (`daily_high_quality_target=10`, `minimum_unique_companies`, `maximum_offer_age_hours=72`, `minimum_quality_score=0.80`, presupuesto diario de pago como margen): si FREE produce ≥10 válidas, no se llama a proveedores de pago; si FREE produce 8, solo se escala lo necesario para el gap. El SearchGoal se edita por API sin tocar código. La ejecución por capas, el gate y las 7 pruebas de contrato viven en `orchestrator.py` + `tests/test_orchestrator.py`.

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

## Query expansion (ADR-010)

El orquestador genera consultas por source a partir de:
- **vocabulario canónico de perfiles** (`apps/api/career/vocabulary.py`, ADR-010): familias closer/setter/cold_caller/account_executive/sdr + agregado digital_sales, con equivalentes (asesor de admisiones, sales advisor, patient coordinator…) y errores ortográficos observados;
- keywords del usuario;
- idioma/mercado;
- señales de calidad (leads cualificados, fijo más comisiones…) que suben el score;
- ruido negativo (MLM, rentabilidad garantizada, cursos que enseñan closing) que descarta.

No usar un LLM para inventar decenas de consultas en cada run. La taxonomía de `vocabulary.py` —fuente única consumida por match(), la clasificación de presentación, los presets por fuente y los inputs de Apify vía `GET /v1/profile-terms`— produce comportamiento reproducible. Los títulos de dirección (gerente, líder, responsable, manager…) no cuentan como perfiles de cierre salvo término explícito de closer/setter en el título.

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
- `>= 0.95` + empresa/dominio iguales: candidato fuerte; auto-link solo con identidad determinista adicional y política validada, nunca por score semántico aislado.
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
  provider exact publication date > parsed explicit publication date > null
  discovered_at se conserva separado; nunca sustituye publicación

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
Encaje orientativo alto (score interno 0.92; no probabilidad)
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

## Búsqueda US hispana y procesamiento Groq

Usar suite ES/EN de [18](18_US_HISPANIC_SOURCE_RESEARCH.md), ampliando roles de ventas sin reducir todo a “closer”. Mantener modo estricto Spanish-required y modo bilingüe/internacional opt-in; español como ventaja se registra separado de obligatorio. Portales hispanos y empresa latina no son evidencia de idioma.

Separar mercado de clientes US de allowed_worker_countries. US-only se excluye para ES/LATAM; ubicación desconocida va a revisión. Híbrido exige oficina accesible. Distinguir inglés requerido y nivel, licencia profesional/autorización laboral explícita, horario y relación laboral/contractor. Ningún ranking puede sobreponerse a exclusión geográfica fiable.

Límite inicial: 200 candidatos, máximo 3 queries por fuente, priorización por yield/coste, caché de listados y detección de cambios antes de descargar detalle. No iniciar todos los proveedores/Actors ni combinar todo el diccionario como una query AND. Conservar query real por connector_run.

Extracción determinista → dedupe exacto → filtros baratos → Groq solo para ambigüedad/enriquecimiento → schema/evidencia → scoring explicable → WDCOpportunity. Un JSON combinado reutilizado cubre rol, condiciones, requisitos, idioma y resumen; no una llamada por cada campo. Gate por tokens/coste/tiempo y backpressure; detalles en [16](16_LLM_PROVIDER_GROQ.md).

Scoring semántico es señal versionada no probabilidad de contratación. No puntuar género/etnia ni deducirlos; “alumnas” es voz de marca. La ficha alumna explica condiciones útiles, no muestra 0.96 de confianza como certeza. Dedupe semántico propone pares con revisión; no fusiona oportunidades distintas de una empresa.

Freshness_score ordena, pero nunca demuestra activa. Solo VerificationService deriva estado conforme a [17](17_WDC_OPPORTUNITY_EXPERIENCE.md). Correcciones de salario/fecha/relación invalidan presentación y caché factual correspondiente.
