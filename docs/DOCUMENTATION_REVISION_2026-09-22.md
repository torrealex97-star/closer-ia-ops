# Registro de revisión documental

Fecha: 2026-09-22. Se revisaron los 60 Markdown existentes (raíz y docs), incluyendo copias, ADRs y fases. Alcance solicitado: arquitectura/especificaciones/planificación; sin cambios de runtime.

## Decisiones y cobertura

| Petición | Documento normativo / fase |
|---|---|
| Groq principal desacoplado; tareas/modelos/JSON/retries/cuotas/costes/observabilidad/fallback | 16_LLM_PROVIDER_GROQ; ADR-007; P05A |
| Fuentes US hispanas, ES/EN y sin cuenta personal | 18_US_HISPANIC_SOURCE_RESEARCH; sources/ (17 fichas); P04K |
| Experiencia empresa + oportunidad + condiciones + siguiente paso | 17_WDC_OPPORTUNITY_EXPERIENCE; 07_UI_UX; P06B |
| Todos los campos de WDCOpportunity | 17 y 03_DATA_MODEL; P01B/P05B |
| Fuente secundaria sin perder atribución ni trazabilidad | 02/05/06/07/08; DTO admin separado |
| Honestidad y seis connection_type | 17 y 03; matriz CTA, evidencia de relación y revocación |
| Normalización/verificación/clasificación y capa WDC | 00/02/04/16/17; P05B |
| Actividad/frescura/fechas desconocidas | 17/03/04; VerificationService y TTL |
| Acción clara y proceso externo honesto | 17/06/07; ApplicationResolver |
| Futuras empresas/acuerdos/recruiters/contactos/referrals/introductions | 03/11; P11 |
| Separación admin/alumna con seguridad real | 02/06/09/10; allowlist y permisos |
| Fases y brecha entre aprobado/implementado | PLAN/STATUS y seis fases nuevas |

## Consolidación y correcciones

README APP.md y README2.md apuntan al README canónico; 05_CONNECTORS 2.md apunta a conectores/investigación. Sus conceptos de distribución y compensación se conservan en docs canónicos. Ningún historial raw ni código eliminado.

Se corrige discovered_at como supuesto published_at; “92% match” deja de ser probabilidad; estados mutables salen del raw objetivo; relaciones por org explícitas; ATS público no es partnership. Arquitectura local vs destino se distinguen. Se mantiene todo ADR histórico; ADR-002/005 reciben enlace a su extensión, ADR-001/003/004/006 siguen válidos sin reescritura.

## Evidencia externa y limitaciones

Documentación primaria Groq enlazada en 16; fuentes primarias y fecha por ficha. Recomendaciones de modelos/prioridades son decisiones a evaluar, no benchmark realizado. LatPro→DiversityJobs e HispanicPro→Hispanic-Jobs evitan duplicar conectores. RepVue devolvió 403; HLPA tuvo timeout; ruta anónima de Latinas in Tech pendiente. No se afirman fuentes integradas por estar investigadas.

No hay cambio de UI, conectores, credenciales, migraciones ejecutadas ni llamadas LLM/scraper de pago. Pruebas de runtime anteriores no validan Groq ni el futuro portal. Validación de esta entrega: links internos/inventario/coherencia/diff; criterios de implementación quedan pendientes.

## Documentos modificados o consolidados

- [AGENTS.md](../AGENTS.md)
- [README.md](../README.md)
- [docs/DESIGN.md](DESIGN.md)
- [docs/INTEGRATIONS.md](INTEGRATIONS.md)
- [docs/PLAN.md](PLAN.md)
- [docs/SOURCES.md](SOURCES.md)
- [docs/STATUS.md](STATUS.md)
- [docs/spec/00_MASTER_SPEC.md](spec/00_MASTER_SPEC.md)
- [docs/spec/01_PRODUCT_SCOPE.md](spec/01_PRODUCT_SCOPE.md)
- [docs/spec/02_ARCHITECTURE.md](spec/02_ARCHITECTURE.md)
- [docs/spec/03_DATA_MODEL.md](spec/03_DATA_MODEL.md)
- [docs/spec/04_SEARCH_AND_RANKING.md](spec/04_SEARCH_AND_RANKING.md)
- [docs/spec/05_CONNECTORS 2.md](spec/05_CONNECTORS 2.md)
- [docs/spec/05_CONNECTORS.md](spec/05_CONNECTORS.md)
- [docs/spec/06_API_CONTRACTS.md](spec/06_API_CONTRACTS.md)
- [docs/spec/07_UI_UX.md](spec/07_UI_UX.md)
- [docs/spec/08_PUBLISHING_EXPORTS.md](spec/08_PUBLISHING_EXPORTS.md)
- [docs/spec/09_SECURITY_OBSERVABILITY.md](spec/09_SECURITY_OBSERVABILITY.md)
- [docs/spec/10_TESTING_ACCEPTANCE.md](spec/10_TESTING_ACCEPTANCE.md)
- [docs/spec/11_FUTURE_ROADMAP.md](spec/11_FUTURE_ROADMAP.md)
- [docs/spec/12_TECHNOLOGY_AND_SOURCE_NOTES.md](spec/12_TECHNOLOGY_AND_SOURCE_NOTES.md)
- [docs/spec/13_EXECUTION_PROTOCOL.md](spec/13_EXECUTION_PROTOCOL.md)
- [docs/spec/14_SOURCE_EXPANSION_RESEARCH.md](spec/14_SOURCE_EXPANSION_RESEARCH.md)
- [docs/spec/15_PRODUCT_VISION_AND_BOUNDARIES.md](spec/15_PRODUCT_VISION_AND_BOUNDARIES.md)
- [docs/spec/AGENTS.md](spec/AGENTS.md)
- [docs/spec/CLAUDE.md](spec/CLAUDE.md)
- [docs/spec/README APP.md](spec/README APP.md)
- [docs/spec/README.md](spec/README.md)
- [docs/spec/README2.md](spec/README2.md)
- [docs/spec/decisions/ADR-002-canonical-job-model.md](spec/decisions/ADR-002-canonical-job-model.md)
- [docs/spec/decisions/ADR-005-llm-boundary.md](spec/decisions/ADR-005-llm-boundary.md)
- [docs/spec/phases/P00_FOUNDATION.md](spec/phases/P00_FOUNDATION.md)
- [docs/spec/phases/P01_DOMAIN_DATABASE.md](spec/phases/P01_DOMAIN_DATABASE.md)
- [docs/spec/phases/P02_ORCHESTRATOR.md](spec/phases/P02_ORCHESTRATOR.md)
- [docs/spec/phases/P03A_LINKEDIN.md](spec/phases/P03A_LINKEDIN.md)
- [docs/spec/phases/P03B_UPWORK.md](spec/phases/P03B_UPWORK.md)
- [docs/spec/phases/P03C_FACEBOOK.md](spec/phases/P03C_FACEBOOK.md)
- [docs/spec/phases/P03D_SKOOL.md](spec/phases/P03D_SKOOL.md)
- [docs/spec/phases/P03_CRITICAL_SOURCES.md](spec/phases/P03_CRITICAL_SOURCES.md)
- [docs/spec/phases/P04A_FREELANCER.md](spec/phases/P04A_FREELANCER.md)
- [docs/spec/phases/P04B_WORKANA.md](spec/phases/P04B_WORKANA.md)
- [docs/spec/phases/P04C_INFOJOBS.md](spec/phases/P04C_INFOJOBS.md)
- [docs/spec/phases/P04D_HIMALAYAS.md](spec/phases/P04D_HIMALAYAS.md)
- [docs/spec/phases/P04E_REMOTE_FEEDS.md](spec/phases/P04E_REMOTE_FEEDS.md)
- [docs/spec/phases/P04F_FREELANCE_MARKETPLACES.md](spec/phases/P04F_FREELANCE_MARKETPLACES.md)
- [docs/spec/phases/P04G_SALES_SPECIALIST.md](spec/phases/P04G_SALES_SPECIALIST.md)
- [docs/spec/phases/P04H_LATAM_AND_GLOBAL_REMOTE.md](spec/phases/P04H_LATAM_AND_GLOBAL_REMOTE.md)
- [docs/spec/phases/P04I_AGGREGATOR_APIS.md](spec/phases/P04I_AGGREGATOR_APIS.md)
- [docs/spec/phases/P04J_WELLFOUND_STARTUPS.md](spec/phases/P04J_WELLFOUND_STARTUPS.md)
- [docs/spec/phases/P04_COMPLEMENTARY_SOURCES.md](spec/phases/P04_COMPLEMENTARY_SOURCES.md)
- [docs/spec/phases/P05_PROCESSING_QUALITY.md](spec/phases/P05_PROCESSING_QUALITY.md)
- [docs/spec/phases/P06_WEB_UI.md](spec/phases/P06_WEB_UI.md)
- [docs/spec/phases/P07_EXPORT_PUBLISH.md](spec/phases/P07_EXPORT_PUBLISH.md)
- [docs/spec/phases/P08_AUTOMATION.md](spec/phases/P08_AUTOMATION.md)
- [docs/spec/phases/P09_HARDENING.md](spec/phases/P09_HARDENING.md)
- [docs/spec/phases/P10_MVP_ACCEPTANCE.md](spec/phases/P10_MVP_ACCEPTANCE.md)

## Documentos nuevos

- [docs/decisions/ADR-007-groq-opportunity-surfaces.md](decisions/ADR-007-groq-opportunity-surfaces.md)
- [docs/spec/16_LLM_PROVIDER_GROQ.md](spec/16_LLM_PROVIDER_GROQ.md)
- [docs/spec/17_WDC_OPPORTUNITY_EXPERIENCE.md](spec/17_WDC_OPPORTUNITY_EXPERIENCE.md)
- [docs/spec/18_US_HISPANIC_SOURCE_RESEARCH.md](spec/18_US_HISPANIC_SOURCE_RESEARCH.md)
- [docs/spec/phases/P01B_OPPORTUNITY_DOMAIN.md](spec/phases/P01B_OPPORTUNITY_DOMAIN.md)
- [docs/spec/phases/P04K_US_HISPANIC_SOURCES.md](spec/phases/P04K_US_HISPANIC_SOURCES.md)
- [docs/spec/phases/P05A_GROQ_PROVIDER.md](spec/phases/P05A_GROQ_PROVIDER.md)
- [docs/spec/phases/P05B_WDC_OPPORTUNITY.md](spec/phases/P05B_WDC_OPPORTUNITY.md)
- [docs/spec/phases/P06B_STUDENT_PREVIEW.md](spec/phases/P06B_STUDENT_PREVIEW.md)
- [docs/spec/phases/P11_DIRECT_CONNECTIONS.md](spec/phases/P11_DIRECT_CONNECTIONS.md)
- [docs/spec/sources/ASHBY.md](spec/sources/ASHBY.md)
- [docs/spec/sources/GREENHOUSE.md](spec/sources/GREENHOUSE.md)
- [docs/spec/sources/HIRELATAM.md](spec/sources/HIRELATAM.md)
- [docs/spec/sources/HIRE_WITH_NEAR.md](spec/sources/HIRE_WITH_NEAR.md)
- [docs/spec/sources/HISPANICPRO.md](spec/sources/HISPANICPRO.md)
- [docs/spec/sources/HISPANIC_JOBS.md](spec/sources/HISPANIC_JOBS.md)
- [docs/spec/sources/HLPA.md](spec/sources/HLPA.md)
- [docs/spec/sources/IHISPANO.md](spec/sources/IHISPANO.md)
- [docs/spec/sources/LATINAS_IN_TECH.md](spec/sources/LATINAS_IN_TECH.md)
- [docs/spec/sources/LATPRO_DIVERSITYJOBS.md](spec/sources/LATPRO_DIVERSITYJOBS.md)
- [docs/spec/sources/LEVER.md](spec/sources/LEVER.md)
- [docs/spec/sources/REMOTE_LATINOS.md](spec/sources/REMOTE_LATINOS.md)
- [docs/spec/sources/REPVUE.md](spec/sources/REPVUE.md)
- [docs/spec/sources/SALESJOBS.md](spec/sources/SALESJOBS.md)
- [docs/spec/sources/SOMEWHERE.md](spec/sources/SOMEWHERE.md)
- [docs/spec/sources/WELLFOUND.md](spec/sources/WELLFOUND.md)
- [docs/spec/sources/WORKINGNOMADS.md](spec/sources/WORKINGNOMADS.md)

Este registro usa rutas relativas desde docs; los archivos de raíz se enlazan con ../ cuando corresponde.
