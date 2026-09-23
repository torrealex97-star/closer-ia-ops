# Fuentes y búsquedas para WDC

Actualizado: 2026-09-23. La revisión vigente de métodos, filtros y 51 referencias del Excel está en [SOURCE_ACQUISITION](SOURCE_ACQUISITION.md). El catálogo actual contiene 38 entradas; los recuentos históricos inferiores se conservan como contexto. Integración local, independiente de Scalix.

## Uso

La búsqueda inicial usa «Closers, setters y comercial online», evidencia de español y modalidad remota o híbrida. Incluye bilingües con español mencionado. Europa es una opción de mercado; no se presupone que remoto permita trabajar desde cualquier país. La casilla de datos desconocidos no elimina el requisito explícito de español ni de modalidad.

El catálogo contiene 33 entradas (incluye categorías y una alternativa Apify para Get on Board); no representa 33 conectores directos ni todo internet.

Quince conectores públicos de coste cero: Himalayas, We Work Remotely, Get on Board, Remotive, Remote OK, Arbeitnow, Working Nomads, Virtual Vocations, Remote.jobs, Jobicy (industria Sales, slug `seller`), Remote First Jobs (RSS de ventas), Jobspresso, RemotoJOB (hispano) y los tableros ATS de la watchlist (Greenhouse: Stripe/Typeform/Wallapop · Ashby: Pennylane · Recruitee: Livestorm). Además hay una watchlist de empresas objetivo consultable a diario (migración 5, tablas `company_watchlist`/`watchlist_targets`); ampliarla exige un slug verificado, no se adivinan URLs. Los demás son rutas de integración a validar, priorizadas para España/LATAM. Un enlace a un Actor es referencia de integración, no una garantía de calidad o mantenimiento.

Pendientes con clave propia (no conectadas: la clave la aporta el usuario y el gasto pasa por el presupuesto diario de Apify o por su cuenta del proveedor): Adzuna (app_id/app_key, ES/MX), Jooble (key, ES/LATAM), Careerjet/Opcionempleo (affid), InfoJobs (API oficial restringida a agregadores), Reddit (OAuth para r/forhire), Upwork (OAuth), SerpApi/JSearch (Google for Jobs, de pago). Descartadas por anti-bot o sin feed: Jobgether, Tecnoempleo, Talent.com, Milanuncios, NoDesk, Dynamite Jobs, Remote Rocketship, Lever/SmartRecruiters/Workable sin slug verificado, Personio (429 incluso anónimo).

## Expansión de fuentes solicitada por WDC — 2026-09-23

Se evaluó una lista de ~108 sitios propuesta por WDC (con muchos duplicados y sitios ya integrados). Triaje con verificación en vivo: tres fuentes nuevas con feed público gratuito entraron como conectores; Remote Work Hub se descarta como conector (su /rss solo publica artículos del blog, no ofertas) y GitHub Jobs, Stack Overflow Jobs y AngelList están cerrados. Jobgether, Tecnoempleo, Chumijobs, Glassdoor, Monster, Dice, FlexJobs, Jobrack y OnlyMarketingJobs están vivos pero sin feed público utilizable (Cloudflare o HTML); quedan como rutas Apify opt-in en el catálogo, sin scraping general en el motor.

## Conectar una fuente

1. Fuentes → Conectar o Añadir fuente. Puedes crear varias conexiones para un portal, país o comunidad.
2. Introduce un token de Apify y un Actor ID, o un dataset existente. No se ejecuta nada al guardar.
3. Añade URLs de búsquedas, páginas o comunidades, una por línea. Selecciona el nombre de campo y formato que acepta el Actor. El formato de un solo enlace usa el primero.
4. El Input JSON contiene los criterios de captación: términos, país, remoto y límites según el Actor. La plantilla InfoJobs precarga los términos de WDC y el filtro de teletrabajo según su documentación. Los otros Actors requieren revisar Input/Output; no tienen esquemas intercambiables.
5. Adapta el mapeo de campos con una muestra de salida. Admite rutas como `company.name`. Para posts sin título omite `title`, mapea `description` al texto y `source_url` al permalink. La búsqueda requiere contratación explícita si el perfil solo aparece en la descripción.
6. Guardar → Comprobar para verificar acceso al dataset. Si necesitas nuevos datos, «Ejecutar scraper · puede generar coste» inicia exactamente una llamada POST. Comprobar actualiza el estado y recoge el dataset al terminar.
7. Oportunidades consulta el dataset guardado y aplica los filtros actuales. **Buscar no ejecuta un scraper nuevo.** No modifica dinámicamente el Input guardado del Actor.

Una respuesta incierta bloquea nuevos lanzamientos. Revisa la consola de Apify y después usa «Ya revisé Apify: desbloquear»; la app no reintenta POST de pago. Se envían límites de 90 segundos, resultados y `maxTotalChargeUsd`; la cobertura de este último depende del modelo de cargos del Actor. Los cargos reales se muestran si Apify los devuelve.

## Cobertura y límites

- Get on Board: categoría Sales, hasta tres páginas de 100. No hay nombre de empresa expandido en la respuesta consultada: se muestra «Empresa no indicada». No se infiere unidad/moneda de un importe.
- Remotive: feed cacheado seis horas conforme a su recomendación de pocas consultas al día. Ofertas retrasadas 24 horas por el proveedor; conservar atribución y enlace. Revisar sus condiciones antes de un portal público con login.
- Remote OK: ventana reciente del feed, sin historial completo.
- Arbeitnow: primera página, actualmente 250 registros; principalmente Europa, cobertura hispana variable.
- WWR: hasta 300 registros RSS. Himalayas: consultas por alias con hasta tres páginas por término; no garantiza cobertura exhaustiva.
- Working Nomads: API JSON pública, ~60 registros globales por descarga; sin filtros upstream.
- Virtual Vocations: RSS general de 50 ofertas, mayoritariamente en inglés (US); el filtro de español descarta la mayoría al importar.
- Remote.jobs: RSS de 10 ofertas; el feed sin barra final redirige 301 y el fetch de la app no sigue redirects por diseño.
- Apify: hasta 500 registros de cada dataset por conexión; no es importación ilimitada. HTTP JSON de proveedores distintos de Apify, OAuth y acceso privado con cookies no tienen adaptador propio todavía.
- La detección de español y modalidad es determinista y conservadora. Puede perder ofertas escuetas o ambiguas; no equivale a clasificación semántica validada. Compartir palabras con portugués no basta para declarar español. Revisar residencia, inglés, experiencia, vigencia y condiciones antes de compartir.
- No se filtra por género. La audiencia WDC son mujeres hispanas; eso no convierte las ofertas en exclusivas para mujeres.
- Grupos privados, canales y comunidades solo con acceso autorizado y un proveedor compatible. Listar una comunidad no implica que pueda extraerse anónimamente.
- Los tokens se guardan fuera de SQLite en archivos locales 0600, directorio 0700, junto a la base activa. Nunca se devuelven por API ni se guardan en localStorage. No es cifrado en reposo ni solución multiusuario de producción.
- La configuración de conexión se usa al ejecutar una búsqueda; las capturas originales permanecen inmutables. Versionar configuraciones por búsqueda queda pendiente.

## Referencias verificadas

- [API pública de Get on Board](https://www.getonbrd.com/user-manual/get-on-board-s-api)
- [Remotive: API y condiciones](https://github.com/remotive-com/remote-jobs-api)
- [Remote OK: feed y atribución](https://remoteok.com/faq)
- [Arbeitnow: API e integraciones](https://www.arbeitnow.com/blog/free-job-posting-integrations)
- [API de Apify](https://docs.apify.com/api/v2)
- [InfoJobs: Input y Output del Actor de referencia](https://apify.com/haketa/infojobs-scraper)
- [Computrabajo: Actor de referencia](https://apify.com/haketa/computrabajo-scraper)
- [LinkedIn: Actor de referencia](https://apify.com/curious_coder/linkedin-jobs-scraper)

Se verificaron públicamente los nueve feeds (los tres últimos el 2026-09-23). Los Actors de pago están documentados y probados con fixtures; no se han ejecutado con una cuenta real ni se han consumido créditos.

## Siguiente lote propuesto — investigación en vivo España, 2026-09-23

Sondeo real (HTTP + estructura de respuesta) de ~35 dominios candidatos para España, priorizando señal comercial (closer/setter/comercial/ventas). Resultado verificado, no suposición:

### Tanda 1 — conector propio coste cero (señal máxima España) · IMPLEMENTADA 2026-09-23

| Fuente | Estado | Resultado de la recogida real |
|---|---|---|
| **JobToday** | **Conector en REGISTRY** (3 rutas: `jobtoday` closer-venta, `jobtoday-telemarketing`, `jobtoday-remoto` ventas-remoto). Lee el `__NEXT_DATA__` embebido; salario/ubicación solo si `isValid`/address presentes; fecha de `createDate` (ms) o `postedSecondsAgo`. | 142 leídas, 2 aceptadas por el filtro WDC (Técnico/a Comercial en Venta Directa — Foro Soluciones S.L., Madrid; Business Development Manager — Nara k Skin, Las Rozas). Las demás son Marketing/RRHH/retail: el clasificador conservador no las convierte en ventas. La ruta `/trabajos-setter` devuelve **410 Gone**: sustituida por `telemarketing` (60 leídas). |
| **ClosersAvenue** | Entrada de catálogo informativa: su bolsa interna devuelve **500**; sin listado público extraíble. Requiere Actor opt-in o acceso autorizado. | — |
| **Greenhouse Cabify** | **Alta en watchlist (migración 7)**: board verificado con 14 ofertas de ventas en el sondeo. | 67 leídas en la recogida real; ninguna matchea perfiles WDC en español hoy (SaaS B2B en inglés/hibrido). El board queda vigilado a diario sin coste. |

### Tanda 2 — a confirmar en siguiente sondeo

- **RemotoList** (`remotolist.com`): HTML 200 con un User-Agent real (el probe `CareerPlatform` recibía 000/403); sin feed RSS localizado aún. Buscar su estructura de listado y categoría Ventas.
- **JobToday paginación**: la primera página trae ~18-83 ítems por ruta; paginar y añadir rutas (`comercial`, `ventas`, `appointment-setter`) si la señal lo justifica.
- **EuropeLanguageJobs**: HTML 200 con secciones de hispanohablantes; el RSS devolvió 1.4 KB sin `<item>` — revisar su feed real o listar HTML.
- **WelcometotheJungle ES**: HTML 200 sin `__NEXT_DATA__`; su backend Algolia exige más ingeniería (tier opt-in Apify).

### Descartados en esta pasada (evidencia en vivo, 2026-09-23)

- **Remoters.net**: 403 con UA propio y 200 con UA navegador pero Cloudflare y sin `<item>` en el feed — anti-bot activo; iría por Actor Apify.
- **Tecnoempleo / Infoempleo / Trabajos.com / Jobrapido / Jobgether / Milanuncios / PrimerEmpleo / GlobalRemoteHub**: 403/404 o sin feed público.
- **Trovit**: responde 200 pero devuelve HTML, no RSS; su API de partner requiere acuerdo.
- **EURES**: endpoint de búsqueda sin formato público estable (404 en ambas variantes).
- **Personio**: 307 a login incluso anónimo (Factorial ya no usa Personio); Ashby sin board público para las empresas probadas; SmartRecruiters sin postings para Adevinta/eDreams/Vueling/Glovo (SuccessFactors interno).
- **RankingCloser**: HTML con señal pero tras paywall; sin listado scrapeable gratuito.
- **Salehires**: conexión fallida (000) desde este entorno.
- **Jobicy**: la API existe (200 con 50 ofertas) pero `industry` exige su slug exacto (`sales` fue rechazado: `Invalid industry value`); probar slugs válidos de su lista antes de añadir un filtro en origen.
- **SmartRecruiters/Ashby/Lever**: sin slugs de empresas España con ofertas de ventas verificados; no añadir a la watchlist sin evidencia.

### Criterio aplicado (coherente con ADR-008/ADR-009)

Solo entra como conector coste cero lo verificado en vivo con datos reales. Todo lo bloqueado por anti-bot queda en el catálogo Apify opt-in con presupuesto diario; nada se conecta a ciegas. La integración de JobToday y las altas de watchlist (Typeform/Cabify) son el siguiente incremento de cobertura recomendado.


## Expansión documental US — 2026-09-22

La nueva investigación añade 17 fichas priorizadas en [18_US_HISPANIC_SOURCE_RESEARCH](spec/18_US_HISPANIC_SOURCE_RESEARCH.md). El catálogo ejecutable sigue con 33 entradas y seis conectores públicos; esta entrega no cambia esos recuentos ni activa scrapers.

Prioridad: ATS por empresa (Greenhouse/Lever/Ashby), recruiters LATAM→US (Remote Latinos/HireLATAM/Near), boards hispanos (Hispanic-Jobs/iHispano/DiversityJobs) y fuentes remotas/ventas/comunidades. Acceso y bloqueos documentados por ficha; sin Actors nuevos declarados operativos.

Buscar ES/EN separando US como mercado de clientes de residencia permitida. Español requerido/preferido, inglés, oficina híbrida y autorización laboral son criterios independientes. Admin conserva source/provider/raw; alumna recibe proyección centrada en empresa y condiciones con atribución necesaria.
