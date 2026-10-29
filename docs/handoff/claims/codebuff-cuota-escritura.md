---
agent: codebuff
status: validated
branch: feat/motor-forma-escritura
pr: 80
touches: sites/engine/worker.js, sites/engine/wrangler.example.toml, scripts/engine-export.mjs, tests/engine/writebudget.mjs, tests/engine/writeshape.mjs, tests/engine/quota-config.mjs, tests/engine/export.mjs, tests/engine/subrequests.mjs, tests/admin-auth/run.sh, docs/decisions/ADR-017-forma-de-escritura-del-catalogo.md, docs/decisions/ADR-018-motor-en-cuenta-propia-de-cloudflare.md, docs/EXTERNAL_SOURCES.md, docs/STATUS.md, docs/ACTIVE_HANDOFF.md
date: 2026-10-29
depends_on: codebuff-himalayas-closer
---
La cuota que pausó el sitio es del plan de hosting y se mide en **filas escritas al mes** (`d1Writes` 100.604/100.000,
reinicio 2026-11-01; `requests` 2.251/100.000, `d1Reads` 10,7 M/50 M, `d1Bytes` 47,8 MB/100 MB). Fueron las escrituras.

**Sesión 126 — la puerta.** El motor ya tenía presupuesto por pasada, pero no techo del mes. Ahora lleva su propio
registro (`write_ledger`, una fila por día y organización) y una puerta con 15% de margen (85.000/mes, 8.500/día) que
detiene la recogida **antes** de que lo haga la plataforma: deja de recoger —declarado en `/api/status`, campo
`write_allowance`— y el catálogo ya recogido se sigue sirviendo. `force` NO salta la puerta. Si el registro no se
puede leer, se declara el hueco y se sigue recogiendo.

**Sesión 127 — la forma de escribir (ADR-017).** Medido en D1 real de workerd: un candidato nuevo escribía **18**
filas (6 tablas × tabla + 2 índices; solo 6 eran datos), porque D1 factura cada entrada de índice. Las seis tablas
del camino nacen ahora `WITHOUT ROWID` (la clave es la tabla, sin índice implícito: 1 fila por fila) y se eliminó
`idx_catalog_expiry` (alta de catálogo 3 → 1; refresco de vigencia 2 → 1). **Se conservan los cinco `UNIQUE`**: no
eran redundantes, son el camino de lectura de la ingesta y del panel (sin ellos, escaneos completos; con ellos, los
planes son `SEARCH`). Candidato: **18 → 16** en la base actual (solo se reconstruye el catálogo) y **11** en una
base nueva. La migración va en un `batch` atómico, se decide leyendo `sqlite_master` (si no se puede leer, no se
escribe nada), tiene tope por pasada (6.000 escrituras) y es reanudable; las cinco tablas caras se declaran en
`/api/status` como `write_shape.legacy` porque reconstruirlas cuesta 2 filas por fila (~35.000 escrituras hoy).

**Sesión 128 — la migración a cuenta propia, preparada (ADR-018).** No se ha ejecutado nada contra una cuenta nueva:
requiere orden expresa (cuenta y gasto nuevos). Lo que queda listo en esta rama:
(1) **guardián configurable por entorno** — `WRITE_ALLOWANCE_MONTH`, `WRITE_ALLOWANCE_DAY` (`0` apaga el freno
diario) y `WRITE_GUARD_RATIO` (0,1–1, acepta `85`/`0,85`); un valor inválido **no se convierte en cero**: se
descarta, se lista en `config.ignored` y se usa el defecto del plan gratuito; `/api/status` publica
`write_allowance.config` y `day_max: null` cuando no hay freno diario (null explícito, no un cero que parezca
agotado);
(2) **ruta `/api/export`** (solo `ADMIN_TOKEN`, solo lectura, paginada por clave, lista blanca de nueve tablas sin
`write_ledger` ni `schema_version`) y `scripts/engine-export.mjs`, que se para si una tabla falla en vez de dejar un
volcado a medias;
(3) **`wrangler.example.toml`** para desplegar el mismo worker en una cuenta propia (D1 `closer-engine`, cron cada
6 h, variables del plan de pago ya puestas);
(4) **runbook del corte** en ADR-018: exportar → importar con `wrangler d1 execute` → rotar `ADMIN_TOKEN` y
`COLLECT_TOKEN` → reapuntar en Vercel solo `CAREER_ENGINE_URL` y `CAREER_ADMIN_TOKEN` → verificar → despublicar el
sitio gestionado cuando lleve un día estable, sin borrar su D1.

**Sesión 129 — el plan de pago, aprovechado en el presupuesto.** El techo de subrequests por invocación lo pone el
plan (50 gratuito, 1.000 Workers Paid) y estaba fijado en el código: con 16 de presupuesto entraban 9 de las 16 fuentes
y se aplazaban 7, entre ellas FreeHire ES closer, FreeHire LATAM closer y Himalayas closer. Ahora `SUBREQUEST_LIMIT`
(6–1.000; ausente = 50) es el techo del plan y `MAX_SUBREQUESTS` se recorta a él; un valor inválido se descarta y se
declara en `ignored`, nunca se convierte en «sin límite». `/api/status` publica `subrequests` (`ceiling`, `budget`,
`sources`, `fetch_cost`, `deferred` del último run) y la recogida añade `spent`. Medido en workerd con D1 local y
fuentes reales: **9/16 fuentes y 16 subrequests** con el gratuito; **16/16 y 35** con el techo de pago (25 s), entrando
FreeHire ES closer (21 candidatos), LATAM closer (27) y Himalayas (31).

NO se toca: la superficie de la alumna, el aviso por correo (sesión 125), la ventana de catálogo de 10 días, el
filtro de rol en el origen, el contrato de lectura de la API (solo se **añade** `write_shape`, `write_allowance.config`
y `subrequests`).

**Probado (tested):** [quota-config.mjs](../../../tests/engine/quota-config.mjs) (defectos intactos, plan de pago,
`day: 0`, inválidos declarados y no aplicados, `config` publicado, la recogida real usa el techo del entorno) y
[export.mjs](../../../tests/engine/export.mjs) (403 sin secreto, 401 con cabecera mala, `write_ledger` fuera de la
lista blanca, SQL con comillas escapadas, cursor y fin de tabla, cero escrituras) y
[subrequests.mjs](../../../tests/engine/subrequests.mjs) (defectos intactos, techo de pago, presupuesto nunca por
encima del plan, inválidos declarados, 7 aplazadas con 16 y ninguna con 966 gastando los 35 reales, estado publicado). Siguen verdes
[writeshape](../../../tests/engine/writeshape.mjs) 7/7, [writebudget](../../../tests/engine/writebudget.mjs),
[terms](../../../tests/engine/terms.mjs) y [activate](../../../tests/engine/activate.mjs); las dos pruebas nuevas
entran en [run.sh](../../../tests/admin-auth/run.sh) y orphan-refs sigue en PASS.
`scripts/engine-export.mjs` se probó contra un servidor local (dos páginas, archivo generado, error claro sin
`ENGINE_URL`/token): **no** contra el motor real, porque está en pausa.

**Bloqueo (motivo exacto):** el código está en esta rama, probado y verificado con D1 real de workerd, pero **no se
puede desplegar**: el contador sigue en `d1Writes` **100.604 / 100.000** y Sites está `suspended` hasta
**2026-11-01T00:00Z**. Sin despliegue no hay forma de mover el estado, y sin plan de pago no hay cuenta donde mover
el motor.

**Siguiente acción exacta:** el **1 de noviembre**, en el primer despliegue del día, publicar `sites/engine` con
[`deploy-manifest.json`](../../../sites/engine/deploy-manifest.json) (el manifiesto con `crons` lo rechaza el esquema
de Sites) y comprobar, en este orden: (1) `GET /api/status` publica `write_allowance` con `month_writes` ~0,
`write_allowance.config` con los defectos del plan gratuito y `write_shape` con `pending: []` y `legacy` con las
cinco; (2) `POST /api/collect` con el `COLLECT_TOKEN` responde 200 con `writes` > 0 y `write_shape.writes` > 0 la
primera vez (migró el catálogo) y 0 después; (3) con el mes cerca del techo, la pasada responde
`skipped: true, reason: 'write_allowance'`. **Después**, y solo con la orden del dueño, ejecutar el runbook de
ADR-018 (crear cuenta con Workers Paid, exportar, importar, reapuntar). **Riesgo mientras no se despliegue:** el día
1 el motor se reanuda con el código viejo (sin guardián), y el techo **diario** (10.000) es el que antes se cruza.

**No declarar PASS en:** el despliegue (verificado en workerd, **no** en producción), la migración del catálogo en la
base real, el corte a una cuenta propia (no ejecutado: falta la orden y la cuenta), ni un envío real de correo.
