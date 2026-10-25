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

## 8. Cualificación automática: la IA clasifica y solo lo complejo llega a tu cola
1. **Reglas primero** ([autoReview.ts](../apps/web/lib/autoReview.ts), mismo camino en el cron y en el botón «Clasificar borradores»): se aprueba sola la oferta que tiene **perfil comercial**, **mercado deducido**, **texto en español** (≥3 palabras), **puntuación ≥ 55**, **ninguna bandera roja** y **enlace no cerrado**. Una página de resultados de un portal («Ofertas de trabajo de…») o un enlace cerrado **no se aprueba ni espera a nadie**: se retira con su motivo.
2. **La IA lee lo dudoso** ([aiReview.ts](../apps/web/lib/aiReview.ts)): las ofertas con perfil y mercado que podrían mostrarse pero no llegan a la puntuación (o cuyo idioma no se puede confirmar) se envían al modelo con el anuncio literal, la ubicación y el mercado detectado. El modelo devuelve `approve` (confianza ≥ 85, empresa identificable, puesto de cierre real, accesible en España/LatAm/dólares), `reject` (no es un puesto de cierre, MLM/pago por adelantado, puesto local de EE. UU. con residencia obligatoria…) o `human` (texto contradictorio o insuficiente). Aprobar exige además **enlace vivo**; una bandera roja del modelo bloquea siempre.
3. **Qué queda en la cola humana**: solo lo que la IA declara dudoso, lo que impugna una bandera roja, lo que no tiene perfil/mercado suficiente para poder mostrarse y la **muestra de auditoría del 10 %**. Esas ofertas pasan a `needs_review` y son la vista por defecto del panel de Fuentes externas. Ya no se queda nada en borrador «sin dueño».
4. **Tope único de 100 aprobaciones al día** (UTC), contando **reglas e IA juntas** (`reviewed_by='auto-reglas'` + `ai-review`). Si no se puede leer el contador, no se aprueba nada: el tope es una garantía. Cada escritura lleva la guarda `editorial_status=eq.draft` y se cuenta lo que la base confirma (`return=representation`). Las retiradas tienen su propio tope por ejecución (150) y se deshacen con «Deshacer las de la IA».
5. **Motivo guardado**: cada aprobación automática guarda `auto_review` (`cumple_reglas` / `no_encaja`) y cada oferta revisada por la IA guarda `ai_review` (veredicto, confianza, razones, enlace, decisión, `applied`, estado previo). Los motivos (`sin_perfil`, `sin_mercado`, `idioma_dudoso`, `score_bajo`, `banderas_rojas`, `enlace_cerrado`, `mercado_dudoso`, `no_es_oferta`, `ia_duda`, `tope_diario`…) se ven al filtrar por «Cola humana».
6. **Si el modelo falla, se declara**: `skipped`/`failed_calls` en el resumen y `ia_fallos`/`ia_sin_proveedor` en el motivo. Un proveedor caído no aprueba por suposición ni se disfraza de «0 revisadas».

## 9. Mercado y moneda, y cómo aplicar
- **Mercado** ([market.ts](../apps/web/lib/market.ts)): manda la ubicación (gazetteer de municipios incluido). Si no dice nada útil —«Remoto» a secas no es un país—, decide el importe: **€ ⇒ España/Europa**, **$ ⇒ dólares (LatAm y EE. UU.)**. Se guarda `market` + `market_basis` y la tarjeta declara el motivo en el panel.
- **Candidatura**: `apply_url` es el enlace de candidatura que publica la fuente (SerpApi lo entrega en `apply_options`); si no existe, se usa el anuncio. `company_url` solo aparece si el texto del anuncio publica una web que **no** es un portal de empleo; no se deduce ni se completa. La tarjeta de la alumna pone «Aplicar en <dominio>» y, en el detalle, la web publicada.
- **Contacto**: se guarda `contact` (máximo 2 correos y 2 teléfonos) **solo si el anuncio lo publica**, y se muestra con la nota de que WDC no lo verifica. El texto de la descripción sigue anonimizado.

## 10. Fuentes del SOP que aún no se recogen
El panel de Fuentes externas lista, plegado, las fuentes del SOP diario de WDC con su encaje, su coste y su vía: conector activo, «añadir pegando su búsqueda» (asistente de fuentes) o manual. Solo se incluyen URL reales del documento; las que el SOP marca como «asumido» quedan fuera hasta comprobarlas. Las comunidades (Facebook, Telegram, Skool) exigen sesión personal y no se automatizan: son ritual diario de la alumna.

## 11. Revisor IA y cualificación automática
Variables opcionales (Vercel): `AI_REVIEW_ENABLED` (`false` apaga), `AI_REVIEW_MODE` (`live` aplica en la revisión manual; por defecto `shadow`, que solo anota), `AI_AUTO_QUALIFY` (`false` devuelve las dudosas a la cola humana en vez de que decida la IA), `AI_REVIEW_MODEL` (por defecto `openai/gpt-oss-20b`; `llama-3.3-70b-versatile` es Enterprise y fallaba), `AI_REVIEW_MAX_CALLS` (60), `AI_REVIEW_MAX_APPROVALS` (25 por ejecución), `AI_REVIEW_MAX_WITHDRAWALS` (150), `AI_REVIEW_CONCURRENCY` (6), `AUTO_PUBLISH` (`true` publica en vez de aprobar), `JEV_API_KEY`/`JEV_API_URL` (anotación opcional). Necesita la clave de Groq en Panel → APIs.

La **cualificación automática** (botón «Clasificar borradores» y cron) aplica las decisiones de la IA con guarda de estado y estado previo, aunque la revisión manual siga en `shadow`: son dos caminos distintos y se pueden deshacer por separado. En el panel, la columna «Revisor IA» muestra el veredicto y la decisión aplicada; el filtro «Cola humana» deja solo las excepciones. Detalle y evidencias en STATUS (sesiones 41 y 90).
