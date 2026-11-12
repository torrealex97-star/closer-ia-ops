# ADR-018 — El motor en una cuenta propia de Cloudflare (corte ejecutado, plan gratuito)

- **Estado**: **ejecutado el 2026-11-12** en la cuenta propia **Women Digital Closers** con el **plan
  gratuito** de Cloudflare. El **plan de pago no se ha activado**: queda como opción futura, con su
  orden de gasto pendiente.
- **Fecha**: decisión 2026-10-28 · ejecución 2026-11-12.
- **Relacionado**: [ADR-017](ADR-017-forma-de-escritura-del-catalogo.md) (forma de escritura),
  [ADR-016](ADR-016-avisos-del-motor-por-correo.md) (aviso cuando el motor se para).

## Contexto

El motor (Worker + D1) vivía en el hosting gestionado de Freebuff Sites. El 2026-10-27 la
plataforma lo pausó **entero** —todas las rutas, también las lecturas de la alumna— porque
`d1Writes` llegó a **100.604 de 100.000 filas escritas al mes**; no fue el tráfico, fueron las
escrituras. El motor ya se para antes de que lo pare la plataforma (guardián propio con registro en
`write_ledger`) y ya escribe barato (ADR-017), pero el techo mensual de Sites seguía siendo el
límite del producto.

La capa de debajo de Sites es Cloudflare. En **cuenta propia** el mismo Worker corre sin cambios de
código, y la cuota de D1 pasa a ser **diaria** (100.000 filas/día en el plan gratuito, 50 M/mes en
Workers Paid), en vez de 100.000 al mes.

Fuentes: [límites de D1](https://developers.cloudflare.com/d1/platform/limits/),
[precios de D1](https://developers.cloudflare.com/d1/platform/pricing/),
[límites de Workers](https://developers.cloudflare.com/workers/platform/limits/).

## Decisión

1. **Mover el motor a la cuenta propia de Cloudflare**, con el despliegue gestionado de Sites
   **intacto** como camino de vuelta. El código del Worker no cambia: se despliega el mismo
   `sites/engine/worker.js` con la misma fecha de compatibilidad.
2. **Hacerlo con el plan gratuito**, que es el que hay. El plan de pago (5 USD/mes) queda como
   opción futura para cuando se quiera lote grande y barrido completo; ver «Opción futura».
3. **El guardián de cuota y el presupuesto de subrequests son configurables por entorno**
   (`WRITE_ALLOWANCE_MONTH`, `WRITE_ALLOWANCE_DAY`, `WRITE_GUARD_RATIO`, `SUBREQUEST_LIMIT`,
   `MAX_SUBREQUESTS`), para que el plan se cambie con variables y no con un despliegue de código.
4. **Los datos se sacan por la ruta `/api/export` del propio motor** (solo `ADMIN_TOKEN`, solo
   lectura, paginada por clave) y se importan con `wrangler d1 execute`. La cuenta gestionada no
   expone credenciales de Cloudflare, así que `wrangler d1 export` no era una opción.
5. **La base nueva se crea vacía y con la forma barata**: el esquema lo crea el propio Worker
   (`ensureSchema` en el primer `/api/status`) y después se importan **solo datos**.

## Lo que se ejecutó (2026-11-12)

| Qué | Valor real |
| --- | --- |
| Cuenta | **Women Digital Closers** (`267ff354…`, cuenta propia) |
| Base D1 | **`closer-engine`** · `database_id` **`cb5ffe32-c55c-4cc4-bffc-bafefd582d60`** · región **EEUR** |
| Worker | **`closer-engine`** · **`https://closer-engine.women-digital-closers.workers.dev`** |
| Plan | **gratuito**: 50 subrequests/invocación, 100.000 filas escritas/día, 5 GB por cuenta, 500 MB por base |
| Datos movidos | **29.888 filas** en 9 tablas · volcado de **39 MB** |
| Coste de la importación | **56.370 filas escritas** (29.888 consultas) · base resultante **54,3 MB** |
| Secretos | `ADMIN_TOKEN` y `COLLECT_TOKEN` nuevos (64 hex), publicados con `wrangler secret put` |
| Forma de escritura | `pending: []`, `legacy: []` — la base nace migrada, sin reconstrucción pendiente |
| Cuota tras el corte | `month_writes 0`, `day_writes 0`, `max 2.550.000`, `day_max 72.250` |

`WRITE_ALLOWANCE_MONTH=3000000` y `WRITE_ALLOWANCE_DAY=85000` son deliberados: el plan gratuito no
tiene tope mensual de escrituras sino **diario** (100.000, reinicio a las 00:00 UTC), y el guardián se
queda con el 85 % para pararse él antes de que lo pare la plataforma. `SUBREQUEST_LIMIT` y
`MAX_SUBREQUESTS` **no se ponen**: el defecto del código ya es 50, y pedir 1.000 con techo de 50
cortaría la invocación con «Too many subrequests».

## Runbook ejecutado

Los pasos 1-6 están hechos y verificados; los pasos 7-9 dependen del operador y están declarados en
«Pendiente».

1. **Autorizar wrangler** en la cuenta propia: `npx wrangler login` (OAuth, sin tokens en archivos).
2. **Crear la base y comprobar que no había ninguna**:
   ```bash
   npx wrangler d1 create closer-engine      # → cb5ffe32-c55c-4cc4-bffc-bafefd582d60 (EEUR)
   npx wrangler d1 list
   ```
3. **Rellenar `database_id` y desplegar vacío** (en `sites/engine`, con `wrangler.toml`, que está
   **ignorado por git** porque lleva el id de la cuenta; la plantilla versionada es
   `wrangler.example.toml`):
   ```bash
   npx wrangler deploy
   curl -s "https://closer-engine.women-digital-closers.workers.dev/api/status"
   ```
   `write_shape` salió `{pending: [], legacy: []}`: la base nace con la forma barata.
4. **Exportar del motor actual** (solo lectura, no escribe en él):
   ```bash
   ENGINE_URL="https://site-41089ec9df4242cbaaac93158f77746b.freebuff.page" \
   ENGINE_ADMIN_TOKEN="<ADMIN_TOKEN de Sites>" \
     node scripts/engine-export.mjs --out engine-dump.sql
   ```
   Salida: 9 tablas, **29.888 filas** (raw_items 5.387 · job_postings, jobs, catalog_entries y
   opportunities 4.540 cada una · opportunity_versions 5.292 · collection_runs 80 ·
   verification_events 884 · slug_audit 85).
5. **Importar** (re-ejecutable, `INSERT OR REPLACE`):
   ```bash
   npx wrangler d1 execute closer-engine --remote --file=engine-dump.sql --yes
   ```
   **29.888 consultas · 56.370 filas escritas · 54,3 MB** en 3,7 s.
6. **Publicar secretos** con los valores nuevos (`openssl rand -hex 32`), nunca por chat:
   ```bash
   npx wrangler secret put ADMIN_TOKEN
   npx wrangler secret put COLLECT_TOKEN
   ```
7. **Reapuntar la web** (Vercel → Production): `CAREER_ENGINE_URL` y `CAREER_ADMIN_TOKEN`, y
   **redeploy**. Sin redeploy las variables no se aplican. La integración conectada responde
   `forbidden` sobre el proyecto, así que este paso es del operador.
8. **Reapuntar el workflow** (GitHub → Secrets → Actions): `ENGINE_URL` y `COLLECT_TOKEN`. Si no se
   cambian, `engine-collect.yml` sigue recogiendo contra Sites.
9. **Despublicar el motor de Sites** cuando lo anterior lleve un día estable (Sites → Unpublish). **No**
   borrar su D1 hasta confirmar que no se vuelve atrás.

## Verificación del corte (lo que se comprobó de verdad)

1. **`GET /api/status` cuadra con el motor viejo** en el momento del corte: `raw_items 5.387`,
   `catalog_active 1.131`, `raw_items_by_route {collection: 4.604, verification: 783}`.
2. **El mismo `dry_run` de activación** (`POST /v1/admin/opportunities/activate` con
   `{dry_run: true, verify: true}`) devuelve en los dos motores **los mismos `counts` (5 skipped)** y
   los **mismos ítems con la misma razón**, uno a uno.
3. **Autorización del motor nuevo**: `/api/export` responde **401 sin token** y **200 con token**.
4. **Cuota nueva**: arranca en **0**, `config {month: 3000000, day: 85000, ratio: 0.85}`,
   `day_max 72.250` (85 % de 100.000/día).
5. **Subrequests del plan gratuito**: `ceiling 50`, `budget 16`, `sources 22`, `fetch_cost 50`, sin
   `SUBREQUEST_LIMIT` en el entorno.

**Lo que no se ha verificado, y se dice**: (1) **la web sigue apuntando al motor viejo** hasta que el
operador cambie las variables de Vercel, así que el panel y la vista de alumna **no** se han probado
contra el motor nuevo; (2) **no se ha lanzado una pasada real de recogida** en el motor nuevo
(`POST /api/collect`), solo la importación y lecturas; (3) el cron de Sites sigue publicado.

## Opción futura: Workers Paid (no ejecutada)

Con **5 USD/mes** por cuenta, sin excesos con el gasto real del motor:

| | Plan gratuito (hoy) | Workers Paid (opción) |
| --- | --- | --- |
| Subrequests/invocación | 50 | 1.000 (`SUBREQUEST_LIMIT=1000`) |
| Fuentes por pasada | ~9 de 16 | **16 de 16** (barrido ≈ 35 subrequests) |
| Lote de activación | 25 | **150** (`activationBudget`) |
| Escrituras D1 | 100.000/día | 50 M/mes |
| CPU por invocación | 10 ms | hasta 5 min |
| `WRITE_ALLOWANCE_DAY` | 85.000 | `0` (sin freno diario) |

Activarlo es cambiar variables, no código:
```bash
# en wrangler.toml: SUBREQUEST_LIMIT = "1000", MAX_SUBREQUESTS = "1000",
#                   WRITE_ALLOWANCE_MONTH = "50000000", WRITE_ALLOWANCE_DAY = "0"
npx wrangler deploy
curl -s https://closer-engine.women-digital-closers.workers.dev/api/status   # ceiling 1000, day_max null
```
Es **gasto nuevo**, así que necesita la **orden expresa del dueño** (AGENTS.md). Hasta entonces no se
toca.

## Pendiente (declarado)

1. **Vercel**: `CAREER_ENGINE_URL` = `https://closer-engine.women-digital-closers.workers.dev` y
   `CAREER_ADMIN_TOKEN` = el `ADMIN_TOKEN` nuevo, en Production, y redeploy.
2. **GitHub Actions**: `ENGINE_URL` y `COLLECT_TOKEN` nuevos.
3. **Despublicar Sites** tras un día estable, conservando su D1.
4. **La web a Cloudflare**: **hecho** (sesiones 147-150). `urlGuard` se reescribió sin APIs de Node
   (allowlist medida, redirecciones manuales, IP literales bloqueadas, con pruebas propias); el port usa
   `@opennextjs/cloudflare` con Next 16.4.5, el Worker `closer-web` habla con el motor por *service
   binding* y `app.womendigitalclosers.com` ya lo sirve Cloudflare. Queda mover los **crons** a Workers
   y retirar Vercel cuando haya varios días de estabilidad (hoy es el rollback).

## Vuelta atrás

Reapuntar `CAREER_ENGINE_URL` y `CAREER_ADMIN_TOKEN` a los valores del motor gestionado y redesplegar
Vercel. La D1 gestionada **no se toca** en ningún paso de este runbook, así que conserva todo hasta el
momento del corte. Se pierde lo escrito **en la cuenta nueva** desde el corte (recogidas y decisiones
tomadas contra ella); no se pierde nada de lo anterior.

## Consecuencias y límites (declarados)

- **Escrituras**: el techo pasa de 100.000 **al mes** a 100.000 **al día** (reinicio 00:00 UTC). El día
  del corte, la importación consumió **56.370**, así que ese día quedaban ~43.600 para lo demás: un
  corte con datos grandes deja poco margen diario, no es un problema de cuota mensual.
- **Subrequests**: el techo sigue siendo 50, así que el motor se da 16, entran ~9 de 16 fuentes y la
  activación sigue en **25 por invocación**. Esto **no mejora con el plan gratuito**: el lote de 150
  exige Workers Paid.
- **CPU**: 10 ms por invocación en el plan gratuito. El motor no se acerca hoy a ese límite en las
  rutas de lectura, pero el límite de CPU de una pasada de clasificación **no se ha medido** en este
  plan; si apareciera, es el argumento más fuerte para el plan de pago.
- **Tamaño**: 54,3 MB de 500 MB por base (y 5 GB por cuenta). Sin riesgo a corto plazo; con años de
  `raw_items` habrá que archivar o pagar el plan de pago (10 GB por base).
- **Concurrencia de cron**: mientras el motor de Sites siga publicado y el cron de Vercel no se
  reapunte, las dos copias pueden recoger a la vez (cada una en su base). No rompe datos (ids
  deterministas), pero duplica peticiones a las fuentes; despublicar el viejo cierra el asunto.
- **Un solo operador local sigue siendo un solo operador**: esto mueve el hosting, no cambia el modelo
  de acceso (ADR-006).

## Evidencia de la ejecución

- `wrangler deploy --dry-run`: empaqueta 246,7 KiB con los bindings correctos (`env.DB` y las tres
  variables del guardián), **sin** variables de subrequests.
- `wrangler d1 execute --remote`: 29.888 consultas, **56.370 filas escritas**, 54,3 MB, 3,7 s.
- `/api/status` del motor nuevo: cifras idénticas a las del viejo (sección «Verificación»).
- `dry_run` de activación: mismos `counts` e ítems que el motor viejo, ítem por ítem.
- `export` sin token **401**, con token **200**.
- Las 12 pruebas del motor (`tests/engine/*.mjs`) en verde, incluidas `quota-config`, `subrequests`,
  `export`, `writeshape` y `writebudget`; `scripts/engine-export.mjs` **sí se ejecutó contra el
  motor real** en esta sesión, a diferencia de la preparación de octubre.
