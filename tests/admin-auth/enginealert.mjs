// Aviso del motor: el panel lo dice en CUALQUIER pestaña y el correo sale solo si hay clave de Resend.
// Lo que se fija aquí: (1) una pausa por cuota se declara con su causa y no como caída; (2) un mismo estado
// NO se avisa dos veces y el inicio del estado no se reinicia en cada comprobación; (3) un estado peor sí
// avisa y la recuperación se anuncia; (4) sin clave no se envía y se dice por qué; (5) sin historial (migración
// sin aplicar) NO se envía nada en vez de repetir el aviso, y el estado real se sigue declarando; (6) solo se
// avisa al PROPIETARIO; (7) el cron hace la misma comprobación sin abrir el panel.
// Uso: lo lanza run.sh con la app ya arrancada contra el simulador (127.0.0.1:8791 auth, 8792 motor).
import assert from 'node:assert/strict';
import { startMocks } from './mock-services.mjs';

const BASE = process.env.BASE ?? 'http://127.0.0.1:3199';
const AUTH_PORT = Number(process.env.MOCK_AUTH_PORT ?? 8791);
const ENGINE_PORT = Number(process.env.MOCK_ENGINE_PORT ?? 8792);
const { state, close } = startMocks({ authPort: AUTH_PORT, enginePort: ENGINE_PORT });
// El módulo del aviso se prueba también directamente (reglas puras y casos que la ruta del panel no puede
// montar sin romper la sesión): se le dan las mismas direcciones simuladas que usa la app.
process.env.SUPABASE_URL = `http://127.0.0.1:${AUTH_PORT}`;
process.env.SUPABASE_PUBLISHABLE_KEY = 'anon-key';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';
process.env.CAREER_ENGINE_URL = `http://127.0.0.1:${ENGINE_PORT}`;
process.env.RESEND_API_BASE = `http://127.0.0.1:${AUTH_PORT}`;
const alert = await import('../../apps/web/lib/engineAlert.ts');

let jar = {};
const cookieHeader = () => Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
async function call(path, { method = 'GET', body, cookies = true, headers = {} } = {}) {
  const res = await fetch(BASE + path, { method, redirect: 'manual', headers: { 'content-type': 'application/json', ...(cookies && cookieHeader() ? { cookie: cookieHeader() } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  for (const raw of res.headers.getSetCookie()) { const [pair, ...attrs] = raw.split('; '); const [k, v] = pair.split('='); if (attrs.includes('Max-Age=0') || v === '') delete jar[k]; else jar[k] = v; }
  return { status: res.status, json: await res.json().catch(() => null), type: res.headers.get('content-type') ?? '' };
}
const alerts = init => call('/api/admin/alerts', init);
const cron = () => call('/api/cron/collect', { cookies: false, headers: { authorization: 'Bearer cron-secret-0123456789' } });
const results = [];
const step = async (name, fn) => { try { await fn(); results.push(['PASS', name]); } catch (e) { results.push(['FAIL', name, e.message]); } };

await step('la ruta del aviso exige sesión y no acepta órdenes de otro origen', async () => {
  assert.equal((await alerts({ cookies: false })).status, 401, 'sin sesión no se lee el estado del motor');
  assert.equal((await alerts({ cookies: false, method: 'POST' })).status, 401);
  assert.equal((await alerts({ method: 'POST', headers: { origin: 'https://evil.example' } })).status, 403, 'un origen ajeno no puede disparar comprobaciones');
});

await step('con la sesión del propietario, la pausa por cuota se declara con su causa y sin aviso enviado todavía', async () => {
  const login = await call('/api/admin/session', { method: 'POST', body: { email: 'owner@test.dev', password: 'Correcta-12345' } });
  assert.equal(login.status, 200, 'la sesión del panel tiene que abrirse para poder probarlo');
  state.enginePaused = 'allowance';
  const r = await alerts();
  assert.equal(r.status, 200);
  assert.equal(r.json.engine.status, 'allowance');
  assert.equal(r.json.engine.http_status, 429);
  assert.match(r.json.engine.detail, /pausa por cuota de hosting/);
  assert.equal(r.json.engine.since, null, 'sin comprobaciones registradas no hay fecha que inventar');
  assert.equal(r.json.log.available, true);
  assert.equal(r.json.notify.key_saved, false);
  assert.match(r.json.notify.blocked, /Resend/);
  assert.equal(r.json.notify.last, null);
  assert.ok(!JSON.stringify(r.json).includes('engine-token'), 'el token del motor no viaja al navegador');
});

await step('«Comprobar ahora» registra la comprobación y NO envía correo sin clave (y dice por qué)', async () => {
  const r = await alerts({ method: 'POST' });
  assert.equal(r.status, 200);
  assert.equal(r.json.recorded, true);
  assert.equal(r.json.decision.kind, 'outage');
  assert.equal(r.json.email.sent, false);
  assert.equal(r.json.email.attempted, false);
  assert.match(r.json.email.detail, /Sin clave de Resend/);
  assert.match(r.json.notify_blocked, /Sin clave de Resend/);
  assert.equal(state.emails.length, 0, 'sin clave no sale ningún correo');
  assert.equal(state.engineAlerts.length, 1);
  assert.equal(state.engineAlerts[0].status, 'allowance');
  assert.equal(state.engineAlerts[0].checked_by, 'owner@test.dev');
  assert.equal(state.engineAlerts[0].since, state.engineAlerts[0].checked_at);
  assert.equal(state.engineAlerts[0].notified_at, null, 'un aviso que no salió no se cuenta como enviado');
});

await step('con clave de Resend, el aviso sale UNA vez al propietario y queda anotado', async () => {
  assert.equal((await call('/api/admin/connections', { method: 'PUT', body: { provider: 'resend', secret: 're_prueba_clave_1234' } })).status, 200);
  state.admins.push({ email: 'ops@test.dev', role: 'admin', invited_by: 'owner@test.dev', created_at: new Date().toISOString() });
  const r = await alerts({ method: 'POST' });
  assert.equal(r.json.email.sent, true);
  assert.equal(state.emails.length, 1);
  assert.deepEqual(state.emails[0].to, ['owner@test.dev'], 'solo el propietario: ni administradores ni alumnas');
  assert.match(state.emails[0].subject, /pausa por cuota/);
  assert.match(state.emails[0].text, /No se pierde ninguna oferta/); 
  assert.match(state.emails[0].text, /\/admin/, 'el correo dice dónde mirarlo sin abrir la pestaña Fuentes');
  assert.equal(state.engineAlerts[0].notified_kind, 'outage');
  assert.ok(state.engineAlerts[0].notified_at, 'el envío se anota en la misma fila');
  assert.equal(r.json.notify.last.kind, 'outage');
  assert.equal(r.json.notify.key_saved, true);
  assert.equal(r.json.notify.blocked, null);
});

await step('el mismo estado no se avisa dos veces y el inicio del estado no se corre', async () => {
  const since = state.engineAlerts[0].since;
  const r = await alerts({ method: 'POST' });
  assert.equal(state.emails.length, 1, 'sin correo nuevo');
  assert.equal(r.json.decision.kind, null);
  assert.match(r.json.decision.why, /ya enviado/);
  assert.equal(r.json.engine.since, since, 'el inicio del estado se mantiene, no se reinicia con cada comprobación');
  assert.match((await alerts()).json.notify.last.detail, /Aviso enviado a owner@test.dev/);
  for (let i = 0; i < 7; i++) { const again = await alerts({ method: 'POST' }); assert.equal(state.emails.length, 1, `comprobación ${i + 3} del mismo estado: ` + again.json.decision.why); }
});

await step('la recuperación se anuncia una sola vez', async () => {
  state.enginePaused = null;
  const r = await alerts({ method: 'POST' });
  assert.equal(r.json.engine.status, 'ok');
  assert.equal(r.json.decision.kind, 'recovery');
  assert.equal(state.emails.length, 2);
  assert.match(state.emails[1].subject, /vuelve a responder/);
  const again = await alerts({ method: 'POST' });
  assert.equal(state.emails.length, 2, 'con el motor bien no se envía nada');
  assert.equal(again.json.decision.kind, null);
});

await step('un estado peor sí avisa (pausa → no responde), con su causa', async () => {
  state.enginePaused = 'allowance';
  assert.equal((await alerts({ method: 'POST' })).json.decision.kind, 'outage');
  assert.equal(state.emails.length, 3);
  state.enginePaused = 'error';
  const r = await alerts({ method: 'POST' });
  assert.equal(r.json.engine.status, 'down');
  assert.equal(r.json.engine.http_status, 500);
  assert.equal(r.json.decision.kind, 'outage');
  assert.match(r.json.decision.why, /empeorado/);
  assert.equal(state.emails.length, 4);
  assert.match(state.emails[3].subject, /no responde/);
  state.enginePaused = null;
  assert.equal((await alerts({ method: 'POST' })).json.decision.kind, 'recovery');
  assert.equal(state.emails.length, 5);
});

await step('el cron diario hace la misma comprobación y avisa sin abrir el panel', async () => {
  state.enginePaused = 'allowance';
  const before = state.engineAlerts.length;
  const r = await cron();
  assert.equal(r.status, 200);
  assert.equal(r.json.engineAlert.engine.status, 'allowance', 'la pasada de la mañana ya informa del estado del motor');
  assert.equal(r.json.engineAlert.recorded, true);
  assert.ok(state.engineAlerts.length > before, 'y lo registra');
  assert.equal(r.json.engineAlert.decision.kind, 'outage');
  assert.equal(state.emails.length, 6);
  assert.equal(state.engineAlerts[0].checked_by, 'cron');
  const again = await cron();
  assert.equal(state.emails.length, 6, 'la segunda pasada del día no repite el aviso');
  assert.equal(again.json.engineAlert.decision.kind, null);
  state.enginePaused = null;
});

await step('sin historial (migración sin aplicar) se declara y NO se envía: se repetiría en cada comprobación', async () => {
  state.alertsTableMissing = true;
  state.enginePaused = 'allowance';
  const r = await alerts({ method: 'POST' });
  assert.equal(r.status, 200, 'el panel sigue informando del estado real aunque no haya historial');
  assert.equal(r.json.engine.status, 'allowance');
  assert.equal(r.json.log.available, false);
  assert.match(r.json.log.problem, /20261029_engine_alerts/);
  assert.equal(r.json.recorded, false);
  assert.match(r.json.notify_blocked, /No se envía el aviso por correo/);
  assert.equal(state.emails.length, 6, 'sin registro no se envía nada');
  const g = await alerts();
  assert.equal(g.json.engine.status, 'allowance', 'la lectura también declara el estado con el historial ilegible');
  assert.equal(g.json.log.available, false);
  state.alertsTableMissing = false; state.enginePaused = null;
});

await step('reglas puras: cada transición se decide igual en cualquier llamada', async () => {
  const row = (status, over = {}) => ({ id: 'r', status, http_status: null, detail: 'd', since: '2026-10-27T06:00:00.000Z', checked_at: '2026-10-27T06:00:00.000Z', checked_by: 'cron', notified_at: null, notified_kind: null, notified_detail: null, ...over });
  const probe = status => ({ configured: true, status, http_status: null, detail: 'd', catalog_active: null, raw_items: null, ms: 0, checked_at: '2026-10-27T07:00:00.000Z' });
  const d = (rows, status) => alert.decideNotification(rows, probe(status)).kind;
  assert.equal(d([], 'ok'), null);
  assert.equal(d([], 'down'), 'outage', 'sin nada registrado, un motor caído se avisa');
  assert.equal(d([row('ok')], 'allowance'), 'outage');
  assert.equal(d([row('ok')], 'ok'), null);
  assert.equal(d([row('down')], 'ok'), 'recovery');
  assert.equal(d([row('allowance', { notified_kind: 'outage' })], 'allowance'), null, 'mismo estado ya avisado');
  assert.equal(d([row('allowance')], 'allowance'), 'outage', 'si el aviso anterior no salió, se reintenta');
  assert.equal(d([row('allowance', { notified_kind: 'outage' })], 'down'), 'outage', 'empeorar avisa aunque ya se avisara');
  assert.equal(alert.decideNotification([], { ...probe('down'), configured: false }).kind, null, 'sin motor configurado no hay nada que vigilar');
  const mail = alert.alertEmail(probe('allowance'), 'outage', '2026-10-27T06:00:00.000Z', 'https://app.test.dev');
  assert.match(mail.subject, /pausa/);
  assert.match(mail.text, /No se pierde ninguna oferta/);
  assert.match(mail.text, /Detectado: 2026-10-27 06:00 UTC/, 'el correo dice desde cuándo');
  assert.ok(!/re_prueba|service-key|engine-token/.test(mail.subject + mail.text), 'el correo no lleva claves');
  assert.match(alert.alertEmail(probe('down'), 'outage', '2026-10-27T06:00:00.000Z', 'https://app.test.dev').subject, /no responde/);
  assert.match(alert.alertEmail(probe('ok'), 'recovery', '2026-10-27T06:00:00.000Z', 'https://app.test.dev').subject, /vuelve a responder/);
});

await step('sin propietario en la lista no se inventa un destinatario', async () => {
  const keep = state.admins;
  state.admins = keep.filter(a => a.role !== 'owner');
  state.enginePaused = null;
  await alert.checkEngine({ by: 'prueba' }); // el motor vuelve: la pausa siguiente es un episodio nuevo
  state.enginePaused = 'allowance';
  const report = await alert.checkEngine({ by: 'prueba' });
  assert.equal(report.email.attempted, false);
  assert.deepEqual(report.email.to, []);
  assert.match(report.email.detail, /No hay propietario/);
  assert.equal(state.emails.length, 6, 'sin destinatario no se llama a Resend');
  state.admins = keep; state.enginePaused = null;
});

close();
for (const [status, name, msg] of results) console.log(`${status}  ${name}${msg ? '\n      ' + msg : ''}`);
const failed = results.filter(r => r[0] === 'FAIL').length;
console.log(`\n${results.length - failed}/${results.length} pasos OK`);
process.exit(failed ? 1 : 0);
