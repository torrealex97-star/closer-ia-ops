# Opportunity Engine — paquete de especificación

Este repositorio documental define el MVP de un motor multi-fuente de oportunidades laborales, inicialmente centrado en Sales/Ventas.

## Objetivo del MVP

Dada una búsqueda como:

- rol: Closer
- mercado: España
- modalidad: remoto
- compensación: >= 2.000 EUR/mes
- idioma: español
- antigüedad: últimas 72 h

el sistema debe consultar varias fuentes en paralelo, recuperar aproximadamente 100–300 candidatos cuando exista oferta suficiente, normalizarlos, filtrarlos, clasificarlos, deduplicarlos y devolver 20–30 oportunidades utilizables en cuestión de minutos.

Los resultados deben poder:

1. verse en la aplicación;
2. exportarse a CSV/XLSX/JSON;
3. copiarse con una plantilla de publicación;
4. publicarse por API/webhook en destinos configurados.

El producto no debe depender de las cuentas personales del operador para sus fuentes principales.

## Orden de lectura

1. `00_MASTER_SPEC.md`
2. `01_PRODUCT_SCOPE.md`
3. `02_ARCHITECTURE.md`
4. `03_DATA_MODEL.md`
5. `04_SEARCH_AND_RANKING.md`
6. `05_CONNECTORS.md`
7. `06_API_CONTRACTS.md`
8. `07_UI_UX.md`
9. `08_PUBLISHING_EXPORTS.md`
10. `09_SECURITY_OBSERVABILITY.md`
11. `10_TESTING_ACCEPTANCE.md`
12. `11_FUTURE_ROADMAP.md`
13. `phases/`
14. `AGENTS.md` / `CLAUDE.md`

## Principios no negociables

- Fuente != proveedor. Una fuente puede tener varios proveedores.
- `raw_items` es evidencia inmutable.
- `job_postings` representa una publicación concreta.
- `jobs` representa la oportunidad canónica.
- Un proveedor roto no puede romper una búsqueda completa.
- La IA no decide silenciosamente datos factuales: cada dato importante conserva procedencia y confianza.
- Deduplicar no significa fusionar agresivamente: los falsos merges son más dañinos que mostrar un duplicado.
- La búsqueda es progresiva: la UI muestra resultados a medida que llegan.
- El MVP prioriza cobertura/calidad sobre escala.
- Todo trabajo de implementación debe cerrar tests y criterios de aceptación de su fase antes de avanzar.

## Stack base verificado a 2026-09-22

- Next.js 16.3.3 (Active LTS).
- React 19.3.
- FastAPI 0.141.1.
- PostgreSQL/Supabase.
- Supabase Queues (`pgmq`) con workers explícitos.
- Apify para Actors, proxies, schedules y webhooks donde corresponda.
- `apify-client` Python 3.2.x.
- Python 3.11+ como mínimo por el cliente Apify v3; elegir una versión estable común para el repo y fijarla.
- TypeScript en frontend.
- Pydantic v2 en backend mediante una versión compatible con el FastAPI fijado.

Las versiones exactas adicionales deben quedar fijadas en lockfiles durante la fase 0, después de ejecutar smoke tests.

## Fuentes prioritarias

### Críticas
- LinkedIn Jobs
- Skool
- Facebook Groups
- Upwork

### Altas
- Freelancer.com
- Indeed / Glassdoor / Google Jobs vía proveedor
- ATS/careers pages
- Discord autorizado

### Complementarias
- FreeHire
- webs/recruiters específicos
- captura manual

## Estado del documento

Arquitectura base: APROBADA para implementación por fases.
