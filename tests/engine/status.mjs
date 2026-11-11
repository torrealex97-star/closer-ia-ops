// `/api/status` cuenta `raw_items` por RUTA DE ESCRITURA.
//
// El problema que corrige: la evidencia de vigencia se guarda en `raw_items` con `source='verification'`,
// así que el total las sumaba con los anuncios y el panel las presentaba juntas como «registros
// recogidos» (el 2026-11-11 eran 574 de 5.168). Una cifra que mezcla dos cosas no sirve para decidir.
//
// Lo que fija:
//   · `raw_items` sigue siendo el total (compatibilidad con quien ya lo lee);
//   · `raw_items_by_route` da `collection` y `verification` separados, y el reparto se hace en SQL por
//     `source='verification'`, no adivinando en el cliente;
//   · una ruta sin filas es un CERO medido (es un conteo de la misma tabla), no un hueco; y un fallo de
//     la consulta no se convierte en ceros: `/api/status` falla, como antes.
// No necesita red ni Cloudflare: D1 es un stub que responde a las tres consultas del estado.
// Uso: node tests/engine/status.mjs
import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const workerPath = fileURLToPath(new URL('../../sites/engine/worker.js', import.meta.url));
const stage = join(mkdtempSync(join(tmpdir(), 'wdc-status-')), 'worker.mjs');
copyFileSync(workerPath, stage);
const worker = (await import(pathToFileURL(stage).href)).default;

// D1 mínimo: responde a las tres consultas del estado y anota el SQL para poder mirar QUÉ se pidió.
function fakeDb({ total = 0, catalog = 0, routes = [] } = {}) {
  const log = [];
  const statement = sql => {
    const stmt = {
      sql, args: [],
      bind(...args) { stmt.args = args; return stmt; },
      async all() {
        log.push({ kind: 'all', sql, args: stmt.args });
        return { results: [] };
      },
      async first() { log.push({ kind: 'first', sql, args: stmt.args }); return null; },
      async run() { log.push({ kind: 'run', sql, args: stmt.args }); return { meta: { changes: 0 } }; },
    };
    return stmt;
  };
  return {
    log,
    prepare: statement,
    async batch(stmts) {
      return stmts.map(stmt => {
        log.push({ kind: 'batch', sql: stmt.sql, args: stmt.args });
        if (/count\(\*\) AS n FROM raw_items WHERE org_id=\?$/.test(stmt.sql.trim())) return { results: [{ n: total }] };
        if (/count\(\*\) AS n FROM catalog_entries/.test(stmt.sql)) return { results: [{ n: catalog }] };
        if (/GROUP BY route/.test(stmt.sql)) return { results: routes };
        if (/SUM\(writes\)/.test(stmt.sql)) return { results: [{ writes: 0 }] };
        if (/SELECT writes FROM write_ledger/.test(stmt.sql)) return { results: [{ writes: 0 }] };
        return { meta: { changes: 0 } };
      });
    },
  };
}

const status = async db => {
  const response = await worker.fetch(new Request('https://engine.test/api/status'), { DB: db }, {});
  return { status: response.status, body: await response.json() };
};

// 1) Con las dos rutas: el total sigue estando y el desglose coincide con lo sembrado.
{
  const db = fakeDb({ total: 5168, catalog: 1120, routes: [{ route: 'collection', n: 4594 }, { route: 'verification', n: 574 }] });
  const { status: code, body } = await status(db);
  assert.equal(code, 200);
  assert.equal(body.raw_items, 5168, 'el total se mantiene: quien ya lo leía no se rompe');
  assert.deepEqual(body.raw_items_by_route, { collection: 4594, verification: 574 }, 'anuncios y evidencias, cada uno en su sitio');
  assert.equal(body.raw_items_by_route.collection + body.raw_items_by_route.verification, body.raw_items, 'las dos rutas suman el total: el desglose no pierde filas');
  // El reparto se hace en la base, por la COLUMNA que lo dice (`source`), no por una lista del cliente.
  const grouped = db.log.find(entry => /GROUP BY route/.test(entry.sql ?? ''));
  assert.ok(grouped, 'se pide el desglose en la misma ronda que el total');
  assert.match(grouped.sql, /source='verification'/);
  assert.deepEqual(grouped.args, ['cloud-wdc'], 'acotado a la organización, como el resto del estado');
}

// 2) Una ruta sin filas es un cero medido (el stub devuelve solo la otra), no un hueco ni un `null`.
{
  const { body } = await status(fakeDb({ total: 12, catalog: 3, routes: [{ route: 'collection', n: 12 }] }));
  assert.deepEqual(body.raw_items_by_route, { collection: 12, verification: 0 }, 'sin evidencia de verificación: 0, y se dice');
  const vacio = await status(fakeDb({ total: 0, catalog: 0, routes: [] }));
  assert.deepEqual(vacio.body.raw_items_by_route, { collection: 0, verification: 0 }, 'base vacía: dos ceros medidos');
}

// 3) Si la consulta del desglose falla, el estado falla: no se publican ceros que parezcan medidos.
{
  const db = fakeDb({ total: 5, catalog: 1, routes: [] });
  const original = db.batch;
  db.batch = async stmts => {
    if (stmts.some(stmt => /GROUP BY route/.test(stmt.sql))) throw new Error('D1_ERROR: boom');
    return original(stmts);
  };
  await assert.rejects(() => status(db), /boom/);
}

console.log('PASS  motor: /api/status separa anuncios recogidos de evidencia de verificación, y el total sigue cuadrando');
