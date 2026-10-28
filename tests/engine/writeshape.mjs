// Forma de escritura del catálogo del motor: en D1 la cuota (100.000 filas/mes) también se gasta en
// los ÍNDICES, y el mes pasado se agotó en escrituras mientras las lecturas iban al 22%.
//
// Lo que fija esta prueba, con la conducta medida en D1 real de workerd el 2026-10-28:
//   · la forma canónica nace barata (WITHOUT ROWID: la clave es la tabla, sin índice aparte) y
//     conserva los cinco UNIQUE que son camino de LECTURA de la ingesta y del panel;
//   · un candidato nuevo cuesta 11 filas escritas en una base nueva (18 con la forma anterior) y el
//     refresco de vigencia 1 (2 antes); el modelo del stub deriva el coste del DDL, no de una lista;
//   · la migración reconstruye UNA tabla por batch (atómica), solo las declaradas `migrate`, con tope
//     de escrituras por pasada, reanudable y sin tocar nada si el esquema no se puede leer.
// No necesita red ni Cloudflare: D1 es un stub que imita `sqlite_master` y cuenta filas escritas.
// Uso: node --experimental-strip-types tests/engine/writeshape.mjs
import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const workerPath = fileURLToPath(new URL('../../sites/engine/worker.js', import.meta.url));
const stage = join(mkdtempSync(join(tmpdir(), 'wdc-writeshape-')), 'worker.mjs');
copyFileSync(workerPath, stage);
const { __testShape: t } = await import(pathToFileURL(stage).href);
const results = [];
const step = (name, fn) => { try { fn(); results.push(['PASS', name]); } catch (e) { results.push(['FAIL', name, e.message.split('\n').filter(Boolean).slice(0, 3).join(' ')]); } };
const aStep = async (name, fn) => { try { await fn(); results.push(['PASS', name]); } catch (e) { results.push(['FAIL', name, e.message.split('\n').filter(Boolean).slice(0, 3).join(' ')]); } };
const CATALOG_TABLES = ['raw_items', 'job_postings', 'jobs', 'catalog_entries', 'opportunities', 'opportunity_versions'];
const MIGRATED = ['catalog_entries'];
const LEGACY = ['raw_items', 'job_postings', 'jobs', 'opportunities', 'opportunity_versions'];
// El DDL canónico, tal como lo escribe `ensureSchema` en una base nueva.
const canonical = () => Object.fromEntries(t.CATALOG_SHAPE.map(shape => [shape.table, `CREATE TABLE ${shape.table} (${shape.columns}) WITHOUT ROWID`]));
// El DDL anterior: misma información, con rowid y el índice de caducidad del catálogo.
const legacyDdl = table => ({
  raw_items: 'CREATE TABLE raw_items (id TEXT PRIMARY KEY, org_id TEXT NOT NULL, source TEXT NOT NULL, provider TEXT NOT NULL, external_id TEXT NOT NULL, content_hash TEXT NOT NULL, payload TEXT NOT NULL, captured_at TEXT NOT NULL, UNIQUE(org_id, source, external_id, content_hash))',
  job_postings: 'CREATE TABLE job_postings (id TEXT PRIMARY KEY, org_id TEXT NOT NULL, raw_id TEXT NOT NULL, source TEXT NOT NULL, external_id TEXT NOT NULL, payload TEXT NOT NULL, UNIQUE(org_id, source, external_id))',
  jobs: 'CREATE TABLE jobs (id TEXT PRIMARY KEY, org_id TEXT NOT NULL, posting_id TEXT NOT NULL, starred INTEGER NOT NULL DEFAULT 0, UNIQUE(org_id, posting_id))',
  catalog_entries: 'CREATE TABLE catalog_entries (org_id TEXT NOT NULL, job_id TEXT NOT NULL, first_seen_at TEXT NOT NULL, expires_at TEXT NOT NULL, PRIMARY KEY(org_id, job_id))',
  opportunities: 'CREATE TABLE opportunities (id TEXT PRIMARY KEY, org_id TEXT NOT NULL, job_id TEXT NOT NULL, current_version_id TEXT, editorial_status TEXT NOT NULL DEFAULT \'draft\', opportunity_status TEXT NOT NULL DEFAULT \'verifying\', connection_type TEXT NOT NULL DEFAULT \'external_application\', created_at TEXT NOT NULL, updated_at TEXT NOT NULL, last_verified_at TEXT, verified_until TEXT, status_reason TEXT, UNIQUE(org_id, job_id))',
  opportunity_versions: 'CREATE TABLE opportunity_versions (id TEXT PRIMARY KEY, org_id TEXT NOT NULL, opportunity_id TEXT NOT NULL, version INTEGER NOT NULL, locale TEXT NOT NULL DEFAULT \'es\', payload TEXT NOT NULL, created_by TEXT NOT NULL, created_at TEXT NOT NULL, reviewed_by TEXT, reviewed_at TEXT, UNIQUE(org_id, opportunity_id, version))',
}[table]);
const legacyAll = () => Object.fromEntries(CATALOG_TABLES.map(table => [table, legacyDdl(table)]));

// D1 mínimo con `sqlite_master` de verdad y el MISMO modelo de coste que D1: una fila por la fila
// de la tabla y una por cada índice que se actualice (UNIQUE, más el de la clave si hay rowid). Así
// la aserción de «11 filas por candidato» sale del DDL y falla sola si alguien vuelve a añadir un
// índice o quita un WITHOUT ROWID.
function fakeDb({ tables = {}, sizes = {}, indexes = {}, failRead = false, failRebuild = null } = {}) {
  const state = { tables: { ...tables }, indexes: { ...indexes }, log: [], batches: [] };
  const rowsOf = name => Number(sizes[name] ?? 0);
  // Coste de insertar una fila: la tabla más cada índice que gane una entrada (UNIQUE, más el
  // implícito de la clave cuando la tabla conserva el rowid). Los índices explícitos se declaran aparte.
  const writesPerInsert = (name, ddl) => {
    const sql = ddl ?? state.tables[name] ?? '';
    const uniques = (sql.match(/UNIQUE\s*\(/gi) || []).length;
    return 1 + uniques + (state.indexes[name]?.length ?? 0) + (/WITHOUT ROWID/i.test(sql) ? 0 : 1);
  };
  // Coste de un upsert sobre una fila que YA existe: se reescribe la tabla y solo los índices cuya
  // clave cambia (medido: el refresco de vigencia pasó de 2 a 1 al quitar el índice de caducidad).
  const writesPerUpdate = (name, sql) => {
    const set = /SET ([\s\S]+)$/i.exec(sql)?.[1] ?? '';
    return 1 + (state.indexes[name] ?? []).filter(columns => columns.some(column => new RegExp(`\\b${column}\\b`).test(set))).length;
  };
  const statement = sql => {
    const stmt = {
      sql, args: [],
      bind(...args) { stmt.args = args; return stmt; },
      async all() {
        state.log.push({ kind: 'all', sql, args: stmt.args });
        if (failRead && /sqlite_master/.test(sql)) throw new Error('D1_ERROR: no such table: sqlite_master');
        if (/FROM sqlite_master/.test(sql)) {
          const names = stmt.args;
          return { results: names.filter(name => state.tables[name] !== undefined).map(name => ({ name, sql: state.tables[name] })) };
        }
        const counted = /SELECT count\(\*\) AS n FROM (\w+)/.exec(sql);
        if (counted) return { results: [{ n: rowsOf(counted[1]) }] };
        return { results: [] };
      },
      async first() { return null; },
      async run() { state.log.push({ kind: 'run', sql, args: stmt.args }); return { meta: { rows_written: 0 } }; },
    };
    return stmt;
  };
  return {
    state,
    writesPerInsert,
    prepare: statement,
    async batch(stmts) {
      state.batches.push(stmts.map(s => s.sql));
      if (failRebuild && stmts.some(s => new RegExp(failRebuild).test(s.sql))) throw new Error('D1_ERROR: batch falló');
      const created = {};
      const out = stmts.map(s => {
        state.log.push({ kind: 'batch-stmt', sql: s.sql, args: s.args });
        const create = /^CREATE TABLE (\w+) \(/.exec(s.sql);
        if (create) created[create[1]] = s.sql;
        // Copiar una tabla cuesta lo que costaría insertar sus filas en la tabla destino (que puede
        // no existir todavía en `sqlite_master`: la acaba de crear este mismo lote).
        const copy = /^INSERT INTO (\w+) .*? SELECT .*? FROM (\w+)$/i.exec(s.sql);
        if (copy) return { meta: { rows_written: rowsOf(copy[2]) * writesPerInsert(copy[1], created[copy[1]]) } };
        const into = /^(?:INSERT(?: OR IGNORE)? INTO|UPDATE) (\w+)/i.exec(s.sql);
        if (into) {
          const rows = /ON CONFLICT .* DO UPDATE/i.test(s.sql) ? writesPerUpdate(into[1], s.sql) : writesPerInsert(into[1], created[into[1]]);
          return { meta: { rows_written: rows } };
        }
        return { meta: { rows_written: 0 } };
      });
      for (const s of stmts) {
        const rename = /^ALTER TABLE (\w+) RENAME TO (\w+)$/.exec(s.sql);
        if (rename && created[rename[1]] !== undefined) {
          delete state.tables[rename[2]];
          state.tables[rename[2]] = created[rename[1]];
        }
        const drop = /^DROP TABLE (?!IF EXISTS)(\w+)$/.exec(s.sql);
        if (drop) delete state.tables[drop[1]];
      }
      return out;
    },
  };
}

step('la forma canónica: seis tablas WITHOUT ROWID y los cinco índices que sirven de lectura', () => {
  assert.deepEqual(t.CATALOG_SHAPE.map(shape => shape.table), CATALOG_TABLES, 'exactamente las tablas del camino de un candidato');
  for (const shape of t.CATALOG_SHAPE) {
    assert.match(shape.columns, /PRIMARY KEY/i, `${shape.table}: clave primaria en la propia tabla`);
    assert.equal(/WITHOUT ROWID/i.test(shape.columns), false, `${shape.table}: WITHOUT ROWID se añade al crear, no en las columnas`);
    for (const name of shape.names) assert.match(shape.columns, new RegExp(`\\b${name}\\b`), `${shape.table}: la columna ${name} existe`);
  }
  // Los UNIQUE no son adorno: son la consulta de `known`, los joins del panel y el de la alumna. Si
  // alguien los quita «para ahorrar», esta prueba lo dice antes de que la ingesta empiece a escanear.
  const uniques = table => (t.CATALOG_SHAPE.find(shape => shape.table === table).columns.match(/UNIQUE\s*\([^)]*\)/gi) || []).map(sql => sql.replace(/\s+/g, ''));
  assert.deepEqual(uniques('raw_items'), ['UNIQUE(org_id,source,external_id,content_hash)']);
  assert.deepEqual(uniques('job_postings'), ['UNIQUE(org_id,source,external_id)']);
  assert.deepEqual(uniques('jobs'), ['UNIQUE(org_id,posting_id)']);
  assert.deepEqual(uniques('opportunities'), ['UNIQUE(org_id,job_id)']);
  assert.deepEqual(uniques('opportunity_versions'), ['UNIQUE(org_id,opportunity_id,version)']);
  assert.deepEqual(uniques('catalog_entries'), [], 'el catálogo no necesita índice aparte: la clave es (org_id, job_id)');
  // Solo se migra la que cuesta una fila por fila existente; las demás siguen con rowid por ahora.
  assert.deepEqual(t.CATALOG_SHAPE.filter(shape => shape.migrate).map(shape => shape.table), MIGRATED);
  assert.deepEqual(t.CATALOG_SHAPE.filter(shape => !shape.migrate).map(shape => shape.table), LEGACY);
});

await aStep('el esquema nuevo nace barato y sin el índice de caducidad', async () => {
  const db = fakeDb();
  await t.ensureSchema(db);
  const creates = db.state.log.filter(entry => entry.kind === 'batch-stmt' && /^CREATE TABLE IF NOT EXISTS /.test(entry.sql));
  for (const table of CATALOG_TABLES) {
    const create = creates.find(entry => new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\(`).test(entry.sql));
    assert.ok(create, `${table}: se crea`);
    assert.match(create.sql, /WITHOUT ROWID/i, `${table}: nace sin rowid (la clave es la tabla)`);
  }
  const indexes = db.state.log.filter(entry => /^CREATE INDEX/i.test(entry.sql || '')).map(entry => entry.sql);
  assert.equal(indexes.some(sql => /catalog_entries/.test(sql)), false, 'sin índice de caducidad sobre el catálogo');
  // Y nada más del esquema pierde lo que sí usa: el de las comprobaciones de vigencia sigue.
  assert.equal(indexes.some(sql => /verification_events/.test(sql)), true, 'el índice de evidencia de vigencia se conserva');
});

await aStep('un candidato nuevo cuesta 11 filas: seis de datos, cinco de los índices que se conservan', async () => {
  const db = fakeDb({ tables: canonical() });
  const candidate = {
    external_id: 'ext-1',
    payload: { title: 'Closer de ventas high-ticket', company: 'ACME', location: 'Madrid', url: 'https://example.com/oferta-1', posted_at: '2026-10-20' },
  };
  const writes = await t.ingestBatch(db, { code: 'freehire-closer' }, [candidate], new Map());
  const statements = db.state.log.filter(entry => entry.kind === 'batch-stmt');
  assert.equal(statements.length, 6, 'seis sentencias, una por tabla del camino');
  assert.deepEqual(statements.map(entry => /(?:INTO|UPDATE) (\w+)/.exec(entry.sql)[1]), CATALOG_TABLES);
  assert.equal(writes, 11, '11 filas escritas: 6 de tabla + 5 de los UNIQUE que sirven de lectura');
  // El reparto por tabla es el medido: el catálogo es la única sin índice propio.
  assert.deepEqual(statements.map(entry => db.writesPerInsert(/(?:INTO|UPDATE) (\w+)/.exec(entry.sql)[1])), [2, 2, 2, 1, 2, 2]);
  // En la base en producción hoy (rowid + los cinco UNIQUE + el índice de caducidad) el mismo
  // candidato cuesta 18; con solo el catálogo migrado baja a 16. La diferencia entre 16 y 11 es lo
  // que ahorraría reconstruir las cinco tablas caras, y por eso se aplaza a una ventana con cuota.
  const legacyIndexes = { catalog_entries: [['org_id', 'expires_at']] };
  const old = fakeDb({ tables: legacyAll(), indexes: legacyIndexes });
  assert.equal(await t.ingestBatch(old, { code: 'freehire-closer' }, [candidate], new Map()), 18);
  const half = fakeDb({ tables: { ...legacyAll(), catalog_entries: canonical().catalog_entries }, indexes: { ...legacyIndexes, catalog_entries: [] } });
  assert.equal(await t.ingestBatch(half, { code: 'freehire-closer' }, [candidate], new Map()), 16);
});

await aStep('la evidencia cruda se deduplica por la clave: el mismo anuncio no duplica filas al reintentar', async () => {
  const source = { code: 'freehire-closer' };
  const payload = { title: 'Closer de ventas', company: 'ACME', location: 'Madrid', url: 'https://example.com/oferta-2' };
  const first = fakeDb({ tables: canonical() });
  await t.ingestBatch(first, source, [{ external_id: 'ext-2', payload }], new Map());
  const again = fakeDb({ tables: canonical() });
  await t.ingestBatch(again, source, [{ external_id: 'ext-2', payload }], new Map());
  const argsOf = (db, table) => db.state.log.find(entry => new RegExp(`INTO ${table} `).test(entry.sql)).args;
  assert.equal(argsOf(first, 'raw_items')[0], argsOf(again, 'raw_items')[0], 'mismo id de raw en los dos intentos');
  assert.equal(argsOf(first, 'job_postings')[0], argsOf(again, 'job_postings')[0], 'y mismo posting y job');
  // Un contenido distinto (anuncio editado) sí entra como evidencia nueva: no se pierde historial.
  const edited = fakeDb({ tables: canonical() });
  await t.ingestBatch(edited, source, [{ external_id: 'ext-2', payload: { ...payload, title: 'Closer de ventas (actualizado)' } }], new Map());
  assert.notEqual(argsOf(edited, 'raw_items')[0], argsOf(first, 'raw_items')[0]);
  // Vigencia fresca (más de dos días por delante): no se escribe NADA, ni evidencia ni catálogo.
  const contentHash = argsOf(first, 'raw_items')[5];
  const fresh = fakeDb({ tables: canonical() });
  const skipped = await t.ingestBatch(fresh, source, [{ external_id: 'ext-2', payload }],
    new Map([[`ext-2|${contentHash}`, Date.now() + 9 * 86400000]]));
  assert.equal(fresh.state.log.length, 0, 'ni una sentencia: el anuncio sigue fresco');
  assert.equal(skipped, 0);
  // A punto de vencer: solo se refresca la fila del catálogo (1 escritura), la evidencia no se toca.
  const expiring = fakeDb({ tables: canonical() });
  const writes = await t.ingestBatch(expiring, source, [{ external_id: 'ext-2', payload }],
    new Map([[`ext-2|${contentHash}`, Date.now() + 3600000]]));
  const cheap = expiring.state.log.filter(entry => entry.kind === 'batch-stmt');
  assert.equal(cheap.length, 1, 'una sola sentencia: refrescar la vigencia');
  assert.match(cheap[0].sql, /catalog_entries/);
  assert.equal(writes, 1, 'el refresh barato del catálogo es 1 fila');
  // En la forma anterior el mismo refresh costaba 2 (tabla + índice de la clave). La diferencia es
  // la que paga la reconstrucción del catálogo.
  const legacyRefresh = fakeDb({ tables: legacyAll() });
  assert.equal(await t.ingestBatch(legacyRefresh, source, [{ external_id: 'ext-2', payload }],
    new Map([[`ext-2|${contentHash}`, Date.now() + 3600000]])), 2);
});

await aStep('qué sigue pendiente se lee del esquema REAL, no de una versión supuesta', async () => {
  const mixed = legacyAll();
  mixed.catalog_entries = `CREATE TABLE catalog_entries (org_id TEXT NOT NULL, job_id TEXT NOT NULL, first_seen_at TEXT NOT NULL, expires_at TEXT NOT NULL, PRIMARY KEY(org_id, job_id)) WITHOUT ROWID`;
  assert.deepEqual(await t.writeShapeState(fakeDb({ tables: mixed })), { pending: [], legacy: LEGACY }, 'solo queda por migrar lo que se migra');
  assert.deepEqual(await t.writeShapeState(fakeDb({ tables: legacyAll() })), { pending: MIGRATED, legacy: LEGACY });
  assert.deepEqual(await t.writeShapeState(fakeDb({ tables: canonical() })), { pending: [], legacy: [] });
  // Una tabla que todavía no existe no está pendiente: la crea `ensureSchema` ya barata.
  assert.deepEqual(await t.writeShapeState(fakeDb({ tables: {} })), { pending: [], legacy: [] });
  // Si el esquema no se puede leer NO se supone nada: `null` no es «todo migrado».
  assert.equal(await t.writeShapeState(fakeDb({ failRead: true })), null);
});

await aStep('la migración reconstruye en UN batch (atómica) y cuenta lo que escribe', async () => {
  const shape = t.CATALOG_SHAPE.find(item => item.table === 'catalog_entries');
  const db = fakeDb({ tables: legacyAll(), sizes: { catalog_entries: 2400 }, indexes: { catalog_entries: [['org_id', 'expires_at']] } });
  const writes = await t.rebuildWriteShape(db, shape);
  assert.equal(db.state.batches.length, 1, 'un solo batch: o queda entera o no cambia nada');
  assert.deepEqual(db.state.batches[0].map(sql => sql.split(' ').slice(0, 2).join(' ')), [
    'DROP TABLE', 'CREATE TABLE', 'INSERT INTO', 'DROP TABLE', 'ALTER TABLE',
  ], 'borra el resto, crea, copia, borra y renombra: en ese orden');
  assert.equal(writes, 2400, 'una fila escrita por fila copiada: el catálogo no arrastra UNIQUE');
  assert.match(db.state.tables.catalog_entries, /WITHOUT ROWID/i, 'la tabla queda con la forma nueva');
  assert.deepEqual(await t.writeShapeState(db), { pending: [], legacy: LEGACY }, 'y deja de estar pendiente');
});

await aStep('la migración no cruza el techo diario ni se come la recogida; lo que no cabe se aplaza', async () => {
  const db = fakeDb({ tables: legacyAll(), sizes: { catalog_entries: 2400 } });
  const first = await t.migrateWriteShape(db, { month_writes: 0, day_writes: 0 });
  assert.deepEqual(first.rebuilt, MIGRATED, 'se migra el catálogo, que es lo que cabe y lo que más ahorra');
  assert.equal(first.writes, 2400);
  assert.deepEqual(first.pending, []);
  assert.deepEqual(first.legacy, LEGACY, 'las cinco caras se declaran, no se finge que están hechas');
  // El índice de caducidad se quita en la MISMA pasada, sin esperar a la reconstrucción: es el
  // ahorro del refresco (2 → 1) y no depende de que la tabla se reconstruya.
  assert.equal(db.state.log.filter(entry => /DROP INDEX IF EXISTS idx_catalog_expiry/.test(entry.sql)).length, 1);
  const again = await t.migrateWriteShape(db, { month_writes: 0, day_writes: 0 });
  assert.deepEqual(again.rebuilt, [], 'idempotente: no se reconstruye dos veces');
  assert.equal(db.state.batches.length, 1);
  // El tope por pasada: un catálogo que no cabe en el presupuesto de la pasada se aplaza entero (nunca
  // a medias) y se declara.
  const big = fakeDb({ tables: legacyAll(), sizes: { catalog_entries: t.MIGRATION_MAX_WRITES } });
  const deferred = await t.migrateWriteShape(big, { month_writes: 0, day_writes: 0 });
  assert.deepEqual(deferred.rebuilt, []);
  assert.deepEqual(deferred.pending, MIGRATED);
  assert.equal(big.state.batches.length, 0);
  // Sin hueco de cuota tampoco: el mes agotado es exactamente el estado del 28 de octubre.
  const monthMax = Math.floor(t.WRITE_ALLOWANCE.month * t.WRITE_GUARD_RATIO);
  const tightDb = fakeDb({ tables: legacyAll(), sizes: { catalog_entries: 100 } });
  const tight = await t.migrateWriteShape(tightDb, { month_writes: monthMax, day_writes: 0 });
  assert.deepEqual(tight.rebuilt, []);
  assert.deepEqual(tight.pending, MIGRATED);
  // Sin cuota para reconstruir, el índice de caducidad se quita igual: el refresco cuesta 1 en vez de 2.
  assert.equal(tightDb.state.log.filter(entry => /DROP INDEX IF EXISTS idx_catalog_expiry/.test(entry.sql)).length, 1);
  // Un fallo de reconstrucción se declara y no revienta la pasada: el catálogo ya recogido se sirve.
  const broken = fakeDb({ tables: legacyAll(), sizes: { catalog_entries: 10 }, failRebuild: 'INSERT INTO' });
  const failed = await t.migrateWriteShape(broken, { month_writes: 0, day_writes: 0 });
  assert.deepEqual(failed.rebuilt, []);
  assert.deepEqual(failed.pending, MIGRATED, 'lo que falló sigue pendiente para la próxima');
  // Y si no se puede leer el esquema, tampoco se escribe: un fallo de lectura no justifica tocar nada.
  const blind = fakeDb({ failRead: true });
  const unreadable = await t.migrateWriteShape(blind, { month_writes: 0, day_writes: 0 });
  assert.equal(unreadable.pending, null);
  assert.equal(unreadable.writes, 0);
  assert.equal(blind.state.batches.length, 0);
  assert.equal(blind.state.log.filter(entry => entry.kind !== 'all').length, 0, 'si el esquema no se puede leer no se escribe nada, ni el índice');
});

const failed = results.filter(([state]) => state === 'FAIL');
for (const [state, name, detail] of results) console.log(`${state}  ${name}${detail ? ` — ${detail}` : ''}`);
if (failed.length) {
  console.error(`\n${failed.length} de ${results.length} fallos`);
  process.exit(1);
}
console.log('\nPASS  motor: forma de escritura medida (11 filas por candidato), índices de lectura intactos y migración atómica');
