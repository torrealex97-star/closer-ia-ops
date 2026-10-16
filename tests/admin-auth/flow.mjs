// Flujo completo del acceso al panel contra la app en BASE (por defecto http://127.0.0.1:3100)
// con Supabase y motor simulados. Lo lanza run.sh, que arranca todo con las env correctas.
import { startMocks } from './mock-services.mjs';
import assert from 'node:assert/strict';

const BASE = process.env.BASE ?? 'http://127.0.0.1:3100';
const { state, close } = startMocks({ authPort: Number(process.env.MOCK_AUTH_PORT ?? 8791), enginePort: Number(process.env.MOCK_ENGINE_PORT ?? 8792) });
let jar = {};
const cookieHeader = () => Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
async function call(path, { method = 'GET', body, cookies = true, headers = {} } = {}) {
  const res = await fetch(BASE + path, { method, redirect: 'manual', headers: { 'content-type': 'application/json', ...(cookies && cookieHeader() ? { cookie: cookieHeader() } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  for (const raw of res.headers.getSetCookie()) { const [pair, ...attrs] = raw.split('; '); const [k, v] = pair.split('='); if (attrs.includes('Max-Age=0') || v === '') delete jar[k]; else jar[k] = v; }
  return { status: res.status, json: await res.json().catch(() => ({})), raw: res };
}
const results = [];
const step = async (name, fn) => { try { await fn(); results.push(['PASS', name]); } catch (e) { results.push(['FAIL', name, e.message]); } };

await step('sin sesión: proxy admin 401, overview 401, users 401', async () => {
  for (const p of ['/api/admin/opportunities', '/api/admin/overview', '/api/admin/users']) assert.equal((await call(p)).status, 401, p);
});
await step('la cookie del password compartido antiguo ya no abre nada', async () => {
  jar = { wdc_admin_session: 'cualquier-valor' };
  assert.equal((await call('/api/admin/opportunities')).status, 401); jar = {};
});
await step('login con contraseña incorrecta → 401 con mensaje único', async () => {
  const r = await call('/api/admin/session', { method: 'POST', body: { email: 'owner@test.dev', password: 'mala' } });
  assert.equal(r.status, 401); assert.equal(r.json.detail, 'Email o contraseña incorrectos.');
  assert.equal((await call('/api/admin/session', { method: 'POST', body: { email: 'nadie@test.dev', password: 'mala' } })).json.detail, 'Email o contraseña incorrectos.');
});
await step('usuario de Auth que NO está en la lista → 403 y sin cookies', async () => {
  state.users.set('colado@test.dev', { id: 'u9', password: 'Colado-123456' });
  const r = await call('/api/admin/session', { method: 'POST', body: { email: 'colado@test.dev', password: 'Colado-123456' } });
  assert.equal(r.status, 403); assert.deepEqual(jar, {});
});
await step('login correcto → cookies HttpOnly y sesión con rol', async () => {
  const r = await call('/api/admin/session', { method: 'POST', body: { email: 'owner@test.dev', password: 'Correcta-12345' } });
  assert.equal(r.status, 200); assert.equal(r.json.role, 'owner');
  const setCookie = r.raw.headers.getSetCookie().join('\n');
  assert.match(setCookie, /wdc_admin_at=.*HttpOnly/); assert.match(setCookie, /wdc_admin_rt=.*HttpOnly/);
  const s = await call('/api/admin/session'); assert.equal(s.json.authenticated, true); assert.equal(s.json.email, 'owner@test.dev');
});
await step('con sesión: proxy admin llega al motor con el token server-side', async () => {
  const r = await call('/api/admin/opportunities'); assert.equal(r.status, 200);
});
await step('cross-site bloqueado', async () => {
  assert.equal((await call('/api/admin/users', { headers: { 'sec-fetch-site': 'cross-site' } })).status, 403);
});
await step('overview: conexiones y fuentes reales del motor, sin valores de env', async () => {
  const r = await call('/api/admin/overview'); assert.equal(r.status, 200);
  assert.equal(r.json.sources.length, 3); assert.equal(r.json.sources[1].warning, 'HTTP 401'); assert.equal(r.json.pool.by_role.closer, 7);
  assert.ok(r.json.connections.some(c => c.id === 'supabase-auth' && c.status === 'ok'));
  assert.ok(r.json.paid.every(p => p.status === 'not_configured'));
  assert.ok(!JSON.stringify(r.json).includes('engine-token') && !JSON.stringify(r.json).includes('service-key'));
});
await step('expira el access token → se renueva solo con el refresh token', async () => {
  const old = 'at-expirado'; jar.wdc_admin_at = old; // token caducado/desconocido para Auth
  const r = await call('/api/admin/users'); assert.equal(r.status, 200); assert.notEqual(jar.wdc_admin_at, old);
});
await step('invitar: solo propietario; crea usuario, lista y manda correo', async () => {
  const r = await call('/api/admin/users', { method: 'POST', body: { email: 'Nueva@Test.dev', role: 'admin' } });
  assert.equal(r.status, 201); assert.equal(r.json.email_sent, true);
  assert.deepEqual(state.recoverCalls.at(-1), { email: 'nueva@test.dev', redirect_to: 'https://app.test.dev/admin/reset' });
  assert.ok((await call('/api/admin/users')).json.users.some(u => u.email === 'nueva@test.dev'));
  assert.equal((await call('/api/admin/users', { method: 'POST', body: { email: 'nueva@test.dev' } })).status, 409);
  assert.equal((await call('/api/admin/users', { method: 'POST', body: { email: 'no-es-email' } })).status, 422);
});
await step('recuperar contraseña: respuesta idéntica; correo solo para usuarios de la lista', async () => {
  const before = state.recoverCalls.length;
  const known = await call('/api/admin/auth/recover', { method: 'POST', cookies: false, body: { email: 'nueva@test.dev' } });
  const unknown = await call('/api/admin/auth/recover', { method: 'POST', cookies: false, body: { email: 'desconocido@test.dev' } });
  assert.equal(known.status, 200); assert.deepEqual(known.json, unknown.json);
  assert.equal(state.recoverCalls.length, before + 1); // solo el de la lista
  assert.equal(state.recoverCalls.at(-1).email, 'nueva@test.dev');
});
await step('reset: contraseña corta rechazada; token inválido 401; válido guarda y permite entrar', async () => {
  const t = state.recoverTokens.get('nueva@test.dev');
  assert.equal((await call('/api/admin/auth/reset', { method: 'POST', cookies: false, body: { access_token: t, password: 'corta' } })).status, 422);
  assert.equal((await call('/api/admin/auth/reset', { method: 'POST', cookies: false, body: { access_token: 'falso', password: 'Contraseña-larga-1' } })).status, 401);
  assert.equal((await call('/api/admin/auth/reset', { method: 'POST', cookies: false, body: { access_token: t, password: 'Contraseña-larga-1' } })).status, 200);
  const saved = jar; jar = {};
  const login = await call('/api/admin/session', { method: 'POST', body: { email: 'nueva@test.dev', password: 'Contraseña-larga-1' } });
  assert.equal(login.status, 200); assert.equal(login.json.role, 'admin');
  // un administrador (no propietario) no puede invitar ni dar de baja
  assert.equal((await call('/api/admin/users', { method: 'POST', body: { email: 'otro@test.dev' } })).status, 403);
  assert.equal((await call('/api/admin/users?email=owner%40test.dev', { method: 'DELETE' })).status, 403);
  jar = saved;
});
await step('baja: no puedes quitarte a ti ni al último propietario; quitar corta el acceso aunque tenga token', async () => {
  assert.equal((await call('/api/admin/users?email=owner%40test.dev', { method: 'DELETE' })).status, 409);
  const savedOwner = jar; jar = {};
  await call('/api/admin/session', { method: 'POST', body: { email: 'nueva@test.dev', password: 'Contraseña-larga-1' } });
  const adminJar = jar; jar = savedOwner;
  assert.equal((await call('/api/admin/users?email=nueva%40test.dev', { method: 'DELETE' })).status, 200);
  assert.ok(!state.admins.some(a => a.email === 'nueva@test.dev') && !state.users.has('nueva@test.dev'));
  const owner = jar; jar = adminJar;
  await new Promise(r => setTimeout(r, 100));
  assert.ok([401, 403].includes((await call('/api/admin/opportunities')).status));
  jar = owner;
});
await step('APIs: sin clave al principio; guardar cifrada; nunca se devuelve en claro; probar válida/ inválida', async () => {
  let r = await call('/api/admin/connections'); assert.equal(r.status, 200);
  assert.equal(r.json.connections.length, 7); assert.ok(r.json.connections.every(c => !c.configured));
  assert.equal((await call('/api/admin/connections', { method: 'PUT', body: { provider: 'nope', secret: 'good-key-1234' } })).status, 422);
  assert.equal((await call('/api/admin/connections', { method: 'PUT', body: { provider: 'groq', secret: 'corta' } })).status, 422);
  assert.equal((await call('/api/admin/connections', { method: 'POST', body: { provider: 'groq' } })).status, 404); // sin clave guardada
  assert.equal((await call('/api/admin/connections', { method: 'PUT', body: { provider: 'groq', secret: 'good-key-1234' } })).status, 200);
  assert.equal((await call('/api/admin/connections', { method: 'PUT', body: { provider: 'serpapi', secret: 'bad-key-99999' } })).status, 200);
  const stored = state.connections.get('groq').secret_ciphertext;
  assert.ok(!stored.includes('good-key-1234') && stored.split('.').length === 3);
  r = await call('/api/admin/connections'); const groq = r.json.connections.find(c => c.provider === 'groq');
  assert.equal(groq.configured, true); assert.equal(groq.last4, '1234');
  assert.ok(!JSON.stringify(r.json).includes('good-key') && !JSON.stringify(r.json).includes('ciphertext'));
  assert.deepEqual((await call('/api/admin/connections', { method: 'POST', body: { provider: 'groq' } })).json, { ok: true, detail: 'Clave válida' });
  const bad = await call('/api/admin/connections', { method: 'POST', body: { provider: 'serpapi' } });
  assert.equal(bad.json.ok, false); assert.match(bad.json.detail, /rechazada/);
  const o = (await call('/api/admin/overview')).json.paid;
  assert.equal(o.find(p => p.id === 'groq').status, 'ok'); assert.equal(o.find(p => p.id === 'serpapi').status, 'error'); assert.equal(o.find(p => p.id === 'apify').status, 'not_configured');
});
await step('APIs: un administrador (no propietario) puede ver y probar pero no guardar ni borrar', async () => {
  state.users.set('adm@test.dev', { id: 'u7', password: 'Admin-pass-12345' }); state.admins.push({ email: 'adm@test.dev', role: 'admin', invited_by: 'x', created_at: new Date().toISOString() });
  const saved = jar; jar = {}; await call('/api/admin/session', { method: 'POST', body: { email: 'adm@test.dev', password: 'Admin-pass-12345' } });
  assert.equal((await call('/api/admin/connections')).status, 200);
  assert.equal((await call('/api/admin/connections', { method: 'POST', body: { provider: 'groq' } })).status, 200);
  assert.equal((await call('/api/admin/connections', { method: 'PUT', body: { provider: 'groq', secret: 'good-key-1234' } })).status, 403);
  assert.equal((await call('/api/admin/connections?provider=groq', { method: 'DELETE' })).status, 403);
  jar = saved;
});
await step('APIs: borrar quita la clave', async () => {
  assert.equal((await call('/api/admin/connections?provider=groq', { method: 'DELETE' })).status, 200);
  assert.ok(!state.connections.has('groq'));
  assert.equal((await call('/api/admin/connections')).json.connections.find(c => c.provider === 'groq').configured, false);
});
await step('sin sesión: connections 401', async () => { const saved = jar; jar = {}; assert.equal((await call('/api/admin/connections')).status, 401); jar = saved; });
await step('ingest: cerrado sin token; valida el cuerpo; limpia datos personales y URLs peligrosas', async () => {
  const ingest = (body, token = 'ingest-token-0123456789abcdef0123') => call('/api/ingest', { method: 'POST', cookies: false, body, headers: token ? { authorization: `Bearer ${token}` } : {} });
  assert.equal((await ingest({ source: 'indeed', candidates: [] }, '')).status, 401);
  assert.equal((await ingest({ source: 'indeed', candidates: [] }, 'otro-token-distinto-0123456789')).status, 401);
  assert.equal((await ingest({ source: 'MAL SOURCE', candidates: [] })).status, 422);
  assert.equal((await ingest({ source: 'indeed' })).status, 422);
  const r = await ingest({ source: 'indeed', via: 'jobspy', candidates: [
    { external_id: 'a1', title: 'Closer de ventas', company: 'Acme', location: 'Madrid, España', url: 'https://es.indeed.com/viewjob?jk=a1', posted_at: '2026-10-15', description: 'Buscamos closer con experiencia en ventas para el equipo comercial. Escribe a rrhh@acme.com o llama al +34 600 123 456 <b>ya</b>.', raw: { site: 'indeed', emails: 'x@y.com', secreto: 'no' } },
    { external_id: 'a2', title: 'Closer', url: 'javascript:alert(1)' },
    { external_id: 'a3', title: 'Sin url' },
    { external_id: 'a4', title: 'Closer ok', url: 'https://www.ejemplo.es/o/4', location: 'Texas, USA' },
  ] });
  assert.equal(r.status, 200); assert.deepEqual([r.json.received, r.json.accepted, r.json.rejected], [4, 2, 2]);
  const stored = [...state.external.values()].find(o => o.external_id === 'a1');
  assert.ok(!/rrhh@acme|600 123|<b>/.test(stored.description) && /correo omitido/.test(stored.description));
  assert.deepEqual(Object.keys(stored.raw), ['site']); assert.equal(stored.editorial_status, 'draft');
  assert.equal(state.ingestRuns[0].source, 'indeed');
});
await step('ingest: repetir una oferta no pisa su estado editorial', async () => {
  const offer = [...state.external.values()].find(o => o.external_id === 'a1'); offer.editorial_status = 'approved';
  const r = await call('/api/ingest', { method: 'POST', cookies: false, headers: { authorization: 'Bearer ingest-token-0123456789abcdef0123' }, body: { source: 'indeed', candidates: [{ external_id: 'a1', title: 'Closer de ventas (actualizada)', url: 'https://es.indeed.com/viewjob?jk=a1' }] } });
  assert.equal(r.status, 200); assert.equal(offer.editorial_status, 'approved');
});
await step('externas (panel): lista con contadores, aprobación en bloque y verificación de vigencia', async () => {
  assert.equal((await call('/api/admin/external', { cookies: false })).status, 401);
  const list = await call('/api/admin/external?status=draft'); assert.equal(list.status, 200);
  assert.ok(list.json.sources.some(x => x.source === 'indeed') && list.json.runs.length >= 1);
  const ok = [...state.external.values()].find(o => o.external_id === 'a4'); ok.url = 'http://127.0.0.1:8792/page/ok'; ok.title = 'Closer de ventas';
  const v = await call('/api/admin/external', { method: 'POST', body: { action: 'verify', ids: [ok.id] } });
  assert.deepEqual(v.json.results[0].result, 'open'); assert.equal(ok.verified_result, 'open');
  assert.equal((await call('/api/admin/external', { method: 'PATCH', body: { ids: ['no-es-uuid'], editorial_status: 'approved' } })).status, 422);
  assert.equal((await call('/api/admin/external', { method: 'PATCH', body: { ids: [ok.id], editorial_status: 'inventado' } })).status, 422);
  const patch = await call('/api/admin/external', { method: 'PATCH', body: { ids: [ok.id], editorial_status: 'approved' } });
  assert.equal(patch.json.changed, 1); assert.equal(ok.editorial_status, 'approved');
});
await step('recogida de APIs oficiales: solo propietario; usa las claves guardadas y guarda borradores', async () => {
  for (const [provider, secret] of [['infojobs', 'cid:good-key-1234'], ['adzuna', 'aid:good-key-1234'], ['jooble', 'good-key-1234']]) {
    assert.equal((await call('/api/admin/connections', { method: 'PUT', body: { provider, secret } })).status, 200);
    assert.equal((await call('/api/admin/connections', { method: 'POST', body: { provider } })).json.ok, true, `prueba ${provider}`);
  }
  const saved = jar; jar = {}; await call('/api/admin/session', { method: 'POST', body: { email: 'adm@test.dev', password: 'Admin-pass-12345' } });
  assert.equal((await call('/api/admin/external', { method: 'POST', body: { action: 'collect' } })).status, 403); jar = saved;
  const r = await call('/api/admin/external', { method: 'POST', body: { action: 'collect' } }); assert.equal(r.status, 200);
  assert.deepEqual(r.json.outcomes.map(o => [o.provider, o.ok]), [['infojobs', true], ['adzuna', true], ['jooble', true]]);
  const bySource = Object.fromEntries([...state.external.values()].map(o => [o.source, o]));
  assert.equal(bySource.infojobs.title, 'Closer de ventas high ticket'); assert.equal(bySource.adzuna.location, 'Barcelona, España'); assert.equal(bySource.jooble.editorial_status, 'draft');
  assert.equal(state.ingestRuns.filter(x => x.via === 'panel').length, 3);
});
await step('cron: exige CRON_SECRET', async () => {
  assert.equal((await call('/api/cron/collect', { cookies: false })).status, 401);
  assert.equal((await call('/api/cron/collect', { cookies: false, headers: { authorization: 'Bearer incorrecto-0123456789' } })).status, 401);
  const r = await call('/api/cron/collect', { cookies: false, headers: { authorization: 'Bearer cron-secret-0123456789' } });
  assert.equal(r.status, 200); assert.equal(r.json.outcomes.length, 3);
});
await step('vista de alumna: suma solo externas aprobadas que cumplen perfil, España y español', async () => {
  const ext = Object.fromEntries([...state.external.values()].map(o => [o.external_id, o]));
  ext.a1.description = 'Buscamos closer con experiencia en ventas para el equipo comercial de la empresa'; ext.a1.editorial_status = 'approved'; ext.a1.title = 'Closer de ventas';
  ext.a4.editorial_status = 'approved'; ext.a4.location = 'Austin, Texas'; ext.a4.description = 'Closer needed';  // aprobada pero fuera de España/inglés
  ext['123'].editorial_status = 'draft'; // borrador: nunca visible
  const search = (body) => call('/api/backend/opportunities/search', { method: 'POST', cookies: false, body: { role: null, market: 'ES', days: 10, include_bilingual: false, starred_only: false, include_extra_roles: true, ...body } });
  const r = await search({}); assert.equal(r.status, 200);
  const urls = r.json.items.map(i => i.source_url);
  assert.ok(urls.includes('https://es.indeed.com/viewjob?jk=a1'), 'externa aprobada visible');
  assert.ok(!urls.some(u => u.includes('ejemplo.es') || u.includes('127.0.0.1:8792/page/ok')), 'fuera de España/inglés no');
  assert.ok(!urls.some(u => u.includes('adzuna')), 'borrador no');
  const item = r.json.items.find(i => i.source_url.includes('a1')); assert.equal(item.role_label, 'Closer'); assert.equal(item.id.startsWith('ext-'), true);
  assert.equal(r.json.total, r.json.items.length);
  assert.ok((await search({ role: 'setter' })).json.items.every(i => !i.source_url.includes('a1')));
  assert.ok((await search({ market: 'EU' })).json.items.every(i => !i.id.startsWith('ext-')));
  assert.ok((await search({ starred_only: true })).json.items.every(i => !i.id.startsWith('ext-')));
});
await step('logout limpia cookies y la sesión deja de valer', async () => {
  await call('/api/admin/session', { method: 'DELETE' });
  assert.deepEqual(jar, {}); assert.equal((await call('/api/admin/opportunities')).status, 401);
});

close();
for (const [status, name, msg] of results) console.log(`${status}  ${name}${msg ? '\n      ' + msg : ''}`);
const failed = results.filter(r => r[0] === 'FAIL').length;
console.log(`\n${results.length - failed}/${results.length} pasos OK`);
process.exit(failed ? 1 : 0);
