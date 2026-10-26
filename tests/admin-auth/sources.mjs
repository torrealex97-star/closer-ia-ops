// Cifras por fuente del panel: node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/sources.mjs
// Comprueba que los números los cuenta la BASE (`count=exact`) y que no se leen las filas: con 6.001 ofertas,
// el panel seguía diciendo 5.000 porque traía la tabla y la contaba en memoria.
import assert from 'node:assert/strict';
import http from 'node:http';

const DAY = 86_400_000;
const now = Date.now();
const row = (source, extra = {}) => ({
  id: `${source}-${Math.random().toString(16).slice(2)}`, source, editorial_status: 'draft',
  expires_at: new Date(now + 5 * DAY).toISOString(), last_seen_at: new Date(now - 60_000).toISOString(), ...extra,
});
const rows = [];
// 6.000 vivas de 'indeed', 1.200 de ellas aprobadas: más que el tope de 5.000 que se leía antes.
for (let i = 0; i < 6_000; i++) rows.push(row('indeed', { editorial_status: i < 1_200 ? 'approved' : 'draft' }));
// 10 vivas de 'infojobs', ninguna aprobada, y una caducada que no debe contar como activa.
for (let i = 0; i < 10; i++) rows.push(row('infojobs'));
rows.push(row('infojobs', { expires_at: new Date(now - DAY).toISOString() }));

const behavior = { failSource: null, maxOffersRows: 0, maxOffersLimit: 0, offersRequests: 0 };
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const send = (code, body, headers = {}) => { res.writeHead(code, { 'content-type': 'application/json', ...headers }); res.end(JSON.stringify(body)); };
  const q = Object.fromEntries(url.searchParams);
  if (url.pathname === '/rest/v1/external_ingest_runs') return send(200, [{ source: 'indeed' }, { source: 'infojobs' }]);
  if (url.pathname === '/rest/v1/source_settings') return send(200, [{ source: 'paused-src' }]);
  if (url.pathname !== '/rest/v1/external_offers') return send(404, {});
  if (q.source === `eq.${behavior.failSource}`) return send(500, { message: 'boom' });
  behavior.offersRequests++;
  behavior.maxOffersLimit = Math.max(behavior.maxOffersLimit, Number(q.limit) || 0);
  let list = rows;
  if (q.source?.startsWith('eq.')) list = list.filter(r => r.source === q.source.slice(3));
  if (q.expires_at?.startsWith('gt.')) { const at = decodeURIComponent(q.expires_at.slice(3)); list = list.filter(r => r.expires_at > at); }
  if (q.editorial_status?.startsWith('in.(')) { const st = q.editorial_status.slice(4, -1).split(','); list = list.filter(r => st.includes(r.editorial_status)); }
  if (q.order?.startsWith('last_seen_at.desc')) list = [...list].sort((a, b) => String(b.last_seen_at).localeCompare(String(a.last_seen_at)));
  if (q.order?.startsWith('first_seen_at.desc')) list = [...list].reverse();
  const offset = Number(q.offset) || 0, limit = Number(q.limit) || 100;
  const slice = list.slice(offset, offset + limit);
  behavior.maxOffersRows = Math.max(behavior.maxOffersRows, slice.length);
  const exact = /count=exact/.test(req.headers.prefer ?? '');
  return send(200, slice, exact ? { 'content-range': `${slice.length ? offset : '*'}-${offset + slice.length - 1}/${list.length}` } : {});
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
process.env.SUPABASE_URL = `http://127.0.0.1:${server.address().port}`;
process.env.SUPABASE_SERVICE_ROLE_KEY = 'k';
process.env.SUPABASE_PUBLISHABLE_KEY = 'a';

const { statsBySource } = await import('../../apps/web/lib/external.ts');
const by = list => new Map(list.map(s => [s.source, s]));

const stats = await statsBySource();
assert.ok(stats, 'la lectura no falla');
const map = by(stats);
assert.equal(map.get('indeed').live, 6_000, 'cuenta exacta por encima de 5.000 (antes se quedaba en 5.000)');
assert.equal(map.get('indeed').approved, 1_200);
assert.equal(map.get('infojobs').live, 10, 'la caducada no es activa');
assert.equal(map.get('infojobs').approved, 0);
assert.ok(map.get('infojobs').last_seen, 'el último avistamiento viaja en la misma respuesta del recuento');
assert.deepEqual(map.get('paused-src'), { source: 'paused-src', live: 0, approved: 0, last_seen: null }, 'una fuente pausada sin datos aparece con ceros reales');
console.log('PASS  cifras por fuente: exactas más allá de 5.000, pausadas incluidas y último avistamiento');

// Nada de leer la tabla: como mucho la lista de nombres (200) y una fila por recuento.
assert.ok(behavior.maxOffersLimit <= 200, `ninguna consulta pide más de 200 filas (máximo: ${behavior.maxOffersLimit})`);
assert.ok(behavior.maxOffersRows <= 200, `ninguna respuesta trae más de 200 filas (máximo: ${behavior.maxOffersRows})`);
console.log(`PASS  sin leer la tabla: ${behavior.offersRequests} consultas, ninguna con más de ${behavior.maxOffersRows} filas`);

// Un contador que falla no se publica como cero ni deja un total incompleto.
behavior.failSource = 'indeed';
assert.equal(await statsBySource(), null, 'si una fuente no se puede contar, el resultado es desconocido (null)');
console.log('PASS  lectura fallida: se declara desconocida, no se rellena con ceros');

server.close();
