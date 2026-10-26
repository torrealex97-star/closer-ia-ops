// Cualificación del pool del motor: lo que la puerta determinista descarta se RETIRA
// con su motivo (no se queda pidiendo revisión humana) y se agrupa por motivo para
// gastar una escritura por grupo, no una por oferta.
// Uso: node --experimental-strip-types tests/engine/activate.mjs
// No necesita red ni Cloudflare: el worker se importa desde el repo y D1 es un stub que
// anota cada sentencia. Lo que se comprueba es la CONDUCTA de la ruta (qué escribe y qué
// deja intacto), no la sintaxis de D1.
import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const workerPath = fileURLToPath(new URL('../../sites/engine/worker.js', import.meta.url));
// El worker no tiene imports y usa `export default`: con extensión .mjs Node lo carga como ESM.
const stage = join(mkdtempSync(join(tmpdir(), 'wdc-engine-')), 'worker.mjs');
copyFileSync(workerPath, stage);
const worker = (await import(pathToFileURL(stage).href)).default;

const now = () => new Date().toISOString();
const SPAIN_TEXT = 'Buscamos closer para nuestro equipo de ventas. Ofrecemos salario y comisiones. Experiencia en llamadas y clientes.';
// Sin ninguna palabra del vocabulario comercial: la oferta no tiene perfil, aunque esté en español.
const NEUTRAL_TEXT = 'Atención al público en recepción. Ofrecemos horario de lunes a viernes y salario. Nuestro equipo te forma.';
const ENGLISH_TEXT = 'We are looking for a closer for our team. Salary and commissions. Experience in calls.';

// D1 mínimo: devuelve lo sembrado y ANOTA cada sentencia con sus argumentos.
function fakeDb(pool) {
  const log = [];
  const statement = sql => {
    const stmt = {
      sql, args: [],
      bind(...args) { stmt.args = args; return stmt; },
      async all() {
        log.push({ kind: 'all', sql, args: stmt.args });
        if (/FROM opportunities o/.test(sql)) return { results: pool };
        return { results: [] };
      },
      async first() {
        log.push({ kind: 'first', sql, args: stmt.args });
        if (/SELECT max\(version\)/.test(sql)) return { v: 1 };
        if (/SELECT id FROM opportunity_versions/.test(sql)) return { id: 'ver-seed' };
        return null;
      },
      async run() {
        log.push({ kind: 'run', sql, args: stmt.args });
        // La retirada en bloque informa de cuántas filas tocó: ids = args tras (razón, ahora, org).
        const changes = /SET editorial_status='withdrawn'/.test(sql) ? stmt.args.length - 3 : 1;
        return { meta: { changes } };
      },
    };
    return stmt;
  };
  return {
    log,
    prepare: statement,
    async batch(stmts) { for (const s of stmts) await s.run(); return stmts.map(() => ({ meta: { changes: 1 } })); },
  };
}

const row = (id, payload) => ({
  opportunity_id: id, job_id: `job-${id}`, current_version_id: 'ver-seed', editorial_status: 'draft',
  opportunity_status: 'verifying', posting_id: `post-${id}`, source: 'jobtoday-closer',
  posting_payload: JSON.stringify(payload), expires_at: '2030-01-01T00:00:00.000Z', first_seen_at: '2026-10-20T00:00:00.000Z',
});
// `descriptionOf` lee el cuerpo del anuncio de `raw` (evidencia cruda), no del campo superior.
const offer = (title, location, description, extra = {}) => ({
  title, location, company: 'Acme', url: 'https://empleo.example.com/oferta',
  raw: { description }, posted_at: now(), ...extra,
});

async function activate(db, body) {
  db.log.length = 0;
  const response = await worker.fetch(
    new Request('https://engine.test/v1/admin/opportunities/activate', {
      method: 'POST',
      headers: { 'X-Admin-Token': 'token-de-prueba', 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { DB: db, ADMIN_TOKEN: 'token-de-prueba' },
    {},
  );
  return { status: response.status, body: await response.json() };
}
// Las sentencias de esquema (`ensureSchema`) no cuentan como escrituras de negocio.
const writes = db => db.log.filter(entry => entry.kind === 'run' && /^(INSERT|UPDATE|DELETE)/.test(entry.sql)
  && !/schema_version|CREATE TABLE/.test(entry.sql));
const withdrawals = db => writes(db).filter(entry => /SET editorial_status='withdrawn'/.test(entry.sql));

// 1) Un panel que solo mira: `dry_run` no escribe NADA y ya dice qué retiraría.
{
  const pool = [
    row('opp-closer', offer('Closer de ventas', 'Madrid, España', SPAIN_TEXT)),
    row('opp-recepcion', offer('Recepcionista', 'Sevilla, España', NEUTRAL_TEXT)),
    row('opp-ingles', offer('Closer', 'Austin, Texas', ENGLISH_TEXT)),
    row('opp-vieja', offer('Closer', 'Madrid, España', SPAIN_TEXT, { posted_at: '2026-09-01T00:00:00.000Z' })),
  ];
  const db = fakeDb(pool);
  const { status, body } = await activate(db, {});
  assert.equal(status, 200);
  assert.equal(body.dry_run, true, 'el valor por defecto sigue siendo el plan');
  assert.equal(writes(db).length, 0, 'un plan no escribe: ni versiones, ni estados');
  assert.equal(body.counts.withdrawn, 0);
  assert.equal(body.counts.published, 0);
  assert.deepEqual(body.items.filter(i => i.action === 'withdraw').map(i => i.id).sort(),
    ['opp-ingles', 'opp-recepcion', 'opp-vieja'].sort());
  assert.equal(body.items.find(i => i.id === 'opp-vieja').reason, 'publicado hace más de 10 días');
  assert.equal(body.scan.truncated, false);
}

// 2) Ejecución real: publica lo que pasa la puerta y RETIRA lo descartado, agrupado por motivo.
{
  const pool = [
    row('opp-closer', offer('Closer de ventas', 'Madrid, España', SPAIN_TEXT)),
    row('opp-recepcion-1', offer('Recepcionista', 'Sevilla, España', NEUTRAL_TEXT)),
    row('opp-recepcion-2', offer('Recepcionista de hotel', 'Bilbao, España', NEUTRAL_TEXT)),
    row('opp-ingles', offer('Closer', 'Austin, Texas', ENGLISH_TEXT)),
    row('opp-vieja', offer('Closer', 'Madrid, España', SPAIN_TEXT, { posted_at: '2026-09-01T00:00:00.000Z' })),
  ];
  const db = fakeDb(pool);
  const { status, body } = await activate(db, { dry_run: false, verify: false, market: 'any' });
  assert.equal(status, 200);
  assert.equal(body.counts.published, 1, 'el closer abierto y en español se publica solo');
  assert.equal(body.counts.withdrawn, 4, 'los cuatro descartes dejan de estar en el pool');
  assert.equal(body.counts.needs_review, 0);

  const retiradas = withdrawals(db);
  assert.equal(retiradas.length, 3, 'una escritura por motivo (3 motivos), no una por oferta (4 ofertas)');
  const sinPerfil = retiradas.find(entry => entry.args[0].includes('sin perfil comercial reconocible'));
  assert.ok(sinPerfil, 'el motivo viaja escrito en la fila');
  assert.deepEqual(sinPerfil.args.slice(3).sort(), ['opp-recepcion-1', 'opp-recepcion-2'].sort());
  const porIdioma = retiradas.find(entry => entry.args[0].includes('no está en español'));
  assert.deepEqual(porIdioma.args.slice(3), ['opp-ingles']);
  for (const entry of retiradas) {
    assert.match(entry.args[0], /^clasificación automática: /, 'la razón dice que la puso la máquina');
    assert.match(entry.sql, /editorial_status='draft'/, 'nunca pisa una oferta que una persona ya movió');
  }
  // Lo retirado es reversible y no se borra: la sentencia es un UPDATE, no un DELETE.
  assert.equal(db.log.filter(entry => /^DELETE/.test(entry.sql ?? '')).length, 0);
  // El pool del escaneo también excluye lo que ya no es borrador.
  const scan = db.log.find(entry => /FROM opportunities o/.test(entry.sql));
  assert.match(scan.sql, /o\.editorial_status='draft'/);
}

// 3) Un motivo con más de 80 ofertas no hace 80 escrituras ni una lista de parámetros sin cota.
{
  const pool = Array.from({ length: 81 }, (_, i) => row(`opp-${i}`, offer('Recepcionista', 'Sevilla, España', NEUTRAL_TEXT)));
  const db = fakeDb(pool);
  const { body } = await activate(db, { dry_run: false, verify: false, market: 'any' });
  assert.equal(body.counts.withdrawn, 81);
  const retiradas = withdrawals(db);
  assert.equal(retiradas.length, 2, '81 ofertas se retiran en dos escrituras (80 + 1)');
  assert.equal(retiradas[0].args.length - 3, 80);
  assert.equal(retiradas[1].args.length - 3, 1);
}

// 4) Una oferta sin descripción (la fuente no trajo cuerpo) NO se retira por «no está en español»: se salta y sigue como estaba.
{
  const pool = [
    row('opp-sin-cuerpo', offer('Closer de ventas', 'Madrid, España', '')),
    row('opp-closer', offer('Closer de ventas', 'Madrid, España', SPAIN_TEXT)),
  ];
  const db = fakeDb(pool);
  const { status, body } = await activate(db, { dry_run: false, verify: false, market: 'any' });
  assert.equal(status, 200);
  assert.equal(body.counts.withdrawn, 0, 'sin cuerpo no hay evidencia de idioma: no se retira');
  assert.equal(withdrawals(db).length, 0);
  assert.equal(body.counts.published, 1, 'la que sí tiene cuerpo en español se publica');
}

console.log('PASS  motor: retira lo descartado en bloque, con motivo, y solo toca borradores');
