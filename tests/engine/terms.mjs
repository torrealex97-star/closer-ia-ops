// Búsquedas de closer del motor: vocabulario, rotación por día, coste en peticiones y extractores
// (FreeHire con `q`, Himalayas con términos). Sin red ni D1: el worker se importa del repo y `fetch`
// se sustituye por respuestas fijas.
// Uso: node --experimental-strip-types tests/engine/terms.mjs
import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const workerPath = fileURLToPath(new URL('../../sites/engine/worker.js', import.meta.url));
const stage = join(mkdtempSync(join(tmpdir(), 'wdc-terms-')), 'worker.mjs');
copyFileSync(workerPath, stage);
const { __test: t } = await import(pathToFileURL(stage).href);
const results = [];
const step = (name, fn) => { try { fn(); results.push(['PASS', name]); } catch (e) { results.push(['FAIL', name, e.message.split('\n')[0]]); } };
const aStep = async (name, fn) => { try { await fn(); results.push(['PASS', name]); } catch (e) { results.push(['FAIL', name, e.message.split('\n')[0]]); } };

step('el vocabulario incluye los términos en español pedidos', () => {
  for (const term of ['closer', 'cierre comercial', 'inside sales', 'high ticket', 'remote closer', 'closer remoto', 'comercial remoto', 'ventas remotas', 'cerrador de ventas', 'setter', 'agendador', 'closer de ventas', 'sales closer', 'cierre de negocios', 'agente comercial remoto']) {
    assert.ok(t.CLOSER_TERMS.includes(term), `falta «${term}»`);
  }
  assert.ok(t.CLOSER_TERMS.length >= 20, 'al menos 20 términos');
  assert.equal(new Set(t.CLOSER_TERMS).size, t.CLOSER_TERMS.length, 'sin repetidos');
});

step('la clasificación no confunde el comparativo inglés ni subcadenas con el rol', () => {
  // Falsos positivos medidos el 2026-10-26 (vacantes de Java y de SRE/DevOps que quedaban
  // elegibles como closer para la alumna): «closer» a secas en el cuerpo es el comparativo.
  assert.equal(t.classifyRole({ title: 'Java Engineer' }, "bring online stores' inventory closer to their customers"), null);
  assert.equal(t.classifyRole({ title: 'Senior Cloud Infrastructure Engineer' }, 'bringing our teams closer together and creating more opportunities'), null);
  assert.equal(t.classifyRole({ title: 'Product Manager' }, 'we are closer than ever to launching'), null);
  assert.equal(t.isProfileCandidate({ title: 'Senior Full Stack Developer', raw: { description: 'work closer than before with clients' } }), false);
  // Un anuncio real de cierre sí entra: por el título, con plural y con las fórmulas del cuerpo.
  assert.equal(t.classifyRole({ title: 'Closer de Ventas High-Ticket' }, ''), 'closer');
  assert.equal(t.classifyRole({ title: 'High-Ticket Closers' }, ''), 'closer');
  assert.equal(t.classifyRole({ title: 'Buscamos un closer' }, ''), 'closer');
  assert.equal(t.classifyRole({ title: 'Tecnico de soporte' }, 'perfil closer de ventas high ticket'), 'closer');
  // La coincidencia por palabra completa sigue evitando subcadenas pegadas.
  assert.equal(t.hasWord('closets', 'closer'), false);
  assert.equal(t.hasWord('enclosed space', 'close'), false);
  assert.equal(t.hasWord('agendadores comerciales', 'agendador'), true);
});

step('el filtro del origen se queda con las familias del perfil y usa el clasificador del motor', () => {
  // Entra el perfil WDC, sea cual sea el término que lo encontró…
  for (const title of ['Closer de ventas High-Ticket', 'Setter y Closer de Ventas', 'Appointment Setter', 'Inside Sales / Closer (SaaS)', 'Cold Caller B2B', 'SDR B2B'])
    assert.equal(t.isProfileCandidate({ title }), true, `debería entrar: ${title}`);
  // …y se descarta el ruido que nunca podría salir a la alumna. La familia AE pura también se
  // descarta aquí: ya la trae el barrido por categoría y cada candidato cuesta 6 escrituras.
  for (const title of ['Data Engineer', 'Sales Assistant - 30h/s Temporal', 'Becario de marketing', 'Recepcionista', 'Inside Sales Representative', 'Asesor/a Comercial'])
    assert.equal(t.isProfileCandidate({ title }), false, `debería descartarse: ${title}`);
  // El texto de la oferta cuenta cuando el título no lo dice: una oferta real de cierre no se pierde.
  assert.equal(t.isProfileCandidate({ title: 'Consultor educativo', raw: { description: 'Buscamos cerrador de ventas high ticket' } }), true);
  // Sin lista paralela: la familia es exactamente la del clasificador del motor.
  assert.equal(t.familyOf({ title: 'Setter y Closer de Ventas' }), t.classifyRole({ title: 'Setter y Closer de Ventas' }, ''));
  assert.deepEqual([...t.PROFILE_FAMILIES].sort(), ['closer', 'cold_caller', 'sdr', 'setter']);
});

step('la rotación cubre todos los términos sin repetir y cambia cada día', () => {
  const seen = new Set();
  const day = n => new Date(Date.UTC(2026, 9, 20 + n));
  for (let i = 0; i < 20; i++) for (const term of t.pickTerms(3, day(i))) seen.add(term);
  assert.equal(seen.size, t.CLOSER_TERMS.length, 'en 20 días se usan todos');
  // Mismo día = mismos términos (determinista); día siguiente = ventana distinta.
  assert.deepEqual(t.pickTerms(3, day(0)), t.pickTerms(3, day(0)));
  assert.notDeepEqual(t.pickTerms(3, day(0)), t.pickTerms(3, day(1)));
  assert.equal(t.pickTerms(3, day(0)).length, 3);
  assert.ok(t.pickTerms(0, day(0)).length >= 1, 'nunca cero términos');
  assert.equal(t.pickTerms(999, day(0)).length, t.CLOSER_TERMS.length, 'no pide más de los que hay');
});

step('coste en peticiones por fuente: se usa para aplazar, no para recortar ofertas', () => {
  assert.equal(t.fetchCost({ kind: 'freehire', region: 'es' }), 3);
  assert.equal(t.fetchCost({ kind: 'freehire', region: 'latam' }), 1);
  assert.equal(t.fetchCost({ kind: 'freehire', region: 'es', terms: true, termsPerRun: 3 }), 3);
  assert.equal(t.fetchCost({ kind: 'himalayas', terms: true, termsPerRun: 3 }), 3);
  assert.equal(t.fetchCost({ kind: 'jobtoday-cities', paths: ['a', 'b', 'c'] }), 3);
  assert.equal(t.fetchCost({ kind: 'getonbrd' }), 2);
  assert.equal(t.fetchCost({ kind: 'jobtoday' }), 1);
});

step('las tres búsquedas nuevas están declaradas sobre las fuentes que ya funcionan', () => {
  const byCode = new Map(t.SOURCES.map(s => [s.code, s]));
  for (const code of ['freehire-closer', 'freehire-latam-closer', 'himalayas-closer']) {
    const s = byCode.get(code);
    assert.ok(s, `falta ${code}`);
    assert.equal(s.terms, true, `${code}: debe buscar por términos`);
    assert.ok(s.termsPerRun >= 4 && s.termsPerRun <= 6, `${code}: ventana medible, no un término suelto`);
  }
  assert.equal(byCode.get('freehire').terms, undefined, 'la búsqueda por categoría se conserva');
});

step('el presupuesto por invocación reserva el gasto D1: lo que no cabe se aplaza, no se cae', () => {
  const total = t.SOURCES.reduce((n, s) => n + t.fetchCost(s), 0);
  assert.ok(total > 20, 'el catálogo de fuentes no cabe en una sola pasada: repartir es la norma');
  const plan = t.planRun(t.SOURCES, null, '2026-10-26', undefined);
  // Presupuesto real de fetch = techo del Worker menos el colchón de D1. Medido en producción el
  // 2026-10-26: con el presupuesto puesto a 40 «peticiones» la invocación murió tras 25 fetch y las
  // dos búsquedas de closer de LATAM/Himalayas y el ATS quedaron CAÍDAS («Too many subrequests»).
  assert.equal(plan.budget, t.PLATFORM_SUBREQUEST_LIMIT - t.D1_RESERVED_SUBREQUESTS);
  assert.ok(plan.budget + t.D1_RESERVED_SUBREQUESTS <= t.PLATFORM_SUBREQUEST_LIMIT, 'fetch + D1 cabe en el techo');
  assert.ok(plan.budget < 25, `presupuesto ${plan.budget}: por debajo de la pasada que murió en producción`);
  // Ninguna fuente desaparece del plan: se aplaza (declarada) o se recoge.
  assert.equal(plan.ordered.length, t.SOURCES.length);
  assert.equal(new Set(plan.ordered.map(s => s.code)).size, t.SOURCES.length, 'sin duplicados ni olvidos');
  let spent = 0, fits = 0;
  for (const s of plan.ordered) { if (spent + t.fetchCost(s) > plan.budget) continue; spent += t.fetchCost(s); fits += 1; }
  assert.ok(fits < t.SOURCES.length, `caben ${fits} de ${t.SOURCES.length}: el resto se aplaza`);
  assert.ok(fits >= 3, 'y caben varias: la pasada no queda vacía');
  // La pasada siguiente ABRE por lo aplazado o caído. El orden de cabecera sigue la rotación del día,
  // así que se compara el CONJUNTO y que ninguna completada se cuele por delante.
  const last = t.SOURCES.map(s => ({ code: s.code, status: 'completed' }));
  const cut = ['himalayas-closer', 'freehire-latam-closer', 'ats-teamtailor-monestcapital'];
  for (const code of cut) last.find(s => s.code === code).status = 'deferred';
  const next = t.planRun(t.SOURCES, JSON.stringify(last), '2026-10-27', undefined);
  assert.deepEqual([...next.resumed].sort(), [...cut].sort());
  assert.deepEqual([...next.ordered.slice(0, cut.length).map(s => s.code)].sort(), [...cut].sort(), 'lo cortado abre la siguiente');
  assert.equal(next.ordered.slice(cut.length).some(s => cut.includes(s.code)), false, 'nada reanudado se repite detrás');
  // Un fallo de verdad también se reanuda: si no, la fuente caída esperaría a su turno de rotación.
  const failed = t.planRun(t.SOURCES, JSON.stringify([{ code: 'himalayas-closer', status: 'failed' }]), '2026-10-27', undefined);
  assert.equal(failed.ordered[0].code, 'himalayas-closer');
  // Techo de entorno menor: el presupuesto no baja de un mínimo usable y nunca rebasa el techo.
  assert.equal(t.planRun(t.SOURCES, null, '2026-10-26', 12).budget, 6);
  assert.equal(t.planRun(t.SOURCES, null, '2026-10-26', 400).budget, t.PLATFORM_SUBREQUEST_LIMIT - t.D1_RESERVED_SUBREQUESTS);
  // Sin estado previo o ilegible no se rompe: queda la rotación del día.
  assert.deepEqual(t.planRun(t.SOURCES, '{basura', '2026-10-26').ordered.map(s => s.code), plan.ordered.map(s => s.code));
  // La ventana de términos cubre todo el vocabulario en menos de una semana.
  assert.ok(Math.ceil(t.CLOSER_TERMS.length / 6) <= 4, 'el vocabulario se recorre en ≤ 4 días');
});

// ---- Extractores con `fetch` simulado ----
const calls = [];
const today = t.pickTerms(3);
const freehireRows = (term) => ({
  meta: { total: 2 },
  data: [
    { public_slug: `fh-${term}-1`, url: 'https://freehire.me/j/1', title: 'Closer de ventas High-Ticket', company: 'Acme', countries: ['ES'], posted_at: '2026-10-26T08:00:00Z', reality: { class: 'fresh' } },
    // Repetido entre términos: el dedupe por external_id debe dejar uno solo.
    { public_slug: 'fh-same', url: 'https://freehire.me/j/same', title: 'Closer remoto', company: 'Acme', countries: ['ES'], posted_at: '2026-10-26T07:00:00Z', reality: { class: null } },
    // Ficha repintada: fuera.
    { public_slug: 'fh-stale', url: 'https://freehire.me/j/stale', title: 'Closer (repintada)', company: 'Acme', countries: ['ES'], posted_at: null, reality: { class: 'stale' } },
    // Ruido no comercial: se descarta en el origen y se cuenta (no se ingiere, no gasta escrituras).
    { public_slug: `fh-noise-${term}`, url: 'https://freehire.me/j/noise', title: 'Sales Assistant - 30h/s Temporal', company: 'Retail', countries: ['ES'], posted_at: '2026-10-26T06:00:00Z', reality: { class: 'fresh' } },
  ],
});
globalThis.fetch = async input => {
  const url = String(input);
  calls.push(url);
  const json = body => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  if (url.includes('freehire.me')) {
    const term = new URL(url).searchParams.get('q') || 'categoria';
    if (term === 'BOOM') return new Response('boom', { status: 500 });
    return json(freehireRows(term));
  }
  if (url.includes('himalayas.app')) {
    const term = new URL(url).searchParams.get('q');
    if (term === 'BOOM') throw new Error('red caída');
    return json({ jobs: [
      { id: `hm-${term}`, title: 'Asesor comercial remoto', companyName: 'Aprende Institute', locationRestrictions: 'Mexico', applicationLink: `https://himalayas.app/jobs/${term}` },
      { id: 'hm-same', title: 'Closer de Ventas High-Ticket | 100% Remoto', companyName: 'Selection Book', locationRestrictions: 'Guatemala,Mexico' },
      { id: `hm-noise-${term}`, title: 'Senior Data Engineer', companyName: 'Nope', locationRestrictions: 'Spain' },
    ] });
  }
  return new Response('', { status: 200 });
};

await aStep('FreeHire: busca por término (`q`), deduplica entre términos y descarta fichas repintadas', async () => {
  calls.length = 0;
  t.resetExtractFiltered();
  const out = await t.sourceFreehire({ code: 'freehire-closer', region: 'es', terms: true, termsPerRun: 3 });
  const searched = calls.map(u => new URL(u).searchParams.get('q')).filter(Boolean);
  assert.deepEqual(searched, today, 'una petición por término del día');
  assert.ok(calls.every(u => new URL(u).searchParams.get('countries') === 'ES'), 'mercado España');
  assert.equal(out.length, today.length + 1, '2 por término con 1 repetido y 1 repintada ⇒ 3+1 únicos');
  assert.equal(new Set(out.map(o => o.external_id)).size, out.length, 'sin ids repetidos');
  assert.ok(!out.some(o => o.external_id === 'fh-stale'), 'la ficha repintada no entra');
  assert.ok(out.some(o => o.payload.raw.search_term === today[0]), 'queda anotado con qué término se encontró');
  assert.ok(!out.some(o => /Sales Assistant/.test(o.payload.title)), 'el ruido no comercial no se ingiere');
  assert.equal(t.filteredOf('freehire-closer'), today.length, 'se cuenta uno descartado por término, declarado en el run');
  t.resetExtractFiltered();
  assert.equal(t.filteredOf('freehire-closer'), 0, 'el contador se reinicia en cada ejecución');
});

await aStep('Himalayas: una búsqueda por término del día y sin repetir la misma oferta', async () => {
  calls.length = 0;
  t.resetExtractFiltered();
  const out = await t.sourceHimalayas({ code: 'himalayas-closer', terms: true, termsPerRun: 3 });
  assert.deepEqual(calls.map(u => new URL(u).searchParams.get('q')), today);
  assert.equal(out.length, 1, 'la oferta de cierre compartida entra una sola vez');
  assert.equal(out[0].payload.location, 'Guatemala,Mexico');
  assert.ok(!out.some(o => /Data Engineer/.test(o.payload.title)), 'los roles no comerciales no se ingieren');
  // Dos descartes por término: el rol técnico y la vacante AE (ya llega por el barrido por categoría).
  assert.equal(t.filteredOf('himalayas-closer'), today.length * 2, 'se declaran los descartes del run');
});

await aStep('si un término falla, los demás siguen: el fallo no esconde lo bueno', async () => {
  const realFetch = globalThis.fetch;
  // El segundo término del día devuelve 500; el resto responde.
  globalThis.fetch = async input => {
    if (String(input).includes(`q=${encodeURIComponent(today[1])}`)) return new Response('boom', { status: 500 });
    return realFetch(input);
  };
  const out = await t.sourceFreehire({ region: 'es', terms: true, termsPerRun: 3 });
  assert.ok(out.length >= 2, 'lo de los términos que sí responden se devuelve');
  globalThis.fetch = realFetch;
});

await aStep('si fallan TODOS los términos, la fuente se declara caída (no un vacío silencioso)', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('boom', { status: 500 });
  await assert.rejects(() => t.sourceFreehire({ region: 'es', terms: true, termsPerRun: 2 }), /ninguna búsqueda respondió/);
  await assert.rejects(() => t.sourceHimalayas({ terms: true, termsPerRun: 2 }), /ningún término respondió/);
  globalThis.fetch = realFetch;
});

for (const [status, name, message] of results) console.log(`${status}  ${name}${message ? '\n      ' + message : ''}`);
const failed = results.filter(r => r[0] === 'FAIL').length;
console.log(`\n${results.length - failed}/${results.length} pasos OK`);
process.exit(failed ? 1 : 0);
