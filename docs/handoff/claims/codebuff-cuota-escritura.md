---
agent: codebuff
status: blocked
branch: main
touches: sites/engine/worker.js, tests/engine/writebudget.mjs, tests/admin-auth/run.sh, docs/EXTERNAL_SOURCES.md, docs/STATUS.md, docs/ACTIVE_HANDOFF.md
date: 2026-10-27
depends_on: codebuff-himalayas-closer
---
La cuota que pausó el sitio es del plan de hosting y se mide en **filas escritas al mes** (medido contra el
contador de la plataforma: `d1Writes` 100.604/100.000, reinicio 2026-11-01; `requests` solo 2.251/100.000 —
no fue el tráfico). El motor ya tenía presupuesto de escritura **por pasada**, pero no techo del **mes**, así
que el acumulado cruzó el límite y la plataforma pausó el sitio ENTERO: todas las rutas 429, también las
lecturas de la alumna.

Se añade registro propio (`write_ledger`, una fila por día y organización) y una puerta con 15% de margen
(85.000/mes y 8.500/día) que detiene la recogida **antes** de que lo haga la plataforma: se deja de recoger
—declarándolo en `/api/status`, campo `write_allowance`— y el catálogo ya recogido se sigue sirviendo.
`force` NO salta la puerta (las dos pasadas forzadas del 26-oct son lo que cruzó el techo). Los lotes de
ingesta devuelven las filas que escriben y cada pasada las anota; la activación en lote anota lo suyo
(aproximado y declarado) pero **nunca se bloquea la aprobación de una persona**. Si el registro no se puede
leer, se declara el hueco y se sigue recogiendo (no se finge un cero ni se cierra la puerta por eso).

NO se toca: el catálogo ya recogido, la superficie de la alumna, el aviso por correo (sesión 125), la ventana
de catálogo de 10 días ni el filtro de rol en el origen.

**Bloqueo (motivo exacto, re-medido hoy 2026-10-27 20:45Z):** el arreglo está en `main`, probado y **verificado
en caliente con D1 real**, pero **no se puede desplegar todavía**: el intento de hoy con
`deploy-manifest.json` devuelve el mismo rechazo de la plataforma —«Your sites have reached a hosting allowance
and are paused. Open Sites to view usage and reset dates. Your data is preserved.»— con el contador aún en
`d1Writes` **100.604 / 100.000** y reinicio **2026-11-01T00:00Z**. Sin despliegue no hay forma de mover el estado.

**Verificado en workerd con D1 real (no es producción)**: mismo worker del repo, misma fecha de compatibilidad
que el manifiesto y D1 real de workerd (arnés en `.local/engine-guard/`, ignorado por git y detenido al terminar):

- `GET /api/status` con el registro vacío → `write_allowance {available: true, month: 2026-10, month_writes: 0, max: 85000, ok: true, left: 85000}`.
- `POST /api/collect` real → **200**, run `completed`, **7.941 filas escritas y anotadas** (`writes: 7941`) y la fila real en la tabla (`cloud-wdc | 2026-10-27 | 7941`); el `/api/status` siguiente publica `month_writes 7941`, `left 77059`.
- Con el mes sembrado por encima del techo (92.941) la pasada **forzada** devuelve `{skipped: true, reason: 'write_allowance', reason_puerta: 'month'}` y `collection_runs` **no sube** (1 → 1): no se recoge ni se escribe nada.
- Dato nuevo medido: una pasada sobre catálogo **vacío** escribe 7.941 filas, o sea **casi el tope diario entero** (10.000); dos pasadas completas el mismo día sumarían ~15.900 y cruzarían el techo del día, que es el más fácil de cruzar. 5 fuentes quedaron `deferred` por presupuesto de peticiones (diseño reanudable, sin cambio).

**Siguiente acción exacta:** el **1 de noviembre** (reinicio de cuota, `2026-11-01T00:00Z`), desplegar
`sites/engine` con [`deploy-manifest.json`](../../../sites/engine/deploy-manifest.json) —el manifiesto **con
`crons` lo rechaza el esquema de Sites**, así que no se usa— y comprobar, en este orden: (1) `GET /api/status`
devuelve `write_allowance` con `month_writes` ~0 y `max` 85.000; (2) `POST /api/collect` con el `COLLECT_TOKEN`
responde 200 con `writes` > 0 y el `/api/status` siguiente muestra `month_writes` creciendo; (3) con el mes
cerca del techo, esa misma pasada responde `skipped: true, reason: 'write_allowance'`. **Riesgo mientras no se
despliegue**: el 1 de noviembre el sitio se reanuda con el código viejo (sin guardián) y el techo **diario**
(10.000 filas) es el que antes se cruza; lo primero del día es desplegar.
Decisión del dueño en paralelo: plan de pago (gasto nuevo, orden expresa) o aceptar que el motor deje de
recoger en el tramo final de cada mes (100.000 filas/mes ÷ ~6 por candidato nuevo ≈ 16.600 candidatos/mes).

**No declarar PASS en:** el despliegue del guardián (lo verificado es workerd con D1 real, **no** producción),
ni en un envío real de correo.
