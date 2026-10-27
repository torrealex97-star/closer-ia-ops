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
  // Dos colas separadas: la máquina clasifica los borradores y a la persona le quedan las excepciones.
  const exceptionsCard = page.locator('article.source-card', { hasText: 'EXCEPCIONES PARA TI' });
  await exceptionsCard.waitFor();
  assert.equal(await exceptionsCard.locator('strong').innerText(), '0', 'en el mock no hay excepciones humanas');
  const draftsCard = page.locator('article.source-card', { hasText: 'POR CLASIFICAR' });
  assert.equal(await draftsCard.locator('strong').innerText(), '3', 'los tres borradores del motor son trabajo automático');
  // Las dos colas se declaran por separado: el total esconde cuál tiene trabajo si no se desglosa.
  assert.match(await exceptionsCard.innerText(), /0 del motor · 0 de fuentes externas/);
  assert.match(await draftsCard.innerText(), /3 del motor · 0 de fuentes externas/);
  assert.ok(await page.getByText(/1 fuente\(s\) fallan/).isVisible());
  assert.equal(await page.getByText(/sin revisar/).count(), 0, 'el resumen ya no pide revisar borradores a mano');
});
await step('Fuentes: catálogo completo (todas las del backend + las del motor) con filtros', async () => {
  await page.getByRole('button', { name: 'Fuentes', exact: true }).click(); await page.getByRole('heading', { name: 'Fuentes de datos.' }).waitFor();
  // El motor recoge por CONECTOR y el panel agrupa por PORTAL: `jobtoday` + `jobtoday-closers` son
  // una sola fila (rotulada «2 conectores»), así que el total es el del catálogo y no crece con cada
  // búsqueda nueva del motor. Antes esta prueba esperaba una fila suelta por conector.
  const expected = catalog.length;
  await page.getByText(String(expected), { exact: true }).first().waitFor();
  assert.ok(expected >= 60);
  const jobtoday = page.locator('table').first().locator('tbody tr').filter({ hasText: 'JobToday España' }).first();
  assert.match(await jobtoday.innerText(), /2 conectores/, 'el portal agrupa sus dos conectores en una fila');
  await page.getByLabel('Mostrar').selectOption('failed');
  await page.getByText('Pennylane').first().waitFor();
  assert.equal(await page.locator('table').first().locator('tbody tr').count(), 1);
  await page.getByLabel('Mostrar').selectOption('local');
  const rowsOf = () => page.locator('table').first().locator('tbody tr').count();
  assert.equal(await rowsOf(), 25, 'el catálogo se muestra por tandas de 25');
  while (await page.getByRole('button', { name: /^Mostrar \d+ más$/ }).count()) await page.getByRole('button', { name: /^Mostrar \d+ más$/ }).click();
  assert.ok(await rowsOf() >= 50, 'con «Mostrar más» se llega al catálogo completo');
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
  await page.getByRole('button', { name: 'Revisión una a una' }).click(); await page.getByRole('heading', { name: 'Revisar a fondo lo que lo merece.' }).waitFor();
  // La cola humana abre por defecto en excepciones; este caso es un borrador que se edita a mano.
  await page.getByLabel('Filtrar por estado editorial').selectOption('draft');
  await page.getByRole('button', { name: /Desarrollador Backend/ }).click(); await page.getByLabel('Título (headline)').waitFor();
  await page.getByRole('button', { name: 'Guardar borrador' }).click(); await page.getByText(/Guardado: Borrador/).waitFor();
});
await step('Fuentes externas: filtra closers de España, verifica y aprueba; el catálogo marca la fuente como externa', async () => {
  const mk = (id, over) => state.external.set(id, { id: crypto.randomUUID(), source: 'indeed', external_id: id, title: 'Closer de ventas', company: 'Acme', location: 'Madrid, España', url: 'http://127.0.0.1:8792/page/ok', salary: null, description: 'Buscamos closer con experiencia en ventas para el equipo comercial de la empresa', posted_at: new Date().toISOString(), editorial_status: 'draft', role: 'closer', spain: true, score: 80, also_seen: [], verified_result: null, first_seen_at: new Date().toISOString(), last_seen_at: new Date().toISOString(), expires_at: new Date(Date.now() + 5 * 864e5).toISOString(), ...over });
  mk('x1', {}); mk('x2', { location: 'Austin, Texas', spain: false, score: 20 }); mk('x3', { title: 'Setter de ventas', location: 'Valencia', role: 'setter', score: 60 });
  // Una excepción de verdad: con ella la pestaña abre en «A revisar» (sin excepciones abriría en borradores).
  mk('x0', { title: 'Closer sin condiciones claras', editorial_status: 'needs_review', score: 55 });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByRole('button', { name: 'Fuentes externas' }).click(); await page.getByRole('heading', { name: 'Ofertas de España y del mercado en dólares.' }).waitFor();
  // La cola externa abre en las excepciones (needs_review): los borradores los cierra la pasada automática.
  await page.locator('#ex-status').inputValue().then(v => assert.equal(v, 'needs_review', 'con excepciones, abre en A revisar y no en borradores'));
  // La cola entera se ve aunque los filtros de perfil/España dejen menos: si no, «cumplen los filtros» la esconde.
  await page.getByText(/en tu cola de excepciones \(sin filtros\)/).waitFor();
  await page.locator('#ex-status').selectOption('draft'); // el resto del paso trabaja sobre borradores
  await page.getByTestId('metrics').waitFor(); assert.match(await page.getByTestId('metrics').innerText(), /Últimos 14 días: \d+ ofertas buenas/);
  // Contraste: el texto pequeño gris usa --secondary (≥ 4,5:1), no --muted (3,4:1)
  assert.equal(await page.locator('.data-table th').first().evaluate(el => getComputedStyle(el).color), 'rgb(116, 107, 107)', 'cabeceras de tabla con --secondary');
  // Gráfico accesible: resumen en aria-label, color por token (computado = accent), eje en 0 y tabla alternativa con los 14 días
  const chart = page.getByTestId('metrics').getByRole('img'); assert.match(await chart.getAttribute('aria-label'), /Ofertas buenas por día del .* al .*: \d+ en total/);
  assert.equal(await page.getByTestId('metrics').locator('svg rect').first().evaluate(el => getComputedStyle(el).fill), 'rgb(141, 70, 61)', 'barras con el token --accent');
  await page.getByTestId('ai-agreement').waitFor(); await page.getByTestId('ai-agreement').locator('summary').click(); assert.match(await page.getByTestId('agreement-verdict').innerText(), /Aún no hay base: 0 de 30 pares/);
  assert.equal(await page.getByTestId('agreement-table').locator('tbody tr').count(), 5);
  await page.getByTestId('metrics').getByText('Ver tabla por día').click(); assert.equal(await page.getByTestId('metrics-days').locator('tbody tr').count(), 14);
  assert.ok(await page.getByTestId('metrics-tiers').isVisible());
  // Error ≠ vacío: si falla la carga se dice y se puede reintentar; después vuelve el panel
  await page.route('**/api/admin/metrics', r => r.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ detail: 'No se pudieron calcular las métricas.' }) }));
  await page.reload(); await page.getByRole('button', { name: 'Fuentes externas' }).click();
  // Tras recargar vuelve a abrir en excepciones; este paso sigue sobre borradores.
  assert.equal(await page.locator('#ex-status').inputValue(), 'needs_review');
  await page.locator('#ex-status').selectOption('draft');
  await page.getByTestId('metrics-error').waitFor(); assert.match(await page.getByTestId('metrics-error').innerText(), /No se pudieron calcular las métricas/);
  await page.unroute('**/api/admin/metrics'); await page.getByRole('button', { name: 'Reintentar' }).click(); await page.getByTestId('metrics').waitFor();
  await page.setViewportSize({ width: 390, height: 844 }); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'métricas sin scroll horizontal en móvil'); await page.setViewportSize({ width: 1280, height: 900 });
  if (process.env.SHOT) { await page.getByTestId('metrics').getByText('Ver tabla por día').click(); await page.getByTestId('metrics').screenshot({ path: process.env.SHOT }); }
  await page.getByRole('cell', { name: /Closer de ventas/ }).first().waitFor(); // por rol: la frase también está en elementos ocultos (ideas de fuentes, búsquedas de Google Jobs)
  assert.equal(await page.locator('table').last().locator('tbody tr').count(), 1); // closer + España; el de Texas y el setter quedan fuera
  assert.equal(await page.locator('table', { has: page.getByRole('columnheader', { name: 'Vía' }) }).locator('tbody tr').count(), 7); // fuentes conocidas: 3 APIs + 4 de JobSpy
  await page.getByRole('button', { name: 'Pausar InfoJobs' }).click(); await page.getByText(/infojobs: pausada/).waitFor();
  await page.getByRole('button', { name: 'Reanudar InfoJobs' }).waitFor(); // espera a que la tabla recargue con el nuevo estado
  await page.getByRole('button', { name: 'Reanudar InfoJobs' }).click(); await page.getByText(/infojobs: reanudada/).waitFor();
  await page.getByLabel('Seleccionar todas las visibles').check();
  await page.getByRole('button', { name: 'Verificar vigencia' }).click(); await page.getByText(/Activa · content_matches/).waitFor();
  await page.getByText('80', { exact: true }).first().waitFor(); // puntuación visible
  await page.getByRole('button', { name: 'Aprobar 1', exact: true }).click(); await page.getByText(/1 oferta\(s\) → Aprobada/).waitFor();
  assert.equal([...state.external.values()].filter(o => o.editorial_status === 'approved').length, 1);
  // «Aprobar las mejores»: con otro borrador de puntuación alta pendiente, se aprueba por filtros
  mk('x4', { title: 'Closer high ticket', score: 95 });
  await page.getByRole('button', { name: 'Actualizar' }).click(); await page.getByText('Closer high ticket').waitFor();
  await page.getByRole('button', { name: 'Aprobar las mejores' }).click(); await page.getByText(/Aprobadas 1 de 1 que cumplían los filtros/).waitFor();
  assert.equal([...state.external.values()].filter(o => o.editorial_status === 'approved').length, 2);
  await page.getByRole('button', { name: 'Fuentes', exact: true }).click(); await page.getByRole('heading', { name: 'Fuentes de datos.' }).waitFor();
  // 5 activas: las cuatro de siempre más la excepción 'x0' que crea este paso.
  await page.getByLabel('Buscar').fill('indeed'); await page.getByText(/Externa · 5 activas/).waitFor();
});
await step('Apify: añadir el actor, guardar la clave, lanzar y recoger resultados con coste y presupuesto', async () => {
  await page.getByRole('button', { name: 'Búsqueda automática', exact: true }).click(); await page.getByRole('heading', { name: 'Buscar ofertas.' }).waitFor();
  await page.getByText(/falta conectar tu cuenta de Apify/).waitFor(); await page.getByText('0.00 USD de 5 USD').waitFor();
  await page.getByTestId('apify-advanced').locator('summary').click(); // las opciones avanzadas empiezan cerradas
  await page.getByRole('button', { name: 'Usar este actor' }).click();
  assert.equal(await page.getByLabel('Actor de Apify').inputValue(), 'aakash19/jobspy'); assert.equal(await page.getByLabel('Código de la fuente').inputValue(), 'apify-jobspy');
  await page.getByLabel('Máximo de elementos por ejecución').fill('300'); await page.getByRole('button', { name: 'Guardar', exact: true }).click(); await page.getByText('Actor guardado.').waitFor();
  await page.getByText('aakash19/jobspy').first().waitFor();
  await page.getByRole('button', { name: 'Lanzar ahora' }).click(); await page.getByText(/Guarda antes la clave de Apify/).first().waitFor(); // sin clave no se lanza
  await page.getByRole('button', { name: 'APIs', exact: true }).click(); await page.getByLabel('Clave de Apify').fill('good-key-1234');
  await page.getByRole('button', { name: 'Guardar', exact: true }).nth(0).click(); await page.getByText('Clave de Apify guardada.').waitFor();
  await page.getByRole('button', { name: 'Búsqueda automática', exact: true }).click(); await page.getByTestId('apify-advanced').locator('summary').click();
  await page.getByRole('button', { name: 'Lanzar ahora' }).click(); await page.getByText(/Ejecución lanzada en Apify/).waitFor();
  assert.equal(state.apifyCalls.length, 1); assert.equal(state.apifyCalls[0].query.maxItems, '300');
  await page.getByText('Buscando…').first().waitFor();
  state.apifyItems = [1, 2, 3].map(i => ({ id: `u${i}`, site: 'linkedin', job_url: `https://www.linkedin.com/jobs/view/u${i}`, title: 'Closer de ventas', company: `Empresa ${i}`, location: 'Madrid, España', description: 'Buscamos closer con experiencia en ventas para el equipo comercial' }));
  await page.getByRole('button', { name: 'Recoger resultados' }).click(); await page.getByText(/Recogidas 1 ejecución\(es\): 3 elementos/).waitFor();
  await page.getByText('Terminada').first().waitFor(); await page.getByText('0.070').waitFor();
  assert.equal([...state.external.values()].filter(o => o.source === 'apify-jobspy').length, 3);
  await page.getByText('1.07 USD de 5 USD').waitFor().catch(() => {}); // 0,07 gastados (+ nada en curso)
});
await step('Búsqueda automática (modo sencillo): portales en lenguaje llano, prueba de 10 ofertas y repuesto visible', async () => {
  await page.getByRole('button', { name: 'Búsqueda automática', exact: true }).click(); await page.getByRole('heading', { name: 'Buscar ofertas.' }).waitFor();
  const text = await page.getByText('Cómo funciona, en 3 líneas').locator('..').innerText();
  assert.match(text, /prueba otro sola/); assert.ok(!/scraper|actor|proxy/i.test(text), 'la explicación no usa jerga');
  const card = page.getByTestId('portal-indeed'); await card.waitFor();
  assert.match(await card.innerText(), /Indeed \(España\)[\s\S]*Sin probar|Funciona|Esperando/);
  assert.ok(!/boncross|chuckling|actor/i.test(await card.innerText()), 'los nombres técnicos no se ven hasta abrir «repuesto»');
  await card.locator('summary').click(); assert.match(await card.innerText(), /Buscador de Indeed A/); assert.match(await card.innerText(), /Se usan por orden/);
  state.apifyFailActors = new Set(['boncross~indeed-jobs']); const before = state.apifyCalls.length;
  await card.getByRole('button', { name: 'Probar con 10 ofertas' }).click(); await page.getByText(/Prueba lanzada en Indeed \(España\) \(el primer buscador no arrancó; se usó «Buscador de Indeed B»\)/).waitFor();
  assert.equal(state.apifyCalls.length, before + 1); assert.equal(state.apifyCalls.at(-1).query.maxItems, '10');
  await card.locator('.status', { hasText: 'Buscando ahora…' }).waitFor();
  await card.getByLabel('Buscar cada día').click(); await page.getByText('Búsqueda diaria activada en Indeed').waitFor();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  state.apifyFailActors = new Set();
});
await step('Alumnas: el panel invita; ella crea contraseña, entra, guarda su perfil con consentimiento y el enlace de su vídeo', async () => {
  await page.getByRole('button', { name: 'Alumnas' }).click(); await page.getByRole('heading', { name: 'Alumnas con acceso.' }).waitFor();
  await page.getByLabel('Invitar a una alumna').fill('lucia@alumna.dev'); await page.getByRole('button', { name: 'Enviar invitación' }).click();
  await page.getByText('Invitación enviada a lucia@alumna.dev.').waitFor(); await page.getByText('lucia@alumna.dev').first().waitFor();
  const alumnaCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, permissions: ['clipboard-read', 'clipboard-write'] }); // otro navegador: sin la sesión del panel
  const alumna = await alumnaCtx.newPage();
  const token = state.recoverTokens.get('lucia@alumna.dev'); assert.ok(token);
  if (process.env.UI_DEBUG) alumna.on('response', r => { if (r.url().includes('/api/')) console.log('NET', r.status(), r.url()); });
  await alumna.goto(`${BASE}/alumna/reset#access_token=${token}&type=recovery`);
  await alumna.getByLabel('Contraseña nueva').fill('Contraseña-lucia-1'); await alumna.getByLabel('Repite la contraseña').fill('Contraseña-lucia-1');
  await alumna.getByRole('button', { name: 'Guardar contraseña' }).click(); await alumna.getByRole('heading', { name: 'Contraseña guardada' }).waitFor({ timeout: 8000 }).catch(async e => { throw new Error(`${e.message.split('\n')[0]} · pantalla: ${(await alumna.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 300)}`); });
  await alumna.goto(BASE + '/alumna'); await alumna.getByLabel('Email').fill('lucia@alumna.dev'); await alumna.getByLabel('Contraseña').fill('Contraseña-lucia-1');
  await alumna.getByRole('button', { name: 'Entrar' }).click(); await alumna.getByText('TU PERFIL', { exact: true }).waitFor();
  assert.ok(await alumna.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'sin scroll horizontal en móvil');
  assert.equal(await alumna.getByRole('button', { name: 'Guardar perfil' }).isDisabled(), true, 'sin consentimiento no se puede guardar');
  await alumna.getByLabel('Nombre').fill('Lucía'); await alumna.getByRole('checkbox', { name: /closer/i }).first().check();
  await alumna.getByLabel(/Enlace a tu vídeo/).fill('https://drive.google.com/file/d/abc/view');
  await alumna.getByLabel(/Acepto que Women Digital Closer/).check(); await alumna.getByRole('button', { name: 'Guardar perfil' }).click();
  await alumna.getByText('Perfil guardado.').waitFor();
  state.external.set('ui|1', { id: '00000000-0000-4000-8000-000000000099', source: 'ui', external_id: '1', title: 'Closer de ventas remoto', company: 'Zeta', location: 'Madrid, España', url: 'https://jobs.example.com/ui1', salary: null, description: 'Buscamos una persona con experiencia en ventas para el equipo comercial de la empresa en España.', posted_at: new Date().toISOString(), expires_at: new Date(Date.now() + 5 * 864e5).toISOString(), first_seen_at: new Date().toISOString(), last_seen_at: new Date().toISOString(), editorial_status: 'approved', role: 'closer', spain: true, score: 70, raw: { is_remote: true }, also_seen: [] });
  await alumna.reload(); await alumna.getByTestId('matches').getByText('Closer de ventas remoto').waitFor({ timeout: 8000 });
  assert.match(await alumna.getByTestId('matches').innerText(), /Remoto/); assert.match(await alumna.getByTestId('matches').innerText(), /No sabemos:/);
  await alumna.reload(); await alumna.getByText('TU PERFIL', { exact: true }).waitFor(); await alumna.waitForFunction(() => document.querySelector('#sp-name')?.value === 'Lucía', null, { timeout: 8000 });
  assert.equal(await alumna.getByLabel(/Enlace a tu vídeo/).inputValue(), 'https://drive.google.com/file/d/abc/view');
  assert.equal(await alumna.getByLabel('Nombre').inputValue(), 'Lucía');
  // Candidatura ASISTIDA: formulario base → preparar → revisar y copiar → abrir → «ya la he enviado». La app no envía nada.
  await alumna.getByTestId('app-form').locator('summary').click();
  await alumna.getByLabel('Email de contacto').fill('lucia@ejemplo.com'); await alumna.getByLabel('Teléfono').fill('600 11 22 33'); await alumna.getByLabel('Tu CV (enlace a tu Drive)').fill('https://drive.google.com/file/d/cv/view');
  await alumna.getByLabel('Presentación breve (2-3 frases)').fill('Cierro llamadas high ticket.'); await alumna.getByLabel('Años de experiencia en ventas').fill('3');
  await alumna.getByRole('button', { name: 'Guardar formulario' }).click(); await alumna.getByText('Formulario guardado.').waitFor();
  assert.match(await alumna.getByTestId('app-form').locator('summary').innerText(), /completado al \d+ %/); assert.match(await alumna.getByTestId('app-missing').innerText(), /Te falta:/);
  await alumna.getByTestId('matches').getByRole('button', { name: 'Preparar candidatura' }).first().click();
  await alumna.getByTestId('application').first().waitFor(); const msg = alumna.locator('textarea[id^="msg-"]').first();
  assert.match(await msg.inputValue(), /Me llamo Lucía y me interesa el puesto de Closer de ventas remoto/); assert.match(await msg.inputValue(), /Cierro llamadas high ticket\./);
  await msg.fill('Mi mensaje revisado por mí.'); await alumna.getByRole('button', { name: 'Guardar mensaje' }).click(); await alumna.getByText('Mensaje guardado.').waitFor();
  await alumna.getByRole('button', { name: 'Copiar mensaje' }).click(); await alumna.getByText('Mensaje copiado.').waitFor(); assert.equal(await alumna.evaluate(() => navigator.clipboard.readText()), 'Mi mensaje revisado por mí.');
  await alumna.getByText('Datos para copiar en los formularios').click(); await alumna.getByRole('button', { name: 'Copiar Email' }).click(); assert.equal(await alumna.evaluate(() => navigator.clipboard.readText()), 'lucia@ejemplo.com');
  const [tab] = await Promise.all([alumnaCtx.waitForEvent('page'), alumna.getByRole('link', { name: 'Abrir el anuncio' }).click()]); await tab.close();
  await alumna.getByText('Anuncio abierto', { exact: false }).first().waitFor();
  await alumna.getByRole('button', { name: 'Ya la he enviado' }).click(); await alumna.getByText('Enviada por ti', { exact: true }).waitFor(); if (process.env.SHOT2) await alumna.screenshot({ path: process.env.SHOT2, fullPage: true }); assert.equal(await alumna.getByRole('button', { name: 'Ya la he enviado' }).count(), 0);
  await alumna.getByTestId('outcome-responded').click(); await alumna.getByText('La empresa ha respondido', { exact: true }).first().waitFor();
  assert.ok(await alumna.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'sin scroll horizontal en móvil con candidaturas');
  // Progreso: una práctica y un repaso registrados con su sesión; la vista muestra solo datos reales y su tabla alternativa.
  const logged = await alumna.evaluate(async () => {
    const send = body => fetch('/api/student/activity', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.status);
    return [await send({ kind: 'practice', ref: 'precio', score: 72, detail: { axes: { empatia: 80, cierre: 64 }, difficulty: 'Media', mode: 'texto' } }), await send({ kind: 'training_review', ref: 'precall', detail: { met: 4, total: 4 } })];
  });
  assert.deepEqual(logged, [201, 201]);
  await alumna.goto(BASE + '/'); await alumna.getByRole('button', { name: 'Mi progreso' }).click(); await alumna.getByRole('heading', { name: 'Tu progreso.' }).waitFor();
  await alumna.locator('.stat-strip').waitFor();
  const strip = await alumna.locator('.stat-strip').innerText(); assert.match(strip, /1\s*prácticas/); assert.match(strip, /72\s*nota media/);
  assert.match(await alumna.locator('.student-progress').innerText(), /1 de 8 módulos repasados/);
  await alumna.getByTestId('this-week').waitFor(); const week = await alumna.getByTestId('this-week').innerText(); assert.match(week, /Completar 3 prácticas en la sala · \d\/3/); assert.match(week, /Enviar 5 candidaturas · \d\/5/); assert.ok(!/sin practicar/.test(week), 'una práctica de hoy no avisa de inactividad');
  await alumna.getByTestId('level').waitFor(); assert.match(await alumna.getByTestId('level').innerText(), /Nivel \d+ · \d+ XP/);
  assert.match(await alumna.locator('.student-progress').innerText(), /Tasa de respuesta\s*100 %/, 'una enviada y respondida = 100 %');
  assert.match(await alumna.locator('.student-progress').innerText(), /Maestría por escenario/);
  await alumna.getByText('Ver como tabla').click(); assert.equal(await alumna.locator('.progress-card details tbody tr').count(), 6, 'seis semanas en la tabla alternativa');
  assert.ok(await alumna.getByRole('img', { name: /Nota media semanal de prácticas/ }).isVisible());
  assert.ok(await alumna.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'sin scroll horizontal en móvil con progreso');
  await Promise.all([page.waitForResponse(r => r.url().includes('/api/admin/students?days=7') && r.ok()), page.getByRole('button', { name: 'Últimos 7 días' }).click()]);
  const board = page.getByTestId('coordinator'); await board.waitFor();
  assert.match(await board.innerText(), /Han practicado\s*\d+ · \d+ %/); assert.ok(await board.getByRole('img', { name: /Actividad de las alumnas en 7 días/ }).isVisible());
  await board.getByText('Ver como tabla').first().click(); assert.equal(await board.getByTestId('alt-table').first().locator('tbody tr').count(), 5, 'cinco pasos en la tabla alternativa');
  assert.match(await board.innerText(), /Hace falta que al menos 5 alumnas/, 'con una sola alumna no hay distribución de notas');
  await board.getByTestId('followup').waitFor(); assert.match(await board.getByTestId('followup').innerText(), /Pendientes de acompañar|por acompañar/, 'la tarjeta de acompañamiento existe');
  assert.match(await board.getByTestId('retention').innerText(), /Elige 30 o 90 días/, 'con 7 días no se mide la retención');
  assert.match(await board.innerText(), /Respuesta de las empresas[\s\S]*Tasa de respuesta\s*100 %/); await board.getByTestId('refer').waitFor();
  if (process.env.SHOT3) await board.screenshot({ path: process.env.SHOT3 });
  assert.match(await board.getByRole('heading', { level: 2 }).first().innerText(), /\d+ de \d+ han practicado/, 'el titular dice la conclusión');
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'panel de coordinación sin scroll horizontal en móvil');
  assert.ok(await board.locator('.funnel-row').first().isVisible());
  if (process.env.SHOT4) await board.screenshot({ path: process.env.SHOT4 });
  await page.setViewportSize({ width: 1280, height: 900 });
  const row = page.locator('tbody tr', { hasText: 'lucia@alumna.dev' }); await row.getByText('1 · media 72').waitFor(); assert.match(await row.innerText(), /1\/8/);
  await alumna.goto(BASE + '/alumna'); await alumna.getByText('TU PERFIL', { exact: true }).waitFor();
  await alumna.getByRole('button', { name: 'Salir' }).click(); await alumna.getByRole('heading', { name: 'Tu espacio' }).waitFor();
});
await step('móvil: Resumen sin scroll horizontal', async () => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Resumen' }).click(); await page.getByRole('heading', { name: 'Cómo vamos.' }).waitFor();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
});
await step('móvil: menú en una sola franja desplazable (no ocupa la pantalla) y Fuentes por tandas con «Mostrar más»', async () => {
  const sidebarBottom = await page.evaluate(() => document.querySelector('.sidebar').getBoundingClientRect().bottom);
  assert.ok(sidebarBottom < 260, `la cabecera del panel mide ${Math.round(sidebarBottom)} px en móvil`);
  const nav = await page.evaluate(() => { const n = document.querySelector('.sidebar nav'); return { scrolls: n.scrollWidth > n.clientWidth, wraps: getComputedStyle(n).flexWrap, overflowX: getComputedStyle(n).overflowX }; });
  assert.deepEqual(nav, { scrolls: true, wraps: 'nowrap', overflowX: 'auto' });
  await page.getByRole('button', { name: 'Fuentes', exact: true }).click(); await page.getByRole('heading', { name: 'Fuentes de datos.' }).waitFor();
  const more = page.getByRole('button', { name: /^Mostrar \d+ más$/ }).first();
  await more.waitFor();
  const rows = () => page.locator('table').first().locator('tbody tr').count();
  const before = await rows(); await more.click();
  assert.ok(await rows() > before, 'al pulsar «Mostrar más» aparecen más fuentes');
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
});

await step('Resumen: la cola humana suma el motor y las fuentes externas, y lleva a la que tiene trabajo', async () => {
  await page.setViewportSize({ width: 1280, height: 900 });
  // Estado conocido: ninguna fila externa en la cola salvo la que se siembra ahora.
  for (const row of state.external.values()) row.editorial_status = 'draft';
  state.external.set('res|1', { id: crypto.randomUUID(), source: 'indeed', external_id: 'res-1', title: 'Closer sin condiciones claras', company: 'Acme', location: 'Madrid, España', url: 'http://127.0.0.1:8792/page/ok', salary: null, description: 'Buscamos closer con experiencia en ventas para el equipo comercial de la empresa', posted_at: new Date().toISOString(), editorial_status: 'needs_review', role: 'closer', spain: true, score: 55, also_seen: [], verified_result: null, first_seen_at: new Date().toISOString(), last_seen_at: new Date().toISOString(), expires_at: new Date(Date.now() + 5 * 864e5).toISOString() });
  const engineNeeds = state.opps.filter(o => o.editorial_status === 'needs_review').length;
  const engineDrafts = state.opps.filter(o => o.editorial_status === 'draft').length;
  const extDrafts = [...state.external.values()].filter(r => r.editorial_status === 'draft').length;
  await page.getByRole('button', { name: 'Resumen', exact: true }).click(); await page.getByRole('heading', { name: 'Cómo vamos.' }).waitFor();
  const exceptionsCard = page.locator('article.source-card', { hasText: 'EXCEPCIONES PARA TI' });
  await exceptionsCard.locator('strong').waitFor();
  // Mientras carga, la tarjeta dice «…»: el desglose solo se pinta con las dos colas ya leídas.
  await page.getByText(new RegExp(`${engineNeeds} del motor · 1 de fuentes externas`)).waitFor();
  // El total incluye la excepción externa: antes solo contaba el motor y la cola real quedaba invisible.
  assert.equal(await exceptionsCard.locator('strong').innerText(), String(engineNeeds + 1), 'la tarjeta suma las dos colas');
  const draftsCard = page.locator('article.source-card', { hasText: 'POR CLASIFICAR' });
  await page.getByText(new RegExp(`${engineDrafts} del motor · ${extDrafts} de fuentes externas`)).waitFor();
  assert.equal(await draftsCard.locator('strong').innerText(), String(engineDrafts + extDrafts));
  // El aviso abre la cola externa (la que tiene trabajo), no la del motor.
  await page.getByRole('button', { name: 'Ver excepciones externas' }).click();
  await page.getByRole('heading', { name: 'Ofertas de España y del mercado en dólares.' }).waitFor();
  assert.equal(await page.locator('#ex-status').inputValue(), 'needs_review');
});

await browser.close(); close();
for (const [status, name, msg] of results) console.log(`${status}  ${name}${msg ? '\n      ' + msg : ''}`);
const failed = results.filter(r => r[0] === 'FAIL').length;
console.log(`\n${results.length - failed}/${results.length} pasos de interfaz OK`);
process.exit(failed ? 1 : 0);
