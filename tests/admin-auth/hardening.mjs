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
const { assertPublicUrl, pinnedGet } = await import('../../apps/web/lib/urlGuard.ts');
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
await step('SSRF: URLs internas, IP literal y DNS a red privada no se piden', async () => {
  for (const u of ['http://127.0.0.1/x', 'http://169.254.169.254/latest', 'http://localhost/x', 'ftp://a.es/x', 'https://user:pw@a.es/x']) assert.equal((await assertPublicUrl(u)).ok, false, u);
  assert.equal((await assertPublicUrl('https://interna.ejemplo.es/x', async () => ['10.0.0.5'])).reason, 'resuelve_a_red_interna');
  assert.equal((await assertPublicUrl('https://ok.ejemplo.es/x', async () => ['93.184.216.34'])).ok, true);
});
await step('SSRF: una IPv4 dentro de IPv6 (también en forma hexadecimal) no pasa por pública', async () => {
  for (const ip of ['::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:10.0.0.1', '::ffff:0a00:0001', '::ffff:169.254.169.254', '::ffff:a9fe:a9fe', '198.18.0.10', '198.19.255.1']) {
    assert.equal((await assertPublicUrl('https://mapeada.ejemplo.es/x', async () => [ip])).reason, 'resuelve_a_red_interna', ip);
  }
  assert.equal((await assertPublicUrl('https://publica.ejemplo.es/x', async () => ['::ffff:8.8.8.8'])).ok, true, 'una IPv4 pública mapeada sigue siendo pública');
});
await step('verifyOffer con URL interna: unknown, sin petición a la URL y razón explícita', async () => {
  mode = 'up'; offerUrl = 'http://169.254.169.254/latest/meta-data'; hits.length = 0;
  const r = await verifyOffer('11111111-1111-1111-1111-111111111111', 2000);
  assert.equal(r.result, 'unknown'); assert.match(r.reason, /url_no_permitida_ip_literal/);
});
await step('DNS rebinding: la IP validada se fija, el DNS se consulta UNA sola vez y no se vuelve a resolver al conectar', async () => {
  let calls = 0; const resolve = async () => { calls++; return calls === 1 ? ['192.0.2.1'] : ['127.0.0.1']; }; // 1.ª respuesta pública (TEST-NET), 2.ª interna
  const r = await pinnedGet('https://rebind.ejemplo.es/x', { timeoutMs: 700, resolve });
  assert.equal(calls, 1); assert.equal(r.ok, false); assert.equal(r.reason, 'red'); // 192.0.2.1 no responde: corta por tiempo, sin tocar 127.0.0.1
  assert.equal((await pinnedGet('https://interna.ejemplo.es/x', { timeoutMs: 700, resolve: async () => ['10.1.2.3', '93.184.216.34'] })).reason, 'resuelve_a_red_interna', 'si UNA respuesta es interna se rechaza');
});
server.close();
for (const [s, n, m] of results) console.log(`${s}  ${n}${m ? '\n      ' + m : ''}`);
const failed = results.filter(r => r[0] === 'FAIL').length; console.log(`\n${results.length - failed}/${results.length} pasos OK`); process.exit(failed ? 1 : 0);
