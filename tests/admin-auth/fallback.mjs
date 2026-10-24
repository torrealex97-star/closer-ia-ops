// Respaldo de cobertura con SerpApi: cuando un portal no tiene API oficial conectada, se busca en Google
// acotado a ese portal. Verifica el plan (prioridad, pausas, no repetir lo ya cubierto), el mapeo sin datos
// inventados y que el coste y los cortes se declaren.
// node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/fallback.mjs
import http from 'node:http';
import assert from 'node:assert/strict';

const PORT = 8797;
let searches = [];          // peticiones a SerpApi de la última recogida
let saved = [];             // filas que el colector intentó guardar
let hasKey = true;
let paused = [];
let recentRows = [];
let mode = 'ok';            // ok | fail | error

// Fichas orgánicas como las devuelve Google: título con el sufijo del portal y enlace al anuncio.
const organic = (name, link) => ({
  title: `Closer de ventas | ${name}`,
  link,
  snippet: 'Buscamos closer para cerrar ventas por videollamada con leads cualificados.',
});
const COMPUTRABAJO_LINK = 'https://co.computrabajo.com/ofertas-de-trabajo/oferta-de-trabajo-de-closer-1';
const OCC_LINK = 'https://www.occ.com.mx/empleo/closer-2';

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const send = (code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  let body = '';
  for await (const chunk of req) body += chunk;
  if (url.pathname === '/search.json') {
    searches.push(Object.fromEntries(url.searchParams));
    if (mode === 'fail') return send(500, { error: 'boom' });
    if (mode === 'error') return send(200, { error: 'Invalid API key' });
    const q = url.searchParams.get('q') ?? '';
    const site = (q.match(/site:([^\s"]+)/) ?? [])[1] ?? '';
    const rows = [
      { title: 'Closer de ventas', link: 'https://example.com/no-es-un-portal', snippet: 'Otra web' }, // fuera del portal
      ...(site.includes('computrabajo') ? [organic('Computrabajo', COMPUTRABAJO_LINK)] : []),
      ...(site.includes('occ.com.mx') ? [organic('OCC Mundial', OCC_LINK)] : []),
    ];
    return send(200, { organic_results: rows });
  }
  if (url.pathname === '/rest/v1/integration_connections') {
    return send(200, hasKey ? [{ secret_ciphertext: process.env.TEST_SECRET }] : []);
  }
  if (url.pathname === '/rest/v1/source_settings') return send(200, paused.map(source => ({ source })));
  if (url.pathname === '/rest/v1/rpc/external_upsert') {
    const rows = JSON.parse(body || '{}').p_rows ?? [];
    saved.push(...rows);
    return send(200, rows.length);
  }
  if (url.pathname === '/rest/v1/external_ingest_runs') {
    if (req.method === 'POST') return send(201, {});
    return send(200, recentRows);
  }
  return send(404, {});
});
await new Promise(r => server.listen(PORT, '127.0.0.1', r));

process.env.SUPABASE_URL = `http://127.0.0.1:${PORT}`;
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';
process.env.SUPABASE_PUBLISHABLE_KEY = 'anon';
process.env.ADMIN_SECRETS_KEY = 'test-root';
process.env.SERPAPI_API_BASE = `http://127.0.0.1:${PORT}`;
delete process.env.SERPAPI_FALLBACK_MAX_SEARCHES;
delete process.env.DAILY_TARGET_OFFERS;

const { encryptSecret } = await import('../../apps/web/lib/secrets.ts');
process.env.TEST_SECRET = encryptSecret('serpapi-key-1234');
const {
  FALLBACK_PORTALS, DEFAULT_MAX, SEARCH_USD, planFallback,
  organicToCandidate, collectFallback,
} = await import('../../apps/web/lib/serpapiFallback.ts');

const computrabajo = FALLBACK_PORTALS.find(p => p.source === 'serpapi-computrabajo');
const occ = FALLBACK_PORTALS.find(p => p.source === 'serpapi-occ');
const infojobs = FALLBACK_PORTALS.find(p => p.source === 'serpapi-infojobs');
assert.ok(computrabajo && occ && infojobs, 'los portales del SOP están definidos');

const results = [];
const step = async (name, fn) => {
  searches = []; saved = []; hasKey = true; paused = []; recentRows = []; mode = 'ok';
  delete process.env.SERPAPI_FALLBACK_MAX_SEARCHES;
  delete process.env.DAILY_TARGET_OFFERS;
  try { await fn(); results.push(['PASS', name]); }
  catch (err) { results.push(['FAIL', name, err.message.split('\n')[0]]); }
};

await step('una ficha orgánica solo vale si el enlace es del portal, y el título pierde el sufijo', async () => {
  const hit = organicToCandidate(organic('Computrabajo', COMPUTRABAJO_LINK), computrabajo);
  assert.equal(hit.title, 'Closer de ventas');
  assert.equal(hit.url, COMPUTRABAJO_LINK);
  // Lo que Google no dice no se rellena: nada de empresa, ubicación ni salario inventados.
  assert.equal(hit.company, null);
  assert.equal(hit.location, null);
  assert.equal(hit.salary, null);
  assert.equal(hit.posted_at, null);
  assert.match(hit.description, /cerrar ventas/);
  assert.equal(organicToCandidate({ title: 'Closer', link: 'https://example.com/x' }, computrabajo), null, 'un portal no puede traer ofertas de otra web');
  assert.equal(organicToCandidate({ title: '', link: 'https://co.computrabajo.com/ofertas-de-trabajo/x' }, computrabajo), null, 'sin título no hay oferta');
  assert.equal(organicToCandidate({ title: 'Closer', link: 'javascript:alert(1)' }, computrabajo), null, 'solo enlaces http(s)');
});

await step('el plan prioriza los portales cuya API oficial falta y no paga dos veces el mismo inventario', async () => {
  const plan = planFallback({ missing: ['adzuna'], paused: new Set(), recent: new Set(), max: 4 });
  assert.equal(plan[0].source, 'serpapi-adzuna', 'la API ausente va primero');
  assert.ok(plan.some(p => p.source === 'serpapi-computrabajo'), 'LatAm sin API oficial entra en el plan');
  assert.ok(plan.length <= 4);
  // Un portal que ya trajo ofertas ayer no se repite (salvo que su API siga sin existir).
  const covered = planFallback({ missing: ['adzuna'], paused: new Set(), recent: new Set(['adzuna']), max: 9 });
  assert.ok(covered.some(p => p.source === 'serpapi-adzuna'), 'la API ausente se reintenta aunque haya respaldo reciente');
  const noRepeat = planFallback({ missing: [], paused: new Set(), recent: new Set(['jooble']), max: 9 });
  assert.ok(!noRepeat.some(p => p.source === 'serpapi-jooble'), 'Jooble ya cubierto por su API: no se paga otra búsqueda');
  // Pausada a propósito = no se busca ni se paga.
  const pausedPlan = planFallback({ missing: ['adzuna'], paused: new Set(['serpapi-adzuna']), recent: new Set(), max: 9 });
  assert.ok(!pausedPlan.some(p => p.source === 'serpapi-adzuna'));
  assert.deepEqual(planFallback({ missing: [], paused: null, recent: new Set(), max: 9 }), [], 'sin saber las pausas no se planifica');
});

await step('busca cada portal en Google con su país y su operador site:', async () => {
  const out = await collectFallback('test', { missing: ['adzuna'], need: 40 });
  assert.equal(out.ok, true);
  assert.equal(out.searches, DEFAULT_MAX, `búsquedas ${out.searches}`);
  assert.equal(out.cost_usd, Number((DEFAULT_MAX * SEARCH_USD).toFixed(3)), 'el coste se declara');
  for (const search of searches) {
    assert.equal(search.engine, 'google');
    assert.equal(search.hl, 'es');
    assert.equal(search.api_key, 'serpapi-key-1234');
    assert.match(search.q, /^site:/, search.q);
    assert.match(search.q, /closer/i, search.q);
    assert.ok(['es', 'mx', 'co', 'ar'].includes(search.gl), search.gl);
  }
  const occSearch = searches.find(s => s.q.includes('occ.com.mx'));
  assert.equal(occSearch.gl, 'mx');
  // Lo guardado sale con el código de su portal y como borrador limpio, listo para las reglas.
  assert.ok(saved.length >= 2, `guardadas ${saved.length}: ${out.outcomes.map(o => `${o.source}=${o.ok}${o.error ? ':' + o.error : ''}`).join(', ')}`);
  assert.equal(saved[0].source, undefined, 'la fuente la pone el guardado, no la fila');
  const row = saved.find(r => r.url.includes('computrabajo'));
  assert.equal(row.role, 'closer');
  assert.equal(row.title, 'Closer de ventas');
  const run = out.outcomes.find(o => o.source === 'serpapi-computrabajo');
  assert.equal(run.portal, 'Computrabajo');
  assert.equal(run.cost_usd, SEARCH_USD);
  assert.ok(run.accepted >= 1, `aceptadas ${run.accepted}`);
});

await step('si el día ya cumplió el objetivo no se gasta ni una búsqueda', async () => {
  recentRows = [{ accepted: 80, source: 'infojobs' }];
  const out = await collectFallback('test', { missing: ['adzuna'] });
  assert.equal(out.ok, true);
  assert.equal(out.searches, 0);
  assert.match(out.outcomes[0].skipped, /objetivo diario/);
  assert.equal(searches.length, 0);
});

await step('un error del proveedor se declara y no se cuenta como éxito', async () => {
  mode = 'error';
  const out = await collectFallback('test', { missing: ['adzuna'], need: 40, max: 1 });
  assert.equal(out.ok, false);
  assert.equal(out.outcomes[0].ok, false);
  assert.match(out.outcomes[0].error, /SerpApi: Invalid API key/);
  assert.equal(out.searches, 1, 'la búsqueda que falló también se cuenta (se pagó)');
});

await step('sin clave de SerpApi no se llama al proveedor', async () => {
  hasKey = false;
  const out = await collectFallback('test', { missing: ['adzuna'], need: 40 });
  assert.equal(out.ok, false);
  assert.match(out.outcomes[0].error, /Sin clave/);
  assert.equal(searches.length, 0);
});

await step('una fuente pausada no se busca', async () => {
  paused = ['serpapi-computrabajo'];
  const out = await collectFallback('test', { missing: [], need: 40, max: 9 });
  assert.ok(!searches.some(s => s.q.includes('computrabajo')), 'no se busca ni se paga lo que está pausado');
  assert.ok(!out.outcomes.some(o => o.source === 'serpapi-computrabajo'), 'ni aparece como intento');
});

await step('sin tiempo se corta y se declara', async () => {
  const out = await collectFallback('test', { missing: [], need: 40, deadline: Date.now() + 100, max: 9 });
  assert.equal(out.truncated, true);
  assert.equal(out.searches, 0);
});

await step('el respaldo se puede apagar y acotar por entorno', async () => {
  process.env.SERPAPI_FALLBACK_MAX_SEARCHES = '0';
  const off = await collectFallback('test', { missing: ['adzuna'], need: 40 });
  assert.equal(off.searches, 0);
  assert.match(off.outcomes[0].skipped, /desactivado/);
  assert.equal(searches.length, 0);
  process.env.SERPAPI_FALLBACK_MAX_SEARCHES = '2';
  const two = await collectFallback('test', { missing: ['adzuna'], need: 40 });
  assert.equal(two.searches, 2, 'el tope del entorno acota las búsquedas');
  process.env.SERPAPI_FALLBACK_MAX_SEARCHES = '99';
  const capped = await collectFallback('test', { missing: [], need: 500 });
  assert.equal(capped.searches, FALLBACK_PORTALS.length, 'no puede superar los portales definidos (y no se repiten)');
  assert.equal(DEFAULT_MAX <= FALLBACK_PORTALS.length, true);
});

server.close();
for (const [status, name, message] of results) console.log(`${status}  ${name}${message ? '\n      ' + message : ''}`);
const failed = results.filter(r => r[0] === 'FAIL').length;
console.log(`\n${results.length - failed}/${results.length} pasos OK`);
process.exit(failed ? 1 : 0);
