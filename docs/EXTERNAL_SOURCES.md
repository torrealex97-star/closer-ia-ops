# Fuentes externas: puesta en marcha

Qué hace cada pieza y qué tiene que hacer el operador. Contexto y riesgos: [ADR-011](decisions/ADR-011-external-sources-tos.md).

## 1. APIs oficiales (InfoJobs, Adzuna, Jooble)
Se recogen solas cada día a las 06:00 UTC y desde el botón «Recoger APIs ahora» (Panel → Fuentes externas).
1. **InfoJobs**: cuenta de desarrollador en developer.infojobs.net → crear aplicación → `client_id` y `client_secret`. En Panel → APIs pega `client_id:client_secret`.
2. **Adzuna**: developer.adzuna.com → `app_id` y `app_key`. Pega `app_id:app_key`. (No se ha podido comprobar desde el entorno de desarrollo que Adzuna cubra España: si «Probar» o la recogida devuelven error, es esto.)
3. **Jooble**: es.jooble.org/api/about → clave. **Cada dominio de país emite su propia clave**: la de jooble.org solo devuelve ofertas de EE. UU., así que para España hay que registrarse en es.jooble.org. El plan gratuito son **500 peticiones por clave en total** (no al mes): cada pasada de recogida gasta 7.
4. Pulsa «Probar» en cada una (no gasta crédito) y luego «Recoger APIs ahora».

## 2. JobSpy (Indeed, LinkedIn, Glassdoor, Google Jobs) en GitHub Actions
1. Genera un token: `openssl rand -hex 32`.
2. Vercel → proyecto → Settings → Environment Variables: `INGEST_TOKEN` = ese token (Production).
3. GitHub → repo → Settings → Secrets and variables → Actions: `INGEST_TOKEN` = el mismo token e `INGEST_URL` = `https://app.womendigitalclosers.com/api/ingest`.
4. Actions → «JobSpy collect» → Run workflow (o espera a las 05:17 UTC). Las ofertas aparecen como borradores en Panel → Fuentes externas.
Los runners de GitHub a veces son bloqueados por LinkedIn/Indeed: un fallo aparece en el log del workflow y en el aviso de la entrada, y no afecta al resto.

## 3. Variables de entorno (Vercel, producción)
`SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` o `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (integración de Supabase), `CAREER_ENGINE_URL`, `CAREER_ADMIN_TOKEN`, `CRON_SECRET` (autoriza el cron), `INGEST_TOKEN` (autoriza el recolector de GitHub), opcional `ADMIN_SECRETS_KEY`.

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

## 8. Revisor IA (shadow)
Variables opcionales (Vercel): `AI_REVIEW_ENABLED` (`false` apaga), `AI_REVIEW_MODE` (`live` decide; por defecto shadow), `AI_REVIEW_MODEL`, `AI_REVIEW_MAX_CALLS` (15), `AI_REVIEW_MAX_APPROVALS` (25), `AUTO_PUBLISH` (`true` publica), `JEV_API_KEY`/`JEV_API_URL` (anotación opcional). Necesita la clave de Groq en Panel → APIs. En shadow no cambia ningún estado; mira la columna «Revisor IA» y el filtro «Cola humana» en Fuentes externas. Detalle en STATUS (sesión 41).
