// Pruebas de interfaz del panel en navegador real contra la app en BASE con Supabase y motor simulados.
// Uso: PLAYWRIGHT_EXECUTABLE=<chrome> node tests/admin-auth/ui.mjs (lo lanza run.sh).
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { startMocks } from './mock-services.mjs';

const BASE = process.env.BASE ?? 'http://127.0.0.1:3100';
const catalog = JSON.parse(readFileSync(new URL('../../apps/web/lib/sourceCatalog.json', import.meta.url), 'utf8'));
const { state, close } = startMocks({ authPort: Number(process.env.MOCK_AUTH_PORT ?? 8791), enginePort: Number(process.env.MOCK_ENGINE_PORT ?? 8792) });
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_EXECUTABLE || undefined });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.on('dialog', d => d.accept());
const results = [];
const step = async (name, fn) => { try { await fn(); results.push(['PASS', name]); } catch (e) { results.push(['FAIL', name, String(e.message).split('\n').slice(0, 4).join(' | ')]); } };

await step('login y Resumen: contador del objetivo, pendientes y siguiente paso', async () => {
  await page.goto(BASE + '/admin'); await page.getByLabel('Email').fill('owner@test.dev'); await page.getByLabel('Contraseña').fill('Correcta-12345');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.getByRole('heading', { name: 'Cómo vamos.' }).waitFor();
  await page.getByText('Faltan 13').waitFor();
  assert.equal(await page.getByRole('progressbar').getAttribute('aria-valuenow'), '7');
  await page.getByText('3', { exact: true }).first().waitFor();
  await page.getByText(/Hay 3 oferta\(s\) sin revisar/).waitFor();
  assert.ok(await page.getByText(/1 fuente\(s\) fallan/).isVisible());
});
await step('Fuentes: catálogo completo (todas las del backend + las del motor) con filtros', async () => {
  await page.getByRole('button', { name: 'Fuentes', exact: true }).click(); await page.getByRole('heading', { name: 'Fuentes de datos.' }).waitFor();
  const expected = catalog.length + 1; // + jobtoday-closers, que solo existe en el motor cloud
  await page.getByText(String(expected), { exact: true }).first().waitFor();
  assert.ok(expected >= 60);
  await page.getByLabel('Mostrar').selectOption('failed');
  await page.getByText('Pennylane').first().waitFor();
  assert.equal(await page.locator('table').first().locator('tbody tr').count(), 1);
  await page.getByLabel('Mostrar').selectOption('local');
  assert.ok(await page.locator('table').first().locator('tbody tr').count() >= 50);
  await page.getByLabel('Buscar').fill('infojobs'); assert.equal(await page.locator('table').first().locator('tbody tr').count(), 1);
});
await step('Revisión rápida: filtra closers, carga ubicación, oculta no-España, verifica y aprueba en bloque', async () => {
  await page.getByRole('button', { name: 'Revisión rápida' }).click(); await page.getByRole('heading', { name: 'Revisa en bloque.' }).waitFor();
  await page.getByText('Closer de ventas B2B (remoto)').waitFor();
  assert.equal(await page.locator('tbody tr').count(), 2); // Backend Developer queda fuera por perfil
  await page.getByRole('button', { name: 'Cargar ubicación' }).click(); await page.getByText('Austin, Texas').waitFor();
  await page.getByLabel('Ocultar las que claramente no son de España').check();
  assert.equal(await page.locator('tbody tr').count(), 1);
  await page.getByLabel('Seleccionar todas las visibles').check();
  await page.getByRole('button', { name: 'Verificar vigencia' }).click(); await page.getByText(/Activa en el origen/).waitFor();
  assert.deepEqual(state.verifies, ['opp-1']);
  await page.getByRole('button', { name: /^Aprobar/ }).click(); await page.getByText('Aprobada · v2').waitFor();
  assert.equal(state.patches.length, 1);
  const sent = state.patches[0];
  assert.equal(sent.id, 'opp-1'); assert.equal(sent.status, 'approved');
  // El motor rechaza campos del payload raw (title, company, url…): solo deben viajar los permitidos.
  for (const k of ['title', 'company', 'url', 'location', 'salary', 'posted_at']) assert.ok(!(k in sent.payload), `campo no permitido enviado: ${k}`);
  assert.equal(sent.payload.role, 'closer'); assert.equal(sent.payload.application_url, 'https://example.com/a'); assert.equal(sent.payload.headline, 'Closer de ventas B2B (remoto)');
});
await step('Revisión una a una: guardar una oferta con payload raw ya no da 422', async () => {
  state.opps[2].editorial_status = 'draft';
  await page.getByRole('button', { name: 'Revisión una a una' }).click(); await page.getByRole('heading', { name: 'Revisar antes de ofrecer.' }).waitFor();
  await page.getByRole('button', { name: /Desarrollador Backend/ }).click(); await page.getByLabel('Título (headline)').waitFor();
  await page.getByRole('button', { name: 'Guardar borrador' }).click(); await page.getByText(/Guardado: Borrador/).waitFor();
});
await step('móvil: Resumen sin scroll horizontal', async () => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Resumen' }).click(); await page.getByRole('heading', { name: 'Cómo vamos.' }).waitFor();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
});

await browser.close(); close();
for (const [status, name, msg] of results) console.log(`${status}  ${name}${msg ? '\n      ' + msg : ''}`);
const failed = results.filter(r => r[0] === 'FAIL').length;
console.log(`\n${results.length - failed}/${results.length} pasos de interfaz OK`);
process.exit(failed ? 1 : 0);
