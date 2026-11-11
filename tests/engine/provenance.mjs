// Procedencia del INVOCADOR en las escrituras del catálogo cloud: quién lanzó una activación o una
// verificación —`cron` o `operator`—, para que la fila lo diga en vez de deducirlo por la hora.
//
// Lo que fija:
//   · la base NUEVA nace con la columna (`invoked_by` en el DDL canónico de `opportunity_versions` y
//     en el CREATE de `verification_events`);
//   · la base que YA existía se migra con dos ALTER tolerantes (uno por tabla), sin tocar datos;
//   · activación con `auto: true` (cron) → versiones y evidencias quedan como `cron`;
//   · activación sin `auto` (panel/script) y `POST /verify` → `operator`;
//   · sin procedencia no se inventa: la columna es nula, no un valor por defecto.
// No necesita red ni Cloudflare: D1 es un stub que anota cada sentencia con sus argumentos.
// Uso: node tests/engine/provenance.mjs
import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const workerPath = fileURLToPath(new URL('../../sites/engine/worker.js', import.meta.url));
const stage = join(mkdtempSync(join(tmpdir(), 'wdc-provenance-')), 'worker.mjs');
copyFileSync(workerPath, stage);
const loaded = await import(pathToFileURL(stage).href);
const worker = loaded.default;
const shape = loaded.__testShape;

const SPAIN_TEXT = 'Buscamos closer para nuestro equipo de ventas. Ofrecemos salario y comisiones. Experiencia en llamadas y clientes.';

// D1 mínimo: devuelve lo sembrado y ANOTA cada sentencia (también las de `batch`, que es donde
// escriben `applyReview` y `runVerification`).
function fakeDb({ pool = [], opportunity = null, posting = null, versionPayload = {} } = {}) {
  const log = [];
  const statement = sql => {
    const stmt = {
      sql, args: [],
      bind(...args) { stmt.args = args; return stmt; },
      async all() {
        log.push({ kind: 'all', sql, args: stmt.args });
        if (/FROM opportunities o/.test(sql)) return { results: pool };
        if (/SUM\(writes\)/.test(sql)) return { results: [{ writes: 0 }] };
        if (/SELECT writes FROM write_ledger/.test(sql)) return { results: [{ writes: 0 }] };
        return { results: [] };
      },
      async first() {
        log.push({ kind: 'first', sql, args: stmt.args });
        if (/SELECT \* FROM opportunities WHERE/.test(sql)) return opportunity;
        if (/JOIN job_postings p/.test(sql)) return posting;
        if (/SELECT id, payload FROM opportunity_versions/.test(sql)) return { id: 'ver-seed', payload: JSON.stringify(versionPayload) };
        if (/SELECT max\(version\)/.test(sql)) return { v: 1 };
        if (/SELECT id FROM opportunity_versions/.test(sql)) return { id: 'ver-seed' };
        return null;
      },
      async run() {
        log.push({ kind: 'run', sql, args: stmt.args });
        const changes = /SET editorial_status='withdrawn'/.test(sql) ? stmt.args.length - 3 : 1;
        return { meta: { changes } };
      },
    };
    return stmt;
  };
  return {
    log,
    prepare: statement,
    async batch(stmts) {
      return stmts.map(stmt => {
        log.push({ kind: 'batch', sql: stmt.sql, args: stmt.args });
        return { meta: { changes: 1 } };
      });
    },
  };
}

// Columnas de un INSERT → objeto con sus argumentos, en el orden en que se bindean.
const inserted = (db, table) => db.log
  .filter(entry => new RegExp(`INSERT (?:OR IGNORE )?INTO ${table} \\(`).test(entry.sql ?? ''))
  .map(entry => {
    const columns = /\(([^)]*)\) VALUES/.exec(entry.sql)[1].split(',').map(name => name.trim());
    return Object.fromEntries(columns.map((name, index) => [name, entry.args[index]]));
  });

const offerRow = (id) => ({
  opportunity_id: id, job_id: `job-${id}`, current_version_id: 'ver-seed', editorial_status: 'draft',
  opportunity_status: 'verifying', posting_id: `post-${id}`, source: 'jobtoday-closer',
  posting_payload: JSON.stringify({ title: 'Closer de ventas', company: 'Acme', url: 'https://empleo.example.com/oferta', raw: { description: SPAIN_TEXT }, posted_at: new Date().toISOString() }),
  expires_at: '2030-01-01T00:00:00.000Z', first_seen_at: '2026-10-20T00:00:00.000Z',
});

const activate = async (db, body) => {
  const response = await worker.fetch(new Request('https://engine.test/v1/admin/opportunities/activate', {
    method: 'POST',
    headers: { 'X-Admin-Token': 'token-de-prueba', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }), { DB: db, ADMIN_TOKEN: 'token-de-prueba' }, {});
  return { status: response.status, body: await response.json() };
};

const verifyOne = async (db, id) => {
  const response = await worker.fetch(new Request(`https://engine.test/v1/admin/opportunities/${id}/verify`, {
    method: 'POST',
    headers: { 'X-Admin-Token': 'token-de-prueba', 'Content-Type': 'application/json' },
    body: '{}',
  }), { DB: db, ADMIN_TOKEN: 'token-de-prueba' }, {});
  return { status: response.status, body: await response.json() };
};

// 1) La base nueva nace con la columna y la que ya existía se migra con dos ALTER tolerantes.
{
  const fresh = fakeDb();
  await shape.ensureSchema(fresh);
  const creates = fresh.log.filter(entry => /CREATE TABLE IF NOT EXISTS/.test(entry.sql ?? '')).map(entry => entry.sql);
  const events = creates.find(sql => /CREATE TABLE IF NOT EXISTS verification_events \(/.test(sql));
  assert.ok(events, 'se crea verification_events');
  assert.match(events, /invoked_by TEXT/, 'la base nueva nace con la procedencia en la evidencia');
  assert.equal(/invoked_by TEXT NOT NULL/.test(events), false, 'sin procedencia no se inventa un valor: es nula');
  const versions = shape.CATALOG_SHAPE.find(item => item.table === 'opportunity_versions');
  assert.match(versions.columns, /invoked_by TEXT/, 'la versión también nace con la columna');
  assert.ok(versions.names.includes('invoked_by'), 'y la reconstrucción sabría copiarla si algún día se migra');
  const alters = fresh.log.filter(entry => /ALTER TABLE (opportunity_versions|verification_events) ADD COLUMN invoked_by/.test(entry.sql ?? ''));
  assert.equal(alters.length, 2, 'una base existente recibe las dos columnas por ALTER (una por tabla)');
}

// 2) Activación del cron (`auto: true`): la versión queda con `cron`.
{
  const db = fakeDb({ pool: [offerRow('opp-closer')] });
  const { status, body } = await activate(db, { dry_run: false, verify: false, market: 'any', auto: true });
  assert.equal(status, 200);
  assert.equal(body.invoked_by, 'cron', 'la respuesta declara quién invocó');
  assert.equal(body.counts.published, 1);
  const versions = inserted(db, 'opportunity_versions');
  assert.equal(versions.length, 1, 'una versión nueva por oferta publicada');
  assert.equal(versions[0].invoked_by, 'cron', 'el cron no se disfraza de operador');
  assert.equal(versions[0].created_by, 'admin-activate');
}

// 3) Activación de una persona: `operator`. Es la misma ruta, así que la diferencia es el `auto`.
{
  const db = fakeDb({ pool: [offerRow('opp-closer')] });
  const { body } = await activate(db, { dry_run: false, verify: false, market: 'any' });
  assert.equal(body.invoked_by, 'operator');
  assert.equal(inserted(db, 'opportunity_versions')[0].invoked_by, 'operator', 'el panel no se disfraza de cron');
}

// 4) Activación CON verificación: la evidencia de vigencia también lleva la procedencia, y la
//    versión y el evento no pueden decir cosas distintas.
{
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('<html><body>Closer de ventas · Acme</body></html>', { status: 200 });
  try {
    const db = fakeDb({ pool: [offerRow('opp-closer')] });
    const { body } = await activate(db, { dry_run: false, verify: true, market: 'any', auto: true });
    assert.equal(body.counts.published, 1, 'con la página abierta y el título dentro, publica');
    const versions = inserted(db, 'opportunity_versions');
    const events = inserted(db, 'verification_events');
    assert.equal(events.length, 1, 'una fila de evidencia por verificación');
    assert.equal(events[0].invoked_by, 'cron');
    assert.equal(events[0].result, 'open');
    assert.equal(events[0].verifier_version, '1', 'la versión del verificador no cambia por registrar quién llamó');
    assert.equal(versions[0].invoked_by, 'cron', 'versión y evidencia dicen lo mismo');
    // La evidencia cruda sigue siendo inmutable y con su hash: la columna nueva no la toca.
    const raws = db.log.filter(entry => /INSERT OR IGNORE INTO raw_items/.test(entry.sql ?? ''));
    assert.equal(raws.length, 1);
    assert.equal(raws[0].args[2], 'verification');
  } finally {
    globalThis.fetch = realFetch;
  }
}

// 5) `POST /verify` de una oferta suelta: siempre `operator`, y lo devuelve en la respuesta.
{
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('<html><body>Closer de ventas · Acme</body></html>', { status: 200 });
  try {
    const db = fakeDb({
      opportunity: { id: 'opp-1', job_id: 'job-1', current_version_id: 'ver-seed', source: 'jobtoday-closer', posting_id: 'post-1' },
      posting: { payload: JSON.stringify({ title: 'Closer de ventas', company: 'Acme', url: 'https://empleo.example.com/oferta' }), source: 'jobtoday-closer', posting_id: 'post-1' },
      versionPayload: { title: 'Closer de ventas', application_url: 'https://empleo.example.com/oferta', next_step: { enabled: false } },
    });
    const { status, body } = await verifyOne(db, 'opp-1');
    assert.equal(status, 200);
    assert.equal(body.result, 'open');
    assert.equal(body.invoked_by, 'operator');
    const events = inserted(db, 'verification_events');
    assert.equal(events.length, 1);
    assert.equal(events[0].invoked_by, 'operator');
  } finally {
    globalThis.fetch = realFetch;
  }
}

console.log('PASS  motor: la procedencia del invocador (cron/operador) se escribe en versiones y verificaciones, y la base existente se migra con ALTER');
