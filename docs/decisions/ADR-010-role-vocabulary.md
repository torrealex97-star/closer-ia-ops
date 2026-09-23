# ADR-010 — Vocabulario canónico de perfiles comerciales (taxonomía WDC)

Estado: aceptada por petición del usuario (2026-09-23, aportada como taxonomía de búsqueda). Complementa ADR-007 (dominio WDCOpportunity) y ADR-009 (orquestación cost-aware). Fuente única: `apps/api/career/vocabulary.py`.

## Decisión

Muchas empresas nunca publican "closer": publican el mismo trabajo de cierre de ventas como "asesor de admisiones", "sales advisor" o "patient coordinator". Buscar y clasificar solo por la palabra "closer" pierde esas ofertas. Por tanto, el vocabulario de perfiles es una **decisión arquitectónica con fuente única**, no listas dispersas en el código.

La fuente única es `apps/api/career/vocabulary.py` (términos guardados sin acentos/folded; el código que compara hace fold de ambos lados):

1. **Familias de rol** (`ROLE_FAMILIES` → `ALIASES`): `closer`, `setter`, `cold_caller`, `account_executive`, `sdr`, más el agregado `digital_sales` (perfil por defecto del buscador) y `sales` (búsqueda amplia). Cada familia incluye títulos canónicos, equivalentes funcionales y errores ortográficos reales observados ("closser", "clouser"). Los equivalentes cubren cinco mundos: cierre (cerrador, sales closer, especialista en cierre), admisiones/educación (asesor de admisiones, admissions advisor, enrollment advisor, asesor de matrícula), prospección/citas (appointment booker, concertador de citas, lead qualifier), venta consultiva y ciclo completo (venta consultiva, full-cycle sales) y funciones equivalentes en inglés (sales advisor, sales consultant, inside sales, account executive).
2. **Señales de calidad** (`QUALITY_SIGNALS`): evidencia de proceso comercial real en la descripción — leads cualificados/calientes, llamadas/citas agendadas, leads proporcionados, fijo más comisiones, comisiones sin techo, contrato indefinido, CRM, OTE… `match()` suma hasta +10 por señales presentes y las lista en `reasons`.
3. **Señales de sector** (`SECTOR_TERMS`): contextos high-ticket (bootcamp/edtech, mentoría/mastermind, trading e inversión, clínicas de fertilidad/capilar/dental/estética, agencias B2B, SaaS). +5 al score cuando aparecen.
4. **Ruido negativo** (`NEGATIVE_SIGNALS` y `COURSE_TERMS`): MLM/multinivel, rentabilidad o inversiones garantizadas, comisión por reclutamiento, y cursos que **enseñan** a cerrar (detectados solo si el título vende el curso; una oferta que menciona "curso" en la descripción no se descarta por ello). `match()` devuelve `None` — no son oportunidades.
5. **Guard anti-gestión**: títulos de dirección (director/a, gerente, líder, jefe, responsable, supervisor, manager, coordinador, head, analista, operations) no cuentan como perfiles de cierre salvo que el título contenga además un término explícito de closer/setter.

Regla de consumo: **todo consumidor lee de `vocabulary.py`**, nunca mantiene su propia lista:

- `pipeline.ALIASES` extiende (no sustituye) las familias del vocabulario con sus alias legacy; `match()` usa `ALIASES` + señales + ruido.
- `presentation.professional_role()` clasifica la vista de alumnas con `ROLE_FAMILIES` (un "Asesor de Admisiones" es perfil closer).
- `integrations.KEYWORDS` (términos por defecto para inputs de Apify) deriva de la "lista mínima" del vocabulario.
- Endpoint `GET /v1/profile-terms`: expone cada familia con etiqueta (`ROLE_LABELS`) y orden por preferencia, para que la web rellene los inputs de proveedores.
- Web (`SourceAssistant.tsx`, `Sources.tsx`): selector "Perfil de búsqueda" y preset InfoJobs leen de `/v1/profile-terms`; el usuario siempre puede editar los términos generados.
- `wdc_source_presets.json`: búsquedas preparadas por fuente con las combinaciones recomendadas (LinkedIn/InfoJobs/Indeed/JobToday, español e inglés).

## Implementación real

- `apps/api/career/vocabulary.py`: `ROLE_FAMILIES`, `ALIASES`, `ROLE_LABELS`, `QUALITY_SIGNALS`, `SECTOR_TERMS`, `NEGATIVE_SIGNALS`, `COURSE_TERMS`, `fold()`.
- `apps/api/career/pipeline.py`: guard anti-gestión ampliado, bonos de señales, rechazo de ruido.
- `apps/api/career/presentation.py`: `professional_role` sobre `ROLE_FAMILIES`.
- `apps/api/career/integrations.py`: `KEYWORDS` derivada del vocabulario.
- `apps/api/career/main.py`: `GET /v1/profile-terms`.
- `apps/web/components/SourceAssistant.tsx` + `Sources.tsx`: consumo del endpoint.
- Tests: `test_vocabulary_families_recognize_equivalent_titles`, `test_match_quality_signals_and_noise`, `test_match_recognizes_admissions_and_sector_terms`, `test_profile_terms_feed_apify_inputs`.

## Consecuencias

- Ampliar la taxonomía = editar `vocabulary.py` (o añadir términos); clasificación, presets e inputs de Apify se actualizan juntos, sin duplicación.
- Más cobertura con el mismo coste: ofertas con títulos equivalentes entran al catálogo (verificado: catálogo diario de 10-11 a 14 con las mismas fuentes).
- El score es comparable: las señales de calidad distinguen ofertas con proceso comercial real de las genéricas, lo que alimenta el Quality Gate de ADR-009.
- El ruido (cursos de closing, MLM, esquemas de rentabilidad garantizada) se rechaza antes de llegar a revisión humana.
- Límite declarado: la coincidencia es léxica (folded + word boundaries). Un título nuevo sin término correspondiente se pierde hasta que alguien lo añada al vocabulario; la clasificación con LLM (ADR-007) queda como evolución complementaria, no como sustituta de esta fuente única.
