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
  assert.equal(r.json.connections.length, 8); assert.ok(r.json.connections.every(c => !c.configured));
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
  assert.equal((await call('/api/admin/connections', { method: 'PUT', body: { provider: 'resend', secret: 'good-key-1234' } })).status, 200);
  assert.deepEqual((await call('/api/admin/connections', { method: 'POST', body: { provider: 'resend' } })).json, { ok: true, detail: 'Clave válida' });
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
    { external_id: 'a1', title: 'Closer de ventas', company: 'Acme', location: 'Madrid, España', url: 'https://es.indeed.com/viewjob?jk=a1', posted_at: new Date(Date.now() - 2 * 864e5).toISOString().slice(0, 10), /* relativo: con una fecha fija la oferta caducaba de la ventana de 10 días con el paso del tiempo */ description: 'Buscamos closer con experiencia en ventas para el equipo comercial. Escribe a rrhh@acme.com o llama al +34 600 123 456 <b>ya</b>.', raw: { site: 'indeed', emails: 'x@y.com', secreto: 'no' } },
    { external_id: 'a2', title: 'Closer', url: 'javascript:alert(1)' },
    { external_id: 'a3', title: 'Sin url' },
    { external_id: 'a4', title: 'Closer ok', url: 'https://www.ejemplo.es/o/4', location: 'Texas, USA' },
  ] });
  assert.equal(r.status, 200); assert.deepEqual([r.json.received, r.json.accepted, r.json.rejected], [4, 2, 2]);
  const stored = [...state.external.values()].find(o => o.external_id === 'a1');
  assert.ok(!/rrhh@acme|600 123|<b>/.test(stored.description) && /correo omitido/.test(stored.description));
  // El contacto se guarda aparte, solo si el anuncio lo publica (decisión del propietario); el texto sigue anonimizado.
  assert.deepEqual(stored.contact, { emails: ['rrhh@acme.com'], phones: ['+34 600 123 456'] });
  assert.equal(stored.company_url, null, 'sin URL corporativa en el texto no se inventa una');
  assert.equal(stored.market, 'ES'); assert.equal(stored.market_basis, 'ubicacion_espana');
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
await step('ofertas peligrosas: la revisión muestra el nivel y el motivo; una oferta normal no lleva marca', async () => {
  const r = await call('/api/ingest', { method: 'POST', cookies: false, headers: { authorization: 'Bearer ingest-token-0123456789abcdef0123' }, body: { source: 'indeed', candidates: [
    { external_id: 'risk1', title: 'Closer high ticket', url: 'https://es.indeed.com/risk1', company: 'Riesgo SL', location: 'Madrid, España', description: 'Debes pagar una licencia de 300 € para empezar a vender con nosotros.' },
    { external_id: 'risk2', title: 'Closer high ticket', url: 'https://es.indeed.com/risk2', company: 'Normal SL', location: 'Madrid, España', description: 'Buscamos closer con experiencia para nuestro equipo comercial en Madrid. Sueldo fijo y comisiones.' },
  ] } });
  assert.equal(r.status, 200);
  try {
    const list = await call('/api/admin/external?status=draft&page_size=100'); assert.equal(list.status, 200);
    const by = id => list.json.offers.find(o => o.external_id === id);
    assert.equal(by('risk1').risk.level, 'BLOCKED'); assert.match(by('risk1').risk.flags.join(' '), /pago o una compra previa/);
    assert.equal(by('risk2').risk, null);
    assert.deepEqual(by('risk2').tags, { niche: 'formacion', pay: 'fijo_mas_comision' }, 'etiquetas de nicho y pago en la revisión');
  } finally { for (const [key, o] of [...state.external.entries()]) if (o.external_id === 'risk1' || o.external_id === 'risk2') state.external.delete(key); }
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
  // Progreso: la entrada ya cuenta; formación y examen solo se registran con sesión.
  const studentHeaders = { cookies: false, headers: { cookie: studentCookie() } };
  assert.equal((await call('/api/student/voice', { cookies: false })).status, 401);
  const voice = await call('/api/student/voice', studentHeaders); assert.equal(voice.status, 200);
  assert.deepEqual(voice.json, { enabled: false, reason: 'switch_off', consent: null }, 'la voz sigue apagada sin VOICE_ROLEPLAY');
  const before = await call('/api/student/progress', studentHeaders);
  assert.equal(before.status, 200); assert.equal(before.json.progress.sessions, 1, 'el login cuenta como entrada');
  assert.equal(before.json.progress.practice.count, 0); assert.equal(before.json.progress.training.examBest, null, 'sin examen es null, no 0');
  assert.equal((await call('/api/student/activity', { cookies: false, method: 'POST', body: { kind: 'training_review', ref: 'precall', detail: { met: 4, total: 4 } } })).status, 401);
  assert.equal((await call('/api/student/activity', { ...studentHeaders, method: 'POST', body: { kind: 'training_review', ref: 'modulo-falso', detail: { met: 1, total: 1 } } })).status, 422);
  assert.equal((await call('/api/student/activity', { ...studentHeaders, method: 'POST', body: { kind: 'training_exam', ref: 'final', score: 101 } })).status, 422);
  assert.equal((await call('/api/student/activity', { ...studentHeaders, method: 'POST', body: { kind: 'training_review', ref: 'precall', detail: { met: 4, total: 4 } } })).status, 201);
  const exam = await call('/api/student/activity', { ...studentHeaders, method: 'POST', body: { kind: 'training_exam', ref: 'final', score: 100, detail: { correct: 6, total: 6, passed: false } } });
  assert.equal(exam.status, 201); assert.equal(exam.json.passed, true, 'el servidor recalcula el superado');
  const after = await call('/api/student/progress', studentHeaders);
  assert.deepEqual(after.json.progress.training.modules, ['precall']); assert.equal(after.json.progress.training.examBest, 100); assert.equal(after.json.progress.training.examPassed, true);
  assert.equal(after.json.progress.recent[0].kind, 'training_exam', 'lo más reciente primero');
  assert.equal(after.json.progress.lifetime.training.examBest, 100, 'el resumen de siempre también trae el examen');
  // La nota la calcula el servidor con las respuestas acertadas: un `score` inflado
  // no se guarda y el «superado» se recalcula.
  const forged = await call('/api/student/activity', { ...studentHeaders, method: 'POST', body: { kind: 'training_exam', ref: 'final', score: 100, detail: { correct: 2, total: 6, passed: true } } });
  assert.equal(forged.status, 201); assert.equal(forged.json.score, 33, '2 de 6 = 33, no el 100 del navegador'); assert.equal(forged.json.passed, false);
  assert.equal((await call('/api/student/activity', { ...studentHeaders, method: 'POST', body: { kind: 'training_exam', ref: 'final', score: 100 } })).status, 422, 'sin respuestas no hay nota');
  const recomputed = await call('/api/student/progress', studentHeaders);
  assert.equal(recomputed.json.progress.recent[0].score, 33); assert.equal(recomputed.json.progress.recent[0].detail.passed, false);
  const adminView = await call('/api/admin/students'); assert.equal(adminView.status, 200);
  assert.ok(adminView.json.activity.some(a => a.student.email === E && a.summary.training.examBest === 100));
  assert.ok(adminView.json.totals.entered7 >= 1);
  assert.equal(adminView.json.activity_available, true, 'la actividad se pudo leer');
  assert.equal(adminView.json.truncated, false);
  // Perfil: exige consentimiento; saneado; el vídeo es un enlace https
  const own = { cookies: false, headers: { cookie: studentCookie() } };
  assert.equal((await call('/api/student/profile', own)).json.profile, null);
  assert.equal((await call('/api/student/profile', { ...own, method: 'PUT', body: { full_name: 'Ana', consent: false } })).status, 422);
  const put = await call('/api/student/profile', { ...own, method: 'PUT', body: { full_name: ' Ana <b>Pérez</b> ', city: 'Sevilla', target_roles: ['closer', 'hacker'], languages: ['es', 'xx'], video_url: 'https://drive.google.com/file/d/1/view', consent: true, user_id: 'robado', org_id: 'otra' } });
  assert.equal(put.status, 200); assert.equal(put.json.profile.full_name, 'Ana Pérez'); assert.deepEqual(put.json.profile.target_roles, ['closer']); assert.deepEqual(put.json.profile.languages, ['es']);
  assert.ok(put.json.profile.consent_at && !('user_id' in put.json.profile), 'user_id/org_id nunca vienen del cuerpo');
  assert.equal([...state.profiles.keys()].length, 1); assert.equal([...state.profiles.values()][0].org_id, 'cloud-wdc');
  // Matching: solo aprobadas, de su perfil, explicado; sin sesión no hay acceso
  assert.equal((await call('/api/student/matches', { cookies: false })).status, 401);
  // Descripciones distintas: la vista de alumna agrupa las republicaciones (misma empresa + texto casi idéntico) y aquí son tres ofertas diferentes.
  const DESCRIPTIONS = { 11: 'Buscamos una persona con experiencia en ventas para el equipo comercial de la empresa en España.', 12: 'Borrador interno sin publicar: puesto de cierre para llamadas con clientes de alto valor en Sevilla y alrededores.', 13: 'Captación telefónica de nuevos contactos en frío, agenda de reuniones y seguimiento del embudo con la dirección de ventas.' };
  const mk = (id, status, title) => state.external.set(`m|${id}`, { id: `00000000-0000-4000-8000-0000000000${id}`, source: 'm', external_id: id, title, company: 'Acme', location: 'Sevilla, España', url: `https://jobs.example.com/${id}`, salary: '30.000 €/año', description: DESCRIPTIONS[id] ?? DESCRIPTIONS['11'], posted_at: new Date().toISOString(), expires_at: new Date(Date.now() + 5 * 864e5).toISOString(), first_seen_at: new Date().toISOString(), last_seen_at: new Date().toISOString(), editorial_status: status, role: 'closer', spain: true, score: 80, raw: {}, also_seen: [] });
  mk('11', 'approved', 'Closer de ventas Sevilla'); mk('12', 'draft', 'Closer de ventas borrador'); mk('13', 'approved', 'Setter de ventas Sevilla');
  const recs = await call('/api/student/matches', own); assert.equal(recs.status, 200); assert.equal(recs.json.ready, true);
  const titles = recs.json.matches.map(m => m.opportunity.original_title);
  assert.ok(titles.includes('Closer de ventas Sevilla'), 'recomienda la aprobada de su perfil');
  assert.ok(!titles.includes('Closer de ventas borrador'), 'nunca un borrador');
  assert.ok(!titles.includes('Setter de ventas Sevilla'), 'ni otro perfil que no eligió');
  const top = recs.json.matches.find(m => m.opportunity.original_title === 'Closer de ventas Sevilla'); assert.ok(top.reasons.some(r => /tu ciudad/.test(r)) && top.score >= 70);
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
await step('candidaturas asistidas: formulario base, borrador, copia, seguimiento, aislamiento y supresión (nada se envía)', async () => {
  const E1 = 'bea@alumna.dev', E2 = 'carla@alumna.dev';
  const login = async (E) => {
    assert.equal((await call('/api/admin/students', { method: 'POST', body: { email: E } })).status, 201);
    assert.equal((await call('/api/student/auth/recover', { method: 'POST', cookies: false, body: { email: E } })).status, 200);
    assert.equal((await call('/api/student/auth/reset', { method: 'POST', cookies: false, body: { access_token: state.recoverTokens.get(E), password: 'Contraseña-alumna-1' } })).status, 200);
    const r = await call('/api/student/session', { method: 'POST', cookies: false, body: { email: E, password: 'Contraseña-alumna-1' } }); assert.equal(r.status, 200);
    const h = { cookies: false, headers: { cookie: `wdc_student_at=${jar.wdc_student_at}` } }; delete jar.wdc_student_at; delete jar.wdc_student_rt; return h;
  };
  const A = await login(E1), B = await login(E2);
  const mk = (id, status, title) => state.external.set(`ap|${id}`, { id: `00000000-0000-4000-8000-0000000000${id}`, source: 'ap', external_id: id, title, company: 'Acme', location: 'Sevilla, España', url: `https://jobs.example.com/${id}`, salary: '30.000 €/año', description: 'Buscamos una persona con experiencia en ventas para el equipo comercial de la empresa en España.', posted_at: new Date().toISOString(), expires_at: new Date(Date.now() + 5 * 864e5).toISOString(), first_seen_at: new Date().toISOString(), last_seen_at: new Date().toISOString(), editorial_status: status, role: 'closer', spain: true, score: 80, raw: {}, also_seen: [] });
  mk('21', 'approved', 'Closer de ventas Sevilla'); mk('22', 'draft', 'Closer en borrador'); const OK = 'ext-00000000-0000-4000-8000-000000000021', DRAFT = 'ext-00000000-0000-4000-8000-000000000022';
  // Sin sesión
  for (const [path, method] of [['/api/student/application-profile', 'GET'], ['/api/student/applications', 'GET'], ['/api/student/applications', 'POST']]) assert.equal((await call(path, { method, cookies: false })).status, 401);
  assert.equal((await call('/api/student/applications', { ...A, method: 'POST', headers: { ...A.headers, origin: 'https://evil.test' }, body: { offer_id: OK } })).status, 403);
  // Sin consentimiento base no se guarda el formulario ni se prepara nada
  assert.equal((await call('/api/student/application-profile', { ...A, method: 'PUT', body: { contact_email: 'bea@ejemplo.com' } })).status, 422);
  assert.equal((await call('/api/student/applications', { ...A, method: 'POST', body: { offer_id: OK } })).status, 422);
  assert.equal((await call('/api/student/profile', { ...A, method: 'PUT', body: { full_name: 'Bea Ruiz', city: 'Sevilla', target_roles: ['closer'], languages: ['es'], video_url: 'https://drive.google.com/file/d/v/view', consent: true } })).status, 200);
  assert.equal((await call('/api/student/profile', { ...B, method: 'PUT', body: { full_name: 'Carla', languages: ['es'], consent: true } })).status, 200);
  // Formulario base: saneado, user_id/org_id ignorados, consentimiento de autorrelleno aparte y revocable
  const g0 = await call('/api/student/application-profile', A); assert.equal(g0.json.profile, null); assert.equal(g0.json.completeness.pct, 10);
  const put = await call('/api/student/application-profile', { ...A, method: 'PUT', body: { contact_email: 'BEA@Ejemplo.com', phone: '600 11 22 33', linkedin_url: 'http://x.y', cv_url: 'https://drive.google.com/file/d/cv/view', country_residence: 'España', work_authorization: 'eu_citizen', years_sales: 4, sales_experience: 'Cierre B2C', pitch: 'Cierro llamadas high ticket.', available_from: '2026-11-03', user_id: 'robado', org_id: 'otra', autofill_consent: true } });
  assert.equal(put.status, 200); assert.equal(put.json.profile.contact_email, 'bea@ejemplo.com'); assert.equal(put.json.profile.linkedin_url, null); assert.ok(put.json.profile.autofill_consent_at); assert.equal(put.json.completeness.pct, 100);
  assert.equal([...state.appProfiles.values()].length, 1); assert.equal([...state.appProfiles.values()][0].org_id, 'cloud-wdc'); assert.notEqual([...state.appProfiles.values()][0].user_id, 'robado');
  const revoked = await call('/api/student/application-profile', { ...A, method: 'PUT', body: { ...put.json.profile, autofill_consent: false } }); assert.equal(revoked.json.profile.autofill_consent_at, null, 'se puede retirar el permiso futuro');
  // Candidatura: solo ofertas aprobadas y visibles; datos de la oferta salen del catálogo; idempotente
  assert.equal((await call('/api/student/applications', { ...A, method: 'POST', body: { offer_id: DRAFT } })).status, 404, 'un borrador no se puede preparar');
  assert.equal((await call('/api/student/applications', { ...A, method: 'POST', body: { offer_id: 'ext-no-es-uuid' } })).status, 422);
  const prep = await call('/api/student/applications', { ...A, method: 'POST', body: { offer_id: OK, offer_title: 'Título falso', offer_url: 'https://evil.test' } });
  assert.equal(prep.status, 201); const app = prep.json.application; assert.equal(app.offer_title, 'Closer de ventas Sevilla'); assert.equal(app.offer_url, 'https://jobs.example.com/21'); assert.equal(app.status, 'draft');
  assert.match(app.cover_message, /Me llamo Bea Ruiz y me interesa el puesto de Closer de ventas Sevilla/); assert.match(app.cover_message, /Cierro llamadas high ticket\./); assert.ok(!/undefined|null/.test(app.cover_message));
  const again = await call('/api/student/applications', { ...A, method: 'POST', body: { offer_id: OK } }); assert.equal(again.status, 200); assert.equal(again.json.created, false); assert.equal(again.json.application.id, app.id);
  assert.equal(state.applications.filter(a => a.offer_ref === OK).length, 1, 'una sola candidatura por oferta');
  const list = await call('/api/student/applications', A); assert.equal(list.json.applications.length, 1); assert.equal(list.json.assisted_only, true);
  const copyKeys = list.json.copy.map(c => c.key); for (const k of ['full_name', 'contact_email', 'phone', 'cv_url', 'video_url', 'work_authorization', 'pitch']) assert.ok(copyKeys.includes(k), `copia: ${k}`);
  assert.equal(list.json.copy.find(c => c.key === 'work_authorization').value, 'Ciudadana de la UE');
  // Seguimiento: ella edita y marca; transiciones coherentes; applied_at solo al enviar
  const edit = await call('/api/student/applications', { ...A, method: 'PATCH', body: { id: app.id, cover_message: 'Mi mensaje <b>propio</b>, escríbeme a bea@ejemplo.com', notes: 'llamar el lunes' } });
  assert.equal(edit.status, 200); assert.equal(edit.json.application.cover_message, 'Mi mensaje  propio , escríbeme a bea@ejemplo.com', 'conserva su propio contacto, quita HTML');
  assert.equal((await call('/api/student/applications', { ...A, method: 'PATCH', body: { id: app.id, status: 'enviada_sola' } })).status, 422);
  const opened = await call('/api/student/applications', { ...A, method: 'PATCH', body: { id: app.id, status: 'opened' } }); assert.equal(opened.json.application.status, 'opened'); assert.equal(opened.json.application.applied_at, null);
  const applied = await call('/api/student/applications', { ...A, method: 'PATCH', body: { id: app.id, status: 'applied' } }); assert.equal(applied.json.application.status, 'applied'); assert.ok(applied.json.application.applied_at);
  assert.equal((await call('/api/student/applications', { ...A, method: 'PATCH', body: { id: app.id, status: 'draft' } })).status, 409, 'una enviada no vuelve a borrador');
  // Resultado declarado por la alumna: enviada → respondida → entrevista; no retrocede y un estado inventado se rechaza.
  const patchApp = status => call('/api/student/applications', { ...A, method: 'PATCH', body: { id: app.id, status } });
  assert.equal((await patchApp('contratada')).status, 422);
  assert.equal((await patchApp('responded')).json.application.status, 'responded');
  assert.equal((await patchApp('applied')).status, 409, 'una respondida no vuelve a enviada');
  assert.equal((await patchApp('interview')).json.application.status, 'interview');
  const mine = await call('/api/student/progress', A); assert.equal(mine.status, 200);
  assert.deepEqual([mine.json.metrics.applications.sent, mine.json.metrics.applications.responded, mine.json.metrics.applications.interviews, mine.json.metrics.applications.responseRate], [1, 1, 1, 100]);
  assert.ok(mine.json.metrics.xp.xp >= 90 && mine.json.metrics.xp.level >= 1, 'la entrevista suma XP');
  assert.equal((await call('/api/student/progress', { cookies: false })).status, 401);
  // Aislamiento: otra alumna ni la ve ni la toca ni la borra
  assert.equal((await call('/api/student/applications', B)).json.applications.length, 0);
  assert.equal((await call('/api/student/applications', { ...B, method: 'PATCH', body: { id: app.id, status: 'discarded' } })).status, 404);
  assert.equal((await call(`/api/student/applications?id=${app.id}`, { ...B, method: 'DELETE' })).status, 404); assert.equal(state.applications.length, 1);
  assert.equal((await call('/api/student/application-profile', B)).json.profile, null);
  // Panel y alumna no se mezclan
  assert.equal((await call('/api/student/applications', { cookies: false, headers: { cookie: `wdc_admin_at=${jar.wdc_admin_at}` } })).status, 401);
  // Nada se envía: ninguna petición saliente a la oferta ni a correo durante todo el flujo (el mock del motor solo ve lecturas)
  // Supresión total: perfil, formulario base y candidaturas
  assert.equal((await call('/api/student/profile', { ...A, method: 'DELETE' })).status, 200);
  assert.equal(state.applications.filter(a => a.user_id === app.user_id).length, 0); assert.equal([...state.appProfiles.values()].length, 0);
  // Borrar una candidatura propia
  mk('23', 'approved', 'Closer de ventas Madrid'); const p2 = await call('/api/student/applications', { ...B, method: 'POST', body: { offer_id: 'ext-00000000-0000-4000-8000-000000000023' } }); assert.equal(p2.status, 201);
  assert.equal((await call(`/api/student/applications?id=${p2.json.application.id}`, { ...B, method: 'DELETE' })).status, 200);
  assert.equal((await call('/api/student/applications', B)).json.applications.length, 0);
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
await step('acuerdo IA/humano (panel): exige sesión y devuelve pares con veredicto', async () => {
  assert.equal((await call('/api/admin/ai-agreement', { cookies: false })).status, 401);
  const r = await call('/api/admin/ai-agreement'); assert.equal(r.status, 200);
  assert.ok(['insufficient', 'not_ready', 'ready'].includes(r.json.verdict) && r.json.min_pairs === 30 && typeof r.json.pairs === 'number');
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
  assert.deepEqual(r.json.outcomes.filter(o => o.provider).map(o => [o.provider, o.ok]), [['infojobs', true], ['adzuna', true], ['jooble', true]], JSON.stringify(r.json.outcomes));
  // Google Jobs (SerpApi) se intenta en la misma pasada; en las pruebas está apagado por SERPAPI_JOBS_MAX_DORKS=0.
  const google = r.json.outcomes.find(o => o.source === 'google-jobs');
  assert.ok(google && google.ok === false && /desactivada/.test(google.error), JSON.stringify(google));
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
  // Europa incluye España: la externa aprobada de Madrid entra; la de Houston no.
  const eu = (await search({ market: 'EU' })).json.items;
  assert.ok(eu.every(i => !i.id.startsWith('ext-') || /Madrid|España/.test(i.location)), 'EU: solo lo español entre las externas');
  // LatAm y EE. UU. se sirven por mercado, no por ubicación española.
  const latam = (await search({ market: 'LATAM' })).json.items;
  assert.ok(latam.every(i => !i.id.startsWith('ext-') || !/Madrid|España/.test(i.location)), 'LatAm no repite las de España');
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
await step('Apify sencillo: portales con buscadores de repuesto (arranque fallido, ejecución fallida y sin ofertas), lenguaje llano y tope de gasto', async () => {
  const post = (body) => call('/api/admin/apify', { method: 'POST', body });
  const settle = () => { for (const r of state.apifyRuns) if (r.status === 'RUNNING') Object.assign(r, { status: 'SUCCEEDED', finished_at: new Date().toISOString(), harvested: 3, cost_usd: 0.07 }); };
  settle();
  // vista: portales en lenguaje llano, sin nombres técnicos obligatorios
  const view = (await call('/api/admin/apify')).json.portals;
  assert.deepEqual(view.map(p => p.id), ['indeed', 'infojobs', 'linkedin', 'multi']);
  const ind0 = view.find(p => p.id === 'indeed'); assert.equal(ind0.state, 'off'); assert.match(ind0.headline, /Sin probar/); assert.equal(ind0.daily, false); assert.equal(ind0.recipes.length, 4);
  assert.equal((await post({ action: 'search_now', portal: 'no-existe' })).status, 422);
  const adm = jar; jar = {}; await call('/api/admin/session', { method: 'POST', body: { email: 'adm@test.dev', password: 'Admin-pass-12345' } });
  assert.equal((await post({ action: 'search_now', portal: 'indeed' })).status, 403, 'solo el propietario gasta crédito'); jar = adm;
  // 1) el primer buscador no arranca → se usa el segundo, y el fallo queda anotado
  state.apifyFailActors = new Set(['boncross~indeed-jobs']);
  let calls = state.apifyCalls.length;
  let r = await post({ action: 'search_now', portal: 'indeed', test: true }); assert.equal(r.status, 202, JSON.stringify(r.json));
  assert.equal(r.json.fallback, true); assert.equal(r.json.recipe, 'Buscador de Indeed B'); assert.match(r.json.message, /Prueba lanzada en Indeed/);
  const c = state.apifyCalls.at(-1); assert.equal(c.actor, 'chuckling_hemp~indeed-jobs-scraper'); assert.equal(state.apifyCalls.length, calls + 1);
  assert.equal(c.query.maxItems, '10', 'la prueba pide solo 10 elementos'); assert.equal(c.query.maxTotalChargeUsd, '0.5', 'tope duro de gasto por prueba'); assert.equal(c.input.search_term, 'closer de ventas');
  const failedStart = state.apifyRuns.find(x => x.status === 'FAILED' && /noarranco/.test(x.run_id)); assert.ok(failedStart && failedStart.error, 'el intento fallido queda en el historial');
  assert.equal((await post({ action: 'search_now', portal: 'indeed' })).status, 409, 'ya hay una búsqueda en curso'); assert.match((await post({ action: 'search_now', portal: 'indeed' })).json.detail, /en curso/);
  // 2) esa ejecución termina FALLIDA → al recoger, se lanza sola el siguiente buscador
  state.apifyStatus = 'FAILED'; calls = state.apifyCalls.length;
  const h = await post({ action: 'harvest' }); assert.equal(h.status, 200); assert.ok(h.json.results.some(x => x.recovery?.ok === true), JSON.stringify(h.json));
  assert.equal(state.apifyCalls.length, calls + 1); assert.equal(state.apifyCalls.at(-1).actor, 'ayeeyee~indeed-job-scraper', 'saltó el que falló (B) y el que ya no arrancaba (A)');
  // 3) termina SIN ofertas → vuelve a probar con el siguiente (JobSpy, último recurso)
  state.apifyStatus = 'SUCCEEDED'; state.apifyItems = []; calls = state.apifyCalls.length;
  const h2 = await post({ action: 'harvest' }); assert.ok(h2.json.results.some(x => x.recovery?.ok === true), JSON.stringify(h2.json)); assert.equal(state.apifyCalls.at(-1).actor, 'aakash19~jobspy');
  // 4) todos fallan → mensaje llano, sin éxito falso, y la vista dice «ningún buscador funciona»
  settle(); state.apifyFailActors = new Set(['boncross~indeed-jobs', 'chuckling_hemp~indeed-jobs-scraper', 'ayeeyee~indeed-job-scraper', 'aakash19~jobspy']);
  r = await post({ action: 'search_now', portal: 'indeed' }); assert.equal(r.status, 409); assert.match(r.json.detail, /Ningún buscador/); assert.ok(r.json.attempts.length >= 3);
  assert.ok(!/HTTP|esquema|actor/i.test(r.json.attempts.map(a => a.error).join(' ')), 'errores en lenguaje llano');
  const down = (await call('/api/admin/apify')).json.portals.find(p => p.id === 'indeed'); assert.equal(down.state, 'down'); assert.match(down.headline, /ningún buscador funciona/i);
  // 5) búsqueda diaria: el interruptor activa todos los buscadores del portal; el cron hace UNA búsqueda al día aunque haya repuestos
  state.apifyFailActors = new Set(['boncross~indeed-jobs']); settle(); state.apifyRuns = state.apifyRuns.filter(x => !/noarranco/.test(x.run_id) && !['FAILED'].includes(x.status));
  for (const x of state.apifyRuns) x.started_at = new Date(Date.now() - 40 * 3600 * 1000).toISOString();
  assert.equal((await post({ action: 'portal_daily', portal: 'indeed', on: 'si' })).status, 422);
  assert.equal((await post({ action: 'portal_daily', portal: 'indeed', on: true })).status, 200); assert.ok((await call('/api/admin/apify')).json.portals.find(p => p.id === 'indeed').daily);
  state.apifyItems = [{ id: 'z1', title: 'Closer de ventas high ticket', url: 'https://es.indeed.com/viewjob?jk=z1', company: 'Acme', location: 'Madrid' }]; // la búsqueda sí devuelve ofertas
  calls = state.apifyCalls.length; const cron = () => call('/api/cron/collect', { cookies: false, headers: { authorization: 'Bearer cron-secret-0123456789' } });
  let k = await cron(); assert.equal(k.status, 200); const indeedActors = ['boncross/indeed-jobs', 'chuckling_hemp/indeed-jobs-scraper', 'ayeeyee/indeed-job-scraper'];
  assert.deepEqual(k.json.apify.started.filter(x => indeedActors.includes(x.actor)).map(x => [x.actor, x.ok]), [['chuckling_hemp/indeed-jobs-scraper', true]], JSON.stringify(k.json.apify)); // A cae → B; solo UNA búsqueda de Indeed
  const afterFirst = state.apifyCalls.length;
  k = await cron(); assert.equal(state.apifyCalls.length, afterFirst, 'una búsqueda diaria por portal: la segunda pasada no lanza nada');
  state.apifyFailActors = new Set(); state.apifyItems = [];
});
await step('privacidad: página pública con borrador visible, sin inventar datos del responsable', async () => {
  const res = await fetch(BASE + '/privacidad'); assert.equal(res.status, 200);
  const html = await res.text();
  for (const t of ['Borrador pendiente de revisión legal', 'No enviamos tu perfil, tu CV ni tus datos de contacto a modelos de inteligencia artificial', 'No subimos ni guardamos tu vídeo', 'No guardamos el texto de tus conversaciones', 'Groq', 'Práctica por voz (cuando se active)', 'v3-borrador', '[pendiente de completar]']) assert.ok(html.includes(t), t);
  assert.ok(!html.includes('No enviamos tus datos personales a modelos de inteligencia artificial'), 'ya no afirma algo falso: el texto de la sala sí va al proveedor de IA');
  assert.ok(!/undefined|null/.test(html.replace(/<script[\s\S]*?<\/script>/g, '')), 'sin valores vacíos visibles');
  assert.equal(res.headers.get('x-frame-options'), 'DENY');
});
await step('términos y condiciones: página pública, borrador visible y sin promesas de resultados', async () => {
  const res = await fetch(BASE + '/terminos'); assert.equal(res.status, 200);
  const html = await res.text();
  for (const t of ['Borrador pendiente de revisión legal', 'No garantizamos resultados', 'no es una certificación oficial ni un título', 'Eres tú quien revisa, completa y envía', 'v1-borrador', '[pendiente de completar]', 'Pendiente de revisión legal']) assert.ok(html.includes(t), t);
  assert.ok(!/2\.000|2000 ?€|en 90 días/.test(html), 'no promete ingresos ni plazos');
  assert.ok(!/undefined|null/.test(html.replace(/<script[\s\S]*?<\/script>/g, '')), 'sin valores vacíos visibles');
  assert.equal(res.headers.get('x-frame-options'), 'DENY');
  assert.ok((await (await fetch(BASE + '/privacidad')).text()).includes('href="/terminos"'), 'la privacidad enlaza los términos');
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
  // La cualificación automática del cron aprueba borradores antes de este paso: se marcan como
  // comprobados hace un momento para que la cola de vigencia (20 más antiguas) llegue a estas tres.
  for (const o of state.external.values()) if (o.editorial_status === 'approved' && !o.verified_at) o.verified_at = new Date().toISOString();
  const live = mk('live', 'http://127.0.0.1:8792/page/ok'), dead = mk('dead', 'http://127.0.0.1:8792/page/gone');
  const fresh = mk('fresh', 'http://127.0.0.1:8792/page/gone'); fresh.verified_at = new Date().toISOString(); // comprobada hace poco: no se toca
  const r = await call('/api/cron/collect', { cookies: false, headers: { authorization: 'Bearer cron-secret-0123456789' } });
  assert.equal(r.status, 200); assert.ok(r.json.vigencia.checked >= 2);
  assert.equal(live.editorial_status, 'approved'); assert.equal(dead.editorial_status, 'withdrawn'); assert.equal(dead.reviewed_by, 'auto-vigencia'); assert.equal(fresh.editorial_status, 'approved');
});
await step('motor caído: la alumna sigue viendo las externas aprobadas y la vista lo declara', async () => {
  const id = crypto.randomUUID();
  state.external.set('e2e|down', { id, source: 'indeed', external_id: 'down', title: 'Closer de ventas', company: 'Acme', location: 'Madrid, España', description: 'Buscamos closer para cerrar ventas consultivas con leads cualificados.', url: 'https://es.indeed.com/down', editorial_status: 'approved', role: 'closer', spain: true, score: 80, raw: {}, posted_at: null, first_seen_at: new Date().toISOString(), last_seen_at: new Date().toISOString(), expires_at: new Date(Date.now() + 5 * 864e5).toISOString(), also_seen: [] });
  const search = (body = {}) => call('/api/backend/opportunities/search', { method: 'POST', cookies: false, body: { role: 'closer', market: 'ES', days: 10, include_bilingual: false, starred_only: false, include_extra_roles: true, ...body } });
  state.engineDown = true;
  const down = await search();
  assert.equal(down.status, 200, 'un motor caído no convierte la vista en un error');
  assert.equal(down.json.degraded, 'motor');
  assert.ok(down.json.items.length > 0, 'se sirven las externas');
  assert.ok(down.json.items.every(i => String(i.id).startsWith('ext-')), 'solo externas: el motor no aporta nada');
  assert.equal(down.json.total, down.json.items.length);
  state.engineDown = false;
  const back = await search();
  assert.equal(back.status, 200);
  assert.equal(back.json.degraded, undefined, 'con el motor arriba no se declara degradado');
  assert.ok(back.json.items.some(i => !String(i.id).startsWith('ext-')), 'vuelven las del motor');
  state.external.delete('e2e|down');
});
await step('seguridad: cabeceras en todas las respuestas', async () => {
  const res = await fetch(BASE + '/admin');
  assert.equal(res.headers.get('x-frame-options'), 'DENY'); assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('referrer-policy'), 'strict-origin-when-cross-origin'); assert.match(res.headers.get('permissions-policy'), /camera=\(\)/);
  assert.equal(res.headers.get('x-powered-by'), null);
});
await step('cualificación automática: aprueba lo claro por reglas, deja lo dudoso y declara su tope', async () => {
  const today = new Date().toISOString();
  const mk = (id, extra) => state.external.set(`au|${id}`, {
    id: crypto.randomUUID(), source: 'au', external_id: id, title: 'Closer de ventas', company: 'Acme',
    location: 'Madrid, España', url: `https://www.infojobs.net/oferta/${id}`, salary: '30.000 €/año',
    description: 'Buscamos closer para cerrar ventas del programa en el equipo comercial de la empresa.',
    posted_at: today, expires_at: new Date(Date.now() + 5 * 864e5).toISOString(), first_seen_at: today, last_seen_at: today,
    editorial_status: 'draft', role: 'closer', spain: true, score: 80, market: 'ES', market_basis: 'ubicacion_espana', currency: 'EUR', raw: {}, also_seen: [], ...extra,
  });
  // El cron de pasos anteriores ya gastó el tope del día: se simula el día siguiente.
  const yesterday = new Date(Date.now() - 864e5).toISOString();
  for (const o of state.external.values()) if (o.reviewed_by === 'auto-reglas') o.reviewed_at = yesterday;
  mk('ok1', {}); mk('ok2', {}); mk('dudoso', { role: null });
  const before = await call('/api/admin/external?status=draft&page_size=100');
  assert.ok(before.json.total > 0, `el panel ve ${before.json.total} borradores y el mock ${[...state.external.values()].filter(o => o.editorial_status === 'draft').length}`);
  const r = await call('/api/admin/external', { method: 'POST', body: { action: 'auto_review' } });
  assert.equal(r.status, 200);
  assert.ok(r.json.approved >= 2, `aprobadas ${r.json.approved} de ${r.json.checked} · usadas ${r.json.used_before} · auto-reglas en mock: ${[...state.external.values()].filter(o => o.reviewed_by === 'auto-reglas').length}`);
  assert.equal(r.json.cap, 100);
  assert.equal(state.external.get('au|ok1').editorial_status, 'approved');
  assert.equal(state.external.get('au|ok1').reviewed_by, 'auto-reglas');
  assert.equal(state.external.get('au|ok1').auto_review.why, 'cumple_reglas');
  assert.equal(state.external.get('au|dudoso').editorial_status, 'draft', 'lo dudoso no se aprueba solo');
  const listed = await call('/api/admin/external?status=draft');
  assert.equal(listed.status, 200); assert.equal(typeof listed.json.auto.cap, 'number');
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
