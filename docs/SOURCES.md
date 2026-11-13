# Fuentes y búsquedas para WDC

Actualizado: 2026-11-13. Los recuentos de esta cabecera y de la sección «Estado real» están **medidos** contra el código (`sites/engine/worker.js`, `apps/web/lib/sourceCatalog.json`) y contra los servicios; los recuentos de las secciones antiguas (33, 38, «quince conectores») se conservan como contexto histórico y **no son el estado actual**. La revisión de métodos, filtros y 51 referencias del Excel sigue en [SOURCE_ACQUISITION](SOURCE_ACQUISITION.md). Integración local, independiente de Scalix.

## Estado real — medido el 2026-11-13

- **Catálogo del panel: 63 entradas.** De ellas, **36** están marcadas `requires: input` («Requiere configurar») y 27 no piden configuración (25 recogidas y 2 libres sin conector).
- **Motor cloud: 36 conectores** (`SOURCES`). Una pasada completa declara **109 subrequests de fetch** (tope 1.000 con Workers de pago; 50 en el plan gratuito, donde el planificador aplaza fuentes en vez de romper). El salto desde 79 es el plan B de FreeHire: tres páginas de datos por término cuando su API responde 429.
- **25 entradas del catálogo tienen recogida ahora.** Las 36 fuentes del motor se agrupan por portal, así que las cifras no coinciden: JobToday son 13 conectores y FreeHire 4; el panel los suma en una fila.
- **Sin duplicados engañosos (corregido el 2026-11-13)**: `getonbrd` era una segunda entrada del mismo portal que el motor recoge como `getonbrd-public` y se pintaba «Requiere configurar»; se eliminó. `freelancer` y `jobgether` se recogían pero su ficha seguía diciendo «Adaptador pendiente / Sin proveedor verificado»: ahora dicen «Conector operativo». Un test (`tests/engine/catalog.mjs`) falla si vuelve a pasar cualquiera de las dos cosas.
- **2 entradas gratuitas sin conector hoy**: dos feeds muertos, Remote.jobs (301) y Remote First Jobs (404).
- **Cinco tableros ATS retirados el 2026-11-13** por cero elegibles en dos mediciones independientes: Holded · Recruitee, Monest Capital · Teamtailor, Typeform · Greenhouse, Wallapop · Greenhouse y Livestorm · Recruitee (23 ofertas entre los cinco, ninguna publicable nunca). Responden 200 y cuestan una petición, así que volver a conectarlos es re-añadir su fila; el criterio de retirada está en STATUS (sesión 172).

### Gratis y conectadas (36 conectores, coste cero)

| Portal | Conectores | Cómo se lee | Coste por pasada |
|---|---|---|---|
| JobToday (ES) | 13 | `__NEXT_DATA__` de `/es/trabajos-<slug>`: 7 búsquedas nacionales, 2 barridos por ciudad y 4 slugs reintroducidos el 2026-11-12 (telemarketing, ventas-remoto, ventas, comercial) | 11 + rutas de ciudad |
| FreeHire (ES/LATAM/global) | 4 | API v1 pública (`/api/v1/jobs/search`) y, si esa responde 429, la ruta de datos de su web (`/jobs/__data.json`, formato `devalue`): el límite es **por IP**, no por clave | 14/6/26/22 (declara reintentos y tres páginas de plan B) |
| Himalayas | 1 | consultas por alias (`q`) | 1 |
| Get on Board | 1 | API pública, categoría Sales | 2 |
| Remotive · Jobicy · Working Nomads · Jobspresso · RemotoJOB · We Work Remotely · Remote OK · Arbeitnow · Virtual Vocations | 9 | RSS o JSON públicos | 1 cada uno |
| Freelancer.com | 1 | API pública de proyectos (encargos, no empleos) | 1 |
| Jobgether | 1 | feed público | 1 |
| ATS por empresa | 6 | Greenhouse (Fever, Stripe, Cabify), Ashby (Qonto, Pennylane), Teamtailor (ProductHackers) | 1 cada uno |

FreeHire necesita una nota aparte porque es la mayor fuente de volumen y la más frágil: su API limita **por IP de origen** (2.000 peticiones, `retry-after` que llegó a 62.740 s) y el Worker sale por las IPs de egreso compartidas de Cloudflare. Cuando ese pozo común se agota, la API devuelve 429 durante horas aunque su web siga viva: por eso el conector pide la ruta de datos de la web (200, 20 ofertas por página, con descripción y país) y lo declara en la nota del run. Medido el 2026-11-13: **237 filas** recuperadas en una pasada y **149 publicables** en la activación en seco.

Ninguno de estos 41 pide clave, cuenta ni pago. Los ATS se amplían con un slug **verificado** (`boards-api.greenhouse.io/v1/boards/<slug>/jobs` debe devolver 200); un 401/404 no se adivina, se descarta.

### Gratis pero fuera del motor hoy (2)

| Entrada | Estado medido el 2026-11-13 | Qué falta |
|---|---|---|
| `remotejobs` | 301 sin `Location` útil; `/rss` no devuelve feed | feed inexistente: solo Actor de pago |
| `remotefirstjobs` | 404 en `/feed` | feed inexistente: solo Actor de pago |

### Exige clave o acuerdo (2)

| Entrada | Requisito | Por qué no está conectada |
|---|---|---|
| `infojobs` | acuerdo de agregación con InfoJobs (API solo para agregadores) | sin acuerdo la API responde 405/403 al Worker; no hay clave que pedir en el panel |
| `jooble` | clave gratuita por email (`jooble.org/api/about`) | además su endpoint responde 403 al Worker desde 2026-09-23 (Cloudflare): la clave no basta |

Adzuna (app_id/app_key, gratis con registro) y Careerjet/Opcionempleo (affid) se documentaron como rutas de clave en 2026-09-23, pero **no están en el catálogo actual**; si se añaden, entran por esta misma vía.

### De pago: Actor de Apify (opt-in, 34 entradas)

Bloqueados por anti-bot, login o HTML sin feed; cada uno necesita un Actor con token propio y gasta crédito por resultado:
`simplyhired`, `computrabajo`, `workana`, `linkedin`, `indeed`, `infoempleo`, `trabajos`, `torre`, `weremoto`, `remotoco`, `laborum`, `elempleo`, `upwork`, `malt`, `eures`, `europe-language`, `jobsqd`, `facebook`, `linkedin-posts`, `skool`, `telegram`, `reddit`, `company`, `custom`, `tecnoempleo`, `talent`, `milanuncios`, `primer-empleo`, `jobfluent`, `welcomejungle`, `closers-avenue`, `google`, `remotolist`, `domestika`.

Con evidencia de bloqueo o cierre, no solo «sin conector»: Workana 403 de Cloudflare, Talent y Tecnoempleo 404, Milanuncios 403, Infoempleo 403, EURES sin endpoint público estable (404), ClosersAvenue 500 en su bolsa, Welcome to the Jungle exige Algolia, RemotoList sin feed y LinkedIn/Indeed con login o captcha. Google for Jobs se cubre con SerpApi/JSearch (de pago), no con scraping propio. El gasto de Apify es opt-in: estimación antes de ejecutar, aviso por encima de 5 USD y confirmación explícita por encima de 20 USD.

**Criterio**: solo entra en el motor lo verificado en vivo, gratis y con datos reales ese día; todo lo demás queda en el catálogo con su requisito escrito, y el panel dice qué falta y cómo se conecta. Un estado de bloqueo medido ayer no se copia: se vuelve a medir antes de documentarlo como operativo.

## Uso

## Uso

La búsqueda inicial usa «Closers, setters y comercial online», evidencia de español y modalidad remota o híbrida. Incluye bilingües con español mencionado. Europa es una opción de mercado; no se presupone que remoto permita trabajar desde cualquier país. La casilla de datos desconocidos no elimina el requisito explícito de español ni de modalidad.

Desde el 2026-11-13 también entran los **anuncios escritos en inglés que exigen español** («Spanish speaker», «Spanish speaking», «bilingual Spanish», «fluent in Spanish», «español requerido»). Se aceptan con etiqueta explícita en la tarjeta —«Anuncio en inglés · exige español»— para que nadie lea un anuncio en inglés creyendo que es en español. No basta con que aparezca «Spanish» suelto junto al nombre de la empresa o de la oficina: la palabra tiene que ir con una exigencia a menos de 30 caracteres. Un anuncio en portugués no entra nunca, ni pidiendo español.

Además hay una watchlist de empresas objetivo consultable a diario (migración 5, tablas `company_watchlist`/`watchlist_targets`); ampliarla exige un slug verificado, no se adivinan URLs. Un enlace a un Actor es referencia de integración, no una garantía de calidad o mantenimiento.

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
- WWR: feed de ventas con hasta 100 registros medidos el 2026-11-12. Himalayas: consultas por alias con hasta tres páginas por término; no garantiza cobertura exhaustiva.
- Working Nomads: API JSON pública, ~60 registros globales por descarga; sin filtros upstream.
- Virtual Vocations: RSS general de **10** ofertas por pasada (medido el 2026-11-12), mayoritariamente en inglés (US); el filtro de español descarta la mayoría al importar.
- Remote.jobs: su `/rss` responde 301 sin feed útil y Remote First Jobs 404 (medido el 2026-11-13): no hay conector gratuito, quedan como Actor opt-in.
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

Solo entra como conector coste cero lo verificado en vivo con datos reales. Todo lo bloqueado por anti-bot queda en el catálogo Apify opt-in con presupuesto diario; nada se conecta a ciegas. La integración de JobToday y las altas de watchlist con volumen (Fever, Cabify) siguen siendo el siguiente incremento de cobertura recomendado.


## Expansión documental US — 2026-09-22

La nueva investigación añade 17 fichas priorizadas en [18_US_HISPANIC_SOURCE_RESEARCH](spec/18_US_HISPANIC_SOURCE_RESEARCH.md). El catálogo ejecutable seguía con 33 entradas y seis conectores públicos **cuando se escribió esta sección (2026-09-22)**; los recuentos vigentes están en «Estado real — medido el 2026-11-13» (36 conectores, 63 entradas). Esta entrega no cambió los recuentos de entonces ni activó scrapers.

Prioridad: ATS por empresa (Greenhouse/Lever/Ashby), recruiters LATAM→US (Remote Latinos/HireLATAM/Near), boards hispanos (Hispanic-Jobs/iHispano/DiversityJobs) y fuentes remotas/ventas/comunidades. Acceso y bloqueos documentados por ficha; sin Actors nuevos declarados operativos.

Buscar ES/EN separando US como mercado de clientes de residencia permitida. Español requerido/preferido, inglés, oficina híbrida y autorización laboral son criterios independientes. Admin conserva source/provider/raw; alumna recibe proyección centrada en empresa y condiciones con atribución necesaria.
