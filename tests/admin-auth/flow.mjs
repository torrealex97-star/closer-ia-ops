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
  assert.equal(r.json.sources.length, 2); assert.equal(r.json.sources[1].warning, 'HTTP 401');
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
await step('logout limpia cookies y la sesión deja de valer', async () => {
  await call('/api/admin/session', { method: 'DELETE' });
  assert.deepEqual(jar, {}); assert.equal((await call('/api/admin/opportunities')).status, 401);
});

close();
for (const [status, name, msg] of results) console.log(`${status}  ${name}${msg ? '\n      ' + msg : ''}`);
const failed = results.filter(r => r[0] === 'FAIL').length;
console.log(`\n${results.length - failed}/${results.length} pasos OK`);
process.exit(failed ? 1 : 0);
