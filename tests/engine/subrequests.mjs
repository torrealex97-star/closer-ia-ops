// Presupuesto de subrequests por pasada: el techo lo pone el PLAN del Worker (50 en el gratuito,
// 1.000 en Workers Paid) y hasta la sesión 129 estaba fijado en el código, así que el plan de pago
// no servía de nada aquí. Lo que fija esta prueba:
//   · sin variables, los defectos del plan gratuito quedan intactos (techo 50, presupuesto 16);
//   · con el techo de pago (1.000) caben las 16 fuentes en UNA pasada (coste medido 35) y la pasada
//     no aplaza ninguna; con el gratuito se aplazan las que no entran, declaradas, no fingidas;
//   · el motor nunca se da más de lo que admite el plan (MAX_SUBREQUESTS se recorta al techo);
//   · un valor inválido se descarta y se declara (`ignored`), no se convierte en «sin límite»;
//   · `/api/status` publica el presupuesto efectivo y qué fuentes aplazó el último run.
// Uso: node --experimental-strip-types tests/engine/subrequests.mjs
// No necesita red ni Cloudflare: el worker se importa del repo, D1 es un stub y los `fetch` de las
// fuentes devuelven vacío (lo que se mide es el PRESUPUESTO, no el contenido de cada portal).
import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const workerPath = fileURLToPath(new URL('../../sites/engine/worker.js', import.meta.url));
const stage = join(mkdtempSync(join(tmpdir(), 'wdc-subrequests-')), 'worker.mjs');
copyFileSync(workerPath, stage);
const workerModule = await import(pathToFileURL(stage).href);
const worker = workerModule.default;
const t = workerModule.__test;
const FREE_BUDGET = t.PLATFORM_SUBREQUEST_LIMIT - t.D1_RESERVED_SUBREQUESTS; // 16
const PAID_BUDGET = t.MAX_SUBREQUEST_CEILING - t.D1_RESERVED_SUBREQUESTS; // 966

// D1 mínimo: el esquema no escribe filas, la lectura del registro de cuota devuelve ceros y
// `collection_runs` se puede devolver sembrado para el estado. Anota cada sentencia.
function fakeDb({ run = null } = {}) {
  const log = [];
  const DDL = /^(CREATE|ALTER|INSERT OR IGNORE INTO schema_version)/i;
  const statement = sql => {
    const stmt = {
      sql, args: [],
      bind(...args) { stmt.args = args; return stmt; },
      async all() { log.push({ kind: 'all', sql, args: stmt.args }); return { results: [] }; },
      async first() {
        log.push({ kind: 'first', sql, args: stmt.args });
        if (/FROM collection_runs/.test(sql)) return run;
        return null;
      },
      async run() {
        log.push({ kind: 'run', sql, args: stmt.args });
        if (/^ALTER/i.test(sql)) throw new Error('duplicate column name');
        return { meta: { changes: DDL.test(sql) ? 0 : 1 } };
      },
    };
    return stmt;
  };
  return {
    log,
    prepare: statement,
    async batch(stmts) {
      for (const s of stmts) log.push({ kind: 'batch-stmt', sql: s.sql, args: s.args });
      return stmts.map(s => {
        if (/AS writes FROM write_ledger/.test(s.sql)) return { results: [{ writes: 0 }] };
        if (/SELECT writes FROM write_ledger/.test(s.sql)) return { results: [{ writes: 0 }] };
        if (/count\(\*\)/i.test(s.sql)) return { results: [{ n: 0 }] };
        return { results: [], meta: { changes: DDL.test(s.sql) ? 0 : 1 } };
      });
    },
  };
}

const collect = async env => {
  const response = await worker.fetch(
    new Request('https://engine.test/api/collect', { method: 'POST', headers: { 'X-Collect-Token': 'collect-token' } }),
    { DB: fakeDb(), COLLECT_TOKEN: 'collect-token', ...env },
    {},
  );
  return { status: response.status, body: await response.json() };
};
const status = async env => {
  const run = { id: 'run-x', day: '2026-10-29', status: 'completed', created_at: '2026-10-29T00:00:00Z', completed_at: '2026-10-29T00:01:00Z', sources: JSON.stringify([{ code: 'himalayas-closer', status: 'deferred' }, { code: 'jobtoday', status: 'completed' }]) };
  const response = await worker.fetch(new Request('https://engine.test/api/status'), { DB: fakeDb({ run }), ...env }, {});
  return { status: response.status, body: await response.json() };
};

// 0) La medida base del catálogo actual: 16 fuentes que, juntas, cuestan 35 subrequests de fetch.
//    Si se añade o se quita una fuente, este número se actualiza aquí (es la cifra que se publica).
const fetchCost = s => t.fetchCost(s);
const TOTAL_COST = t.SOURCES.reduce((n, s) => n + fetchCost(s), 0);
assert.equal(t.SOURCES.length, 16, 'el catálogo del motor tiene 16 fuentes: si cambia, actualizar la medida');
assert.equal(TOTAL_COST, 35, 'coste medido del barrido completo: 35 subrequests de fetch');
for (const source of t.SOURCES) {
  assert.ok(fetchCost(source) >= 1 && fetchCost(source) <= 6, `${source.code}: coste fuera de rango (${fetchCost(source)})`);
}

// 1) Sin variables, la conducta del plan gratuito NO cambia: techo 50 y 16 de presupuesto.
{
  const limits = t.subrequestLimits();
  assert.deepEqual(limits, { ceiling: 50, max: 50, reserve: 34, budget: FREE_BUDGET });
  assert.equal(limits.ignored, undefined, 'sin entorno no hay nada que declarar');
  const plan = t.planRun(t.SOURCES, null, '2026-10-29');
  assert.equal(plan.budget, FREE_BUDGET, 'el presupuesto por defecto sigue siendo el medido');
  // Con 16 peticiones no caben las 16 fuentes: unas cuantas se aplazan (hoy, 7).
  let spent = 0;
  let fits = 0;
  for (const source of plan.ordered) {
    if (spent + fetchCost(source) > plan.budget) continue;
    spent += fetchCost(source);
    fits += 1;
  }
  assert.ok(fits < t.SOURCES.length, 'con el plan gratuito el barrido completo no cabe en una pasada');
  assert.ok(spent <= plan.budget);
}

// 2) Con el techo de pago (1.000) cabe TODO en una pasada y no se aplaza ninguna.
{
  const limits = t.subrequestLimits({ SUBREQUEST_LIMIT: '1000' });
  assert.deepEqual(limits, { ceiling: 1000, max: 1000, reserve: 34, budget: PAID_BUDGET });
  const plan = t.planRun(t.SOURCES, null, '2026-10-29', limits.max, limits.ceiling);
  assert.equal(plan.budget, PAID_BUDGET);
  assert.ok(plan.budget >= TOTAL_COST, 'el presupuesto de pago cubre el barrido completo');
}

// 3) El motor nunca se da más de lo que admite el plan (MAX_SUBREQUESTS se recorta al techo).
{
  const clamped = t.subrequestLimits({ SUBREQUEST_LIMIT: '200', MAX_SUBREQUESTS: '1000' });
  assert.equal(clamped.ceiling, 200);
  assert.equal(clamped.max, 200, 'pedir 1.000 con techo 200 se recorta a 200');
  assert.equal(clamped.budget, 200 - t.D1_RESERVED_SUBREQUESTS);
  const lower = t.subrequestLimits({ SUBREQUEST_LIMIT: '1000', MAX_SUBREQUESTS: '100' });
  assert.equal(lower.max, 100, 'un presupuesto menor que el techo se respeta');
  assert.equal(lower.budget, 100 - t.D1_RESERVED_SUBREQUESTS);
}

// 4) Valores inválidos: se descartan, se declaran y se usa el defecto (nunca «sin límite»).
{
  for (const bad of ['muchas', '0', '-10', '99999', '']) {
    const limits = t.subrequestLimits({ SUBREQUEST_LIMIT: bad });
    assert.equal(limits.ceiling, 50, `SUBREQUEST_LIMIT=${JSON.stringify(bad)} no se aplica`);
    if (bad) assert.ok(limits.ignored?.includes('SUBREQUEST_LIMIT'), `SUBREQUEST_LIMIT=${JSON.stringify(bad)} se declara`);
  }
  const mixed = t.subrequestLimits({ SUBREQUEST_LIMIT: '1000', MAX_SUBREQUESTS: 'ochocientas' });
  assert.equal(mixed.ceiling, 1000);
  assert.equal(mixed.max, 1000, 'un MAX_SUBREQUESTS ilegible no deja al motor sin presupuesto');
  assert.deepEqual(mixed.ignored, ['MAX_SUBREQUESTS']);
  const zero = t.subrequestLimits({ SUBREQUEST_LIMIT: '1000', MAX_SUBREQUESTS: '0' });
  assert.equal(zero.max, 1000, '0 no es un presupuesto válido: se usa el del plan');
  assert.deepEqual(zero.ignored, ['MAX_SUBREQUESTS']);
}

// 5) Una pasada REAL con el presupuesto gratuito aplaza fuentes y lo declara en la respuesta.
//    (`fetch` simulado: las fuentes devuelven vacío; lo que se mide es el reparto del presupuesto.)
{
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('', { status: 200 });
  try {
    const { status: code, body } = await collect({});
    assert.equal(code, 200);
    assert.equal(body.budget, FREE_BUDGET);
    assert.equal(body.subrequests.ceiling, 50);
    assert.ok(body.subrequests.deferred.length > 0, 'con el plan gratuito hay fuentes aplazadas');
    assert.ok(body.subrequests.spent <= body.budget, 'no se gasta más de lo presupuestado');
    const aplazadas = body.sources.filter(s => s.status === 'deferred');
    assert.equal(aplazadas.length, body.subrequests.deferred.length, 'lo declarado cuadra con el estado por fuente');
    assert.match(aplazadas[0].warning, /no cabe en el presupuesto de 16 peticiones/);
  } finally {
    globalThis.fetch = realFetch;
  }
}

// 6) La misma pasada con el techo de pago: caben las 16, ninguna se aplaza y se gasta el coste real.
{
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('', { status: 200 });
  try {
    const { body } = await collect({ SUBREQUEST_LIMIT: '1000', MAX_SUBREQUESTS: '1000' });
    assert.equal(body.budget, PAID_BUDGET);
    assert.equal(body.subrequests.ceiling, 1000);
    assert.deepEqual(body.subrequests.deferred, [], 'con el plan de pago no se aplaza ninguna fuente');
    assert.equal(body.subrequests.spent, TOTAL_COST, 'se gasta el coste real del barrido, no el techo');
    // Cada fuente llega a EJECUTARSE (completed o failed). Los `failed` de esta prueba son del stub
    // —el cuerpo vacío no es el HTML/JSON de cada portal—, no del presupuesto: lo que se afirma aquí
    // es que ninguna se queda sin turno por falta de peticiones.
    const executed = body.sources.filter(s => s.status === 'completed' || s.status === 'failed');
    assert.equal(executed.length, t.SOURCES.length, 'las 16 fuentes se intentan en la misma pasada');
  } finally {
    globalThis.fetch = realFetch;
  }
}

// 7) El estado publica el presupuesto efectivo y las fuentes que aplazó el último run.
{
  const free = await status({});
  assert.equal(free.status, 200);
  assert.equal(free.body.subrequests.ceiling, 50);
  assert.equal(free.body.subrequests.budget, FREE_BUDGET);
  assert.equal(free.body.subrequests.sources, 16);
  assert.equal(free.body.subrequests.fetch_cost, TOTAL_COST);
  assert.deepEqual(free.body.subrequests.deferred, ['himalayas-closer']);
  const paid = await status({ SUBREQUEST_LIMIT: '1000' });
  assert.equal(paid.body.subrequests.ceiling, 1000);
  assert.equal(paid.body.subrequests.budget, PAID_BUDGET);
  assert.equal(paid.body.subrequests.day_max, undefined, 'el presupuesto de subrequests no inventa campos de cuota');
}

console.log('PASS  motor: presupuesto de subrequests por plan (16 → 966) y barrido completo en una pasada');
