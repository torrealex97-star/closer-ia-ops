// Fuentes del motor: la lista no se duplica, el 429 se reintenta una vez y el extractor de
// Freelancer.com lee lo que la API devuelve DE VERDAD (respuesta recortada, no inventada).
// Uso: node --experimental-strip-types tests/engine/sources.mjs
// Sin red: `fetch` se sustituye por los casos de abajo.
import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const workerPath = fileURLToPath(new URL('../../sites/engine/worker.js', import.meta.url));
const stage = join(mkdtempSync(join(tmpdir(), 'wdc-engine-sources-')), 'worker.mjs');
copyFileSync(workerPath, stage);
const worker = await import(pathToFileURL(stage).href);
const { SOURCES, fetchCost, planRun, subrequestLimits, sourceFreelancer, sourceJobgether, sourceRemotive, sourceJobicy, sourceWorkingNomads, sourceJobspresso, resetExtractFiltered, filteredOf } = worker.__test;

// Respuesta real de https://www.freelancer.com/api/projects/0.1/projects/active/ (2026-11-08),
// recortada a los campos que usa el extractor. El segundo proyecto es el ruido típico de la
// búsqueda por término: no es del perfil y tiene que quedar filtrado ANTES de escribir.
const FREELANCER_OK = {
  result: {
    projects: [
      {
        id: 40808935, title: 'Closer comercial remoto (España)', seo_url: 'sales/Closer-comercial-remoto',
        type: 'fixed', currency: { code: 'USD' }, budget: { minimum: 250, maximum: 750 },
        time_submitted: 1794168736, preview_description: 'Buscamos un closer para cerrar demos',
        jobs: [{ name: 'Sales' }], location: { country: { name: 'Spain' } },
      },
      {
        id: 40777001, title: 'WordPress website redesign', seo_url: 'websites/WordPress-website-redesign',
        type: 'fixed', currency: { code: 'USD' }, budget: { minimum: 100, maximum: 300 },
        time_submitted: 1794100000, jobs: [{ name: 'WordPress' }],
      },
    ],
  },
};

const realFetch = globalThis.fetch;
const respond = (status, body) => new Response(body === undefined ? '' : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

try {
  // 1) Lista sana: códigos únicos (un código repetido recorre el mismo board dos veces y gasta un
  //    subrequest en vano) y coste declarado por fuente, que es lo que reparte el presupuesto.
  {
    const codes = SOURCES.map(s => s.code);
    assert.equal(new Set(codes).size, codes.length, 'códigos de fuente únicos');
    for (const s of SOURCES) assert.ok(fetchCost(s) >= 1, `${s.code} declara al menos un fetch`);
    const limits = subrequestLimits({});
    // `planRun` recibe el TECHO efectivo (`max`) y calcula el presupuesto restando el colchón de D1.
    const plan = planRun(SOURCES, JSON.stringify([{ code: 'jobtoday', status: 'deferred' }]), '2026-11-08', limits.max, limits.ceiling);
    assert.equal(plan.budget, 16, 'sin variables, el presupuesto sigue siendo el del plan gratuito');
    assert.equal(plan.ordered[0].code, 'jobtoday', 'la pasada abre por lo que quedó aplazado');
    const total = SOURCES.reduce((n, s) => n + fetchCost(s), 0);
    assert.ok(total > plan.budget, 'con el plan gratuito no caben todas: se aplazan, no se rompen');
    assert.ok(SOURCES.some(s => s.code === 'freelancer-closer'), 'el conector de encargos está en la lista');
  }

  // 2) Un 429 no es una fuente caída: se reintenta UNA vez y lo que venga después se ingiere.
  {
    resetExtractFiltered();
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      if (calls === 1) return respond(429, { detail: 'slow down' });
      return respond(200, FREELANCER_OK);
    };
    const got = await sourceFreelancer({ code: 'freelancer-closer', termsPerRun: 1 });
    assert.equal(calls, 2, 'un reintento tras el 429');
    assert.equal(got.length, 1, 'solo el proyecto del perfil');
    const [candidate] = got;
    assert.equal(candidate.payload.title, 'Closer comercial remoto (España)');
    assert.equal(candidate.payload.url, 'https://www.freelancer.com/projects/sales/Closer-comercial-remoto');
    assert.equal(candidate.payload.salary, null, 'un presupuesto de encargo no se disfraza de salario');
    assert.equal(candidate.payload.raw.engagement, 'freelance');
    assert.equal(candidate.payload.raw.budget.minimum, 250, 'el presupuesto queda en raw, sin perderlo');
    assert.equal(candidate.payload.posted_at, new Date(1794168736 * 1000).toISOString());
    assert.ok(filteredOf('freelancer-closer') >= 1, 'el ruido se cuenta, no se esconde');
  }

  // 3) Si el 429 persiste, la fuente se declara caída con su código —y con UN reintento, no una
  //    tormenta de peticiones que se come el presupuesto de las demás fuentes.
  {
    let calls = 0;
    globalThis.fetch = async () => { calls++; return respond(429, { detail: 'slow down' }); };
    await assert.rejects(() => sourceFreelancer({ code: 'freelancer-closer', termsPerRun: 1 }), /HTTP 429/);
    assert.equal(calls, 2, 'dos intentos en total');
  }

  // 4) Un 404/410 NO se reintenta: no cambia solo y reintentarlo gasta un subrequest.
  {
    let calls = 0;
    globalThis.fetch = async () => { calls++; return respond(410, { detail: 'gone' }); };
    await assert.rejects(() => sourceFreelancer({ code: 'freelancer-closer', termsPerRun: 1 }), /HTTP 410/);
    assert.equal(calls, 1, 'un 410 se declara a la primera');
  }
} finally {
  globalThis.fetch = realFetch;
}

// 5) Fuentes nuevas de la lista del operador (2026-11-08): cada extractor lee SU formato, filtra el
//    ruido y no publica salario que no esté estructurado. Los cuerpos son respuestas reales
//    recortadas a los campos que usa el extractor.
{
  const run = async (extractor, body, code) => {
    globalThis.fetch = async () => respond(200, body);
    resetExtractFiltered();
    const got = await extractor({ code });
    return { got, filtered: filteredOf(code) };
  };

  const jobgether = await run(sourceJobgether, { jobs: [
    { id: 'g1', title: 'Closer comercial (remoto)', company: { name: 'Acme' }, url: 'https://jobgether.com/oferta/g1', location: 'España', remote: true, postedAt: '2026-11-07T10:00:00Z' },
    { id: 'g2', title: 'Backend engineer (Kubernetes)', company: 'Otra', url: 'https://jobgether.com/oferta/g2', postedAt: null },
  ] }, 'jobgether');
  assert.equal(jobgether.got.length, 1, 'Jobgether: solo el del perfil');
  assert.equal(jobgether.got[0].payload.company, 'Acme', 'la empresa llega como objeto y se aplana');
  assert.equal(jobgether.got[0].payload.salary, null);
  assert.equal(jobgether.got[0].payload.location, 'España · remoto');
  assert.ok(jobgether.filtered >= 1);

  const remotive = await run(sourceRemotive, { jobs: [
    { id: 1, title: 'Sales Closer (LATAM)', company_name: 'Acme', candidate_required_location: 'LATAM', url: 'https://remotive.com/job/1', publication_date: '2026-11-06T09:00:00Z', salary: '$40k-$60k' },
    { id: 2, title: 'Service Desk Engineer', company_name: 'Otra', url: 'https://remotive.com/job/2', publication_date: '2026-11-06T09:00:00Z' },
  ] }, 'remotive-sales');
  assert.equal(remotive.got.length, 1);
  assert.equal(remotive.got[0].payload.location, 'LATAM');
  assert.equal(remotive.got[0].payload.salary, null, 'el salario en texto libre no se publica como verificado');

  const jobicy = await run(sourceJobicy, { jobs: [
    { id: 10, jobTitle: 'Appointment Setter (Remote)', companyName: 'Acme', jobGeo: 'Spain', url: 'https://jobicy.com/jobs/10', pubDate: '2026-11-05T08:00:00Z', salaryMin: 20000, salaryMax: 30000, salaryCurrency: 'EUR' },
    { id: 11, jobTitle: 'Salesforce Administrator', companyName: 'Otra', jobGeo: 'USA', url: 'https://jobicy.com/jobs/11' },
  ] }, 'jobicy-marketing');
  assert.equal(jobicy.got.length, 1);
  assert.equal(jobicy.got[0].payload.salary, null, 'un rango de la API no se publica como salario verificado');

  const nomads = await run(sourceWorkingNomads, [
    { url: 'https://www.workingnomads.com/job/go/1/', title: 'Cold Caller (Remoto)', company_name: 'Acme', location: 'Remoto', pub_date: '2026-11-05T07:00:00Z' },
    { url: 'https://www.workingnomads.com/job/go/2/', title: 'Senior Magento Developer', company_name: 'Otra', location: 'Remoto' },
  ], 'workingnomads');
  assert.equal(nomads.got.length, 1);
  assert.equal(nomads.got[0].payload.company, 'Acme');

  globalThis.fetch = async () => new Response(`<?xml version="1.0"?><rss><channel>
    <item><title>Sales Closer (remote)</title><link>https://jobspresso.co/job/1/</link><pubDate>Wed, 05 Nov 2026 08:00:00 +0000</pubDate><description>cierre</description></item>
    <item><title>Fraud Protect Investigator</title><link>https://jobspresso.co/job/2/</link><description>x</description></item>
  </channel></rss>`, { status: 200 });
  resetExtractFiltered();
  const jobspresso = await sourceJobspresso({ code: 'jobspresso', slug: 'https://jobspresso.co/feed/?post_type=job_listing' });
  assert.equal(jobspresso.length, 1, 'Jobspresso: el feed trae empleos y el filtro deja solo el del perfil');
  assert.equal(jobspresso[0].payload.url, 'https://jobspresso.co/job/1/');
}

console.log('PASS  motor: fuentes sin duplicados, 429 con un reintento y extractores (Freelancer + 5 portales) sin inventar salario');
