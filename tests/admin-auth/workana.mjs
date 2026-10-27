// Workana como portal de Apify: la fila del portal, su plantilla de entrada y que el coste de una
// pasada de 100 proyectos quede por debajo del tope por ejecución. Sin red ni Apify.
// Uso: node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/workana.mjs
import assert from 'node:assert/strict';
import { PORTALS, portalById, portalBySource } from '../../apps/web/lib/apifyCatalog.ts';
import { adaptInput, fillTemplate, mapItem, RUN_CAP_USD, TEST_CAP_USD } from '../../apps/web/lib/apify.ts';
import { roleFromTitle } from '../../apps/web/lib/vocabulary.ts';

const results = [];
const step = (name, fn) => { try { fn(); results.push(['PASS', name]); } catch (e) { results.push(['FAIL', name, e.message.split('\n')[0]]); } };

const workana = portalById('workana');

step('Workana está en el catálogo de portales, con su propia fuente', () => {
  assert.ok(workana, 'falta el portal workana');
  assert.equal(workana.source, 'apify-workana');
  // La fuente se separa del resto de actores: las cifras del panel no se mezclan.
  assert.equal(portalBySource('apify-workana'), workana);
  assert.equal(workana.maxItems, 100, 'la primera pasada es de 100 proyectos');
  assert.ok(workana.testItems <= 10, 'la prueba gasta céntimos');
  assert.equal(workana.recipes[0].actor, 'automation-lab/workana-freelance-projects-scraper', 'el actor principal es el documentado');
  assert.ok(workana.recipes.length >= 2, 'hay repuestos si el primero falla');
});

step('la plantilla no mete `country` (Workana espera un código de 2 letras) y habla español', () => {
  const t = workana.inputTemplate;
  assert.ok(t, 'la plantilla es lo que evita mandar «España» a un campo ISO');
  assert.equal(t.locale, 'es');
  assert.equal('country' in t, false, 'country rompería el filtro de Workana');
  assert.equal(t.query, '{{query}}');
  assert.equal(t.maxItems, '{{max_items}}');
});

step('la plantilla se rellena con la búsqueda y el tope de la pasada', () => {
  const filled = fillTemplate(workana.inputTemplate, { query: 'ventas', location: 'España', country: 'Spain', max_items: 100, hours_old: 240, sites: [] });
  assert.deepEqual(filled, { query: 'ventas', locale: 'es', maxItems: 100, maxPages: 5 });
});

step('el adaptador genérico NO se usa: sin plantilla mandaría country=España', () => {
  // Esquema real del actor (campos publicados en su ficha).
  const schema = {
    properties: { query: { type: 'string' }, country: { type: 'string' }, locale: { type: 'string' }, maxItems: { type: 'integer' } },
    required: [],
  };
  const adapted = adaptInput(schema, { query: 'ventas', location: 'España', country: 'Spain', max_items: 100, hours_old: 240, sites: [] });
  assert.equal(adapted.input.country, 'Spain', 'el adaptador genérico manda la ubicación tal cual');
  assert.ok(workana.inputTemplate, 'por eso Workana lleva plantilla propia');
});

step('una pasada de 100 proyectos cabe en el tope por ejecución y se estima antes', () => {
  // Precio publicado del actor: desde 0,96 USD por 1.000 elementos extraídos.
  const PER_ITEM_USD = 0.96 / 1000;
  const estimate = workana.maxItems * PER_ITEM_USD;
  assert.ok(estimate < 0.5, `100 proyectos ≈ ${estimate.toFixed(3)} USD`);
  assert.ok(estimate < RUN_CAP_USD, 'el tope duro por ejecución no se toca');
  assert.ok(workana.testItems * PER_ITEM_USD < TEST_CAP_USD);
});

step('un proyecto de Workana entra como candidato con su enlace y sin sueldo inventado', () => {
  // Fila real del dataset documentada por el actor.
  const candidate = mapItem({
    projectId: 'closer-de-ventas-high-ticket', url: 'https://www.workana.com/job/closer-de-ventas-high-ticket',
    title: 'Closer de ventas high ticket', description: 'Buscamos closer para cerrar llamadas de clientes.',
    category: 'marketing-digital-y-ventas', subcategory: 'comercial-vendedor', skills: ['Ventas'],
    budget: 'USD 500 - 1.200', budgetCurrency: 'USD', budgetMin: 500, budgetMax: 1200, isHourly: false,
    clientCountry: 'España', clientPaymentVerified: true, proposalCount: 12, publishedAtText: 'hace 1 hora', status: 'open',
  });
  assert.ok(candidate, 'sin título o sin enlace no hay candidato verificable');
  assert.equal(candidate.url, 'https://www.workana.com/job/closer-de-ventas-high-ticket');
  assert.equal(candidate.external_id, 'closer-de-ventas-high-ticket', 'id estable del proyecto, no la URL');
  // El presupuesto por proyecto NO se guarda como salario: queda literal en raw, sin disfrazarse.
  assert.equal(candidate.salary, null, 'un presupuesto por proyecto no es un sueldo');
  assert.equal(candidate.raw.budget_text, 'USD 500 - 1.200');
  assert.equal(candidate.raw.kind, 'freelance_project');
  assert.equal(candidate.company, null, 'el cliente suele venir enmascarado: no se inventa');
  assert.equal(candidate.location, 'España', 'el país público del cliente se conserva como ubicación');
});

step('los dos títulos reales que se perdían ya tienen perfil', () => {
  // Medido en la primera pasada real de Workana (2026-10-26): se quedaban sin familia.
  assert.equal(roleFromTitle('Especialista en Seguimiento y Cierre de Ventas por Whatsapp para Chocolates'), 'closer');
  assert.equal(roleFromTitle('Ejecutivo(a) Comercial Freelance B2B/B2G para Venta de Capacitación Empresarial en México'), 'account_executive');
  // Y los cuatro closers reales que sí acertaba el vocabulario anterior siguen acertando.
  for (const title of [
    'Buscamos Appointment Setter y Closer para Software de Fidelización B2B en Hostelería',
    'Buscamos Closer de Ventas B2b | Leads proporcionados | Trabajo remoto',
    'Buscamos Closer de Ventas para Startup de Asistentes de Ia y Crm',
    'Closer Mujer-Horario Flexible-Producto High Tiket-Altas comisiones',
  ]) assert.equal(roleFromTitle(title), 'closer', title);
});

step('lo que no trae título o enlace se descarta en vez de guardarse a medias', () => {
  assert.equal(mapItem({ title: 'Closer sin enlace' }), null);
  assert.equal(mapItem({ url: 'https://www.workana.com/job/x' }), null);
});

for (const [status, name, message] of results) console.log(`${status}  ${name}${message ? '\n      ' + message : ''}`);
const failed = results.filter(r => r[0] === 'FAIL').length;
console.log(`\n${results.length - failed}/${results.length} pasos OK`);
process.exit(failed ? 1 : 0);
