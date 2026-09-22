# MASTER SPEC — WDC Career Platform

Revisión 2026-09-22: Groq, expansión US hispana y experiencia de oportunidades. Arquitectura objetivo aprobada; estado implementado en [STATUS](../STATUS.md). [ADR-007](../decisions/ADR-007-groq-opportunity-surfaces.md) registra estas decisiones; ADR-006 conserva la entrega local. Los lockfiles determinan versiones reales.

## Principio de producto

Para administración construimos un motor de inteligencia y agregación de oportunidades. Para las alumnas construimos una experiencia de conexión con empresas y oportunidades profesionales.

WDC busca, filtra, selecciona, verifica, organiza y presenta un siguiente paso claro. Cada afirmación refleja una acción/evidencia real; encontrar una publicación no acredita colaboración empresarial. WDC es la primera organización de un producto reutilizable; Scalix e influencers permanecen separados.

## Dos superficies del mismo sistema

Admin: búsquedas, fuentes/proveedores, raw, postings, runs, clasificación, duplicados, costes, auditoría y revisión.
Alumna: empresa + oportunidad + condiciones + siguiente paso. La procedencia es secundaria salvo atribución necesaria. Portal con login queda en una fase posterior; antes se construye su DTO y preview dentro de administración.

## Invariantes

- Source != proveedor de adquisición != proveedor LLM.
- Todo dato externo entra como raw inmutable; estados de procesamiento en tablas separadas.
- Posting apunta a raw; job tiene al menos un posting, incluso oportunidades directas.
- WDCOpportunity es una presentación versionada derivada del job; no sustituye trazabilidad.
- No inventar empresa, salario, potencial, fecha, vigencia, elegibilidad ni relación WDC.
- Cada campo factual importante conserva evidencia; desconocidos explícitos.
- Aislamiento por organización desde almacenamiento a DTO; ningún raw/coste/contacto privado en API de alumna.
- Filtros obligatorios no se relajan para completar cupo; dedupe conservador con revisión.
- Fallos individuales producen resultados parciales; progreso sin esperar a todas las fuentes.
- Adquisición normal sin cuentas personales; proveedores y gastos opt-in.
- Aplicación/envío/publicación son acciones diferentes de descubrir o hacer click.

## Requisitos conservados del motor

Los IDs originales se conservan para seguimiento. M4 sigue siendo objetivo de cobertura, con entrega escalonada según ADR-006 y PLAN, no requisito ya completado.

| ID | Requisito |
|---|---|
| M1–M3 | Búsqueda bajo demanda, multi-fuente paralela y resultados progresivos |
| M4–M6 | Adaptadores LinkedIn/Skool/Facebook/Upwork, independencia de cuentas personales y proveedores reemplazables con fallback controlado |
| M7–M8 | 100–300 candidatos y objetivo 20–30 útiles condicionado a oferta suficiente y filtros |
| M9–M12 | Raw inmutable, posting/job universal, dedupe conservador y trazabilidad por campo |
| M13 | Publicación, descubrimiento, observación y vigencia separados |
| M14–M15 | CSV/XLSX/JSON, copiar/preview y publicación Discord/Telegram/webhook bajo políticas |
| M16–M17 | Fallos parciales y métricas de latencia/errores/candidatos/aceptados/duplicados/coste |
| M18–M20 | Secretos server-side, autorización/RLS en producción, auditoría, idempotencia y contratos/versiones |

S1–S9 siguen previstos: búsquedas guardadas/programadas, taxonomía configurable, plantillas, revalidación, health/circuit breaker, filtros salariales strict/prefer, gold set y captura manual URL/texto. Fuera del primer MVP: portal completo, autoapply, mensajes automáticos, modelo ML propio e infraestructura masiva. El preview de alumna prepara su experiencia sin adelantar esas fases.

## Proveedor de IA

`default_llm_provider = groq`, detrás de `LLMProvider`. Incluye extracción, normalización, rol, idiomas, requisitos, salarios/comisiones, clasificación, resumen, contenido de alumna/publicación, scoring semántico y apoyo a dedupe. Primero usar datos estructurados/parsers; una llamada combinada solo cuando aporte valor.

Structured JSON, validación factual, persistencia previa, caché, límites de tokens/coste/concurrencia y observabilidad obligatorios. Fallback futuro configurado, nunca gasto silencioso. Modelos por tarea, configuración, errores, retries y benchmark en [16_LLM_PROVIDER_GROQ](16_LLM_PROVIDER_GROQ.md). El análisis OpenAI local existente debe migrarse sin perder historial.

## Mercados y fuentes

España, LATAM, Europa con español y oportunidades US hispanas/bilingües o internacionales compatibles con el perfil. Separar país de empresa/cliente del lugar permitido de trabajo. Remoto no significa worldwide; portal hispano no demuestra español requerido.

Consultas ES/EN cubren closer, high-ticket, appointment/DM setter, SDR/BDR, AE, sales representative, inside sales, business development, enrollment advisor, sales consultant, cold caller, lead generation, telemarketing y equivalentes españoles.

Conservar seis feeds públicos operativos y catálogo configurable. Ampliación documentada en [18_US_HISPANIC_SOURCE_RESEARCH](18_US_HISPANIC_SOURCE_RESEARCH.md) con fichas individuales, prioridades, acceso y bloqueos; no confundir catálogo con integración operativa.

## Oportunidad y conexión

Pipeline: raw → normalización → verificación → clasificación → job → WDCOpportunity → revisión/política → alumna/publicación.
Contrato, mensajes, estados y CTA en [17_WDC_OPPORTUNITY_EXPERIENCE](17_WDC_OPPORTUNITY_EXPERIENCE.md).

connection_type: direct_partner, direct_recruiter, direct_company, external_application, marketplace_application, community_opportunity.
Relación directa exige evidencia vigente y canal autorizado. application_type determina cómo aplicar; abrir un ATS público no crea relación directa.
Estados: Activa, Verificando, Cerrada. Fecha publicada separada de descubierta y verificada; potencial/OTE separado de fijo.

## Arquitectura y contratos

Monorepo Next.js/FastAPI/worker. MVP actual SQLite local; destino multiusuario Postgres/Auth/RLS según ADR-006. API backend/OpenAPI genera tipos cuando se implemente; endpoints nuevos documentados son objetivo, no rutas disponibles.

Módulos: Acquisition → Processing/LLM → Canonical jobs → Opportunity presentation/verification → Admin/Student APIs → Publication/Referrals.
Futuras entidades: companies, company_partnerships, recruiters, company_contacts, direct_opportunities, candidate_referrals, introductions. Sin outreach automático implícito.

## Fases y aceptación

Orden vigente en [PLAN](../PLAN.md): P05A Groq → P01B modelo de oportunidad → P04K spikes US → P05B proyección/verificación → P06B preview → P07/P09 gates → acceso y portal → conexiones directas. Ejecutar un incremento verificable cada vez.

Objetivo condicionado a oferta real: 100–300 candidatos y 20–30 oportunidades útiles en minutos, sin fabricar ni ampliar filtros. Benchmark 200 candidatos: p95 <=5 min y primeros útiles <=60 s con capacidad de proveedor declarada; reportar límites/colas, no prometerlo en toda cuenta.

Gold set mínimo 200 items ES/EN: clasificación precision >=90%, recall >=85%; merge precision >=95%, false merge <1%; trazabilidad 100%. Añadir elegibilidad geográfica, idioma, compensación, vigencia, honestidad del CTA y fuga de datos entre DTOs. Ninguna fase se considera terminada solo por tener MD.

## Índice normativo

[Scope](01_PRODUCT_SCOPE.md) · [Architecture](02_ARCHITECTURE.md) · [Data Model](03_DATA_MODEL.md) · [Search](04_SEARCH_AND_RANKING.md) · [Connectors](05_CONNECTORS.md) · [API](06_API_CONTRACTS.md) · [UI/UX](07_UI_UX.md) · [Publishing](08_PUBLISHING_EXPORTS.md) · [Security](09_SECURITY_OBSERVABILITY.md) · [Acceptance](10_TESTING_ACCEPTANCE.md) · [Roadmap](11_FUTURE_ROADMAP.md).

Los documentos 16–18 son parte de esta especificación, no propuestas opcionales. Las copias README APP/README2/CONNECTORS 2 se mantienen como enlaces a documentos canónicos para evitar divergencias.
