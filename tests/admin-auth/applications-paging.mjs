// Lectura de candidaturas por páginas: PostgREST corta cada respuesta en `db-max-rows` (1.000 en Supabase), así que una
// sola petición devolvía menos filas de las que hay sin decirlo (el XP y los recuentos del panel salían cortos).
// node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/applications-paging.mjs
import http from 'node:http';
import assert from 'node:assert/strict';

const DB_MAX_ROWS = 1000; // tope por respuesta, como en Supabase
const rows = [];
let failFromOffset = null; // simula un fallo de la base a mitad de la lectura
const requests = [];
const make = (i, user = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') => ({
  id: `22222222-2222-4222-8222-${String(i).padStart(12, '0')}`, user_id: user, offer_ref: `ext-${i}`,
  offer_title: `Oferta ${i}`, offer_company: 'Acme', offer_url: 'https://x.es/o', status: ['draft', 'applied', 'responded', 'interview', 'offer', 'rejected'][i % 6],
  cover_message: null, notes: null, created_at: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString(),
  updated_at: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString(), applied_at: null,
});

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  const q = Object.fromEntries(url.searchParams);
  const send = (status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  if (url.pathname !== '/rest/v1/student_applications') return send(404, { message: 'no' });
  const offset = Number(q.offset) || 0;
  requests.push({ offset, limit: q.limit, order: q.order, select: q.select });
  if (failFromOffset !== null && offset >= failFromOffset) return send(500, { message: 'boom' });
  const eqv = k => q[k]?.startsWith('eq.') ? decodeURIComponent(q[k].slice(3)) : null;
  let hit = rows.filter(r => (!eqv('user_id') || r.user_id === eqv('user_id')) && (!eqv('org_id') || true));
  const keys = (q.order ?? 'updated_at.desc').split(',').map(part => { const [k, dir] = part.split('.'); return [k, dir === 'desc' ? -1 : 1]; });
  hit = hit.slice().sort((x, y) => { for (const [k, dir] of keys) { const a = String(x[k] ?? ''), b = String(y[k] ?? ''); if (a !== b) return a < b ? -dir : dir; } return 0; });
  const limit = Math.min(Number(q.limit) || DB_MAX_ROWS, DB_MAX_ROWS);
  const page = hit.slice(offset, offset + limit).map(r => q.select === 'user_id,status' ? { user_id: r.user_id, status: r.status } : r);
  return send(200, page);
});
await new Promise(r => server.listen(8799, '127.0.0.1', r));
process.env.SUPABASE_URL = 'http://127.0.0.1:8799';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';
process.env.SUPABASE_PUBLISHABLE_KEY = 'anon';

const { listApplications, listOrgApplicationStatuses } = await import('../../apps/web/lib/applications.ts');
const results = [];
const step = async (name, fn) => { try { await fn(); results.push(['PASS', name]); } catch (e) { results.push(['FAIL', name, e.message.split('\n')[0]]); } };

for (let i = 0; i < 2400; i++) rows.push(make(i));

await step('2.400 candidaturas: se leen TODAS (no 200 ni las 1.000 de una respuesta)', async () => {
  requests.length = 0;
  const page = await listApplications('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  assert.equal(page.rows.length, 2400);
  assert.equal(page.truncated, false, 'sin llegar al tope no se declara truncado');
  assert.equal(new Set(page.rows.map(r => r.id)).size, 2400, 'sin filas repetidas');
  assert.equal(page.rows[0].id, '22222222-2222-4222-8222-000000002399', 'sigue viniendo de más reciente a más antigua');
  // Una página corta (por el tope del servidor) NO se toma por el final: se sigue hasta la página vacía.
  assert.deepEqual(requests.map(r => r.offset), [0, 1000, 2000, 2400]);
  assert.ok(requests.every(r => Number(r.limit) === 1000 && r.order === 'updated_at.desc,id.desc'), 'paginado estable: orden fijo y sin saltos');
});
await step('recuentos del panel: 2.400 filas de toda la organización, solo `user_id` y `status`', async () => {
  requests.length = 0;
  const page = await listOrgApplicationStatuses();
  assert.equal(page.rows.length, 2400);
  assert.equal(page.truncated, false);
  assert.deepEqual(Object.keys(page.rows[0]).sort(), ['status', 'user_id'], 'no se traen textos ni borradores ajenos');
  assert.deepEqual(requests.map(r => r.offset), [0, 1000, 2000, 2400]);
});
await step('un fallo a mitad de la lectura devuelve «no se sabe» (null), nunca una lista parcial', async () => {
  failFromOffset = 1000;
  assert.equal(await listApplications('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'), null);
  assert.equal(await listOrgApplicationStatuses(), null);
  failFromOffset = null;
});
await step('al llegar al tope de 10.000 se declara `truncated` en vez de cortar en silencio', async () => {
  rows.length = 0;
  for (let i = 0; i < 10_500; i++) rows.push(make(i));
  const page = await listOrgApplicationStatuses();
  assert.equal(page.rows.length, 10_000);
  assert.equal(page.truncated, true);
});

server.close();
for (const [status, name, message] of results) console.log(`${status}  ${name}${message ? '\n      ' + message : ''}`);
const failed = results.filter(r => r[0] === 'FAIL').length;
console.log(`\n${results.length - failed}/${results.length} pasos OK`);
process.exit(failed ? 1 : 0);
