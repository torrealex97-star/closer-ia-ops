// Presupuesto de tiempo del cron: node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/cronbudget.mjs
import assert from 'node:assert/strict';
import http from 'node:http';

// --- Supabase REST simulado ---
const upserts = [], offers = new Map(); let secretCipher = '';
const rest = http.createServer((req, res) => {
  let body = ''; req.on('data', c => body += c); req.on('end', () => {
    const url = new URL(req.url, 'http://x'); const send = (s, d) => { res.writeHead(s, { 'content-type': 'application/json' }); res.end(JSON.stringify(d)); };
    if (url.pathname === '/rest/v1/source_settings') return send(200, []);
    if (url.pathname === '/rest/v1/integration_connections') return send(200, [{ secret_ciphertext: secretCipher }]);
    if (url.pathname === '/rest/v1/rpc/external_upsert') { upserts.push(...JSON.parse(body).p_rows); return send(200, JSON.parse(body).p_rows.length); }
    if (url.pathname === '/rest/v1/external_ingest_runs') return send(201, {});
    if (url.pathname === '/rest/v1/external_offers') {
      if (req.method === 'PATCH') return send(200, []);
      return send(200, [...offers.values()].map(o => ({ id: o.id })));
    }
    send(404, {});
  });
});
// --- Jooble simulado: cada consulta tarda 400 ms ---
let jooCalls = 0;
const jooble = http.createServer((req, res) => { jooCalls++; setTimeout(() => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ jobs: [{ id: `j${jooCalls}`, title: `Closer ${jooCalls}`, company: 'Acme', location: 'Madrid', link: `https://jobs.example.com/${jooCalls}` }] })); }, 400); });
// --- Página de oferta lenta para la vigencia: 600 ms ---
let pageCalls = 0;
const pages = http.createServer((req, res) => { pageCalls++; setTimeout(() => { res.writeHead(200); res.end('Closer Acme'); }, 600); });
await Promise.all([rest, jooble, pages].map(s => new Promise(r => s.listen(0, '127.0.0.1', r))));
process.env.SUPABASE_URL = `http://127.0.0.1:${rest.address().port}`; process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key'; process.env.SUPABASE_PUBLISHABLE_KEY = 'a';
process.env.JOOBLE_API_BASE = `http://127.0.0.1:${jooble.address().port}`;
const { encryptSecret } = await import('../../apps/web/lib/secrets.ts');
secretCipher = encryptSecret('clave-jooble');
const B = await import('../../apps/web/lib/cronBudget.ts');
const C = await import('../../apps/web/lib/collectors.ts');
const E = await import('../../apps/web/lib/external.ts');

// 1) Reloj: reparto y recortes
let t = 1_000_000; const clock = () => t;
const b = B.createBudget(40_000, clock);
assert.equal(b.remaining(), 40_000); assert.equal(b.expired(), false);
assert.equal(b.deadline(18_000), 1_018_000, 'un paso no pasa de su tope');
t += 30_000; assert.equal(b.remaining(), 10_000); assert.equal(b.deadline(18_000), 1_040_000, 'ni del fin global');
t += 20_000; assert.equal(b.expired(), true); assert.equal(b.remaining(), 0);
b.cut('apis'); b.cut('apis'); b.cut('vigencia'); assert.deepEqual(b.truncated, ['apis', 'vigencia'], 'cortes sin duplicar');
assert.equal(B.timeLeft(undefined), Infinity); assert.equal(B.callTimeout(20000, 1_005_000, () => 1_000_000), 5000); assert.equal(B.callTimeout(20000, undefined), 20000);
assert.ok(Number.isInteger(B.callTimeout(20000, 1_014_000.6667, () => 1_000_000)), 'AbortSignal.timeout exige un entero (fallo real con deadline fraccionario)');
assert.equal(B.totalFromEnv({}), 40_000); assert.equal(B.totalFromEnv({ CRON_BUDGET_MS: '25000' }), 25_000); assert.equal(B.totalFromEnv({ CRON_BUDGET_MS: '90000' }), 40_000, 'fuera de rango: valor seguro');
assert.equal(B.totalFromEnv({ CRON_BUDGET_MS: 'x' }), 40_000);
console.log('PASS  reloj: fin por paso y global, recortes, cortes sin duplicar y límites de la variable');

// 2) APIs oficiales: con poco tiempo se corta, se guarda lo recogido y se declara; sin tiempo ni empieza
upserts.length = 0; jooCalls = 0;
const cut = await C.collectProvider('jooble', 'test', Date.now() + 1500); // ≈ 7 consultas × 400 ms = 2800 ms > 1500 − 3000 de margen
assert.equal(cut.truncated, true); assert.equal(cut.ok, false, 'con <3 s de margen desde el principio ni empieza');
upserts.length = 0; jooCalls = 0;
const part = await C.collectProvider('jooble', 'test', Date.now() + 5200); // margen mínimo 3 s: caben 5-6 consultas
assert.equal(part.ok, true); assert.equal(part.truncated, true, 'declara el corte'); assert.ok(jooCalls >= 3 && jooCalls < 7, `consultas hechas: ${jooCalls}`);
assert.equal(upserts.length, jooCalls, 'se guarda todo lo recogido antes del corte');
upserts.length = 0; jooCalls = 0;
const full = await C.collectProvider('jooble', 'test', Date.now() + 30_000);
assert.equal(full.ok, true); assert.equal(full.truncated, undefined); assert.equal(jooCalls, 7);
const all = await C.collectAll('test', undefined, Date.now() + 1000);
assert.ok(all.every(o => o.truncated === true && /Sin tiempo/.test(o.error)), 'con <3 s, ningún proveedor empieza');
console.log('PASS  APIs: corte declarado, lo recogido se guarda, sin tiempo no empieza, sin deadline = comportamiento de siempre');

// 3) Vigencia: las comprobaciones paran cuando no queda tiempo
for (let i = 0; i < 12; i++) offers.set(`o${i}`, { id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}` });
// El detalle de cada oferta lo sirve el mismo mock: devolvemos una oferta con URL de la página lenta
rest.removeAllListeners('request');
rest.on('request', (req, res) => {
  let body = ''; req.on('data', c => body += c); req.on('end', () => {
    const url = new URL(req.url, 'http://x'); const send = (s, d) => { res.writeHead(s, { 'content-type': 'application/json' }); res.end(JSON.stringify(d)); };
    const q = Object.fromEntries(url.searchParams);
    if (url.pathname !== '/rest/v1/external_offers') return send(200, []);
    if (req.method === 'PATCH') return send(200, []);
    if (q.select === 'id') return send(200, [...offers.values()].map(o => ({ id: o.id })));
    const id = (q.id ?? '').slice(3); return send(200, [{ id, title: 'Closer Acme', company: 'Acme', url: `http://127.0.0.1:${pages.address().port}/p`, source: 's', external_id: id }]);
  });
});
process.env.URL_GUARD_TEST_ALLOW = `127.0.0.1:${pages.address().port}`; // la página lenta es local: solo ese host:port exacto pasa la guarda SSRF
pageCalls = 0;
const quick = await E.refreshVigencia(12, Date.now() + 2500); // 4 en paralelo × 600 ms: caben 1-2 rondas
assert.equal(quick.truncated, true); assert.ok(quick.checked >= 4 && quick.checked < 12, `comprobadas: ${quick.checked}`);
pageCalls = 0;
const none = await E.refreshVigencia(12, Date.now() + 500); assert.equal(none.checked, 0); assert.equal(none.truncated, true, 'sin tiempo no empieza');
pageCalls = 0;
const unbounded = await E.refreshVigencia(12); assert.equal(unbounded.checked, 12); assert.equal(unbounded.truncated, undefined);
console.log('PASS  vigencia: el reloj gobierna cada comprobación, corte declarado, sin deadline comprueba todas');
for (const s of [rest, jooble, pages]) s.closeAllConnections?.(), s.close();
