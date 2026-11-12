// Endurecimiento tras la revisión de código: node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/hardening.mjs
import http from 'node:http';
import assert from 'node:assert/strict';

let mode = 'down'; const hits = []; let offerUrl = 'http://127.0.0.1:1/oferta';
const server = http.createServer((req, res) => {
  hits.push(`${req.method} ${req.url.split('?')[0]}`);
  const send = (c, b) => { res.writeHead(c, { 'content-type': 'application/json' }); res.end(JSON.stringify(b)); };
  if (mode === 'down') return send(500, { message: 'boom' });
  if (req.url.startsWith('/rest/v1/external_offers') && req.method === 'GET') return send(200, [{ id: '11111111-1111-1111-1111-111111111111', title: 'Closer de ventas', company: 'Acme', url: offerUrl, source: 'infojobs', editorial_status: 'approved' }]);
  return send(200, []);
});
await new Promise(r => server.listen(8797, '127.0.0.1', r));
process.env.SUPABASE_URL = 'http://127.0.0.1:8797'; process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key'; process.env.SUPABASE_PUBLISHABLE_KEY = 'anon';
const { monthSpent } = await import('../../apps/web/lib/apify.ts');
const { pausedSourcesStrict, ingest, verifyOffer } = await import('../../apps/web/lib/external.ts');
const { externalForStudent } = await import('../../apps/web/lib/externalSurface.ts');
const { collectProvider } = await import('../../apps/web/lib/collectors.ts');
const { assertPublicUrl, guardedGet, privateAddress } = await import('../../apps/web/lib/urlGuard.ts');
const results = []; const step = async (name, fn) => { try { await fn(); results.push(['PASS', name]); } catch (e) { results.push(['FAIL', name, e.message.split('\n')[0]]); } };

await step('BD caída: el gasto de Apify es «no se sabe» (null), no 0', async () => assert.equal(await monthSpent(), null));
await step('BD caída: las fuentes pausadas son «no se sabe» y no se muestra nada a las alumnas', async () => {
  assert.equal(await pausedSourcesStrict(), null);
  assert.deepEqual(await externalForStudent({ role: null, market: 'any', days: 10, include_bilingual: false, starred_only: false }), []);
});
await step('BD caída: ingest no guarda como si nada (tratada como pausada) y la recogida declara el fallo sin lanzar', async () => {
  const r = await ingest('infojobs', 'test', [{ external_id: 'a', title: 'Closer', url: 'https://x.es/a' }]); assert.equal(r.accepted, 0); assert.equal(r.paused, true);
  const o = await collectProvider('infojobs', 'test'); assert.equal(o.ok, false); assert.match(o.error, /pausada|reintenta/);
});
await step('SSRF: URLs internas, IP literal y host fuera de la allowlist no se piden', async () => {
  for (const u of ['http://127.0.0.1/x', 'http://169.254.169.254/latest', 'http://localhost/x', 'ftp://a.es/x', 'https://user:pw@a.es/x']) assert.equal((await assertPublicUrl(u)).ok, false, u);
  assert.equal((await assertPublicUrl('https://interna.ejemplo.es/x')).reason, 'host_no_autorizado', 'sin DNS, la política es la allowlist');
  assert.equal((await assertPublicUrl('https://www.infojobs.net/oferta/1')).ok, true);
});
await step('SSRF: una IPv4 dentro de IPv6 (también en forma hexadecimal) no pasa por pública', async () => {
  for (const ip of ['::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:10.0.0.1', '::ffff:0a00:0001', '::ffff:169.254.169.254', '::ffff:a9fe:a9fe', '198.18.0.10', '198.19.255.1']) assert.equal(privateAddress(ip), true, ip);
  assert.equal(privateAddress('::ffff:8.8.8.8'), false, 'una IPv4 pública mapeada sigue siendo pública');
  for (const u of ['http://[::ffff:7f00:1]/x', 'http://[::ffff:a9fe:a9fe]/x']) assert.equal((await assertPublicUrl(u)).reason, 'ip_literal', u);
});
await step('verifyOffer con URL interna: unknown, sin petición a la URL y razón explícita', async () => {
  mode = 'up'; offerUrl = 'http://169.254.169.254/latest/meta-data'; hits.length = 0;
  const r = await verifyOffer('11111111-1111-1111-1111-111111111111', 2000);
  assert.equal(r.result, 'unknown'); assert.match(r.reason, /url_no_permitida_ip_literal/);
});
await step('SSRF: sin DNS no hay pinning; una redirección a IP literal no se pide', async () => {
  const calls = [];
  const fetchImpl = async (url) => { calls.push(String(url)); return new Response('', { status: 302, headers: { location: 'http://127.0.0.1/x' } }); };
  const first = await guardedGet('https://jobtoday.com/es/oferta/1', { timeoutMs: 700, fetchImpl });
  assert.equal(first.ok, true); assert.equal(first.location, 'http://127.0.0.1/x');
  assert.equal((await guardedGet(first.location, { timeoutMs: 700, fetchImpl })).reason, 'ip_literal');
  assert.equal(calls.length, 1, 'solo se pidió el host de la allowlist; el salto interno nunca sale');
});
server.close();
for (const [s, n, m] of results) console.log(`${s}  ${n}${m ? '\n      ' + m : ''}`);
const failed = results.filter(r => r[0] === 'FAIL').length; console.log(`\n${results.length - failed}/${results.length} pasos OK`); process.exit(failed ? 1 : 0);
