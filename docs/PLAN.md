# Plan de producto

Revisión 2026-09-22. Producto independiente de Scalix; WDC primera organización. Arquitectura aprobada no equivale a código entregado. Estado ejecutable en [STATUS](STATUS.md).

## Base disponible

Actualización de ejecución: P05A iniciada; Groq ya configurable en preview con adaptadores separados, salida estructurada, historial y límites por solicitud/día. Faltan presupuestos monetarios/cuotas coordinadas, tareas masivas y canary/benchmark; ver STATUS. Las entregas posteriores continúan pendientes.

MVP administrativo local: seis feeds públicos, catálogo de fuentes, Apify guiado, análisis individual OpenAI, búsqueda/histórico/exportación y migraciones SQLite v2. No login de alumnas ni portal desplegado. Esta revisión no cambia proveedores ni consume servicios.

## Próximos incrementos, en orden

| Orden | Fase | Resultado y dependencia |
|---|---|---|
| 1 | [P05A Groq](spec/phases/P05A_GROQ_PROVIDER.md) | LLMProvider, adaptador Groq principal y conservación de OpenAI/histórico; caché/cuotas/observabilidad; pruebas y canary si hay clave |
| 2 | [P01B Dominio](spec/phases/P01B_OPPORTUNITY_DOMAIN.md) | WDCOpportunity, fechas/actividad/elegibilidad/relaciones, DTOs separados y migración conservadora |
| 3 | [P04K Fuentes US](spec/phases/P04K_US_HISPANIC_SOURCES.md) | Spikes e integración incremental según fichas; un conector por corte, no esperar todas para continuar |
| 4 | [P05B Calidad WDC](spec/phases/P05B_WDC_OPPORTUNITY.md) | Hechos verificados, presentación normalizada y CTA honesto, gold set ES/EN |
| 5 | [P06B Preview](spec/phases/P06B_STUDENT_PREVIEW.md) | Superficie de alumna previsualizable dentro de admin con contrato separado |
| 6 | P07 / P09 / P10 | Publicación por políticas/atribución y revisión, hardening y aceptación medidos |
| 7 | Acceso online y portal | Postgres/Auth/RLS, membresías, pruebas multiusuario; feed/perfil/preferencias/matching de alumnas |
| 8 | [P11 Conexiones directas](spec/phases/P11_DIRECT_CONNECTIONS.md) | Empresas/recruiters verificados, necesidades, consentimiento, referrals e introductions |
| 9 | Preparación y candidaturas | Roleplays/entrevistas con Groq detrás de abstracción; seguimiento, aplicaciones asistidas y autoapply autorizado |

P05B puede usar las fuentes existentes sin esperar toda P04K. Spikes de documentación son preparatorios; mantener una sola fase de implementación activa. Si falta clave Groq, avanzar contrato/fixture/migración sin declarar canary completado. No sustituir P05A por expansión indiscriminada de scrapers.

## Principios de entrega

Admin conserva adquisición y trazabilidad; alumna ve empresa + oportunidad + condiciones + siguiente paso. Groq es default objetivo; toda IA tiene evidencia/versiones/límites. US hispano no equivale a residencia US ni a elegibilidad España/LATAM. Ver [ADR-007](decisions/ADR-007-groq-opportunity-surfaces.md).

Cada corte deja código, pruebas, migración/contratos cuando corresponda y estado honesto. Los MD nuevos son especificación, no una marca de fase terminada.

## Evolución diaria

Una mejora pequeña comprobable del incremento activo. Priorizar fallos reproducibles, contratos y coste por oportunidad útil. No consumir servicios de pago, publicar aplicaciones ni contactar terceros sin configuración/autorización. Notificar avances verificables o bloqueos accionables. La automatización existente mantiene el proyecto, no publica ofertas.

## Proyecto separado

Influencers IG/TikTok/YouTube/LinkedIn pertenece al futuro proyecto separado en Scalix. Reutilizar paquetes versionados solo ante necesidad concreta, nunca secretos, datos ni dependencias internas.
