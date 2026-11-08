// La activación AUTOMÁTICA (cron) respeta el guardián de cuota; la de una persona, no. Y el esquema se crea una vez.
// Uso: node --experimental-strip-types tests/engine/activationquota.mjs   (sin red ni Cloudflare)
import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const workerPath = fileURLToPath(new URL('../../sites/engine/worker.js', import.meta.url));
const stage = join(mkdtempSync(join(tmpdir(), 'wdc-engine-aq-')), 'worker.mjs');
copyFileSync(workerPath, stage);
const worker = (await import(pathToFileURL(stage).href)).default;

function fakeDb({ month = 0, day = 0 } = {}) {
  const log = [];
  const statement = sql => {
    const stmt = { sql, args: [], bind(...a) { stmt.args = a; return stmt; },
      async all() { log.push(sql); return { results: [] }; },
      async first() { log.push(sql); return null; },
      async run() { log.push(sql); return { meta: { changes: 1 } }; } };
    return stmt;
  };
  return { log, prepare: statement,
    async batch(stmts) {
      return stmts.map(s => {
        log.push(s.sql);
        if (/SUM\(writes\)/.test(s.sql)) return { results: [{ writes: month }] };
        if (/SELECT writes FROM write_ledger/.test(s.sql)) return { results: [{ writes: day }] };
        return { meta: { changes: 1 } };
      });
    } };
}
const call = (db, body) => worker.fetch(new Request('https://engine.test/v1/admin/opportunities/activate', { method: 'POST', headers: { 'X-Admin-Token': 't', 'content-type': 'application/json' }, body: JSON.stringify(body) }), { DB: db, ADMIN_TOKEN: 't' });
const scanned = db => db.log.filter(q => /FROM opportunities o/.test(q)).length;

// Cuota agotada (mes por encima del 85 %): el cron NO escribe ni escanea; una persona sí.
const spent = fakeDb({ month: 90_000 });
const auto = await (await call(spent, { dry_run: false, auto: true })).json();
assert.equal(auto.skipped, true); assert.equal(auto.reason, 'write_allowance'); assert.equal(auto.counts.published, 0); assert.equal(auto.scan.truncated, false);
assert.equal(scanned(spent), 0, 'la activación automática no toca el catálogo sin cuota');
const manual = await (await call(spent, { dry_run: false })).json();
assert.ok(!manual.skipped, 'una persona aprobando nunca se bloquea por cuota'); assert.equal(scanned(spent), 1);
// Con cuota, el cron trabaja.
const fresh = fakeDb({ month: 100 });
const ok = await (await call(fresh, { dry_run: false, auto: true })).json();
assert.ok(!ok.skipped); assert.equal(scanned(fresh), 1);
// El esquema se crea UNA vez por conexión (no en cada petición).
const ddl = db => db.log.filter(q => /CREATE TABLE IF NOT EXISTS/.test(q)).length;
const once = fakeDb({ month: 100 });
await call(once, { dry_run: true }); const first = ddl(once);
await call(once, { dry_run: true }); await call(once, { dry_run: true });
assert.ok(first > 0, 'la primera petición crea el esquema'); assert.equal(ddl(once), first, 'las siguientes no repiten el DDL');
console.log('PASS  activación automática: respeta la cuota, la manual no; esquema una vez por conexión');
