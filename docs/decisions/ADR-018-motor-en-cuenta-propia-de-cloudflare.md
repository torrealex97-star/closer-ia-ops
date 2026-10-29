# ADR-018 — El motor en una cuenta propia de Cloudflare (plan de pago)

- **Estado**: preparado, **no ejecutado**. El corte necesita la orden del dueño (cuenta y gasto nuevos).
- **Fecha**: 2026-10-28.
- **Relacionado**: [ADR-017](ADR-017-forma-de-escritura-del-catalogo.md) (forma de escritura), [ADR-016](ADR-016-avisos-del-motor-por-correo.md) (aviso cuando el motor se para).

## Contexto

El motor (Worker + D1) vive hoy en el hosting gestionado de Freebuff Sites. El 2026-10-27 la
plataforma lo pausó **entero** —todas las rutas, también las lecturas de la alumna— porque
`d1Writes` llegó a **100.604 de 100.000 filas escritas al mes**; las peticiones iban por 2.251 de
100.000 y las lecturas por 10,7 M de 50 M: no fue el tráfico, fueron las escrituras. La pausa se
levanta el **1 de noviembre**.

El motor ya se para antes de que lo pare la plataforma (guardián propio con registro en
`write_ledger`, sesión 126) y ya escribe barato (ADR-017). Pero el techo sigue siendo del plan: con
la forma nueva, 100.000 filas dan para **~9.000 candidatos nuevos al mes** (de 18 a 11 filas por
candidato), y el objetivo del producto es recoger sin recortar.

La capa de debajo de Sites es Cloudflare. En **cuenta propia** con **Workers Paid (5 USD/mes por
cuenta)** el D1 incluye **50 millones de filas escritas al mes** (500×), 25.000 millones de lecturas,
5 GB de almacenamiento, 10 M de peticiones y 30 M de ms de CPU; los excesos van a 1 USD por millón
de filas escritas, 0,001 USD por millón de lecturas y 0,75 USD por GB-mes. Con el gasto real del
motor (~100.000–300.000 escrituras/mes, 47,8 MB, 2.251 peticiones) **no hay ningún exceso**: es el
fijo de 5 USD/mes.

Fuentes (consultadas el 2026-10-28): [precios de Workers](https://developers.cloudflare.com/workers/platform/pricing/),
[precios de D1](https://developers.cloudflare.com/d1/platform/pricing/),
[límites de D1](https://developers.cloudflare.com/d1/platform/limits/),
[subrequests por invocación](https://developers.cloudflare.com/changelog/post/2026-02-11-subrequests-limit/).

## Decisión

1. **Mover el motor a una cuenta propia de Cloudflare con Workers Paid**, dejando el despliegue
   gestionado intacto como camino de vuelta. El código del Worker no cambia de proveedor: se
   despliega el mismo `sites/engine/worker.js` con la misma fecha de compatibilidad.
2. **El guardián de cuota pasa a ser configurable por entorno**, para que el techo suba con el plan
   y no con un despliegue de código: `WRITE_ALLOWANCE_MONTH`, `WRITE_ALLOWANCE_DAY` (0 = sin freno
   diario) y `WRITE_GUARD_RATIO`. Sin variables, los defectos siguen siendo los del plan gratuito.
3. **Los datos se sacan por la ruta `/api/export` del propio motor** (nueva, solo `ADMIN_TOKEN`,
   solo lectura, paginada por clave) y se importan con `wrangler d1 execute`. La cuenta gestionada no
   expone credenciales de Cloudflare, así que `wrangler d1 export` no es una opción.
4. **La base nueva se crea vacía y con la forma barata**: el esquema lo crea el propio Worker
   (`ensureSchema` al primer `/api/status`) y después se importan **solo datos**. Así no hay que
   migrar la forma de escritura en la cuenta nueva: nace con 11 filas por candidato.

## Qué NO se mueve

- `write_ledger` **no se exporta**: mide lo escrito en **esta** cuenta y heredarlo contaría como
  gastado lo que la cuenta nueva todavía no ha escrito. La cuota nueva empieza en cero.
- `schema_version` no se importa: lo escribe `ensureSchema`.
- Las variables de Vercel y las claves de Supabase no cambian de forma; solo cambian **sus valores**
  (URL y token del motor).

## Datos a mover

| Tabla | Qué es | ¿Irreemplazable? |
| --- | --- | --- |
| `raw_items` | evidencia cruda de cada anuncio (payload + hash) | sí, es la evidencia inmutable |
| `job_postings` | el anuncio normalizado que leen el panel y la búsqueda | sí (de aquí sale el texto que ve la alumna) |
| `jobs` | marca de «guardada» por el operador | sí (estado de uso) |
| `catalog_entries` | vigencia (10 días) y primera vez visto | sí (decide qué se sirve) |
| `opportunities` | estado editorial: aprobada, publicada, retirada | **sí, es el trabajo editorial** |
| `opportunity_versions` | versiones inmutables y quién revisó | **sí, procedencia** |
| `collection_runs` | historial de pasadas y estado por fuente | no (se regenera al recoger) |
| `verification_events` | evidencia de verificación de vigencia | no (append-only, se regenera) |
| `slug_audit` | audit diario de slugs de JobToday | no (se regenera el mismo día) |

Coste de la importación: **no es 1 fila escrita por fila importada**, porque cada índice que se toca
también se paga; la forma barata medida da **~1,8 filas por fila de datos**. Con el plan de pago (50 M)
es irrelevante; en el plan gratuito de una cuenta propia habría que trocear la importación por debajo
de las 100.000 filas al día. Por eso el corte se hace **con el plan de pago ya activo**.

Las ofertas que entren entre la exportación y el reapuntado **se vuelven a recoger** de las fuentes en
la primera pasada del motor nuevo (los ids son deterministas por fuente + anuncio + contenido, así que
no se duplican). Lo que **sí se perdería** son decisiones editoriales tomadas en ese hueco: por eso el
corte se hace en minutos y con el panel sin usar.

## Runbook del corte

Requisitos: cuenta de Cloudflare con Workers Paid activo, Node 26 (`npx wrangler` no añade dependencia
al repositorio), y `CLOUDFLARE_API_TOKEN` con permiso de Workers + D1 en esa cuenta. El sitio actual
está en pausa hasta el **1 de noviembre**: la exportación **no puede correr antes** (todo responde 429).

0. **Comprobar que el sitio gestionado está sirviendo** (si sigue en pausa, no hay de dónde exportar):
   ```bash
   curl -s "$ENGINE_URL/api/status" | head -c 400
   ```
1. **Crear la base y el Worker nuevos** (en `sites/engine`):
   ```bash
   cp wrangler.example.toml wrangler.toml     # rellenar database_id tras el paso siguiente
   npx wrangler d1 create closer-engine
   npx wrangler d1 list
   ```
2. **Crear el esquema vacío** (con la forma barata) llamando al Worker **antes** de importar nada:
   ```bash
   npx wrangler deploy
   curl -s "https://<worker>.workers.dev/api/status"
   ```
   `write_shape` tiene que salir con `pending: []` y `legacy: []` — la base nueva nace migrada.
3. **Exportar los datos** (lee el motor actual, no escribe en él):
   ```bash
   ENGINE_URL="$ENGINE_URL" ENGINE_ADMIN_TOKEN="$CAREER_ADMIN_TOKEN" \
     node scripts/engine-export.mjs --out engine-dump.sql
   ```
   El script imprime filas por tabla y se para si una tabla falla (no deja un volcado a medias).
4. **Importar en la base nueva**:
   ```bash
   npx wrangler d1 execute closer-engine --remote --file=engine-dump.sql
   ```
   Es re-ejecutable (`INSERT OR REPLACE`): si se corta, se vuelve a lanzar.
5. **Publicar los secretos y las variables** (el `ADMIN_TOKEN` nuevo se genera con `openssl rand -hex 32`):
   ```bash
   npx wrangler secret put ADMIN_TOKEN
   npx wrangler secret put COLLECT_TOKEN
   # las variables del plan de pago ya están en wrangler.toml ([vars])
   npx wrangler deploy
   ```
6. **Comprobar el motor nuevo antes de tocar la web**:
   ```bash
   curl -s "https://<worker>.workers.dev/api/status"
   ```
   - `raw_items` y `catalog_active` tienen que **cuadrar con los del motor viejo**.
   - `write_allowance.config` = `{ month: 50000000, day: 0, ratio: 0.85 }`.
   - `write_allowance.month_writes` = `0` (cuota nueva, registro nuevo).
7. **Reapuntar la web** (Vercel → Production):
   ```bash
   vercel env rm CAREER_ENGINE_URL production
   vercel env add CAREER_ENGINE_URL production      # https://<worker>.workers.dev
   vercel env rm CAREER_ADMIN_TOKEN production
   vercel env add CAREER_ADMIN_TOKEN production     # el token del paso 5
   vercel --prod
   ```
   También se puede hacer en el panel de Vercel. **Sin redeploy** las variables nuevas no se aplican.
8. **Verificar de punta a punta** (checklist de abajo).
9. **Retirar el sitio gestionado** cuando lo anterior lleve un día estable: despublicarlo (Sites →
   Unpublish) para que no quede una copia congelada sirviendo datos viejos por su URL. **No** borrar su
   D1 hasta que el dueño confirme que no vuelve atrás.

## Variables a reapuntar

| Variable | Dónde vive | Antes | Después |
| --- | --- | --- | --- |
| `CAREER_ENGINE_URL` | Vercel (Production) | URL del motor en Sites | `https://<worker>.workers.dev` (o dominio propio) |
| `CAREER_ADMIN_TOKEN` | Vercel (Production) | token del motor en Sites | **nuevo** `ADMIN_TOKEN` del Worker propio |
| `ADMIN_TOKEN` | secreto del Worker | gestionado por Sites | nuevo, `wrangler secret put` |
| `COLLECT_TOKEN` | secreto del Worker | gestionado por Sites | nuevo (lo usa `POST /api/collect`) |
| `MAX_SUBREQUESTS` | variable del Worker | 50 | 50 (ver límite abajo) |
| `WRITE_ALLOWANCE_MONTH` | variable del Worker | — (100.000 por código) | `50000000` |
| `WRITE_ALLOWANCE_DAY` | variable del Worker | — (10.000 por código) | `0` (sin freno diario) |
| `WRITE_GUARD_RATIO` | variable del Worker | — (0.85 por código) | `0.85` |

No cambian: nada de Supabase, `ADMIN_PUBLIC_URL`, `GROQ_API_KEY`, `RESEND_*`, ni las claves de los
conectores (Apify, SerpApi, InfoJobs/Adzuna/Jooble siguen viviendo en la web, no en el motor).

## El guardián de cuota, configurable

`writeLimits(env)` valida el entorno y devuelve los límites efectivos; la puerta `writeAllowance` y la
migración de forma los usan. Reglas:

- `WRITE_ALLOWANCE_MONTH`: entero > 0. Ausente = 100.000.
- `WRITE_ALLOWANCE_DAY`: entero ≥ 0; **0 apaga el freno diario** (el plan de pago no tiene techo
  diario). Si supera al mensual, se recorta al mensual.
- `WRITE_GUARD_RATIO`: 0.1–1 (se aceptan `85`, `0,85`). Ausente = 0.85.
- Un valor inválido **no se convierte en cero** (eso dejaría al motor sin recoger para siempre): se
  descarta, se lista en `config.ignored` y se usa el defecto.
- `/api/status` publica `write_allowance.config` con los límites efectivos, y `day_max: null` cuando
  no hay freno diario (un `null` explícito, no un cero que parezca agotado).
- El registro (`write_ledger`) sigue midiendo **lo que escribe el motor**, no lo que factura la
  plataforma: el margen del 15 % absorbe el error de la estimación.

El panel todavía **no pinta** `write_allowance.config` (lo enseña el endpoint): es una mejora de UI
pendiente, no un dato inventado.

## Verificación del corte

1. `GET /api/status` del Worker nuevo: mismas cifras que el viejo; `write_shape.pending: []`;
   `write_allowance.config` como arriba; `month_writes: 0`.
2. `GET /v1/admin/opportunities?status=approved&limit=5` con `X-Admin-Token`: devuelve las mismas
   ofertas aprobadas, con su versión y su procedencia.
3. `GET /api/offers` y la búsqueda de la alumna: mismas ofertas y mismos enlaces; ninguna inventada.
4. Una pasada real (`POST /api/collect` con `X-Collect-Token`) sobre el motor nuevo: declara
   `writes`, deja una fila en `collection_runs` y anota la cuota; ninguna fuente con
   «Too many subrequests».
5. El panel (`/admin`) en producción: counts, cola de revisión y guardián leen del motor nuevo.
6. Una hora después, el cron del Worker nuevo: `GET /api/status` con `latest_run` posterior al corte.

## Vuelta atrás

Reapuntar `CAREER_ENGINE_URL` y `CAREER_ADMIN_TOKEN` a los valores del motor gestionado y redesplegar
Vercel. La D1 gestionada **no se toca** en ningún paso de este runbook, así que conserva todo hasta el
momento del corte. Se pierde lo escrito **en la cuenta nueva** desde el corte (recogidas y decisiones
tomadas contra ella); no se pierde nada de lo anterior.

## Consecuencias y límites (declarados)

- **El motor sigue topando en 50 subrequests por invocación** (`PLATFORM_SUBREQUEST_LIMIT` en el
  código) aunque el Worker de pago admita 10.000: subir `MAX_SUBREQUESTS` no sirve todavía. Aprovechar
  el plan de pago para recoger todas las fuentes en una pasada exige cambiar esa constante y volver a
  medir el presupuesto por fuente; queda como trabajo aparte.
- **CPU**: el plan gratuito da 10 ms por invocación y el de pago 30 s (15 minutos para un cron con
  intervalo ≥ 1 h). El motor no se acerca hoy al límite, pero deja de ser el riesgo que era.
- **Gasto nuevo**: 5 USD/mes, más los excesos si algún mes se cruzan 50 M de escrituras. Es gasto
  nuevo, así que **necesita la orden expresa del dueño** (AGENTS.md).
- **Concurrencia de cron**: mientras el sitio gestionado siga publicado con su trigger, las dos copias
  pueden recoger a la vez (cada una en su base). No rompe datos (ids deterministas), pero duplica
  peticiones a las fuentes; despublicar el viejo cierra el asunto.
- **Un solo operador local sigue siendo un solo operador**: esto mueve el hosting, no cambia el modelo
  de acceso (ADR-006).

## Evidencia de esta preparación

- `node --check sites/engine/worker.js` OK.
- `tests/engine/quota-config.mjs` **PASS** (defectos intactos; plan de pago; `day: 0`; valores
  inválidos declarados y no aplicados; `config` publicado; la recogida real usa el techo del entorno).
- `tests/engine/export.mjs` **PASS** (403 sin secreto, 401 con cabecera mala, `write_ledger` fuera de
  la lista blanca, SQL con comillas escapadas, cursor y fin de tabla, cero escrituras).
- `tests/engine/writebudget.mjs`, `writeshape.mjs` y `terms.mjs` siguen en verde sin cambios.
- `scripts/engine-export.mjs` **probado contra un servidor de prueba local** (dos páginas, archivo
  generado, fallo claro sin `ENGINE_URL`/token): no contra el motor real, porque está en pausa.
- **No ejecutado**: ni la cuenta nueva, ni la exportación real, ni el reapuntado de Vercel. Todo lo de
  arriba es *preparado y probado con datos simulados*, no *verificado en producción*.
