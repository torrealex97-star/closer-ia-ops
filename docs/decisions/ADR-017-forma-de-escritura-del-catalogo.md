# ADR-017 — Forma de escritura del catálogo del motor: quitar índices sin perder lecturas

Estado: aceptada e implementada (2026-10-28) · Evidencia: *tested* ([writeshape.mjs](../../tests/engine/writeshape.mjs), 7 casos, y la suite del motor en verde) y *verificado en workerd con D1 real* (base nueva y base antigua sembrada: la migración corre de verdad y el coste por candidato se mide, no se supone); **no desplegado**: la cuota de escrituras del mes está agotada y el sitio está en pausa hasta el **2026-11-01T00:00Z**. Nada de este ADR está verificado en producción todavía.

## Contexto

El 2026-10-27 el sitio del motor se pausó porque D1 llegó a **100.604 / 100.000 filas escritas al mes**, mientras las lecturas iban por **10,7 M / 50 M** (22%) y el almacenamiento por **47,8 MB / 100 MB** (48%). No fue el tráfico: fueron las escrituras, y en D1 **cada entrada de índice se factura como una fila escrita**, no solo la fila de la tabla.

Medido en D1 real de workerd (2026-10-28), un candidato nuevo escribía **18 filas**: seis tablas × (1 fila + 2 índices) — el índice implícito de la clave primaria de texto y un `UNIQUE` o el índice de caducidad—. De esas 18, solo 6 eran datos. Con 100.000 filas al mes eso son ~5.500 candidatos nuevos, no los ~16.600 que sugería la cuenta sin índices.

El operador pidió, antes de pagar un plan: «propón cómo bajar las filas escritas por candidato para ampliar la recogida gratis, con el ahorro que supondría y sus pruebas».

## Decisión 1 — `WITHOUT ROWID` en las seis tablas del camino de un candidato

`raw_items`, `job_postings`, `jobs`, `catalog_entries`, `opportunities` y `opportunity_versions` se crean (en bases nuevas) con `WITHOUT ROWID`: con clave primaria de texto, **la clave es la tabla** y no se crea el índice aparte de la clave primaria. Medido: 1 fila escrita por fila, frente a 2. Es la pieza que se quita **sin coste de lectura**: las búsquedas por clave siguen siendo `SEARCH ... USING PRIMARY KEY`.

## Decisión 2 — Los cinco `UNIQUE` se conservan: no son redundantes, son camino de lectura

Quitarlos ahorraba una fila por escritura, pero la consulta que construye el mapa `known` de la ingesta filtra por `(org_id, source)` y une por `(org_id, source, external_id)`; el panel lista y une oportunidades por `(org_id, job_id)`; las versiones se leen por `(org_id, opportunity_id)`. Sin esos índices, cada pasada de recogida y cada página de la alumna harían escaneos completos sobre tablas de miles de filas. Con ellos, `EXPLAIN QUERY PLAN` en workerd devuelve `SEARCH` en la consulta de `known`, en sus joins y en el join de la alumna (ningún `SCAN`). La prueba falla si alguien los quita «para ahorrar».

## Decisión 3 — Fuera el índice de caducidad del catálogo

`idx_catalog_expiry (org_id, expires_at)` no hacía falta: el filtro por organización ya es la clave del catálogo. Medido: el alta de una fila de catálogo pasa de **3 filas escritas a 1** y el refresco de vigencia (upsert de `expires_at`) de **2 a 1**. El refresco es el coste que se paga en cada pasada, no solo al dar de alta, así que es la parte que más rinde. El plan de la consulta pasa de `SEARCH ... USING INDEX idx_catalog_expiry` a `SEARCH ... USING PRIMARY KEY (org_id=?)`: con una sola organización el índice apenas filtraba y el `ORDER BY first_seen_at` ya obligaba a ordenar.

## Decisión 4 — Migración: atómica, reanudable, con la cuota delante y solo donde se paga

El índice de caducidad **no espera a la reconstrucción**: se quita en la primera pasada de recogida (`DROP INDEX IF EXISTS`, idempotente: cuando ya no está no escribe nada), porque su ahorro —el refresco de vigencia— se paga en cada pasada y no depende del rowid de la tabla. Así el ahorro llega aunque la reconstrucción del catálogo se aplace por falta de cuota.

Las bases que ya existen no cambian de forma solas, y no hay `ALTER` para quitar el rowid: hay que reconstruir la tabla (`CREATE ... WITHOUT ROWID` + copia + `DROP` + `RENAME`) dentro de **un solo `batch`**, que en D1 es transaccional. La decisión de qué falta se lee del **esquema real** (`sqlite_master`), no de una versión supuesta: una base nueva ya nace bien y una migrada deja de estarlo. Si el esquema no se puede leer, **no se escribe nada** (mismo criterio que el registro de cuota: un fallo de lectura no justifica escribir).

Coste medido de la reconstrucción: **1 fila por fila copiada** cuando la tabla no tiene `UNIQUE` aparte, y **2 filas por fila** cuando lo conserva (8.030 escrituras para 4.000 filas). Por eso:

- Se migra **solo `catalog_entries`** (sin `UNIQUE` aparte, ~1 fila por fila, unos 3.000 escrituras con el catálogo actual): es lo que cabe en la ventana de noviembre sin comerse la recogida, y a cambio baja el alta y cada refresco.
- Las otras cinco siguen con rowid y se declaran en `/api/status` como `write_shape.legacy` (no se finge que están migradas). Reconstruirlas costaría ~2 filas por fila —del orden de 30.000-40.000 escrituras con el tamaño actual: un tercio del mes— para ahorrar 5 escrituras por candidato nuevo; se hará cuando haya hueco de sobra (plan de pago, o una ventana de baja recogida).
- La migración tiene **tope por pasada** (6.000 escrituras, más 1.500 de margen bajo el techo diario de 10.000, que pausa el sitio entero), no cruza el techo mensual del guardián y es **reanudable**: lo que no cabe o falla se declara pendiente y sigue en la pasada siguiente. Un fallo de reconstrucción no revienta la recogida.

## Decisión 5 — La evidencia cruda se nombra por su clave

El id de `raw_items` pasa a ser determinista (`stableId` de fuente + id externo + hash de contenido), como ya lo eran el posting y el job. Misma fuente + mismo anuncio + mismo contenido = misma fila: un reintento no duplica evidencia y el id deja de ser aleatorio. No cambia el modelo de datos ni la inmutabilidad de la evidencia.

## Cifras (medidas, no estimadas)

| Caso | Antes | Después |
| --- | --- | --- |
| Candidato nuevo, base en producción hoy | **18** filas | **16** (solo catálogo migrado) · **11** en base nueva |
| Alta de una fila de catálogo | 3 filas | 1 |
| Refresco de vigencia | 2 filas | 1 |
| Reconstrucción de una tabla con `UNIQUE` | — | 2,0075 filas por fila (4.000 → 8.030) |
| Reconstrucción del catálogo | — | ~1 fila por fila + ~15 de DDL |

Verificado en workerd con D1 real: base nueva → 6 tablas `WITHOUT ROWID`, 0 índices sobre el catálogo, **11** filas por candidato; base antigua sembrada → `pending: ["catalog_entries"]`, **18** filas por candidato, la migración reconstruye el catálogo conservando sus filas y el candidato pasa a **16**.

## Consecuencias

- Ahorro inmediato por la vía barata: **-2 filas por candidato nuevo** y **-1 por refresco**; en una base nueva, **-7 por candidato**.
- El techo no sube: con el plan gratuito el motor sigue dejando de recoger al final del mes. Esto **estira** la cuota (unas 6.250 altas nuevas al mes en la base actual, ~9.000 en una base nueva, frente a ~5.500), no la elimina.
- El almacenamiento también baja (seis índices menos por tabla en bases nuevas; dos en el catálogo migrado), que es el segundo techo (48% usado).
- No hay cambio de contrato de la API: solo se **añade** `write_shape` a `/api/status` y a la respuesta de la recogida.

## Límites y siguiente paso

1. **No desplegado**: el sitio está en pausa por cuota hasta el 2026-11-01T00:00Z. Lo primero del día 1 es desplegar (`sites/engine/deploy-manifest.json`) junto con el guardián de cuota de la sesión 126, y comprobar en `/api/status` que `write_shape` publica `pending: []` y `legacy` con las cinco tablas.
2. En producción el candidato seguirá costando 16 hasta que se reconstruyan las cinco tablas caras; la cifra de 11 solo la alcanza una base nueva.
3. La migración no se ha ejecutado contra la base real (no se puede leer ni escribir mientras el sitio está en pausa).
4. Si el catálogo crece por encima de ~4.500 filas, la reconstrucción de una sola pasada ya no cabe en el tope y se aplaza sola (declarándolo en el log): haría falta una copia por trozos con sincronización del delta antes del intercambio.
