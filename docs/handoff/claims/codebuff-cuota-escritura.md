---
agent: codebuff
status: blocked
branch: feat/motor-forma-escritura
touches: sites/engine/worker.js, tests/engine/writebudget.mjs, tests/engine/writeshape.mjs, tests/admin-auth/run.sh, docs/decisions/ADR-017-forma-de-escritura-del-catalogo.md, docs/EXTERNAL_SOURCES.md, docs/STATUS.md, docs/ACTIVE_HANDOFF.md
date: 2026-10-28
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

NO se toca: la superficie de la alumna, el aviso por correo (sesión 125), la ventana de catálogo de 10 días, el
filtro de rol en el origen, el contrato de lectura de la API (solo se **añade** `write_shape`).

**Bloqueo (motivo exacto, re-medido hoy 2026-10-28):** el código está en `main`, probado y verificado con D1 real de
workerd, pero **no se puede desplegar**: el contador sigue en `d1Writes` **100.604 / 100.000** y Sites está
`suspended` hasta **2026-11-01T00:00Z**; el despliegue se rechaza con «Your sites have reached a hosting allowance
and are paused» (intentado el 2026-10-27 20:45Z). Sin despliegue no hay forma de mover el estado.

**Verificado en workerd con D1 real (no producción)** — arnés `.local/engine-schema/`, ignorado por git y detenido:
base nueva → 6 tablas `WITHOUT ROWID`, 0 índices sobre el catálogo, `write_shape {pending: [], legacy: []}` y **11**
filas por candidato; base antigua sembrada → `pending: ["catalog_entries"]`, `legacy` con las cinco, **18** filas por
candidato, y la migración real reconstruye el catálogo (21 filas intactas, `WITHOUT ROWID`, 0 índices) y lo deja en
**16**, con **36** filas escritas para 21 filas (~1 por fila + DDL). Sesión 126, mismo método: una pasada real
escribió y anotó **7.941** filas, y con el mes sembrado en 92.941 la pasada forzada se salta sin escribir nada.

**Probado (tested):** [writeshape.mjs](../../../tests/engine/writeshape.mjs) 7/7 (coste derivado del DDL, índices de
lectura fijados uno a uno, migración atómica/reanudable/tope), más writebudget, terms y activate en verde; el test
entra en [run.sh](../../../tests/admin-auth/run.sh) y orphan-refs sigue en PASS.

**Siguiente acción exacta:** el **1 de noviembre**, en el primer despliegue del día, publicar `sites/engine` con
[`deploy-manifest.json`](../../../sites/engine/deploy-manifest.json) (el manifiesto con `crons` lo rechaza el esquema
de Sites) y comprobar, en este orden: (1) `GET /api/status` publica `write_allowance` con `month_writes` ~0 y
`write_shape` con `pending: []` y `legacy` con las cinco; (2) `POST /api/collect` con el `COLLECT_TOKEN` responde 200
con `writes` > 0 y `write_shape.writes` > 0 la primera vez (migró el catálogo) y 0 después; (3) con el mes cerca del
techo, la pasada responde `skipped: true, reason: 'write_allowance'`. **Riesgo mientras no se despliegue:** el día 1
el motor se reanuda con el código viejo (sin guardián), y el techo **diario** (10.000) es el que antes se cruza.

**No declarar PASS en:** el despliegue (verificado en workerd, **no** en producción), la migración del catálogo en la
base real, ni en un envío real de correo.
