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
const step = async (name, fn) => { try { await fn(); results.push(['PASS', name]); } catch (e) { results.push(['FAIL', name, `${e.message} @ ${(String(e.stack).match(/flow\.mjs:\d+/) ?? [''])[0]}`]); } };

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
await step('ingest: rescata el salario literal del texto cuando la fuente no lo trae', async () => {
  const r = await call('/api/ingest', { method: 'POST', cookies: false, headers: { authorization: 'Bearer ingest-token-0123456789abcdef0123' }, body: { source: 'indeed', candidates: [
    { external_id: 's1', title: 'Closer', url: 'https://es.indeed.com/s1', description: 'Ofrecemos 24.000 - 30.000 € brutos/año más comisiones y formación continua en el equipo' },
    { external_id: 's2', title: 'Closer', url: 'https://es.indeed.com/s2', description: 'Bonus de 1.000 € mensuales por objetivos', salary: '1.500 € / mes' },
    { external_id: 's3', title: 'Closer', url: 'https://es.indeed.com/s3', description: 'Más de 2.000 clientes' },
  ] } });
  assert.equal(r.status, 200);
  const by = id => [...state.external.values()].find(o => o.external_id === id);
  assert.equal(by('s1').salary, '24.000 - 30.000 € brutos/año'); assert.equal(by('s2').salary, '1.500 € / mes'); assert.equal(by('s3').salary, null);
});
await step('ingest: repetir una oferta no pisa su estado editorial', async () => {
  const offer = [...state.external.values()].find(o => o.external_id === 'a1'); offer.editorial_status = 'approved';
  const r = await call('/api/ingest', { method: 'POST', cookies: false, headers: { authorization: 'Bearer ingest-token-0123456789abcdef0123' }, body: { source: 'indeed', candidates: [{ external_id: 'a1', title: 'Closer de ventas (actualizada)', url: 'https://es.indeed.com/viewjob?jk=a1' }] } });
  assert.equal(r.status, 200); assert.equal(offer.editorial_status, 'approved');
});
await step('alumnas: invitación, recuperación, login, perfil con consentimiento, aislamiento, pausa, supresión y baja', async () => {
  const E = 'ana@alumna.dev', studentCookie = () => `wdc_student_at=${jar.wdc_student_at}`;
  // Sin sesión
  for (const [path, method] of [['/api/student/profile', 'GET'], ['/api/admin/students', 'GET']]) assert.equal((await call(path, { method, cookies: false })).status, 401);
  assert.equal((await call('/api/student/session', { method: 'POST', cookies: false, body: { email: E, password: 'x'.repeat(12) } })).status, 401);
  // Invitar (admin): origen ajeno bloqueado, alta, duplicado, correo no válido
  assert.equal((await call('/api/admin/students', { method: 'POST', body: { email: E }, headers: { origin: 'https://evil.test' } })).status, 403);
  const inv = await call('/api/admin/students', { method: 'POST', body: { email: E } }); assert.equal(inv.status, 201); assert.equal(inv.json.email_sent, true);
  assert.equal((await call('/api/admin/students', { method: 'POST', body: { email: E } })).status, 409);
  assert.equal((await call('/api/admin/students', { method: 'POST', body: { email: 'no-es-correo' } })).status, 422);
  // Una persona NO invitada no puede recuperar ni entrar (misma respuesta: no revela quién está)
  const rec = await call('/api/student/auth/recover', { method: 'POST', cookies: false, body: { email: 'intrusa@x.dev' } }); assert.equal(rec.status, 200); assert.ok(!state.recoverTokens.has('intrusa@x.dev'));
  // Crear contraseña con el enlace del correo y entrar
  assert.equal((await call('/api/student/auth/recover', { method: 'POST', cookies: false, body: { email: E } })).status, 200);
  const t = state.recoverTokens.get(E);
  assert.equal((await call('/api/student/auth/reset', { method: 'POST', cookies: false, body: { access_token: t, password: 'corta' } })).status, 422);
  assert.equal((await call('/api/student/auth/reset', { method: 'POST', cookies: false, body: { access_token: t, password: 'Contraseña-alumna-1' } })).status, 200);
  const login = await call('/api/student/session', { method: 'POST', cookies: false, body: { email: E, password: 'Contraseña-alumna-1' } }); assert.equal(login.status, 200);
  assert.ok(login.raw.headers.getSetCookie().every(c => /HttpOnly/.test(c) && c.startsWith('wdc_student_')), 'cookies propias y HttpOnly');
  // Primera entrada enlaza el usuario y activa la ficha
  assert.equal(state.students.find(x => x.email === E).status, 'active'); assert.ok(state.students.find(x => x.email === E).user_id);
  // Perfil: exige consentimiento; saneado; el vídeo es un enlace https
  const own = { cookies: false, headers: { cookie: studentCookie() } };
  assert.equal((await call('/api/student/profile', own)).json.profile, null);
  assert.equal((await call('/api/student/profile', { ...own, method: 'PUT', body: { full_name: 'Ana', consent: false } })).status, 422);
  const put = await call('/api/student/profile', { ...own, method: 'PUT', body: { full_name: ' Ana <b>Pérez</b> ', city: 'Sevilla', target_roles: ['closer', 'hacker'], languages: ['es', 'xx'], video_url: 'https://drive.google.com/file/d/1/view', consent: true, user_id: 'robado', org_id: 'otra' } });
  assert.equal(put.status, 200); assert.equal(put.json.profile.full_name, 'Ana Pérez'); assert.deepEqual(put.json.profile.target_roles, ['closer']); assert.deepEqual(put.json.profile.languages, ['es']);
  assert.ok(put.json.profile.consent_at && !('user_id' in put.json.profile), 'user_id/org_id nunca vienen del cuerpo');
  assert.equal([...state.profiles.keys()].length, 1); assert.equal([...state.profiles.values()][0].org_id, 'cloud-wdc');
  const bad = await call('/api/student/profile', { ...own, method: 'PUT', body: { full_name: 'Ana', video_url: 'http://insegura.test/v', consent: true } }); assert.equal(bad.json.profile.video_url, null, 'http se descarta');
  assert.equal((await call('/api/student/profile', { ...own, method: 'PUT', body: { video_url: 'https://10.0.0.1/x', consent: true } })).json.profile.video_url, null, 'IP literal se descarta');
  // Aislamiento entre superficies: la sesión de alumna no abre el panel ni al revés
  assert.equal((await call('/api/admin/students', { cookies: false, headers: { cookie: studentCookie() } })).status, 401);
  assert.equal((await call('/api/admin/external', { cookies: false, headers: { cookie: studentCookie() } })).status, 401);
  assert.equal((await call('/api/student/profile', { cookies: false, headers: { cookie: `wdc_admin_at=${jar.wdc_admin_at}` } })).status, 401);
  // Pausar corta el acceso (con su token aún vivo) y reactivar lo devuelve; la lista la ve el panel
  const id = (await call('/api/admin/students')).json.students.find(x => x.email === E).id;
  assert.equal((await call('/api/admin/students', { method: 'PATCH', body: { id, status: 'paused' } })).status, 200);
  assert.equal((await call('/api/student/profile', own)).status, 403);
  assert.equal((await call('/api/student/session', { method: 'POST', cookies: false, body: { email: E, password: 'Contraseña-alumna-1' } })).status, 403);
  assert.equal((await call('/api/admin/students', { method: 'PATCH', body: { id, status: 'inventado' } })).status, 422);
  assert.equal((await call('/api/admin/students', { method: 'PATCH', body: { id, status: 'active' } })).status, 200);
  assert.equal((await call('/api/student/profile', own)).status, 200);
  // Supresión de perfil (RGPD) y baja
  assert.equal((await call('/api/student/profile', { ...own, method: 'DELETE' })).status, 200); assert.equal((await call('/api/student/profile', own)).json.profile, null);
  assert.equal((await call('/api/admin/students', { method: 'DELETE' })).status, 503, 'sin id no borra nada');
  assert.equal((await call(`/api/admin/students?id=${id}`, { method: 'DELETE' })).status, 200);
  assert.ok(!state.students.some(x => x.email === E) && !state.users.has(E), 'baja borra ficha y usuario de Auth');
  const out = await call('/api/student/session', { method: 'DELETE', headers: { origin: 'https://evil.test' } }); assert.equal(out.status, 403);
  delete jar.wdc_student_at; delete jar.wdc_student_rt; // el navegador de la alumna no es el del operador
});
await step('leads B2B (panel): exige sesión y origen, importa, lista y cambia estado sin pisar el trabajo humano', async () => {
  assert.equal((await call('/api/admin/b2b', { cookies: false })).status, 401);
  assert.equal((await call('/api/admin/b2b', { method: 'POST', body: { leads: [{ advertiser: 'Acme' }] }, headers: { origin: 'https://evil.test' } })).status, 403);
  const imp = await call('/api/admin/b2b', { method: 'POST', body: { leads: [{ advertiser: 'Acme Clinics', market: 'ES', weeks_active: 8 }, { nada: 1 }] } });
  assert.equal(imp.status, 200); assert.deepEqual([imp.json.accepted, imp.json.rejected], [1, 1]);
  const list = await call('/api/admin/b2b'); assert.equal(list.json.leads.length, 1);
  const id = list.json.leads[0].id;
  assert.equal((await call('/api/admin/b2b', { method: 'PATCH', body: { ids: [id], status: 'contactado' } })).json.changed, 1);
  assert.equal((await call('/api/admin/b2b', { method: 'PATCH', body: { ids: [id], status: 'inventado' } })).status, 422);
  await call('/api/admin/b2b', { method: 'POST', body: { leads: [{ advertiser: 'Acme Clinics', market: 'ES', weeks_active: 9 }] } });
  assert.equal((await call('/api/admin/b2b')).json.leads[0].status, 'contactado');
});
await step('métricas (panel): exige sesión y devuelve 14 días con coste y decisiones', async () => {
  assert.equal((await call('/api/admin/metrics', { cookies: false })).status, 401);
  const r = await call('/api/admin/metrics'); assert.equal(r.status, 200);
  assert.equal(r.json.days.length, 14); assert.ok(Array.isArray(r.json.perTier) && Array.isArray(r.json.perSource) && r.json.review.minutes === null && 'cost_per_good' in r.json.apify);
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
  // Presupuesto de tiempo: la respuesta declara los cortes y lo gastado, muy por debajo de maxDuration (60 s)
  assert.ok(Array.isArray(r.json.truncated)); assert.ok(r.json.spent_ms >= 0 && r.json.spent_ms < 40000);
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
  // Sin descripción (p. ej. LinkedIn sin detalle): visible si el título es español y la ubicación es España explícita.
  const noDesc = { id: crypto.randomUUID(), source: 'linkedin', external_id: 'nd1', title: 'Closer de ventas', company: 'Delta', location: 'Madrid, España', url: 'https://www.linkedin.com/jobs/view/nd1', description: null, editorial_status: 'approved', posted_at: new Date().toISOString(), expires_at: new Date(Date.now() + 5 * 864e5).toISOString() };
  const noDescUs = { ...noDesc, id: crypto.randomUUID(), external_id: 'nd2', url: 'https://www.linkedin.com/jobs/view/nd2', location: 'Houston, Texas' };
  state.external.set('l|nd1', noDesc); state.external.set('l|nd2', noDescUs);
  const again = (await search({})).json.items.map(i => i.source_url);
  assert.ok(again.includes(noDesc.url), 'sin descripción pero título español + España: visible'); assert.ok(!again.includes(noDescUs.url), 'sin descripción y sin España: no');
  assert.ok(!urls.some(u => u.includes('ejemplo.es') || u.includes('127.0.0.1:8792/page/ok')), 'fuera de España/inglés no');
  assert.ok(!urls.some(u => u.includes('adzuna')), 'borrador no');
  const item = r.json.items.find(i => i.source_url.includes('a1')); assert.equal(item.role_label, 'Closer'); assert.equal(item.id.startsWith('ext-'), true);
  // Lo que declara la fuente (is_remote, job_type) se muestra; lo demás sigue «no indicado».
  assert.equal(item.modality, 'Modalidad no indicada'); ext.a1.raw = { site: 'indeed', is_remote: true, job_type: 'fulltime, permanent' };
  const declared = (await search({})).json.items.find(i => i.source_url.includes('a1')); assert.equal(declared.modality, 'Remoto'); assert.equal(declared.schedule, 'Jornada completa'); assert.equal(declared.contract, 'Indefinido');
  assert.equal(r.json.total, r.json.items.length);
  assert.ok((await search({ role: 'setter' })).json.items.every(i => !i.source_url.includes('a1')));
  assert.ok((await search({ market: 'EU' })).json.items.every(i => !i.id.startsWith('ext-')));
  assert.ok((await search({ starred_only: true })).json.items.every(i => !i.id.startsWith('ext-')));
});
await step('escala: puntuación, filtros en servidor, paginación, deduplicado entre fuentes y «aprobar las mejores»', async () => {
  const tok = { authorization: 'Bearer ingest-token-0123456789abcdef0123' };
  const fresh = new Date().toISOString();
  const candidates = Array.from({ length: 130 }, (_, i) => ({
    external_id: `g${i}`, title: i % 10 === 0 ? 'Setter de ventas' : `Closer de ventas ${i}`, company: `Empresa ${i}`, location: i % 2 ? 'Austin, Texas' : 'Madrid, España', url: `https://www.glassdoor.es/job/${i}`, posted_at: fresh,
    description: 'Buscamos una persona con experiencia en ventas para el equipo comercial de la empresa. ' + (i % 3 === 0 ? 'Ofrecemos 30.000 € brutos/año más comisiones. ' : '') + 'x'.repeat(i % 7 === 0 ? 400 : 0),
  }));
  const r = await call('/api/ingest', { method: 'POST', cookies: false, headers: tok, body: { source: 'glassdoor', via: 'jobspy', candidates } });
  assert.equal(r.json.accepted, 130);
  const rows = [...state.external.values()].filter(o => o.source === 'glassdoor');
  assert.equal(rows.length, 130); assert.ok(rows.every(o => Number.isInteger(o.score) && o.score >= 0 && o.score <= 100));
  assert.equal(rows.find(o => o.external_id === 'g2').role, 'closer'); assert.equal(rows.find(o => o.external_id === 'g10').role, 'setter');
  assert.equal(rows.find(o => o.external_id === 'g2').spain, true); assert.equal(rows.find(o => o.external_id === 'g3').spain, false);
  assert.ok(rows.find(o => o.external_id === 'g6').score > rows.find(o => o.external_id === 'g2').score, 'con sueldo publicado puntúa más');
  assert.ok(rows.find(o => o.external_id === 'g2').score > rows.find(o => o.external_id === 'g3').score, 'España puntúa más que fuera');
  // listado en servidor
  const list = (qs) => call('/api/admin/external?' + qs);
  const all = await list('status=draft&source=glassdoor&spain=1&role=closer&page_size=50'); assert.equal(all.status, 200);
  assert.equal(all.json.total, 52); // 65 en España − 13 setters (i%10==0 y par)
  assert.equal(all.json.offers.length, 50); assert.equal(all.json.page, 1);
  const scores = all.json.offers.map(o => o.score); assert.deepEqual(scores, [...scores].sort((a, b) => b - a), 'orden por puntuación');
  assert.equal((await list('status=draft&source=glassdoor&spain=1&role=closer&page_size=50&page=2')).json.offers.length, 2);
  assert.equal((await list('status=draft&source=glassdoor&role=setter')).json.total, 13);
  assert.equal((await list('status=draft&source=glassdoor&spain=1&q=Empresa%2012')).json.total, 6); // 12, 120, 122, 124, 126, 128 (búsqueda parcial, como ilike)
  assert.ok((await list('status=draft&source=glassdoor&min_score=60')).json.offers.every(o => o.score >= 60));
  assert.ok((await list('status=draft&source=glassdoor&sort=recent')).json.offers.length > 0);
  assert.ok(all.json.counts.draft >= 130);
  // el mismo anuncio llegando por otra fuente no se duplica
  const before = state.external.size;
  const dup = await call('/api/ingest', { method: 'POST', cookies: false, headers: tok, body: { source: 'google', candidates: [{ external_id: 'dup-4', title: 'Closer de ventas 4 (H/M)', company: 'EMPRESA 4 S.L.', location: 'Madrid', url: 'https://www.google.com/jobs/4', description: 'Buscamos' }] } });
  assert.equal(dup.json.accepted, 1); assert.equal(state.external.size, before);
  assert.deepEqual(rows.find(o => o.external_id === 'g4').also_seen, ['google']);
  // aprobar las 5 mejores con filtros
  const top5 = [...all.json.offers].slice(0, 5).map(o => o.id);
  const bad = await call('/api/admin/external', { method: 'POST', body: { action: 'approve_top', n: 0 } }); assert.equal(bad.status, 422);
  const ap = await call('/api/admin/external', { method: 'POST', body: { action: 'approve_top', n: 5, filters: { status: 'draft', source: 'glassdoor', spain: '1', role: 'closer' } } });
  assert.deepEqual([ap.json.matched, ap.json.approved], [52, 5]);
  const approved = rows.filter(o => o.editorial_status === 'approved').map(o => o.id).sort();
  assert.deepEqual(approved, [...top5].sort(), 'se aprueban justo las 5 de mayor puntuación');
  assert.equal((await list('status=draft&source=glassdoor&spain=1&role=closer')).json.total, 47);
  // las aprobadas llegan a la vista de alumna ordenadas, las borradores no
  const seen = (await call('/api/backend/opportunities/search', { method: 'POST', cookies: false, body: { role: 'closer', market: 'ES', days: 10, include_bilingual: false, starred_only: false, include_extra_roles: true } })).json.items.filter(i => i.source_url.includes('glassdoor.es'));
  assert.equal(seen.length, 5);
});
await step('Apify: clave, actores, validaciones y permisos (solo el propietario configura y lanza)', async () => {
  assert.equal((await call('/api/admin/apify', { cookies: false })).status, 401);
  assert.equal((await call('/api/admin/connections', { method: 'PUT', body: { provider: 'apify', secret: 'good-key-1234' } })).status, 200);
  let g = await call('/api/admin/apify'); assert.equal(g.status, 200); assert.equal(g.json.has_key, true); assert.equal(g.json.budget.limit, 5); assert.equal(g.json.presets[0].actor, 'aakash19/jobspy');
  const save = (b) => call('/api/admin/apify', { method: 'POST', body: { action: 'save', ...b } });
  assert.equal((await save({ label: 'x', actor: 'sin-barra', source: 'apify-x' })).status, 422);
  assert.equal((await save({ label: 'x', actor: 'a/b', source: 'MAL' })).status, 422);
  assert.equal((await save({ label: 'x', actor: 'a/b', source: 'apify-x', input_template: '{no json' })).status, 422);
  assert.equal((await save({ label: 'x', actor: 'a/b', source: 'apify-x', input_template: '[1]' })).status, 422);
  assert.equal((await save({ label: 'JobSpy', actor: 'aakash19/jobspy', source: 'apify-jobspy', max_items: 650, memory_mb: 1024, timeout_s: 900 })).status, 201);
  assert.equal((await save({ label: 'Con plantilla', actor: 'owner/templated', source: 'apify-tpl', max_items: 100, input_template: '{"keywords":"{{query}}","where":"{{location}}","limit":"{{max_items}}","nested":{"c":"{{country}}"},"text":"en {{location}}"}' })).status, 201);
  assert.equal((await save({ label: 'Estricto', actor: 'owner/strict', source: 'apify-strict' })).status, 201);
  const actors = (await call('/api/admin/apify')).json.actors; assert.equal(actors.length, 3);
  const saved = jar; jar = {}; await call('/api/admin/session', { method: 'POST', body: { email: 'adm@test.dev', password: 'Admin-pass-12345' } });
  assert.equal((await call('/api/admin/apify')).status, 200); // ver: cualquiera
  assert.equal((await save({ label: 'y', actor: 'a/b', source: 'apify-y' })).status, 403);
  assert.equal((await call('/api/admin/apify', { method: 'POST', body: { action: 'start', id: actors[0].id } })).status, 403);
  assert.equal((await call('/api/admin/apify', { method: 'POST', body: { action: 'schema', actor: 'a/b' } })).status, 403);
  assert.equal((await call('/api/admin/apify', { method: 'POST', body: { action: 'harvest' } })).status, 200); // recoger: cualquiera
  jar = saved;
  const schema = await call('/api/admin/apify', { method: 'POST', body: { action: 'schema', actor: 'aakash19/jobspy' } });
  assert.deepEqual(schema.json.fields.find(f => f.name === 'search_term'), { name: 'search_term', type: 'string', required: true });
});
await step('Apify: lanzar adapta la entrada al esquema, aplica límites, webhook y presupuesto', async () => {
  const [jobspy, tpl, strict] = (await call('/api/admin/apify')).json.actors;
  const start = (a) => call('/api/admin/apify', { method: 'POST', body: { action: 'start', id: a.id } });
  const r = await start(jobspy); assert.equal(r.status, 202);
  const c = state.apifyCalls.at(-1);
  assert.equal(c.actor, 'aakash19~jobspy'); assert.equal(c.auth, 'good-key-1234');
  assert.match(c.input.search_term, /"closer de ventas" OR "closer high ticket"/); assert.equal(c.input.location, 'España'); assert.equal(c.input.country_indeed, 'Spain');
  assert.equal(c.input.results_wanted, 650); assert.equal(c.input.hours_old, 240); assert.deepEqual(c.input.site_name, ['indeed', 'linkedin', 'glassdoor', 'google']); assert.deepEqual(c.input.proxyConfiguration, { useApifyProxy: true });
  assert.deepEqual([c.query.memory, c.query.timeout, c.query.maxItems], ['1024', '900', '650']);
  const hook = JSON.parse(Buffer.from(c.query.webhooks, 'base64').toString()); assert.ok(hook[0].eventTypes.includes('ACTOR.RUN.SUCCEEDED')); assert.match(hook[0].requestUrl, /^https:\/\/app\.test\.dev\/api\/apify\/webhook\?t=[0-9a-f]{64}$/);
  assert.equal(state.apifyRuns[0].status, 'RUNNING'); assert.equal(state.apifyRuns[0].started_by, 'owner@test.dev');
  assert.equal((await start(jobspy)).status, 409, 'una sola ejecución en curso por actor');
  const t = await start(tpl); assert.equal(t.status, 202); const ti = state.apifyCalls.at(-1).input;
  assert.equal(ti.limit, 100); assert.equal(typeof ti.limit, 'number'); assert.equal(ti.where, 'España'); assert.equal(ti.nested.c, 'Spain'); assert.equal(ti.text, 'en España'); assert.match(ti.keywords, /closer de ventas/);
  const st = await start(strict); assert.equal(st.status, 409); assert.match(st.json.detail, /mandatoryField/);
  // presupuesto: con 4,5 USD gastados y límite 5 no se lanza nada más
  state.apifyRuns.unshift({ id: crypto.randomUUID(), actor_id: tpl.id, run_id: 'OLD1', status: 'SUCCEEDED', started_at: new Date().toISOString(), finished_at: new Date().toISOString(), harvested: 1, cost_usd: 4.5 });
  state.apifyRuns.find(x => x.run_id === 'OLD1'); const calls = state.apifyCalls.length;
  const over = await start({ id: tpl.id }); assert.equal(over.status, 409); assert.match(over.json.detail, /Presupuesto mensual agotado/); assert.equal(state.apifyCalls.length, calls);
  state.apifyRuns = state.apifyRuns.filter(x => x.run_id !== 'OLD1');
});
await step('Apify: una ejecución lanzada que no se puede registrar se DECLARA con su id (no es un éxito falso)', async () => {
  const [jobspy] = (await call('/api/admin/apify')).json.actors;
  const keep = state.apifyRuns; state.apifyRuns = []; state.failRunPost = true;
  try {
    const r = await call('/api/admin/apify', { method: 'POST', body: { action: 'start', id: jobspy.id } });
    assert.equal(r.status, 409); assert.match(r.json.detail, /no se pudo registrar/); assert.match(r.json.detail, /RUN\w+/, 'incluye el id de la ejecución de Apify');
    assert.equal(state.apifyRuns.length, 0, 'nada a medias en la base');
  } finally { state.failRunPost = false; state.apifyRuns = keep; }
});
await step('Apify: webhook con token; recogida por lotes reanudable; coste y duplicados', async () => {
  const run = state.apifyRuns.find(r => r.run_id.startsWith('RUN1')); const token = JSON.parse(Buffer.from(state.apifyCalls[0].query.webhooks, 'base64').toString())[0].requestUrl.split('t=')[1];
  const hookCall = (t, body) => call(`/api/apify/webhook?t=${t}`, { method: 'POST', cookies: false, body });
  assert.equal((await hookCall('mal', { resource: { id: run.run_id } })).status, 401);
  assert.equal((await hookCall(token, { resource: { id: 'noexiste1' } })).status, 404);
  assert.equal((await hookCall(token, { resource: { id: '!!' } })).status, 422);
  // En curso: no hay nada que recoger todavía
  state.apifyStatus = 'RUNNING'; let h = await hookCall(token, { resource: { id: run.run_id } }); assert.equal(h.json.done, false); assert.equal(h.json.harvested, 0);
  // 650 elementos con forma de JobSpy + 2 inválidos (sin enlace) y uno repetido por otra fuente
  state.apifyItems = Array.from({ length: 650 }, (_, i) => ({ id: `ap-${i}`, site: 'indeed', job_url: `https://es.indeed.com/viewjob?jk=ap${i}`, title: i % 5 === 0 ? 'Setter de ventas' : `Closer de ventas ${i}`, company: `Compañía ${i}`, location: i % 2 ? 'Texas, USA' : 'Madrid, España', date_posted: new Date().toISOString().slice(0, 10), description: 'Buscamos una persona con experiencia en ventas para el equipo comercial de la empresa', min_amount: i % 3 === 0 ? 24000 : null, max_amount: i % 3 === 0 ? 30000 : null, currency: 'EUR', interval: 'yearly', is_remote: i % 4 === 0, job_type: 'fulltime' }));
  state.apifyItems.push({ id: 'bad1', title: 'Sin enlace' }, { id: 'bad2', job_url: 'javascript:alert(1)', title: 'Peligrosa' });
  state.apifyStatus = 'SUCCEEDED';
  const before = [...state.external.values()].filter(o => o.source === 'apify-jobspy').length; assert.equal(before, 0);
  h = await hookCall(token, { resource: { id: run.run_id } }); assert.equal(h.status, 200); assert.equal(h.json.done, true); assert.equal(h.json.harvested, 652);
  const got = [...state.external.values()].filter(o => o.source === 'apify-jobspy');
  assert.equal(got.length, 650, 'las 2 inválidas se descartan y las demás se guardan en 3 lotes (300+300+52)');
  assert.ok(got.every(o => o.score >= 0 && o.editorial_status === 'draft'));
  const withSalary = got.find(o => o.external_id === 'ap-0'); assert.equal(withSalary.salary, '24000–30000 EUR / yearly'); assert.equal(withSalary.role, 'setter'); assert.equal(withSalary.spain, true);
  assert.equal(got.find(o => o.external_id === 'ap-4').raw.is_remote, true);
  const done = state.apifyRuns.find(r => r.run_id === run.run_id); assert.equal(done.cost_usd, 0.07); assert.ok(done.finished_at); assert.equal(done.harvested, 652); assert.equal(done.error, null);
  const g = (await call('/api/admin/apify')).json; assert.equal(g.budget.spent, 0.07 + 1, 'coste real de la terminada + 1 USD reservado de la ejecución en curso');
  // reanudable: si ya está terminada no se vuelve a recoger
  const again = await call('/api/admin/apify', { method: 'POST', body: { action: 'harvest' } });
  assert.equal(state.external.size, [...state.external.values()].length); assert.equal([...state.external.values()].filter(o => o.source === 'apify-jobspy').length, 650); void again;
  // ejecución fallida: se anota y no recoge nada
  const failed = state.apifyRuns.find(r => r.run_id.startsWith('RUN2')); state.apifyStatus = 'FAILED';
  const f = await hookCall(token, { resource: { id: failed.run_id } }); assert.equal(f.json.done, true); assert.match(state.apifyRuns.find(r => r.run_id === failed.run_id).error, /FAILED/); state.apifyStatus = 'SUCCEEDED';
});
await step('Apify: el cron lanza solo los actores diarios (una vez al día) y respeta el presupuesto', async () => {
  const [jobspy] = (await call('/api/admin/apify')).json.actors;
  await call('/api/admin/apify', { method: 'POST', body: { action: 'save', id: jobspy.id, label: 'JobSpy', actor: 'aakash19/jobspy', source: 'apify-jobspy', max_items: 650, memory_mb: 1024, timeout_s: 900, schedule_daily: true } });
  state.apifyRuns.find(r => r.actor_id === jobspy.id).started_at = new Date(Date.now() - 30 * 3600 * 1000).toISOString(); // última ejecución hace 30 h
  for (const r of state.apifyRuns) if (r.actor_id !== jobspy.id) r.status = 'SUCCEEDED';
  const calls = state.apifyCalls.length;
  const cron = () => call('/api/cron/collect', { cookies: false, headers: { authorization: 'Bearer cron-secret-0123456789' } });
  let r = await cron(); assert.equal(r.status, 200); assert.equal(state.apifyCalls.length, calls + 1, 'lanzó el diario'); assert.deepEqual(r.json.apify.started, [{ actor: 'aakash19/jobspy', ok: true }]);
  r = await cron(); assert.equal(state.apifyCalls.length, calls + 1, 'una sola vez al día'); assert.deepEqual(r.json.apify.started, []);
});
await step('pausar una fuente: se rechaza su ingesta, se salta su recogida y desaparece de la vista de alumna', async () => {
  const tok = { authorization: 'Bearer ingest-token-0123456789abcdef0123' };
  const saved = jar; jar = {}; await call('/api/admin/session', { method: 'POST', body: { email: 'adm@test.dev', password: 'Admin-pass-12345' } });
  assert.equal((await call('/api/admin/external', { method: 'PATCH', body: { source: 'indeed', enabled: false } })).status, 403); jar = saved; // solo propietario
  assert.equal((await call('/api/admin/external', { method: 'PATCH', body: { source: 'MAL SOURCE', enabled: false } })).status, 422);
  assert.equal((await call('/api/admin/external', { method: 'PATCH', body: { source: 'indeed', enabled: 'no' } })).status, 422);
  assert.equal((await call('/api/admin/external', { method: 'PATCH', body: { source: 'indeed', enabled: false } })).status, 200);
  assert.deepEqual((await call('/api/admin/external')).json.paused, ['indeed']);
  const before = state.external.size;
  const r = await call('/api/ingest', { method: 'POST', cookies: false, headers: tok, body: { source: 'indeed', candidates: [{ external_id: 'p1', title: 'Closer', url: 'https://es.indeed.com/p1' }] } });
  assert.equal(r.json.paused, true); assert.equal(r.json.accepted, 0); assert.equal(state.external.size, before);
  const search = () => call('/api/backend/opportunities/search', { method: 'POST', cookies: false, body: { role: null, market: 'ES', days: 10, include_bilingual: false, starred_only: false, include_extra_roles: true } });
  assert.ok(!(await search()).json.items.some(i => i.source_url.includes('a1')), 'pausada: oculta');
  await call('/api/admin/connections', { method: 'PUT', body: { provider: 'jooble', secret: 'good-key-1234' } });
  assert.equal((await call('/api/admin/external', { method: 'PATCH', body: { source: 'jooble', enabled: false } })).status, 200);
  const c = await call('/api/admin/external', { method: 'POST', body: { action: 'collect' } });
  assert.deepEqual(c.json.outcomes.find(o => o.provider === 'jooble'), { provider: 'jooble', ok: false, error: 'Fuente pausada' });
  for (const s of ['indeed', 'jooble']) assert.equal((await call('/api/admin/external', { method: 'PATCH', body: { source: s, enabled: true } })).status, 200);
  assert.deepEqual((await call('/api/admin/external')).json.paused, []);
  assert.ok((await search()).json.items.some(i => i.source_url.includes('a1')), 'reanudada: visible otra vez');
});
await step('vigencia automática (cron): verifica las aprobadas viejas y retira solo las cerradas', async () => {
  const mk = (id, url) => { const o = { id: crypto.randomUUID(), source: 'indeed', external_id: id, title: 'Closer de ventas', company: 'Acme', location: 'Madrid, España', url, editorial_status: 'approved', verified_at: null, verified_result: null, posted_at: null, expires_at: new Date(Date.now() + 5 * 864e5).toISOString() }; state.external.set('v|' + id, o); return o; };
  const live = mk('live', 'http://127.0.0.1:8792/page/ok'), dead = mk('dead', 'http://127.0.0.1:8792/page/gone');
  const fresh = mk('fresh', 'http://127.0.0.1:8792/page/gone'); fresh.verified_at = new Date().toISOString(); // comprobada hace poco: no se toca
  const r = await call('/api/cron/collect', { cookies: false, headers: { authorization: 'Bearer cron-secret-0123456789' } });
  assert.equal(r.status, 200); assert.ok(r.json.vigencia.checked >= 2);
  assert.equal(live.editorial_status, 'approved'); assert.equal(dead.editorial_status, 'withdrawn'); assert.equal(dead.reviewed_by, 'auto-vigencia'); assert.equal(fresh.editorial_status, 'approved');
});
await step('seguridad: cabeceras en todas las respuestas', async () => {
  const res = await fetch(BASE + '/admin');
  assert.equal(res.headers.get('x-frame-options'), 'DENY'); assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('referrer-policy'), 'strict-origin-when-cross-origin'); assert.match(res.headers.get('permissions-policy'), /camera=\(\)/);
  assert.equal(res.headers.get('x-powered-by'), null);
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
