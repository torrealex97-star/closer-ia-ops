# ADR-011 — Port futuro a Postgres multi-org con RLS

Fecha: 2026-10-16. Estado: **propuesta documental**. No se ha creado ningún proyecto Supabase, ni DDL, ni cambios de código. Es la valoración que pidió el operador sobre `apps/api/career/migrations.py` antes de cualquier port.

Relaciona con ADR-006 (Supabase/Postgres/RLS como destino de producción, condicionado a aislamiento probado) y con [03_DATA_MODEL](../spec/03_DATA_MODEL.md) (sección RLS y extensión normativa WDC).

## 1. Hechos verificados (no supuestos)

Inventario automático sobre `migrations.py` + `db.py` (25 `CREATE TABLE`):

- Todas las tablas de negocio llevan `org_id`, salvo tres: `watchlist_targets`, `company_target` y `provider_cache`. `schema_version` es global por diseño.
- `watchlist_targets` referencia `company_watchlist(id)` solo por `id`, sin `org_id` en la FK. Es el único punto donde la integridad multi-org depende de que el id sea único globalmente.
- `provider_cache` tiene PK `key`, con `key = sha256(url + params)` ([connectors.py:21](../../apps/api/career/connectors.py)). Compartir esa caché entre organizaciones es aceptable solo si las respuestas son públicas e independientes de la organización. Ninguna clave de proveedor debe entrar en la URL.
- Varias tablas tienen PK solo `id` y no `UNIQUE(org_id, id)`: `ai_generations`, `collection_runs`, `scrape_budget`, `company_watchlist`, `job_classifications`, `opportunity_versions`, `verification_events`, `saved_searches`. Hoy ninguna es destino de FK compuesta, pero el patrón del modelo exige que lo sean.
- La organización sale de `CAREER_ORG_ID` con valor por defecto `local-wdc` ([db.py:21](../../apps/api/career/db.py)). Es modo local de un solo operador; no es autenticación hospedada.
- El motor cloud (Sites/D1) **no usa** `migrations.py`. Tiene su propio `ensureSchema` ([worker.js](../../sites/engine/worker.js)) con la organización fijada como constante `'cloud-wdc'`. Hay dos fuentes de esquema.
- El schema `career` que se creó en Supabase el 2026-10-09 se eliminó en la sesión 30 por decisión del operador. El proyecto `growth-ops-app` (`rgcbveflosqgxrcqlqzv`) **pertenece a otro producto** y no puede usarse para esto (AGENTS: no tocar datos ni despliegues ajenos).

Lectura de la documentación oficial de Supabase (RLS, API keys, esquemas expuestos): los roles `anon` y `authenticated` están sujetos a RLS; `service_role` tiene `BYPASSRLS`; `public` se expone por defecto en la API de datos; un `SECURITY DEFINER` salta RLS si su dueño tiene `BYPASSRLS` ([RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [Securing your API](https://supabase.com/docs/guides/api/securing-your-api), [Custom schemas](https://supabase.com/docs/guides/api/using-custom-schemas)).

## 2. Valoración: ¿merece la pena el port ahora?

**No, todavía.** El aislamiento que exige RLS solo aporta cuando hay usuarios distintos que acceden directamente a datos. Hoy hay una única organización WDC, una superficie pública de solo lectura en el motor cloud y un panel de operador detrás de token. El coste es alto: dos motores de datos (D1 en el cloud y Postgres), migración de datos y un modelo de autorización nuevo.

Opciones:

| Opción | Qué es | Pros | Contras |
|---|---|---|---|
| A. Postgres en proyecto Supabase propio + RLS | Destino de ADR-006 | RLS como segunda barrera, auth de Supabase, FK compuestas exigibles | Dos motores hasta retirar D1; coste y pausa de plan; migración completa |
| B. Quedarse en D1 y escalar por Worker | Sites con D1 + Sign in with Freebuff | Ya en producción; sin segundo motor | Sin RLS: el aislamiento vive en el código del Worker y en tests; `user.sub` como clave de todo |
| C. Postgres solo detrás de la API, sin exposición PostgREST | Backend con conexión propia y filtro por org en código | Sin superficie de API de datos | Sin defensa en profundidad; el aislamiento depende de cada consulta |

**Recomendación**: mantener B hasta que se cumpla un disparador. Cuando lo haya, ejecutar A con el alcance de este documento, no C.

Disparadores para arrancar el port:
1. Entra una segunda organización o cuentas de alumnas autenticadas con acceso a datos propios (plan fase 7).
2. Se decide el proveedor de identidad. Si es Sign in with Freebuff, el argumento de Supabase Auth pierde peso y se revisa la opción B.
3. El gasto y la pausa del plan de Supabase son aceptables para el operador.

## 3. Traducción de `migrations.py` a Postgres

No se traduce automáticamente. Las versiones se rehacen como DDL versionado en un directorio nuevo, y las diferencias de dialecto quedan listadas:

| Origen SQLite | Destino Postgres |
|---|---|
| `TEXT` con timestamps ISO (`now()`) | `timestamptz` (UTC, como exige 03_DATA_MODEL) |
| `payload TEXT` con JSON | `jsonb`; los campos filtrados pasan a columna |
| `starred INTEGER`, `enabled INTEGER` | `boolean` |
| `REAL` de costes y scores | `numeric` (costes) y `real` solo donde no haya dinero |
| `json_extract`, `json_set` (migración 3 y [ai.py:200](../../apps/api/career/ai.py)) | `->>`, `jsonb_set` |
| `strftime(..., '+10 days')` (migración 4) | `timestamptz + interval '10 days'` |
| `INSERT OR IGNORE` | `ON CONFLICT DO NOTHING` |
| `INSERT OR REPLACE` en `provider_cache` | `ON CONFLICT (key) DO UPDATE` |
| `PRAGMA`, `BEGIN IMMEDIATE` | Transacciones con bloqueo explícito (advisory lock para migraciones) |
| Triggers `raw_no_update/raw_no_delete` (en `db.py`, no en migraciones) | Función trigger + revocar `UPDATE/DELETE` al rol de la app |
| Seeds con `'local-wdc'` (migraciones 5, 7, 8, 9, 10) | Seed por organización desde la aplicación, no desde la migración |
| `_backfill_opportunities` (migración 12, Python) | Job Python explícito, no SQL |

## 4. Brechas a corregir antes del port (aplicables también en SQLite)

Cada una es una migración aditiva propia, con prueba. Ninguna es urgente para el uso local actual.

- **G1** `watchlist_targets`: añadir `org_id` y FK compuesta `(org_id, watchlist_id)` hacia `company_watchlist(org_id, id)` con `UNIQUE(org_id, id)` en la tabla padre.
- **G2** `provider_cache`: añadir `org_id` a la clave, o documentar y probar que solo guarda respuestas públicas. Lo segundo exige que ningún conector ponga credenciales en la URL.
- **G3** `company_target`: decidir si es catálogo público compartido (correcto, sin `org_id`) o por organización. Documentar la decisión en la spec.
- **G4** PK global `id` sin `UNIQUE(org_id, id)`: añadirla antes de convertir esas tablas en destino de FK.
- **G5** Accesos por id sin `org_id`: el worker de IA toma la siguiente generación en cola con `SELECT ... WHERE status='queued' LIMIT 1` sin organización ([ai.py:151](../../apps/api/career/ai.py)) y después la actualiza solo por `id` ([ai.py:154](../../apps/api/career/ai.py)). Es un worker global por diseño, pero la escritura debe ir por `(org_id, id)` y la cola debe conservar la organización de la fila. Las lecturas de `saved_searches` sí filtran por organización ([main.py:171](../../apps/api/career/main.py)). Corregir y probar con dos organizaciones antes del port.
- **G6** Dos fuentes de esquema (`migrations.py` y `ensureSchema` del Worker): elegir una como fuente única antes del port. Hoy divergen en FKs, índices y columnas de vigencia.

## 5. Diseño RLS para el proyecto Supabase propio

- **Proyecto**: nuevo, creado por el operador y separado de `growth-ops-app`. Crearlo tiene coste y cuenta externa: requiere autorización explícita. No se crea desde este documento.
- **Exposición**: el navegador no consulta Postgres directamente. Toda lectura pasa por la API. Las tablas de datos viven en un esquema no expuesto (`career_private`) y, aun así, **RLS está activado en todas**. Si algún día se expone PostgREST, la política ya está ahí.
- **Membresía**: `org_members(org_id, user_id, role)`, PK `(org_id, user_id)` e índice adicional en `user_id`. Las políticas usan `(select auth.uid())` y `WITH CHECK` en escrituras.
- **Roles de aplicación**: `admin` (miembro de la organización con rol administrador) y `student` (solo lectura de revisiones `approved` y `published`, a través de vistas o funciones).
- **Datos admin-only** (sin política para alumnas): `raw_items`, configuración de proveedores, costes, contactos privados y eventos de verificación.
- **Funciones**: ninguna `SECURITY DEFINER` expuesta. Si se necesita una, va fuera de los esquemas expuestos, con `search_path` fijado a `''`, nombres calificados y `EXECUTE` revocado a `public`.
- **Rol del backend**: usa conexión privilegiada, que salta RLS. Por tanto el filtro por organización en código **sigue siendo obligatorio**, y el control real es el test de aislamiento, no RLS por sí solo.

## 6. Pruebas de aislamiento obligatorias antes de publicar

Con dos organizaciones (A y B) y dos usuarios sin relación:

1. Un usuario de A no lee filas de B en ninguna tabla de negocio.
2. Un usuario de A no inserta ni actualiza filas con `org_id` de B (`WITH CHECK`).
3. Un rol `anon` y uno `authenticated` sin membresía reciben cero filas.
4. Una FK compuesta impide enlazar una oferta de A con una búsqueda de B.
5. `raw_items` rechaza `UPDATE` y `DELETE`, también desde el rol de aplicación.
6. Las vistas de alumna no devuelven borradores ni `withdrawn`.
7. Las respuestas personalizadas llevan `Cache-Control: private, no-store`.

## 7. Plan por fases (cada una cerrable por separado)

- **P0** Brechas G1–G6 en SQLite, con migración aditiva y tests. Fuente única de esquema.
- **P1** DDL Postgres versionado en un directorio nuevo; carga en un proyecto Supabase vacío de preview. Recuento de filas y checksums.
- **P2** Copia de datos desde un export de SQLite con mapeo de organización explícito (`local-wdc` → organización WDC).
- **P3** Adaptador de base de datos tras la misma interfaz `connect()`, con los mismos tests de contrato.
- **P4** RLS, membresías y las siete pruebas de la sección 6, en el proyecto propio.
- **P5** Conmutación. Rollback: conservar el SQLite de solo lectura y el D1 hasta verificar.

## 8. Riesgos

- Dos motores de datos si D1 sigue en uso: mantener uno solo o documentar la frontera.
- Pausa del plan gratuito por inactividad: ya se mencionó en la sesión 30; el plan de pago se decide antes de P2.
- Divergencia de esquema entre el repo y el Worker (G6) mientras dure la transición.
- Copia de datos reales: `career.sqlite3` contiene evidencia y datos de candidatas; la copia y el export se hacen fuera del repo y sin credenciales en el log.

## Alcance de esta valoración

- Documentación únicamente. No se ejecutó código, no hubo pruebas de runtime y no se modificó ningún esquema.
- Lo verificado: el inventario del esquema (sección 1), el código citado y la documentación oficial de Supabase.
- Lo no verificado: el comportamiento real de las consultas traducidas y los costes y límites de los planes actuales (sujetos a cambio). El ADR no ejecutó el worker de IA; la brecha G5 se ha leído en el código, no reproducido.
