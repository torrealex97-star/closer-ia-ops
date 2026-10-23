# Plan de producto

Revisión 2026-09-23: orquestación cost-aware/quality-aware entregada ([ADR-009](decisions/ADR-009-cost-aware-search.md): SearchGoal configurable, ejecución por capas FREE→premium, presupuesto tope y 7 pruebas de contrato). Revisión 2026-09-22. Producto independiente de Scalix; WDC primera organización. Arquitectura aprobada no equivale a código entregado. Estado ejecutable en [STATUS](STATUS.md).

## Base disponible

Actualización de ejecución: P05A iniciada; Groq ya configurable en preview con adaptadores separados, salida estructurada, historial y límites por solicitud/día. Faltan presupuestos monetarios/cuotas coordinadas, tareas masivas y canary/benchmark; ver STATUS. Las entregas posteriores continúan pendientes.

MVP administrativo local: seis feeds públicos, catálogo de fuentes, Apify guiado, análisis individual OpenAI, búsqueda/histórico/exportación y migraciones SQLite v2. No login de alumnas ni portal desplegado. Esta revisión no cambia proveedores ni consume servicios.

## Prioridad solicitada — catálogo diario (2026-09-22)

Entregado antes de continuar P05A: recogida diaria de las fuentes conectadas, búsqueda exclusivamente local y ventana de diez días. Presupuesto inicial de scraping 1 €/día, ajustable a 2 €, reservas globales, conversión BCE con margen y actores PPE compatibles. Ver [ADR-008](decisions/ADR-008-daily-catalog.md) y [operación](DAILY_CATALOG.md). La automatización de mantenimiento de código sigue siendo independiente del worker de recogida.

## Ajuste de experiencia solicitado — 2026-09-22

Preview de alumna adelantado de P06B: `/` centrado en elección profesional, perfiles Closer/Setter/Cold Caller, español por defecto y condiciones visibles; gestión en `/admin`. DTO de presentación permitido ya implementado sobre el catálogo local. P01B/P05B/P06B completos siguen pendientes: clasificación/verificación editorial, dominio versionado, matching real y autorización multiusuario no quedan resueltos por esta separación visual. Ver STATUS.

Prioridad de cobertura España aplicada: consultas públicas ES antes del pool global y vista inicial de todos los perfiles; pendiente obtener resultados válidos de InfoJobs y medir rendimiento de las conexiones nuevas. La ausencia de datos no se suple ampliando a países incompatibles.

Referencias WDC y adquisición por fuente organizadas en [SOURCE_ACQUISITION](SOURCE_ACQUISITION.md). Próximo paso de cobertura: validar pequeñas extracciones de los proveedores elegidos dentro del presupuesto existente; implementar rutas específicas donde no hay Actor compatible, con atención a comunidades privadas.

## Próximos incrementos, en orden

| Orden | Fase | Resultado y dependencia |
|---|---|---|
| 1 | [P05A Groq](spec/phases/P05A_GROQ_PROVIDER.md) | LLMProvider, adaptador Groq principal y conservación de OpenAI/histórico; caché/cuotas/observabilidad; pruebas y canary si hay clave |
| 1b | Conectores del lote España 2026-09-23 | JobToday (`__NEXT_DATA__`), ClosersAvenue (parseo a validar) y watchlist Greenhouse Typeform/Cabify; coste 0, señal comercial máxima. Ver [SOURCES](SOURCES.md) y [ADR-009](decisions/ADR-009-cost-aware-search.md) |
| 2 | [P01B Dominio](spec/phases/P01B_OPPORTUNITY_DOMAIN.md) | WDCOpportunity, fechas/actividad/elegibilidad/relaciones, DTOs separados y migración conservadora |
| 3 | [P04K Fuentes US](spec/phases/P04K_US_HISPANIC_SOURCES.md) | Spikes e integración incremental según fichas; un conector por corte, no esperar todas para continuar |
| 4 | [P05B Calidad WDC](spec/phases/P05B_WDC_OPPORTUNITY.md) | Hechos verificados, presentación normalizada y CTA honesto, gold set ES/EN |
| 5 | [P06B Preview](spec/phases/P06B_STUDENT_PREVIEW.md) | Superficie de alumna previsualizable dentro de admin con contrato separado |
| 6 | P07 / P09 / P10 | Publicación por políticas/atribución y revisión, hardening y aceptación medidos |
| 7 | Acceso online y portal | Postgres/Auth/RLS, membresías, pruebas multiusuario; feed/perfil/preferencias/matching de alumnas |
| 8 | [P11 Conexiones directas](spec/phases/P11_DIRECT_CONNECTIONS.md) | Empresas/recruiters verificados, necesidades, consentimiento, referrals e introductions |
| 9 | Preparación y candidaturas | Roleplays/entrevistas con Groq detrás de abstracción; seguimiento, aplicaciones asistidas y autoapply autorizado |

P05B puede usar las fuentes existentes sin esperar toda P04K. Spikes de documentación son preparatorios; mantener una sola fase de implementación activa. Si falta clave Groq, avanzar contrato/fixture/migración sin declarar canary completado. No sustituir P05A por expansión indiscriminada de scrapers.

## Práctica de venta y entrevista (I1 entregado)

Plan revisado el 2026-10-23 a partir del paquete `closer-ai-coach`: método (cebolla de la culpa, looping, regla de silencio, rúbrica con evidencia), señales deterministas, voz del navegador y repaso. **Aprobado I1 y las notas 0-100 por eje y global**; entregado con ocho situaciones, capas de resistencia, feedback de cuatro ejes con cita, señales y respuesta modelo. **I2 (voz) e I3 (repaso/progreso local) siguen pendientes de aprobación**, junto con la lista de descartes y sus motivos: [plan](plans/PRACTICE_UPGRADE_FROM_CLOSER_AI_COACH.md). Estado y límites en [STATUS](STATUS.md).

## Principios de entrega

Admin conserva adquisición y trazabilidad; alumna ve empresa + oportunidad + condiciones + siguiente paso. Groq es default objetivo; toda IA tiene evidencia/versiones/límites. US hispano no equivale a residencia US ni a elegibilidad España/LATAM. Ver [ADR-007](decisions/ADR-007-groq-opportunity-surfaces.md).

Cada corte deja código, pruebas, migración/contratos cuando corresponda y estado honesto. Los MD nuevos son especificación, no una marca de fase terminada.

## Evolución diaria

Una mejora pequeña comprobable del incremento activo. Priorizar fallos reproducibles, contratos y coste por oportunidad útil. No consumir servicios de pago, publicar aplicaciones ni contactar terceros sin configuración/autorización. Notificar avances verificables o bloqueos accionables. La automatización existente mantiene el proyecto, no publica ofertas.

## Proyecto separado

Influencers IG/TikTok/YouTube/LinkedIn pertenece al futuro proyecto separado en Scalix. Reutilizar paquetes versionados solo ante necesidad concreta, nunca secretos, datos ni dependencias internas.
