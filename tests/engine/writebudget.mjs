// Cuota de escritura del motor: el techo que pausa el sitio ENTERO (100.000 filas escritas al mes
// en D1) no lo descubre la plataforma por nosotros, así que el motor se para ANTES y sigue sirviendo.
// Uso: node --experimental-strip-types tests/engine/writebudget.mjs
// No necesita red ni Cloudflare: el worker se importa del repo, D1 es un stub que anota cada
// sentencia y los `fetch` de las fuentes se simulan. Lo que se comprueba es la CONDUCTA de la
// puerta (cuándo recoge, cuándo se para, qué anota), no la sintaxis de D1.
import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const workerPath = fileURLToPath(new URL('../../sites/engine/worker.js', import.meta.url));
const stage = join(mkdtempSync(join(tmpdir(), 'wdc-engine-budget-')), 'worker.mjs');
copyFileSync(workerPath, stage);
const workerModule = await import(pathToFileURL(stage).href);
const worker = workerModule.default;
// `__test` es un export con nombre (la puerta pura), no una propiedad del handler.
const { writeAllowance, rowsWritten } = workerModule.__test;

const MONTH_MAX = Math.floor(100000 * 0.85); // 85.000
const DAY_MAX = Math.floor(10000 * 0.85); // 8.500

// D1 mínimo: el esquema no escribe filas, los `ALTER` ya existen (lanzan, como en D1), y el
// registro de cuota devuelve lo sembrado. Anota cada sentencia para poder afirmar QUÉ se escribió.
const todayKey = () => new Date().toISOString().slice(0, 10);

// `earliest` = la fila más antigua del libro (null = libro vacío); `baseline` = línea base sembrada,
// que el stub guarda cuando la siembra la escribe, como haría D1.
function fakeDb({ month = 0, day = 0, failLedger = false, earliest = '2026-01-01', baseline = null } = {}) {
  const log = [];
  let seeded = baseline;
  const DDL = /^(CREATE|ALTER|INSERT OR IGNORE INTO schema_version)/i;
  const statement = sql => {
    const stmt = {
      sql, args: [],
      bind(...args) { stmt.args = args; return stmt; },
      async all() { log.push({ kind: 'all', sql, args: stmt.args }); return { results: [] }; },
      async first() { log.push({ kind: 'first', sql, args: stmt.args }); return null; },
      async run() {
        log.push({ kind: 'run', sql, args: stmt.args });
        if (/^ALTER/i.test(sql)) throw new Error('duplicate column name');
        if (/^INSERT INTO write_baseline/.test(sql)) {
          const [, d, m, mw, dw, source, created_at] = stmt.args;
          seeded = { day: d, month: m, month_writes: mw, day_writes: dw, source, created_at };
        }
        return { meta: { changes: DDL.test(sql) ? 0 : 1 } };
      },
    };
    return stmt;
  };
  return {
    log,
    get baseline() { return seeded; },
    prepare: statement,
    async batch(stmts) {
      for (const s of stmts) log.push({ kind: 'batch-stmt', sql: s.sql, args: s.args });
      if (stmts.some(s => /FROM write_ledger/.test(s.sql)) && failLedger) throw new Error('ledger no legible');
      return stmts.map(s => {
        if (/AS writes FROM write_ledger/.test(s.sql)) return { results: [{ writes: month }] };
        if (/SELECT writes FROM write_ledger/.test(s.sql)) return { results: [{ writes: day }] };
        if (/MIN\(day\) AS day/.test(s.sql)) return { results: earliest === null ? [] : [{ day: earliest }] };
        if (/FROM write_baseline/.test(s.sql)) return { results: seeded ? [seeded] : [] };
        if (/count\(\*\)/i.test(s.sql)) return { results: [{ n: 0 }] };
        return { results: [], meta: { changes: DDL.test(s.sql) ? 0 : 1 } };
      });
    },
  };
}

const writes = db => db.log.filter(entry => (entry.kind === 'run' || entry.kind === 'batch-stmt')
  && /^(INSERT|UPDATE|DELETE)/i.test(entry.sql) && !/schema_version|write_ledger/.test(entry.sql));
const ledgerRows = db => db.log.filter(entry => /INSERT INTO write_ledger/.test(entry.sql));

async function collect(db, { token = 'collect-token' } = {}) {
  db.log.length = 0;
  const response = await worker.fetch(
    new Request('https://engine.test/api/collect', { method: 'POST', headers: { 'X-Collect-Token': token } }),
    { DB: db, COLLECT_TOKEN: 'collect-token', MAX_SUBREQUESTS: 50 },
    {},
  );
  return { status: response.status, body: await response.json() };
}

async function status(db) {
  db.log.length = 0;
  const response = await worker.fetch(new Request('https://engine.test/api/status'), { DB: db }, {});
  return { status: response.status, body: await response.json() };
}

// 0) La puerta es pura y tiene número exacto: 85.000 al mes y 8.500 al día.
{
  assert.equal(writeAllowance({ month: 0, day: 0 }).ok, true);
  assert.equal(writeAllowance({ month: MONTH_MAX - 1, day: 0 }).ok, true);
  const mes = writeAllowance({ month: MONTH_MAX, day: 0 });
  assert.equal(mes.ok, false, 'el mes no admite pasarse ni una fila del margen');
  assert.equal(mes.reason, 'month');
  assert.equal(mes.left, 0);
  const dia = writeAllowance({ month: 1000, day: DAY_MAX });
  assert.equal(dia.ok, false, 'el tope diario también cierra la puerta');
  assert.equal(dia.reason, 'day');
  assert.equal(writeAllowance({ month: 1000, day: DAY_MAX - 1 }).ok, true);
  assert.equal(writeAllowance({}).ok, true, 'sin lectura no se cierra: no se inventa un cero');
  // La métrica que cuenta la plataforma es `rows_written`; `changes` es el respaldo.
  assert.equal(rowsWritten({ meta: { rows_written: 7 } }), 7);
  assert.equal(rowsWritten({ meta: { changes: 3 } }), 3);
  assert.equal(rowsWritten({ meta: {} }), 0);
  assert.equal(rowsWritten(null), 0);
}

// 1) El registro se publica en el estado del motor (es lo que el panel enseña para verlo venir).
{
  const db = fakeDb({ month: 1200, day: 40 });
  const { status: code, body } = await status(db);
  assert.equal(code, 200);
  assert.equal(body.write_allowance.available, true);
  assert.equal(body.write_allowance.month_writes, 1200);
  assert.equal(body.write_allowance.day_writes, 40);
  assert.equal(body.write_allowance.max, MONTH_MAX);
  assert.equal(body.write_allowance.left, MONTH_MAX - 1200);
  assert.equal(body.write_allowance.ok, true);
  assert.equal(writes(db).length, 0, 'mirar el estado no escribe nada');
}

// 2) Con el mes al techo NO se recoge —ni con `force`, que es lo que cruzó la cuota el 2026-10-26—
//    y no se escribe NADA: ni la fila del run, ni lotes de ingesta.
{
  const db = fakeDb({ month: MONTH_MAX, day: 10 });
  const { status: code, body } = await collect(db);
  assert.equal(code, 200);
  assert.equal(body.skipped, true);
  assert.equal(body.reason, 'write_allowance');
  assert.equal(body.write_allowance.reason, 'month');
  assert.match(body.note, /se reanuda al reiniciarse la cuota/i);
  assert.equal(writes(db).length, 0, 'una recogida detenida por cuota no escribe ni una fila');
  assert.equal(ledgerRows(db).length, 0, 'ni se anota una pasada que no ocurrió');
}

// 3) El tope DIARIO también cierra la puerta aunque quede mes por delante.
{
  const db = fakeDb({ month: 1000, day: DAY_MAX });
  const { body } = await collect(db);
  assert.equal(body.skipped, true);
  assert.equal(body.write_allowance.reason, 'day');
  assert.equal(writes(db).length, 0);
}

// 4) Con cuota disponible SÍ se recoge (fetch de fuentes simulado: sin candidatos) y la pasada queda
//    anotada en el registro, que es lo que mantiene el guardián con números reales.
{
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('', { status: 200 });
  try {
    const db = fakeDb({ month: 100 });
    const { status: code, body } = await collect(db);
    assert.equal(code, 200);
    assert.equal(body.skipped, undefined, 'con cuota, la recogida corre');
    assert.ok(body.run_id, 'y deja su run');
    const corridas = db.log.filter(entry => /INSERT INTO collection_runs/.test(entry.sql));
    assert.equal(corridas.length, 1, 'la fila del run se escribe una vez');
    const registro = ledgerRows(db);
    assert.equal(registro.length, 1, 'y la pasada se anota en el registro de cuota del mes');
    assert.equal(registro[0].args[2], body.writes, 'lo anotado es lo que la respuesta declara');
    assert.equal(body.writes, 3, 'su fila de run, la final y la del propio registro');
    assert.equal(body.write_allowance.charged, 3);
    assert.equal(body.write_allowance.month, new Date().toISOString().slice(0, 7));
    // El `INSERT OR IGNORE` del esquema no cuenta como fila escrita: el esquema no gasta cuota.
    assert.equal(db.log.filter(entry => /INSERT OR IGNORE INTO schema_version/.test(entry.sql)).length, 1);
  } finally {
    globalThis.fetch = realFetch;
  }
}

// 5) Si el registro no se puede leer, se declara el hueco y se SIGUE recogiendo: dejar de traer
//    ofertas por un fallo de lectura sería culpar a la cuota de un problema que no es suyo.
{
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('', { status: 200 });
  try {
    const db = fakeDb({ failLedger: true });
    const { body } = await collect(db);
    assert.equal(body.skipped, undefined);
    assert.equal(body.write_allowance.available, false, 'sin lectura no se finge un cero');
    assert.equal(body.write_allowance.month_writes, null);
    assert.equal(body.write_allowance.ok, true, 'y no se cierra la puerta por no poder leer');
  } finally {
    globalThis.fetch = realFetch;
  }
}

// 6) Un libro que arrancó HOY no da el día por bueno: lo escrito antes de que existiera el registro no
//    está contado, así que el techo diario no se puede respetar. Se cierra declarándolo, en vez de
//    seguir recogiendo sobre una cifra que parece baja y no lo es (el caso del 2026-11-08).
{
  const db = fakeDb({ month: 9000, day: 120, earliest: todayKey() });
  const { status: code, body } = await collect(db);
  assert.equal(code, 200);
  assert.equal(body.skipped, true);
  assert.equal(body.write_allowance.reason, 'day_unseeded');
  assert.equal(body.write_allowance.day_trusted, false);
  assert.match(body.note, /00:00 UTC/);
  assert.equal(writes(db).length, 0, 'un día sin contabilizar no escribe nada');
}

// 7) Con historia de días anteriores el día se da por bueno y se recoge con normalidad.
{
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('', { status: 200 });
  try {
    const db = fakeDb({ month: 9000, day: 120, earliest: '2026-10-02' });
    const { body } = await collect(db);
    assert.equal(body.skipped, undefined);
    assert.equal(body.write_allowance.day_trusted, true);
  } finally {
    globalThis.fetch = realFetch;
  }
}

// 8) La siembra guarda SOLO la parte anterior al libro (plataforma − libro) y el estado publica el
//    total contado: sembrar dos veces no suma dos veces, y el día deja de estar ciego.
{
  const db = fakeDb({ month: 400, day: 40, earliest: todayKey() });
  const seed = async (payload, token = 'admin-token') => {
    const response = await worker.fetch(new Request('https://engine.test/v1/admin/write-ledger/seed', {
      method: 'POST', headers: { 'X-Admin-Token': token, 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    }), { DB: db, ADMIN_TOKEN: 'admin-token' }, {});
    return { status: response.status, body: await response.json() };
  };
  const sinToken = await worker.fetch(new Request('https://engine.test/v1/admin/write-ledger/seed', { method: 'POST', body: '{}' }), { DB: db, ADMIN_TOKEN: 'admin-token' }, {});
  assert.equal(sinToken.status, 401, 'la siembra no es superficie pública');
  assert.equal((await seed({ month_writes: 'muchas', day_writes: 1 })).status, 422, 'un valor raro no se vuelve cero');
  assert.equal((await seed({ month_writes: 100, day_writes: 200 })).status, 422, 'el día no puede superar el mes');
  const ok = await seed({ month_writes: 16148, day_writes: 9582, source: 'Sites 2026-11-08T22:51Z' });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.baseline.month_writes, 16148 - 400, 'solo lo que el libro no tenía');
  assert.equal(ok.body.baseline.day_writes, 9582 - 40);
  assert.equal(ok.body.write_allowance.month_writes, 16148, 'el estado cuenta libro + línea base');
  assert.equal(ok.body.write_allowance.day_writes, 9582);
  assert.equal(ok.body.write_allowance.day_trusted, true, 'sembrado el día, deja de estar ciego');
  assert.equal(ok.body.write_allowance.reason, 'day', 'se cierra por techo diario, no por desconocimiento');
  assert.equal(db.log.filter(e => /INSERT INTO write_baseline/.test(e.sql)).length, 1, 'una sola fila de línea base');
  // Re-sembrar recalcula contra el libro actual: el total no se duplica.
  const otra = await seed({ month_writes: 16148, day_writes: 9582 });
  assert.equal(otra.body.write_allowance.month_writes, 16148);
  assert.equal(otra.body.baseline.month_writes, 16148 - 400);
}

console.log('PASS  motor: guardián de cuota de escritura (85.000/mes y 8.500/día), día no contabilizado y siembra del contador');
