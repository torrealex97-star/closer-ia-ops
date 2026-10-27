# Fuentes externas: puesta en marcha

Qué hace cada pieza y qué tiene que hacer el operador. Contexto y riesgos: [ADR-011](decisions/ADR-011-external-sources-tos.md).

## 1. APIs oficiales (InfoJobs, Adzuna, Jooble)
Se recogen solas cada día a las 06:00 UTC y desde el botón «Recoger APIs ahora» (Panel → Fuentes externas).
1. **InfoJobs**: cuenta de desarrollador en developer.infojobs.net → crear aplicación → `client_id` y `client_secret`. En Panel → APIs pega `client_id:client_secret`.
2. **Adzuna**: developer.adzuna.com → `app_id` y `app_key`. Pega `app_id:app_key`. (No se ha podido comprobar desde el entorno de desarrollo que Adzuna cubra España: si «Probar» o la recogida devuelven error, es esto.)
3. **Jooble**: es.jooble.org/api/about → clave. **Cada dominio de país emite su propia clave**: la de jooble.org solo devuelve ofertas de EE. UU., así que para España hay que registrarse en es.jooble.org. El plan gratuito son **500 peticiones por clave en total** (no al mes): cada pasada de recogida gasta 7.
4. Pulsa «Probar» en cada una (no gasta crédito) y luego «Recoger APIs ahora».

## 1 bis. Google Jobs (SerpApi), la fuente que trae closers de España y de LatAm sin clave nueva
Google Jobs indexa InfoJobs, LinkedIn, Computrabajo, Bumerán, OCCMundial y portales, así que es la vía para acercarse al inventario real de closer mientras no haya más claves conectadas.
1. La clave ya conectada en Panel → APIs → SerpApi se usa sola; no hay que guardar nada más.
2. El cron recoge **7 dorks** con su país (`gl`) y en español (`hl`): **4 de España** (`closer de ventas España`, `closer high ticket España`, `setter closer España`, `closer remoto España`) y **3 de LatAm** (`closer de ventas remoto` en México, `closer high ticket` en Colombia, `closer de ventas` en Argentina). Una búsqueda cada uno y **sin paginar** (una segunda página se cobra aparte). Hay 3 dorks más definidos que solo corren si se sube el tope.
3. **Coste**: 0,025 USD por búsqueda → **0,175 USD/día** (≈5,25 USD/mes) en plan de pago; en el plan gratuito salen de las 250 búsquedas/mes. `SERPAPI_JOBS_MAX_DORKS` fija cuántas se lanzan (7 por defecto, 0 apaga, máximo 10). Para gastar más hay que subir esa variable en Vercel → Settings → Environment Variables; el panel muestra el coste por pasada.
4. Sin tiempo en el cron se corta y lo declara (`truncated`); lo ya recogido se guarda y la siguiente pasada continúa.
5. La fuente se pausa como cualquier otra desde Fuentes externas (código `google-jobs`).

## 1 ter. Respaldo por portal: si su API oficial falta, se busca en Google acotado a ese portal
Cuando un portal del SOP no tiene API oficial conectada (sin clave, clave rechazada o caída) se busca su inventario con Google + SerpApi (`site:<portal>`), en su país y en español. Así no queda un mercado sin ofertas porque falte una clave: **la API oficial manda y SerpApi solo cubre el hueco**.
1. **Qué portales** ([serpapiFallback.ts](../apps/web/lib/serpapiFallback.ts)): Computrabajo (`co`), OCCMundial (`mx`), Bumerán (`ar`), BeBee (`es`), e InfoJobs, Indeed, LinkedIn, Adzuna y Jooble. Cada uno tiene su patrón de enlace de oferta: una ficha orgánica que no apunte al anuncio del portal se descarta.
2. **Orden y ahorro**: primero los portales cuya API falta; después los que no tienen ninguna otra vía (LatAm y agregadores); y solo al final los que ya tienen API, y únicamente si esa fuente **no trajo nada en 24 h**. Un portal que ya trajo ofertas ayer no se vuelve a pagar hoy. Una fuente **pausada** no cuenta como ausente ni se busca.
3. **Tope**: `SERPAPI_FALLBACK_MAX_SEARCHES` (4 por defecto, 0 lo apaga, máximo 9). Además se detiene solo cuando el día ya cumplió `DAILY_TARGET_OFFERS` (60 por defecto) o cuando cada búsqueda aportaría más de lo que falta.
4. **Coste**: 0,025 USD por búsqueda → **≤0,1 USD/día** con el tope por defecto, dentro de las mismas 250 búsquedas/mes del plan gratuito que usa Google Jobs (7 + 4 = 11 al día como mucho; el tope diario de ofertas y la regla de 24 h lo bajan en la práctica).
5. **Datos**: de una ficha de Google solo se toman título, enlace y el resumen publicado. **Empresa, ubicación y salario no se inventan**: quedan como «no indicado» salvo que el texto los mencione con una cifra literal. Entra como borrador, como todo lo demás.
6. **Visibilidad**: el panel lo declara en cada recogida (`Computrabajo: 6 guardadas · 1 búsqueda (~0,025 USD)`) y un corte por tiempo se anota como `truncated`.

## 1 quater. Búsquedas gratuitas de closer en el motor cloud (sin clave ni coste)
El motor (`sites/engine/worker.js`, Sites) busca por término en las fuentes gratuitas que ya funcionan: **FreeHire España**, **FreeHire LATAM** y **Himalayas**.
1. **Vocabulario** (`CLOSER_TERMS`, 20 términos): `closer`, `closer remoto`, `remote closer`, `closer de ventas`, `sales closer`, `cierre comercial`, `cierre de ventas`, `cierre de negocios`, `cerrador de ventas`, `high ticket`, `inside sales`, `setter`, `agendador`, `comercial remoto`, `asesor comercial remoto`, `agente comercial remoto`, `ejecutivo comercial remoto`, `ventas remotas`, `closing sales`, `televentas remoto`.
2. **Rotación y presupuesto**: cada pasada usa 6 términos en FreeHire ES, 5 en FreeHire LATAM y 4 en Himalayas (1 petición por término), así el vocabulario completo se recorre en 4–5 días. El techo de subrequests lo comparten los `fetch` y el gasto D1 del propio run, así que la pasada reserva un colchón para D1 (**16 `fetch` por invocación**, medido el 2026-10-26 tras ver morir la invocación con 25). Lo que no cabe se **aplaza declarándolo** y **la pasada siguiente abre por lo aplazado o caído**: no se pierde, se reparte.
3. **Filtro de rol en el origen**: un candidato se ingiere solo si su familia (la misma que calcula el motor) es closer, setter, cold caller o sdr. Se descarta antes de escribir: cada candidato cuesta 6 escrituras de D1 (raw, posting, job, catálogo, oportunidad y versión) y el ruido (dependientes de tienda, ingeniería, becarios) nunca podría salir a la alumna. **La familia AE no entra por aquí**: ya llega por el barrido por categoría de FreeHire, que medía 278 candidatos por pasada, 851 en catálogo, 19 elegibles y 0 closers.
4. **Honestidad de las cifras**: el estado de cada fuente en `/api/status` publica `fetched` y `filtered`; lo descartado no se disfraza de vacío.
5. **Coste**: 0. La cuota que sí se gasta es la mensual de escrituras de D1 del motor; el filtro es lo que la mantiene bajo control.
6. **Qué trajo el primer día** (medido en producción el 2026-10-26): `himalayas-closer` **18 ofertas** (2 closers, 13 setters, 3 SDR) y 29 descartadas en el origen; `freehire-latam-closer`, 55 y 246. Con el vocabulario completo, Himalayas da **42 ofertas y 26 closers**. Ojo: están **en inglés**, así que en la vista por defecto de la alumna no aparecen; sí con la casilla «También oportunidades bilingües». La cuota mensual de **escrituras D1** del motor es un techo real (100.000 filas al mes; medido el 2026-10-27: 100.604, sitio en pausa hasta el reinicio del día 1) y al agotarse el sitio **ni sirve ni recoge**. Desde la sesión 126 el motor lleva su propio registro (`write_ledger`) y una puerta con 15% de margen que **detiene la recogida antes** de que la plataforma pause el sitio: se deja de recoger —declarándolo en `/api/status`, campo `write_allowance`— pero el catálogo ya recogido se sigue sirviendo a la alumna. `force` no salta esa puerta (las dos pasadas forzadas del 26-oct son lo que cruzó el techo). El arreglo está en `main` y **entra en el primer despliegue posterior al reinicio de la cuota**: la plataforma rechaza las subidas mientras el sitio está en pausa.
7. **Por qué no se pagina más** (medido 2026-10-26): las búsquedas vienen ordenadas por fecha y la segunda página de 100 filas trae 0–1 candidatos de perfil y **0 closers** (la mediana de antigüedad pasa de 4 días y en varios términos ya no queda nada dentro de la ventana de 10 días). El tope de 100 por término no recorta closers: recortar la ventana de términos sí los recortaría.

## 1 quinquies. Workana (Apify, proyectos freelance de ventas)
Workana publica proyectos de ventas en España y LatAm; su contrato no es el de un portal de empleo: el importe es un **presupuesto por proyecto**, no un sueldo.
1. **Dónde está**: Panel → Búsqueda automática → «Workana». Actor principal `automation-lab/workana-freelance-projects-scraper` (desde 0,96 USD / 1.000 elementos), con dos repuestos si falla.
2. **Plantilla propia** ([apifyCatalog.ts](../apps/web/lib/apifyCatalog.ts)): `{query, locale: 'es', maxItems, maxPages}`. No se le pasa `country` —el actor espera un código ISO de dos letras y «España» rompería el filtro— y por eso el portal no usa el adaptador genérico.
3. **Primera pasada medida (2026-10-26)**: búsqueda `ventas` en español, tope 100 elementos, 5 páginas → **35 proyectos** (el actor devolvió todo lo que su buscador tenía de esa consulta), **0,0645 USD** reales, 35 guardados como borradores. Reparto: 4 closer + 3 setter + 4 ejecutivo comercial + 24 sin perfil claro (proyectos de marketing, e-commerce o desarrollo que mencionan «ventas»).
4. **Presupuesto**: tope duro de 2 USD por ejecución (0,5 en las pruebas de 10) y 10 USD al mes para todo Apify; el panel muestra el gasto antes de lanzar.
5. **Lo que no se inventa**: un presupuesto por proyecto no se guarda como salario (queda literal en `raw.budget_text`), y el país público del cliente se usa como ubicación cuando el actor lo trae.

## 2. JobSpy (Indeed, LinkedIn, Glassdoor, Google Jobs) en GitHub Actions
1. Genera un token: `openssl rand -hex 32`.
2. Vercel → proyecto → Settings → Environment Variables: `INGEST_TOKEN` = ese token (Production).
3. GitHub → repo → Settings → Secrets and variables → Actions: `INGEST_TOKEN` = el mismo token e `INGEST_URL` = `https://app.womendigitalclosers.com/api/ingest`.
4. Actions → «JobSpy collect» → Run workflow (o espera a las 05:17 UTC). Las ofertas aparecen como borradores en Panel → Fuentes externas.
Los runners de GitHub a veces son bloqueados por LinkedIn/Indeed: un fallo aparece en el log del workflow y en el aviso de la entrada, y no afecta al resto.

## 3. Variables de entorno (Vercel, producción)
`SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` o `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (integración de Supabase), `CAREER_ENGINE_URL`, `CAREER_ADMIN_TOKEN`, `CRON_SECRET` (autoriza el cron), `INGEST_TOKEN` (autoriza el recolector de GitHub), opcional `ADMIN_SECRETS_KEY`. Opcionales de la recogida de Google Jobs: `SERPAPI_JOBS_MAX_DORKS` (7 por defecto; 0 apaga) y `SERPAPI_FALLBACK_MAX_SEARCHES` (4 por defecto; 0 apaga el respaldo por portal), más `DAILY_TARGET_OFFERS` (60) para el objetivo diario.

## 4. Control diario
- **Pausar/reanudar** una fuente: Panel → Fuentes externas → tabla de fuentes (solo propietario). Pausada = no se recoge, no se acepta y no se muestra.
- **Vigencia**: cada día el cron revisa las aprobadas y retira las cerradas en origen. LinkedIn/Indeed suelen bloquear la comprobación («no verificable»): esas se mantienen.
- **Exportar**: botón «Exportar CSV» en Probar ofertas y en Fuentes externas.

## 5. Notas de JobSpy (revisado el código de speedyapply/JobSpy)
- El workflow instala un **commit fijado** del repositorio (`1988484`, 2026-10-14), más reciente que PyPI 1.3.0. Para actualizar, revisa los cambios y cambia el SHA en el workflow.
- El país se pasa con `country_indeed='Spain'` (aplica a Indeed y Glassdoor). El nombre de parámetro importa: la versión de GitHub falla con otro nombre y PyPI lo ignoraría y buscaría en EE. UU.
- Indeed busca también en la descripción: se usa **frase exacta** entre comillas. LinkedIn usa `location='Spain'` y descarga la descripción (una petición extra por oferta; se desactiva con la variable `LINKEDIN_FETCH_DESCRIPTION=0`).
- JobSpy informa en `attrs['errors']`/`attrs['warnings']` de qué sitio falló: el recolector lo recoge y lo envía como nota de la entrada, para distinguir «bloqueado» de «sin ofertas».
- LinkedIn limita ráfagas (429) y los runners de GitHub pueden ser bloqueados: el secreto opcional `JOBSPY_PROXIES` (proxies separados por coma) se pasa a JobSpy.
- JobSpy solo extrae salario del texto para EE. UU.; aquí se rescata la frase literal en euros con periodo o bruto/neto (`lib/salary.ts`).
- **Actor de Apify `aakash19/jobspy`** (envoltorio de pago de JobSpy, comunidad, 1 usuario mensual): no se ha integrado. Pros: proxies de Apify, sin bloqueo de IP de GitHub. Contras: coste por uso de plataforma, esquema de entrada no documentado en su ficha y un único mantenedor. Si se quiere, se conecta desde la app local (Fuentes → Apify guiado, que descubre el esquema de entrada) o se añade aquí como fuente de pago desactivada por defecto.

## 6. Apify: scraping a escala sin proxies propios (de pago por uso)
Los actores de Apify corren en la infraestructura de Apify, que ya incluye sus proxies: no hay que montar nada y no se bloquea tu IP. Es la vía para reunir miles de ofertas.
1. **Clave**: Panel → APIs → Apify (token de Apify). Pon también un **límite de gasto en Apify** (Settings → Billing); la app añade su propio tope mensual (`APIFY_MONTHLY_BUDGET_USD`, 10 USD por defecto).
2. **Actor**: Panel → Apify → «Añadir actor» (hay un preajuste con `aakash19/jobspy`). Sin plantilla de entrada, la app lee el esquema del actor y rellena búsqueda, ubicación (España), número de resultados, antigüedad (10 días), país y sitios. Si el actor exige campos que no conoce, pega una **plantilla** con marcadores `{{query}}`, `{{location}}`, `{{country}}`, `{{max_items}}`, `{{hours_old}}`, `{{sites}}`. Cualquier actor que devuelva ofertas sirve: el mapeo reconoce los nombres habituales de campos (título, empresa, ubicación, enlace, salario, descripción, fecha).
3. **Límites por ejecución**: máximo de elementos, memoria y tiempo. **Lanzar ahora** (propietario) o «Lanzar cada día» (cron de las 06:00 UTC, una vez al día).
4. **Resultados**: al terminar, Apify avisa por webhook (`/api/apify/webhook`, con token derivado de `CRON_SECRET`) y se recogen por lotes de 300; si no da tiempo, continúa con «Recoger resultados» o el cron. Entran como borradores puntuados en Fuentes externas; el coste real de cada ejecución se suma al gasto del mes.
5. **Presupuesto**: no se lanza nada si el gasto del mes más 1 USD de reserva supera el tope.

## 7. Filtrar miles de ofertas
En Fuentes externas los filtros (estado, perfil, fuente, España, puntuación mínima, búsqueda, orden) y la paginación se hacen **en el servidor**. Cada oferta lleva una **puntuación 0-100** (perfil por título, España explícita, sueldo publicado, comisiones, frescura, calidad del texto) y una **huella** que une el mismo anuncio llegado por varias fuentes (se anota «también en …»). «Aprobar las N mejores» aprueba los borradores que cumplen los filtros por orden de puntuación; es reversible.

## 8. Cualificación automática: solo lo dudoso llega a tu cola
1. **Reglas primero** ([autoReview.ts](../apps/web/lib/autoReview.ts), mismo camino en el cron y en el botón «Aprobar las claras»): se aprueba sola la oferta que tiene **perfil comercial**, **mercado deducido**, **texto en español** (≥3 palabras), **puntuación ≥ 55**, **ninguna bandera roja** y **enlace no cerrado**. Lo que falle una condición se queda en borrador: esa es la cola de excepciones.
2. **Tope de 100 al día** (UTC), contado en la base (`reviewed_by='auto-reglas'`). Si no se puede leer el contador, no se aprueba nada: el tope es una garantía. La escritura lleva la guarda `editorial_status=eq.draft`, así que no pisa lo que una persona movió entretanto, y se cuenta lo que la base confirma (`return=representation`).
3. **La IA desempata solo si se enciende**: con `AI_REVIEW_MODE=live` y clave de Groq, las dudosas pasan por el revisor con umbral alto (confianza ≥ 85, puntuación ≥ 80, enlace vivo) y su cuota también descuenta de las 100. En `shadow` (por defecto) la IA solo anota y las dudosas esperan a una persona. Encenderlo es cambiar esa variable en Vercel.
4. **Motivo guardado**: cada aprobación automática guarda `auto_review` (`cumple_reglas`) y cada descarte su motivo (`sin_perfil`, `sin_mercado`, `idioma_dudoso`, `score_bajo`, `banderas_rojas`, `enlace_cerrado`, `mercado_dudoso`, `tope_diario`), visible en el panel al filtrar por «Cola humana».

## 9. Mercado y moneda, y cómo aplicar
- **Mercado** ([market.ts](../apps/web/lib/market.ts)): manda la ubicación (gazetteer de municipios incluido). Si no dice nada útil —«Remoto» a secas no es un país—, decide el importe: **€ ⇒ España/Europa**, **$ ⇒ dólares (LatAm y EE. UU.)**. Se guarda `market` + `market_basis` y la tarjeta declara el motivo en el panel.
- **Candidatura**: `apply_url` es el enlace de candidatura que publica la fuente (SerpApi lo entrega en `apply_options`); si no existe, se usa el anuncio. `company_url` solo aparece si el texto del anuncio publica una web que **no** es un portal de empleo; no se deduce ni se completa. La tarjeta de la alumna pone «Aplicar en <dominio>» y, en el detalle, la web publicada.
- **Contacto**: se guarda `contact` (máximo 2 correos y 2 teléfonos) **solo si el anuncio lo publica**, y se muestra con la nota de que WDC no lo verifica. El texto de la descripción sigue anonimizado.

## 10. Fuentes del SOP que aún no se recogen
El panel de Fuentes externas lista, plegado, las fuentes del SOP diario de WDC con su encaje, su coste y su vía: conector activo, «añadir pegando su búsqueda» (asistente de fuentes) o manual. Solo se incluyen URL reales del documento; las que el SOP marca como «asumido» quedan fuera hasta comprobarlas. Las comunidades (Facebook, Telegram, Skool) exigen sesión personal y no se automatizan: son ritual diario de la alumna.

## 11. Revisor IA (shadow)
Variables opcionales (Vercel): `AI_REVIEW_ENABLED` (`false` apaga), `AI_REVIEW_MODE` (`live` decide; por defecto shadow), `AI_REVIEW_MODEL`, `AI_REVIEW_MAX_CALLS` (15), `AI_REVIEW_MAX_APPROVALS` (25), `AUTO_PUBLISH` (`true` publica), `JEV_API_KEY`/`JEV_API_URL` (anotación opcional). Necesita la clave de Groq en Panel → APIs. En shadow no cambia ningún estado; mira la columna «Revisor IA» y el filtro «Cola humana» en Fuentes externas. Detalle en STATUS (sesión 41).
