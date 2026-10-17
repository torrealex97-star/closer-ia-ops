// STUDENT_LOGIN_REQUIRED=true: `/` y la búsqueda hospedada exigen sesión de alumna. Arranca su propia app (puerto 3198) y sus mocks.
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { startMocks } from './mock-services.mjs';

const PORT = 3198, BASE = `http://127.0.0.1:${PORT}`;
const { state, close } = startMocks({ authPort: 8793, enginePort: 8794 });
state.students = [{ id: crypto.randomUUID(), user_id: null, status: 'invited', email: 'ana@alumna.dev', created_at: new Date().toISOString() }];
state.users.set('ana@alumna.dev', { id: crypto.randomUUID(), password: 'Contraseña-alumna-1' });
const env = { ...process.env, PORT: String(PORT), SUPABASE_URL: 'http://127.0.0.1:8793', SUPABASE_PUBLISHABLE_KEY: 'anon-key', SUPABASE_SERVICE_ROLE_KEY: 'service-key', CAREER_ENGINE_URL: 'http://127.0.0.1:8794', CAREER_ADMIN_TOKEN: 'engine-token', STUDENT_AUTH_CACHE_MS: '0' };
const run = (flag) => spawn('npx', ['--no-install', 'next', 'start', 'apps/web', '--hostname', '127.0.0.1', '--port', String(PORT)], { env: { ...env, ...(flag ? { STUDENT_LOGIN_REQUIRED: flag } : {}) }, stdio: 'ignore', detached: true });
const up = async () => { for (let i = 0; i < 60; i++) { try { await fetch(BASE + '/'); return; } catch { await new Promise(r => setTimeout(r, 500)); } } throw new Error('la app no arrancó'); };
const search = (cookie) => fetch(BASE + '/api/backend/opportunities/search', { method: 'POST', headers: { 'content-type': 'application/json', origin: BASE, host: `127.0.0.1:${PORT}`, ...(cookie ? { cookie } : {}) }, body: JSON.stringify({ market: 'any', days: 10 }) });

const results = []; let child;
const step = async (name, fn) => { try { await fn(); results.push(['PASS', name]); } catch (e) { results.push(['FAIL', name, e.message]); } };
const stop = async () => { try { process.kill(-child.pid); } catch {} await new Promise(r => setTimeout(r, 800)); };

try {
  child = run('true'); await up();
  await step('flag activo: `/` sin sesión redirige a /alumna', async () => {
    const r = await fetch(BASE + '/', { redirect: 'manual' });
    assert.ok([307, 308].includes(r.status), `status ${r.status}`); assert.match(r.headers.get('location') ?? '', /\/alumna$/);
  });
  await step('flag activo: la búsqueda sin sesión responde 401 y con cookie falsa también', async () => {
    assert.equal((await search()).status, 401); assert.equal((await search('wdc_student_at=falsa')).status, 401);
  });
  await step('flag activo: con sesión de alumna `/` y la búsqueda funcionan', async () => {
    const login = await fetch(BASE + '/api/student/session', { method: 'POST', headers: { 'content-type': 'application/json', origin: BASE }, body: JSON.stringify({ email: 'ana@alumna.dev', password: 'Contraseña-alumna-1' }) });
    assert.equal(login.status, 200);
    const cookie = login.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
    assert.equal((await fetch(BASE + '/', { redirect: 'manual', headers: { cookie } })).status, 200);
    assert.notEqual((await search(cookie)).status, 401);
  });
  await step('flag activo: sesión caducada (solo refresh) se renueva y los tokens nuevos llegan al navegador', async () => {
    const login = await fetch(BASE + '/api/student/session', { method: 'POST', headers: { 'content-type': 'application/json', origin: BASE }, body: JSON.stringify({ email: 'ana@alumna.dev', password: 'Contraseña-alumna-1' }) });
    const refresh = login.headers.getSetCookie().map(c => c.split(';')[0]).find(c => c.startsWith('wdc_student_rt='));
    const r = await search(refresh); assert.notEqual(r.status, 401);
    assert.ok(r.headers.getSetCookie().some(c => c.startsWith('wdc_student_at=') && /HttpOnly/.test(c)), 'el proxy debe reenviar la cookie renovada');
  });
  await stop();
  child = run(''); await up();
  await step('flag apagado (por defecto): `/` y la búsqueda siguen abiertas', async () => {
    assert.equal((await fetch(BASE + '/', { redirect: 'manual' })).status, 200);
    assert.notEqual((await search()).status, 401);
  });
} finally { await stop(); close(); }
for (const [s, n, m] of results) console.log(`${s}  ${n}${m ? '\n      ' + m : ''}`);
const failed = results.filter(r => r[0] === 'FAIL').length;
console.log(`\n${results.length - failed}/${results.length} pasos OK`);
process.exit(failed || !results.length ? 1 : 0);
