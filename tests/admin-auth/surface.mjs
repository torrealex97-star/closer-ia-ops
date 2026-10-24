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
const { toOpportunity } = await import('../../apps/web/lib/externalSurface.ts');

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

for (const [s, n, m] of results) console.log(`${s}  ${n}${m ? '\n      ' + m : ''}`);
const failed = results.filter(r => r[0] === 'FAIL').length;
console.log(`\n${results.length - failed}/${results.length} pasos OK`);
process.exit(failed ? 1 : 0);
