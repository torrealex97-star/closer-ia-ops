// Cuando el motor no responde, el panel y la alumna tienen que recibir la CAUSA en JSON. La plataforma
// responde 429 con TEXTO PLANO cuando el sitio está publicado pero la cuota del mes se agotó (medido en
// producción), y el motor reenviaba ese cuerpo: el cliente no puede leerlo como JSON, así que el panel
// mostraba «La consulta falló.» y la alumna leía «Revisa los campos e inténtalo otra vez» — culpándola de
// un problema del servidor. Aquí se fija: (1) pausa ≠ caída, (2) la causa se nombra, (3) sin ceros falsos.
// Uso: lo lanza run.sh con la app ya arrancada contra el simulador (127.0.0.1:8791 auth, 8792 motor).
import assert from 'node:assert/strict';
import { startMocks } from './mock-services.mjs';

const BASE = process.env.BASE ?? 'http://127.0.0.1:3199';
const { state, close } = startMocks({ authPort: Number(process.env.MOCK_AUTH_PORT ?? 8791), enginePort: Number(process.env.MOCK_ENGINE_PORT ?? 8792) });
let jar = {};
const cookieHeader = () => Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
async function call(path, { method = 'GET', body, cookies = true, headers = {} } = {}) {
  const res = await fetch(BASE + path, { method, redirect: 'manual', headers: { 'content-type': 'application/json', ...(cookies && cookieHeader() ? { cookie: cookieHeader() } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  for (const raw of res.headers.getSetCookie()) { const [pair, ...attrs] = raw.split('; '); const [k, v] = pair.split('='); if (attrs.includes('Max-Age=0') || v === '') delete jar[k]; else jar[k] = v; }
  return { status: res.status, json: await res.json().catch(() => null), type: res.headers.get('content-type') ?? '' };
}
const search = () => call('/api/backend/opportunities/search', { method: 'POST', cookies: false, body: { role: 'closer', market: 'ES', days: 10, include_bilingual: false, starred_only: false, include_extra_roles: true } });
const engineCheck = json => json.connections.find(c => c.id === 'engine');
const results = [];
const step = async (name, fn) => { try { await fn(); results.push(['PASS', name]); } catch (e) { results.push(['FAIL', name, e.message]); } };

const login = await call('/api/admin/session', { method: 'POST', body: { email: 'owner@test.dev', password: 'Correcta-12345' } });
assert.equal(login.status, 200, 'la sesión del panel tiene que abrirse para poder probarlo');
assert.equal(state.external.size, 0, 'sin ofertas externas aprobadas: así se prueba el hueco real, no un relleno');

await step('motor en pausa por cuota: overview nombra la causa y no rellena el hueco con ceros', async () => {
  state.enginePaused = 'allowance';
  const r = await call('/api/admin/overview');
  assert.equal(r.status, 200);
  assert.ok(r.type.includes('json'), `el panel recibe JSON, no el texto de la plataforma (${r.type})`);
  assert.equal(r.json.engine, null, 'sin datos del motor: se declara, no se inventa');
  assert.equal(r.json.engine_reason, 'allowance');
  assert.equal(r.json.engine_http_status, 429);
  assert.equal(engineCheck(r.json).status, 'error');
  assert.match(engineCheck(r.json).detail, /pausa por cuota de hosting/);
  assert.deepEqual(r.json.sources, [], 'las fuentes del motor van vacías, no como si no existieran');
  assert.ok(!JSON.stringify(r.json).includes('engine-token'), 'el token del motor no sale al navegador');
});

await step('el proxy admin explica la pausa en vez de reenviar el texto en inglés', async () => {
  const r = await call('/api/admin/opportunities?limit=1');
  assert.equal(r.status, 503, 'el motor no está disponible');
  assert.ok(r.type.includes('json'), `JSON también aquí (${r.type})`);
  assert.equal(r.json.engine_paused, true);
  assert.equal(r.json.upstream_status, 429);
  assert.match(r.json.detail, /pausa por cuota de hosting/);
  assert.ok(!JSON.stringify(r.json).includes('hosting allowance'), 'no se filtra el texto crudo de la plataforma');
});

await step('la alumna recibe la causa, no un «Revisa los campos»', async () => {
  const r = await search();
  assert.equal(r.status, 503);
  assert.ok(r.type.includes('json'), `JSON también para la alumna (${r.type})`);
  assert.match(r.json.detail, /pausa por cuota de hosting/);
  assert.match(r.json.detail, /Vuelve a intentarlo/, 'y qué puede hacer mientras');
});

await step('motor en pausa CON externas aprobadas: la alumna las ve (JSON legible, no texto etiquetado)', async () => {
  state.external.set('ep|ext1', {
    id: crypto.randomUUID(), source: 'indeed', external_id: 'ext1', title: 'Closer de ventas', company: 'Acme', location: 'Madrid, España',
    description: 'Buscamos closer para cerrar ventas consultivas con leads cualificados.', url: 'https://es.indeed.com/ext1',
    editorial_status: 'approved', role: 'closer', spain: true, score: 80, raw: {}, posted_at: null,
    first_seen_at: new Date().toISOString(), last_seen_at: new Date().toISOString(), expires_at: new Date(Date.now() + 5 * 864e5).toISOString(), also_seen: [],
  });
  const r = await search();
  assert.equal(r.status, 200, 'un motor en pausa no convierte la vista en un error si hay externas que servir');
  assert.ok(r.type.includes('json'), `el cuerpo es JSON y tiene que estar etiquetado como tal (${r.type})`);
  assert.equal(r.json.degraded, 'motor');
  assert.ok(r.json.items.length > 0 && r.json.items.every(i => String(i.id).startsWith('ext-')), 'solo externas: el motor no aporta nada');
  state.external.delete('ep|ext1');
});

await step('una caída real (500) no se cuenta como pausa de cuota', async () => {
  state.enginePaused = 'error';
  const r = await call('/api/admin/overview');
  assert.equal(r.json.engine_reason, 'down');
  assert.equal(r.json.engine_http_status, 500);
  assert.match(engineCheck(r.json).detail, /No responde/);
  const p = await call('/api/admin/opportunities?limit=1');
  assert.equal(p.status, 502, 'un 500 del motor no es «no encontrado» ni «no autorizado»');
  assert.equal(p.json.engine_paused, false);
  assert.match(p.json.detail, /HTTP 500/);
});

await step('motor sano: ninguna causa inventada (control)', async () => {
  state.enginePaused = null;
  const r = await call('/api/admin/overview');
  assert.equal(r.status, 200);
  assert.equal(r.json.engine_reason, null);
  assert.equal(r.json.engine_http_status, null);
  assert.equal(r.json.engine.catalog_active, 12);
  assert.equal(engineCheck(r.json).status, 'ok');
  assert.equal((await call('/api/admin/opportunities?limit=1')).status, 200);
  const s = await search();
  assert.equal(s.status, 200);
  assert.equal(s.json.items.length, 7, 'la búsqueda de la alumna vuelve a servir el catálogo del motor');
});

close();
for (const [status, name, msg] of results) console.log(`${status}  ${name}${msg ? '\n      ' + msg : ''}`);
const failed = results.filter(r => r[0] === 'FAIL').length;
console.log(`\n${results.length - failed}/${results.length} pasos OK`);
process.exit(failed ? 1 : 0);
