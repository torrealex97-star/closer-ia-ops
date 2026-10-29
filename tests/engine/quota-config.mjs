// El guardián de cuota tiene que poder SUBIR de techo sin recompilar el motor: pasar a un plan de pago
// (50 M de filas escritas al mes) o a una cuenta propia se hace con variables de entorno, no con un
// cambio de código. Lo que fija esta prueba:
//   · los defectos siguen siendo los del plan gratuito (100.000/mes, 10.000/día, margen 0.85);
//   · `WRITE_ALLOWANCE_MONTH`/`_DAY`/`WRITE_GUARD_RATIO` cambian los límites EFECTIVOS y la puerta;
//   · `WRITE_ALLOWANCE_DAY=0` apaga solo el freno diario (el plan de pago no tiene techo diario);
//   · un valor inválido NO se convierte en cero: se descarta, se declara en `config.ignored` y se usa
//     el defecto — un `0` accidental no puede dejar al motor sin recoger para siempre.
// Uso: node --experimental-strip-types tests/engine/quota-config.mjs
import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const workerPath = fileURLToPath(new URL('../../sites/engine/worker.js', import.meta.url));
const stage = join(mkdtempSync(join(tmpdir(), 'wdc-engine-quota-')), 'worker.mjs');
copyFileSync(workerPath, stage);
const module = await import(pathToFileURL(stage).href);
const worker = module.default;
const { writeAllowance } = module.__test;
const { writeLimits } = module.__testShape;

// D1 mínimo: el registro de cuota devuelve lo sembrado; el esquema no gasta filas.
function fakeDb({ month = 0, day = 0 } = {}) {
  const log = [];
  const statement = sql => {
    const stmt = {
      sql, args: [],
      bind(...args) { stmt.args = args; return stmt; },
      async all() { log.push({ kind: 'all', sql }); return { results: [] }; },
      async first() { log.push({ kind: 'first', sql }); return null; },
      async run() {
        log.push({ kind: 'run', sql });
        if (/^ALTER/i.test(sql)) throw new Error('duplicate column name');
        return { meta: { changes: 1 } };
      },
    };
    return stmt;
  };
  return {
    log,
    prepare: statement,
    async batch(stmts) {
      for (const s of stmts) log.push({ kind: 'batch-stmt', sql: s.sql });
      return stmts.map(s => {
        if (/AS writes FROM write_ledger/.test(s.sql)) return { results: [{ writes: month }] };
        if (/SELECT writes FROM write_ledger/.test(s.sql)) return { results: [{ writes: day }] };
        if (/count\(\*\)/i.test(s.sql)) return { results: [{ n: 0 }] };
        return { results: [], meta: { changes: 0 } };
      });
    },
  };
}

const statusOf = async env => {
  const response = await worker.fetch(new Request('https://engine.test/api/status'), env, {});
  return { code: response.status, body: await response.json() };
};

const collect = async (db, env) => {
  const response = await worker.fetch(
    new Request('https://engine.test/api/collect', { method: 'POST', headers: { 'X-Collect-Token': 'collect-token' } }),
    { DB: db, COLLECT_TOKEN: 'collect-token', MAX_SUBREQUESTS: 50, ...env },
    {},
  );
  return { code: response.status, body: await response.json() };
};

// 0) Defectos intactos: escribir el motor sin variables no cambia nada de lo verificado en octubre.
{
  const limits = writeLimits({});
  assert.deepEqual({ month: limits.month, day: limits.day, ratio: limits.ratio }, { month: 100000, day: 10000, ratio: 0.85 });
  assert.deepEqual(limits.ignored, []);
  assert.equal(writeAllowance({ month: 84999, day: 0 }, limits).ok, true);
  assert.equal(writeAllowance({ month: 85000, day: 0 }, limits).reason, 'month');
}

// 1) Plan de pago: 50 M al mes y sin freno diario. La misma lectura que antes cruzaba el techo ya no
//    lo cruza, y el `config` publicado dice contra qué techo se mide.
{
  const limits = writeLimits({ WRITE_ALLOWANCE_MONTH: '50000000', WRITE_ALLOWANCE_DAY: '0', WRITE_GUARD_RATIO: '1' });
  assert.equal(limits.month, 50000000);
  assert.equal(limits.day, 0);
  assert.equal(limits.ratio, 1);
  assert.equal(writeAllowance({ month: 50000000, day: 0 }, limits).reason, 'month');
  assert.equal(writeAllowance({ month: 49999999, day: 120000 }, limits).ok, true, 'sin día, 120.000 en un día no cierra la puerta');
  const gate = writeAllowance({ month: 1000, day: 0 }, limits);
  assert.equal(gate.day_max, null, 'sin freno diario se publica null, no un cero que parezca agotado');
}

// 2) Valores raros: se descartan y se declaran. Nunca un cero silencioso.
{
  const limits = writeLimits({ WRITE_ALLOWANCE_MONTH: 'muchas', WRITE_ALLOWANCE_DAY: '-5', WRITE_GUARD_RATIO: '0' });
  assert.deepEqual({ month: limits.month, day: limits.day, ratio: limits.ratio }, { month: 100000, day: 10000, ratio: 0.85 });
  assert.deepEqual(limits.ignored.sort(), ['WRITE_ALLOWANCE_DAY', 'WRITE_ALLOWANCE_MONTH', 'WRITE_GUARD_RATIO']);
  // Formas aceptadas del ratio: decimal, porcentaje y coma decimal.
  assert.equal(writeLimits({ WRITE_GUARD_RATIO: '85' }).ratio, 0.85);
  assert.equal(writeLimits({ WRITE_GUARD_RATIO: '0,9' }).ratio, 0.9);
  assert.equal(writeLimits({ WRITE_GUARD_RATIO: '0.1' }).ratio, 0.1);
  // Un freno diario por encima del mensual se recorta al mensual (no tiene sentido y confunde el panel).
  const recortado = writeLimits({ WRITE_ALLOWANCE_MONTH: '1000', WRITE_ALLOWANCE_DAY: '5000' });
  assert.equal(recortado.day, 1000);
}

// 3) `/api/status` publica los límites efectivos, con o sin descartes.
{
  const ok = await statusOf({ DB: fakeDb({ month: 1200, day: 40 }), WRITE_ALLOWANCE_MONTH: '50000000', WRITE_ALLOWANCE_DAY: '0' });
  assert.equal(ok.code, 200);
  assert.deepEqual(ok.body.write_allowance.config, { month: 50000000, day: 0, ratio: 0.85 });
  assert.equal(ok.body.write_allowance.max, 42500000, 'el techo publicado es el efectivo: mes × margen');
  const malo = await statusOf({ DB: fakeDb(), WRITE_GUARD_RATIO: 'abc' });
  assert.deepEqual(malo.body.write_allowance.config.ignored, ['WRITE_GUARD_RATIO']);
  assert.equal(malo.body.write_allowance.config.ratio, 0.85);
}

// 4) La puerta REAL de la recogida usa el entorno: con 90.000 filas escritas (por encima del techo
//    gratuito) y un plan de pago declarado, se recoge; con el techo pequeño, se para y se declara.
{
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('', { status: 200 });
  try {
    const pago = await collect(fakeDb({ month: 90000, day: 9000 }), { WRITE_ALLOWANCE_MONTH: '50000000', WRITE_ALLOWANCE_DAY: '0' });
    assert.equal(pago.body.skipped, undefined, 'el techo del plan de pago no se cruza con 90.000/9.000');
    assert.ok(pago.body.run_id);
    assert.equal(pago.body.write_allowance.config.month, 50000000);

    const pequeño = await collect(fakeDb({ month: 900, day: 0 }), { WRITE_ALLOWANCE_MONTH: '1000' });
    assert.equal(pequeño.body.skipped, true);
    assert.equal(pequeño.body.write_allowance.reason, 'month');
    assert.equal(pequeño.body.write_allowance.max, 850, 'el techo efectivo es 1.000 × 0,85');
    assert.equal(pequeño.body.write_allowance.config.month, 1000);
  } finally {
    globalThis.fetch = realFetch;
  }
}

console.log('PASS  motor: guardián de cuota configurable por entorno (defectos del plan gratuito intactos)');
