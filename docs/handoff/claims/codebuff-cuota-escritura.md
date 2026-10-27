---
agent: codebuff
status: blocked
branch: main
touches: sites/engine/worker.js, tests/engine/writebudget.mjs, tests/admin-auth/run.sh, docs/EXTERNAL_SOURCES.md, docs/STATUS.md
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

**Bloqueo (motivo exacto):** el arreglo está en `main` y probado, pero **no se puede desplegar todavía**: la
plataforma rechaza las subidas mientras el sitio está en pausa (medido el 2026-10-26: «your sites have reached
a hosting allowance and are paused»).

**Siguiente acción exacta:** el 1 de noviembre (reinicio de cuota) desplegar `sites/engine` con su manifiesto,
comprobar que `GET /api/status` devuelve `write_allowance` y lanzar una pasada para ver que anota el registro.
Decisión del dueño en paralelo: plan de pago (gasto nuevo, orden expresa) o aceptar que el motor deje de
recoger en el tramo final de cada mes (100.000 filas/mes ÷ ~6 por candidato nuevo ≈ 16.600 candidatos/mes).

**No declarar PASS en:** el despliegue del guardián, ni en un envío real de correo.
