# Métodos de adquisición y referencias WDC

Revisión 2026-09-22. Metadatos públicos, sin ejecutar Actors. El catálogo contiene 35 entradas: seis conectores públicos y 29 rutas de integración. Los candidatos no equivalen a extracciones comprobadas.

## Búsqueda antes de descarga

- Himalayas: palabras clave y país (España primero). Remotive: categoría sales con caché de seis horas. WWR: RSS de ventas y marketing. Get on Board: categoría ventas. Remote OK/Arbeitnow mantienen feeds compartidos sin parámetros de búsqueda inventados.
- El asistente conserva las URLs de búsquedas filtradas. Ubicación explícita sustituye valores por defecto del proveedor; enums incompatibles exigen otra ubicación o URL. No descarta en silencio keywords de un Actor que solo admite una.
- Esquema y precio se verifican al preparar. Límites por búsqueda se dividen entre términos/URLs. Comentarios, reacciones y análisis opcionales se desactivan cuando son campos booleanos reconocidos. El presupuesto diario previo sigue siendo el control de lanzamientos.
- Sin API/Actor compatible no se ejecuta un crawler general. Se indica adaptador pendiente. La selección descarta coincidencias aproximadas de otros sitios y scrapers de perfiles en lugar de vacantes.

## Excel WDC

WDC_EXECUTION_SYSTEM.xlsx se leyó sin modificarlo. Se recuperaron hipervínculos reales, incluidas celdas con texto de enlace. 51 referencias: 27 grupos Facebook, 2 Skool, 9 portales, 11 Telegram y 2 referencias de canales extraídas del pipeline (comunidad WDC y portal Nuclio).

Las referencias se muestran únicamente para local-wdc; no se trasladan automáticamente a otras organizaciones. Inglés queda detrás de español y sin prioridad. No se crean conexiones ni se lanzan scrapers al cargar el Excel. Se retiran página/identificador de oferta/tracking de las URLs de búsqueda conservando criterios originales. En InfoJobs se elimina page=3; el keyword original es Comercial de ventas y se conserva teleworkingIds=2.

No se importan estados, personas, notas de seguimiento ni cálculos de comisión del pipeline como ofertas vigentes. La hoja EXPLICACION se trata como contexto, no autorización para enviar mensajes o candidaturas.

## Cobertura por ruta

| Fuente | Candidatos con metadatos revisados | Estado |
|---|---|---|
| infojobs | [haketa/infojobs-scraper](https://apify.com/haketa/infojobs-scraper), [easyapi/infojobs-job-scraper](https://apify.com/easyapi/infojobs-job-scraper) | Falta comprobar extracción real y compatibilidad con filtros elegidos |
| computrabajo | [haketa/computrabajo-scraper](https://apify.com/haketa/computrabajo-scraper), [stealth_mode/computrabajo-jobs-search-scraper](https://apify.com/stealth_mode/computrabajo-jobs-search-scraper), [powerai/computrabajo-jobs-search-scraper](https://apify.com/powerai/computrabajo-jobs-search-scraper) | Falta comprobar extracción real y compatibilidad con filtros elegidos |
| workana | [automation-lab/workana-freelance-projects-scraper](https://apify.com/automation-lab/workana-freelance-projects-scraper), [getdataforme/workana-job-scraper](https://apify.com/getdataforme/workana-job-scraper), [gio21/workana-scraper](https://apify.com/gio21/workana-scraper) | Falta comprobar extracción real y compatibilidad con filtros elegidos |
| getonbrd | [scrapers_lat/getonbrd-scraper](https://apify.com/scrapers_lat/getonbrd-scraper), [jungle_synthesizer/getonbrd-latam-tech-jobs-scraper](https://apify.com/jungle_synthesizer/getonbrd-latam-tech-jobs-scraper) | Falta comprobar extracción real y compatibilidad con filtros elegidos |
| linkedin | [curious_coder/linkedin-jobs-scraper](https://apify.com/curious_coder/linkedin-jobs-scraper), [bebity/linkedin-jobs-scraper](https://apify.com/bebity/linkedin-jobs-scraper), [fantastic-jobs/advanced-linkedin-job-search-api](https://apify.com/fantastic-jobs/advanced-linkedin-job-search-api) | Falta comprobar extracción real y compatibilidad con filtros elegidos |
| indeed | [misceres/indeed-scraper](https://apify.com/misceres/indeed-scraper), [borderline/indeed-scraper](https://apify.com/borderline/indeed-scraper), [curious_coder/indeed-scraper](https://apify.com/curious_coder/indeed-scraper) | Falta comprobar extracción real y compatibilidad con filtros elegidos |
| infoempleo | Sin candidato verificado | Requiere proveedor/adaptador específico o acceso autorizado |
| jobtoday | [scrapestorm/jobtoday-jobs-scraper---cheap](https://apify.com/scrapestorm/jobtoday-jobs-scraper---cheap), [delectable_incubator/jobtoday-scraper-low-cost](https://apify.com/delectable_incubator/jobtoday-scraper-low-cost) | Falta comprobar extracción real y compatibilidad con filtros elegidos |
| trabajos | Sin candidato verificado | Requiere proveedor/adaptador específico o acceso autorizado |
| torre | [scrapers_lat/torre-scraper](https://apify.com/scrapers_lat/torre-scraper) | Falta comprobar extracción real y compatibilidad con filtros elegidos |
| weremoto | Sin candidato verificado | Requiere proveedor/adaptador específico o acceso autorizado |
| remotoco | Sin candidato verificado | Requiere proveedor/adaptador específico o acceso autorizado |
| laborum | [serp.cheap.ofc/bumeran-scraper](https://apify.com/serp.cheap.ofc/bumeran-scraper), [blackfalcondata/bumeran-scraper](https://apify.com/blackfalcondata/bumeran-scraper), [shahidirfan/bumeran-jobs-scraper](https://apify.com/shahidirfan/bumeran-jobs-scraper) | Falta comprobar extracción real y compatibilidad con filtros elegidos |
| elempleo | [logiover/elempleo-colombia-job-scraper](https://apify.com/logiover/elempleo-colombia-job-scraper), [corvuslab/elempleo-scraper](https://apify.com/corvuslab/elempleo-scraper) | Falta comprobar extracción real y compatibilidad con filtros elegidos |
| upwork | [neatrat/upwork-job-scraper](https://apify.com/neatrat/upwork-job-scraper), [blackfalcondata/upwork-scraper](https://apify.com/blackfalcondata/upwork-scraper) | Falta comprobar extracción real y compatibilidad con filtros elegidos |
| freelancer | Sin candidato verificado | Requiere proveedor/adaptador específico o acceso autorizado |
| malt | Sin candidato verificado | Requiere proveedor/adaptador específico o acceso autorizado |
| eures | [easyapi/eures-job-scraper](https://apify.com/easyapi/eures-job-scraper), [shahidirfan/eures-job-scraper](https://apify.com/shahidirfan/eures-job-scraper), [nomad-agent/eures-scraper](https://apify.com/nomad-agent/eures-scraper) | Falta comprobar extracción real y compatibilidad con filtros elegidos |
| europe-language | Sin candidato verificado | Requiere proveedor/adaptador específico o acceso autorizado |
| jobsqd | Sin candidato verificado | Requiere proveedor/adaptador específico o acceso autorizado |
| facebook | [apify/facebook-groups-scraper](https://apify.com/apify/facebook-groups-scraper), [apify/facebook-posts-scraper](https://apify.com/apify/facebook-posts-scraper), [scraper_one/facebook-posts-search](https://apify.com/scraper_one/facebook-posts-search), [powerai/facebook-post-search-scraper](https://apify.com/powerai/facebook-post-search-scraper) | Falta comprobar extracción real y compatibilidad con filtros elegidos |
| linkedin-posts | [harvestapi/linkedin-profile-posts](https://apify.com/harvestapi/linkedin-profile-posts), [harvestapi/linkedin-post-search](https://apify.com/harvestapi/linkedin-post-search) | Falta comprobar extracción real y compatibilidad con filtros elegidos |
| skool | [memo23/skool-posts-with-comments-scraper](https://apify.com/memo23/skool-posts-with-comments-scraper) | Falta comprobar extracción real y compatibilidad con filtros elegidos |
| telegram | [tri_angle/telegram-scraper](https://apify.com/tri_angle/telegram-scraper), [lofomachines/telegram-keyword-search-scraper](https://apify.com/lofomachines/telegram-keyword-search-scraper) | Falta comprobar extracción real y compatibilidad con filtros elegidos |
| reddit | [trudax/reddit-scraper-lite](https://apify.com/trudax/reddit-scraper-lite), [fatihtahta/reddit-scraper-search-fast](https://apify.com/fatihtahta/reddit-scraper-search-fast), [harshmaur/reddit-scraper](https://apify.com/harshmaur/reddit-scraper) | Falta comprobar extracción real y compatibilidad con filtros elegidos |
| company | [fantastic-jobs/greenhouse-jobs-api](https://apify.com/fantastic-jobs/greenhouse-jobs-api), [jobo.world/greenhouse-jobs-scraper-api](https://apify.com/jobo.world/greenhouse-jobs-scraper-api), [automation-lab/greenhouse-jobs-scraper](https://apify.com/automation-lab/greenhouse-jobs-scraper) | Falta comprobar extracción real y compatibilidad con filtros elegidos |
| custom | Sin candidato verificado | Requiere proveedor/adaptador específico o acceso autorizado |
| jooble | [agentx/jooble-jobs-scraper](https://apify.com/agentx/jooble-jobs-scraper), [scrapeai/jooble-jobs-scraper](https://apify.com/scrapeai/jooble-jobs-scraper) | Falta comprobar extracción real y compatibilidad con filtros elegidos |
| simplyhired | [shahidirfan/Simplyhired-Job-Scraper](https://apify.com/shahidirfan/Simplyhired-Job-Scraper), [easyapi/simplyhired-job-scraper](https://apify.com/easyapi/simplyhired-job-scraper), [fatihtahta/simplyhired-jobs-scraper](https://apify.com/fatihtahta/simplyhired-jobs-scraper), [thirdwatch/simplyhired-jobs-scraper](https://apify.com/thirdwatch/simplyhired-jobs-scraper) | Falta comprobar extracción real y compatibilidad con filtros elegidos |

## Comunidades y límites

Facebook Groups usa apify/facebook-groups-scraper solo para grupos públicos, últimas diez jornadas mediante fecha relativa, orden cronológico y resultados acotados. El proveedor advierte que la búsqueda sin login por palabra es muy limitada; no se promete filtrar todas las publicaciones antes de descargarlas. Skool privado sigue requiriendo un método autorizado compatible; no se guardan cookies en el Input. Telegram necesita que el Actor admita el canal y un límite compatible.

Las publicaciones sin título solo se clasifican como Closer/Setter/Cold Caller si contienen contratación explícita; autopromoción o búsqueda de empleo de candidatos no se convierte en vacante.

## Evidencia

- [RSS por categoría de WWR](https://weworkremotely.com/remote-job-rss-feed)
- [Filtros de Remotive](https://github.com/remotive-io/remote-jobs-api)
- [Input y límites de Facebook Groups](https://apify.com/apify/facebook-groups-scraper/input-schema)
- [InfoJobs: búsquedas filtradas](https://apify.com/haketa/infojobs-scraper/input-schema)

Preparaciones reales verificadas con metadatos públicos para InfoJobs y Facebook Groups: planes persistidos con caducidad, sin conexiones nuevas ni ejecuciones facturables. 71 backend, 10 Playwright, build/TypeScript y Ruff correctos. Referencias técnicas en source_audit.json y wdc_source_presets.json; scripts/audit_sources.py permite renovar la revisión pública sin credenciales.
