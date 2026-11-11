// Exportación de la base del motor: mover el motor a una cuenta propia de Cloudflare exige sacar el
// catálogo de la D1 actual, que vive en una cuenta gestionada donde no hay `wrangler d1 export` que
// se pueda usar. Lo que fija esta prueba:
//   · la ruta NO es pública: sin `ADMIN_TOKEN` no responde y con cabecera equivocada da 401;
//   · solo exporta las tablas de la lista blanca y `write_ledger` queda FUERA (mide la cuota de esta
//     cuenta: heredarlo contaría como gastado lo que la cuenta nueva aún no ha escrito);
//   · devuelve SQL listo para `wrangler d1 execute --file`, con las columnas del esquema REAL, los
//     textos escapados (comillas dobladas) y paginación por cursor de clave;
//   · exportar NO gasta cuota: ni una fila escrita.
// Uso: node --experimental-strip-types tests/engine/export.mjs
import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const workerPath = fileURLToPath(new URL('../../sites/engine/worker.js', import.meta.url));
const stage = join(mkdtempSync(join(tmpdir(), 'wdc-engine-export-')), 'worker.mjs');
copyFileSync(workerPath, stage);
const module = await import(pathToFileURL(stage).href);
const worker = module.default;
const { sqlLiteral, EXPORT_TABLES } = module.__testExport;

// D1 mínimo con esquema real (PRAGMA) y una tabla de la que se sirve una página por consulta.
function fakeDb({ columns = ['id', 'org_id', 'payload'], rows = [] } = {}) {
  const log = [];
  const statement = sql => {
    const stmt = {
      sql, args: [],
      bind(...args) { stmt.args = args; return stmt; },
      async all() {
        log.push({ kind: 'select', sql, args: stmt.args });
        if (/PRAGMA table_info/.test(sql)) return { results: columns.map(name => ({ name })) };
        if (/SELECT \* FROM/.test(sql)) {
          const [after, limit] = stmt.args;
          const page = rows.filter(row => String(row.id) > String(after)).slice(0, Number(limit));
          return { results: page };
        }
        return { results: [] };
      },
      async first() { log.push({ kind: 'first', sql }); return null; },
      async run() {
        log.push({ kind: 'run', sql });
        if (/^ALTER/i.test(sql)) throw new Error('duplicate column name');
        return { meta: { changes: 0 } };
      },
    };
    return stmt;
  };
  return {
    log,
    prepare: statement,
    async batch(stmts) {
      for (const s of stmts) log.push({ kind: 'batch-stmt', sql: s.sql });
      return stmts.map(s => (/count\(\*\)/i.test(s.sql) ? { results: [{ n: 0 }] } : { results: [], meta: { changes: 0 } }));
    },
  };
}

const exportCall = async (db, env, query) => {
  const response = await worker.fetch(new Request(`https://engine.test/api/export?${query}`, { headers: env.headers ?? {} }), { DB: db, ...env }, {});
  return { code: response.status, body: await response.json(), cors: response.headers.get('Access-Control-Allow-Origin') };
};

// 0) El literal SQL no puede romper el archivo de importación.
{
  assert.equal(sqlLiteral("Closer 'high ticket'"), "'Closer ''high ticket'''");
  assert.equal(sqlLiteral(null), 'NULL');
  assert.equal(sqlLiteral(undefined), 'NULL');
  assert.equal(sqlLiteral(7), '7');
  assert.equal(sqlLiteral('a\u0000b'), "'ab'", 'los bytes nulos se descartan, no viajan al SQL');
}

// 1) Sin credencial no hay exportación: primero falta el secreto (403), después la cabecera falla (401).
{
  const db = fakeDb({ rows: [{ id: 'raw-1', org_id: 'cloud-wdc', payload: '{}' }] });
  const sinSecreto = await exportCall(db, {}, 'table=raw_items');
  assert.equal(sinSecreto.code, 403);
  const malaCabecera = await exportCall(db, { ADMIN_TOKEN: 'secreto' }, 'table=raw_items');
  assert.equal(malaCabecera.code, 401);
  assert.equal(db.log.filter(entry => /SELECT \* FROM/.test(entry.sql)).length, 0, 'sin credencial no se lee ni una fila');
}

// 2) Lista blanca: `write_ledger` y el esquema quedan fuera, y el error dice qué SÍ se puede pedir.
{
  const ok = { ADMIN_TOKEN: 'secreto', headers: { 'X-Admin-Token': 'secreto' } };
  assert.equal(EXPORT_TABLES.write_ledger, undefined, 'la cuota de esta cuenta no se hereda');
  assert.equal(EXPORT_TABLES.schema_version, undefined);
  const negada = await exportCall(fakeDb(), ok, 'table=write_ledger');
  assert.equal(negada.code, 400);
  assert.ok(negada.body.tables.includes('opportunities'));
  assert.ok(negada.body.tables.includes('raw_items'));
}

// 3) Exportar devuelve SQL con las columnas del esquema real, los textos escapados y el cursor para la
//    página siguiente; una página corta cierra la tabla (`next: null`). Y no escribe una sola fila.
{
  const ok = { ADMIN_TOKEN: 'secreto', headers: { 'X-Admin-Token': 'secreto' } };
  const db = fakeDb({
    columns: ['id', 'org_id', 'payload'],
    rows: [
      { id: 'raw-1', org_id: 'cloud-wdc', payload: "{\"title\":\"Closer 'senior'\"}" },
      { id: 'raw-2', org_id: 'cloud-wdc', payload: '{"title":"SDR"}' },
    ],
  });
  const { code, body, cors } = await exportCall(db, ok, 'table=raw_items&limit=2');
  assert.equal(code, 200);
  assert.equal(cors, null, 'ruta de operador: sin CORS, ningún navegador de otro origen la lee');
  assert.deepEqual(body.columns, ['id', 'org_id', 'payload']);
  assert.equal(body.rows, 2);
  assert.equal(body.next, 'raw-2');
  assert.match(body.sql, /INSERT OR REPLACE INTO raw_items \(id, org_id, payload\) VALUES \('raw-1', 'cloud-wdc', '\{"title":"Closer ''senior''"\}'\);/);
  // `INSERT OR IGNORE` de schema_version es el DDL del esquema, no una fila de datos.
  assert.equal(db.log.filter(entry => /^(INSERT|UPDATE|DELETE)/i.test(entry.sql) && !/schema_version/.test(entry.sql)).length, 0,
    'exportar no gasta cuota de escritura');

  const corta = await exportCall(fakeDb({ rows: [{ id: 'raw-9', org_id: 'cloud-wdc', payload: '{}' }] }), ok, 'table=raw_items&limit=200');
  assert.equal(corta.body.next, null, 'la última página se declara cerrada');

  // Un `limit` absurdo no rompe la consulta: se acota a [1, 500].
  const acotado = await exportCall(fakeDb({ rows: [] }), ok, 'table=raw_items&limit=99999');
  assert.equal(acotado.code, 200);
  assert.equal(acotado.body.rows, 0);
}

console.log('PASS  motor: exportación con credencial, lista blanca sin write_ledger y sin gastar cuota');
