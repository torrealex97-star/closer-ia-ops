// Atribución de fuente en la tarjeta de la alumna.
// node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/surface.mjs
//
// Google Jobs devuelve su propia ficha (google.com/search…&ibp=htl;jobs) cuando el
// anuncio no publica enlace de candidatura. La tarjeta no puede decir «publicado en
// google.com»: nombra el portal que Google atribuye y declara el salto.
import assert from 'node:assert/strict';

process.env.SUPABASE_URL = 'http://127.0.0.1:1';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';
process.env.SUPABASE_PUBLISHABLE_KEY = 'anon';
const { dedupeReposted, toOpportunity } = await import('../../apps/web/lib/externalSurface.ts');

const base = {
  id: '11111111-1111-1111-1111-111111111111', org_id: 'cloud-wdc', source: 'google-jobs', external_id: 'g1',
  title: 'Closer de Ventas High-Ticket', company: 'Fastrack', location: 'Madrid', salary: null,
  description: 'Buscamos closer para cerrar ventas por videollamada.', posted_at: null, raw: {},
  first_seen_at: null, last_seen_at: null, expires_at: null, editorial_status: 'approved',
  reviewed_by: null, reviewed_at: null, verified_at: null, verified_result: null, role: 'closer',
  spain: true, score: 80, fingerprint: null, also_seen: [], market: null, remote: null,
  pay_model: null, pay_detail: null, currency: null, vertical: null, language: null, red_flags: [], ai_review: null,
};

const googleUrl = 'https://www.google.com/search?q=closer+Espa%C3%B1a&ibp=htl%3Bjobs';
const results = [];
const step = (name, fn) => { try { fn(); results.push(['PASS', name]); } catch (e) { results.push(['FAIL', name, e.message.split('\n')[0]]); } };

step('ficha de Google con portal declarado: se nombra el portal y se dice «vía Google Jobs»', () => {
  const o = toOpportunity({ ...base, url: googleUrl, raw: { site: 'BeBee' } }, 'closer');
  assert.equal(o.source_name, 'BeBee · vía Google Jobs');
  assert.equal(o.source_url, googleUrl, 'el enlace no se toca ni se inventa uno del portal');
});

step('enlace del portal: se nombra su dominio, sin coletilla', () => {
  const o = toOpportunity({ ...base, url: 'https://www.infojobs.net/oferta/1', raw: { site: 'InfoJobs' } }, 'closer');
  assert.equal(o.source_name, 'infojobs.net');
});

step('ficha de Google sin portal (via ausente): no se inventa un portal, se dice google.com', () => {
  const o = toOpportunity({ ...base, url: googleUrl, raw: {} }, 'closer');
  assert.equal(o.source_name, 'google.com');
});

step('un via que no es texto no rompe la tarjeta', () => {
  const o = toOpportunity({ ...base, url: googleUrl, raw: { site: 42 } }, 'closer');
  assert.equal(o.source_name, 'google.com');
});

step('sin fecha en la fuente: se declara desconocida, no se inventa', () => {
  const o = toOpportunity({ ...base, url: googleUrl, raw: { site: 'BeBee' } }, 'closer');
  assert.equal(o.published_at, null);
});

// El mismo anuncio en tres portales: el texto coincide palabra a palabra salvo el cierre.
const fastrack = (title, url, extra = '') => ({ id: title, company: 'Fastrack', title, url, description: 'Te apasiona el cierre de ventas, dominas la venta consultiva y buscas un proyecto solido con un plan de comisiones muy potente. En Fastrack, consultora especializada en formacion y desarrollo comercial, buscamos un closer high ticket para cerrar ventas por videollamada con leads cualificados. Ofrecemos fijo mas comisiones, formacion continua y un equipo senior.' + extra });

step('el mismo puesto en tres portales se queda en uno', () => {
  const rows = [
    fastrack('High-Ticket Sales Closer', 'https://www.google.com/search?q=a&ibp=htl;jobs'),
    fastrack('High-Ticket Sales Closer (Hospitality Sector)', 'https://www.google.com/search?q=b&ibp=htl;jobs', ' Sector hosteleria.'),
    fastrack('Closer de ventas high-ticket', 'https://www.google.com/search?q=c&ibp=htl;jobs', ' Jornada completa.'),
  ];
  const out = dedupeReposted(rows);
  assert.equal(out.length, 1, `quedaron ${out.length}`);
  assert.equal(out[0].title, 'High-Ticket Sales Closer', 'se conserva el primero: la lista ya viene ordenada por puntuación');
});

step('dos anuncios distintos de la misma empresa no se fusionan', () => {
  const rows = [
    fastrack('Closer de Ventas — Formación Digital', 'https://www.google.com/search?q=d', ' Buscamos tu proximo desafio profesional.'),
    { id: 'b1', company: 'Fastrack', title: 'Closer de Ventas High-Ticket (Freelance)', url: 'https://www.google.com/search?q=e', description: 'Agencia especializada en generacion de leads y captacion comercial busca un closer freelance full cycle sales de alto rendimiento para liderar el cierre de oportunidades cualificadas.' },
  ];
  assert.equal(dedupeReposted(rows).length, 2);
});

step('misma descripción en otra empresa no se fusiona', () => {
  const a = fastrack('High-Ticket Sales Closer', 'https://www.google.com/search?q=f');
  const b = { ...a, id: 'x', company: 'Otra Consultora' };
  assert.equal(dedupeReposted([a, b]).length, 2);
});

step('sin empresa o sin descripción no se agrupa a ciegas', () => {
  const a = { id: '1', company: null, title: 'Closer', url: 'https://a.es/1', description: 'Texto largo de un anuncio de closer de ventas high ticket en remoto.' };
  const b = { ...a, id: '2', url: 'https://b.es/2' };
  assert.equal(dedupeReposted([a, b]).length, 2, 'sin empresa no hay señal suficiente');
  const c = { ...a, company: 'Acme', description: null };
  assert.equal(dedupeReposted([c, { ...c, id: '3', url: 'https://c.es/3' }]).length, 2, 'sin descripción no hay señal suficiente');
});

step('si el conservado solo tiene la ficha de Google y el duplicado el portal, se cambia el enlace', () => {
  const rows = [
    fastrack('High-Ticket Sales Closer', 'https://www.google.com/search?q=g&ibp=htl;jobs'),
    fastrack('Closer de ventas high-ticket', 'https://www.infojobs.net/oferta/1'),
  ];
  const out = dedupeReposted(rows);
  assert.equal(out.length, 1);
  assert.equal(out[0].url, 'https://www.infojobs.net/oferta/1');
});

for (const [s, n, m] of results) console.log(`${s}  ${n}${m ? '\n      ' + m : ''}`);
const failed = results.filter(r => r[0] === 'FAIL').length;
console.log(`\n${results.length - failed}/${results.length} pasos OK`);
process.exit(failed ? 1 : 0);
