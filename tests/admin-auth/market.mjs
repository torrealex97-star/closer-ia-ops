// Mercado, candidatura, contacto y regla de cualificación:
// node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/market.mjs
import assert from 'node:assert/strict';
import { currencyOf, marketFor } from '../../apps/web/lib/market.ts';
import { companyUrlIn, contactsIn } from '../../apps/web/lib/external.ts';
import { inMarket } from '../../apps/web/lib/externalSurface.ts';
import { judgeOffer } from '../../apps/web/lib/autoReview.ts';

const results = [];
const step = async (name, fn) => { try { await fn(); results.push(['PASS', name]); } catch (e) { results.push(['FAIL', name, e.message.split('\n')[0]]); } };

await step('moneda: euros y dólares, y el euro gana si el anuncio trae los dos', async () => {
  assert.equal(currencyOf('30.000 € brutos/año'), 'EUR');
  assert.equal(currencyOf('3.000 euros al mes'), 'EUR');
  assert.equal(currencyOf('3.000 USD al mes'), 'USD');
  assert.equal(currencyOf('$2,500 a month'), 'USD');
  assert.equal(currencyOf('2.500 dólares mensuales'), 'USD');
  assert.equal(currencyOf('30.000 € (≈ 32.000 $) al año'), 'EUR');
  assert.equal(currencyOf('Salario a convenir'), null);
  assert.equal(currencyOf(null, undefined), null);
});

await step('mercado: manda la ubicación; la moneda solo rellena el hueco', async () => {
  // Contradicción: ubicación España con importe en dólares ⇒ España (decisión del propietario).
  assert.deepEqual(marketFor({ title: 'Closer', location: 'Madrid, España', salary: '$3.000/mes' }), { market: 'ES', basis: 'ubicacion_espana', currency: 'USD' });
  assert.deepEqual(marketFor({ title: 'Closer', location: 'Remoto, LATAM', salary: '30.000 €' }), { market: 'LATAM', basis: 'ubicacion_latam', currency: 'EUR' });
  assert.deepEqual(marketFor({ title: 'Closer', location: 'Córdoba, Argentina', salary: 'USD 2.000' }), { market: 'LATAM', basis: 'ubicacion_latam', currency: 'USD' });
  assert.deepEqual(marketFor({ title: 'Closer', location: 'Austin, Texas', salary: '$90k' }), { market: 'US_LATINO', basis: 'ubicacion_estados_unidos', currency: 'USD' });
  // Sin ubicación útil: decide el importe.
  assert.deepEqual(marketFor({ title: 'Closer', location: 'Remoto', salary: '3.000 USD/mes' }), { market: 'US_LATINO', basis: 'moneda_usd', currency: 'USD' });
  assert.deepEqual(marketFor({ title: 'Closer', location: null, salary: '30.000 €/año' }), { market: 'ES', basis: 'moneda_eur', currency: 'EUR' });
  assert.deepEqual(marketFor({ title: 'Closer', location: null }), { market: null, basis: 'sin_senal', currency: null });
  // Gazetteer: un municipio pequeño ya cuenta como España.
  assert.equal(marketFor({ title: 'Closer', location: 'Boiro, A Coruña' }).market, 'ES');
  assert.equal(marketFor({ title: 'Closer', location: 'Córdoba, España' }).market, 'ES');
});

await step('filtro de la alumna: España/Europa, LatAm y dólares', async () => {
  const es = { title: 'Closer', location: 'Sevilla, España', market: 'ES' };
  const latam = { title: 'Closer', location: 'Bogotá, Colombia', market: 'LATAM' };
  const usd = { title: 'Closer', location: 'Remoto', market: 'US_LATINO' };
  assert.equal(inMarket(es, 'ES'), true); assert.equal(inMarket(latam, 'ES'), false);
  assert.equal(inMarket(latam, 'LATAM'), true); assert.equal(inMarket(usd, 'LATAM'), true);
  assert.equal(inMarket(usd, 'US'), true); assert.equal(inMarket(es, 'US'), false);
  assert.equal(inMarket(es, 'any'), true); assert.equal(inMarket(es, 'MARTE'), false);
  assert.equal(inMarket({ title: 'Closer', location: 'Madrid' }, 'ES'), true);
});

await step('candidatura: enlace propio si existe y web publicada que no sea portal', async () => {
  const text = 'Aplica en https://www.infojobs.net/oferta/1 o en https://acme.com/empleo. Dudas: talento@acme.com';
  assert.equal(companyUrlIn(text), 'https://acme.com/empleo');
  assert.equal(companyUrlIn('Solo https://es.indeed.com/viewjob?jk=1'), null);
  assert.equal(companyUrlIn('ATS: https://jobs.lever.co/acme/123'), 'https://jobs.lever.co/acme/123');
  assert.equal(companyUrlIn(null), null);
});

await step('contacto: solo lo publicado, acotado y sin imágenes', async () => {
  assert.deepEqual(contactsIn('Escribe a rrhh@acme.com o llama al +34 600 123 456'), { emails: ['rrhh@acme.com'], phones: ['+34 600 123 456'] });
  assert.deepEqual(contactsIn('logos en logo@2x.png y nada más'), null);
  assert.equal(contactsIn('sin contacto'), null);
  const many = contactsIn('a@a.com b@b.com c@c.com 600111222 600333444 600555666');
  assert.deepEqual(many.emails, ['a@a.com', 'b@b.com']);
  assert.deepEqual(many.phones.length, 2);
});

await step('regla: aprueba lo claro y devuelve a la cola solo lo dudoso', async () => {
  const base = { title: 'Closer high ticket', description: 'Buscamos closer para cerrar ventas del programa en el equipo comercial de la empresa.', location: 'Madrid, España', salary: '30.000 €/año', role: 'closer', score: 78, spain: true, verified_result: null, market: 'ES', market_basis: 'ubicacion_espana', red_flags: [] };
  assert.equal(judgeOffer(base).decision, 'approve');
  assert.equal(judgeOffer({ ...base, role: null }).why, 'sin_perfil');
  assert.equal(judgeOffer({ ...base, location: null, salary: null, market: null, market_basis: 'sin_senal' }).why, 'sin_mercado');
  assert.equal(judgeOffer({ ...base, score: 40 }).why, 'score_bajo');
  assert.equal(judgeOffer({ ...base, description: 'Apply now, our team is hiring a sales closer in Madrid.', spain: true }).why, 'idioma_dudoso');
  assert.equal(judgeOffer({ ...base, verified_result: 'closed' }).why, 'enlace_cerrado');
  assert.equal(judgeOffer({ ...base, red_flags: ['pide_inversion'] }).why, 'banderas_rojas');
  // Mercado en dólares: también se aprueba sola, con la misma exigencia de idioma y perfil.
  const usd = { ...base, location: 'Remoto', market: 'US_LATINO', market_basis: 'moneda_usd', salary: '3.000 USD/mes', spain: null };
  assert.equal(judgeOffer(usd).decision, 'approve');
});

for (const [s, n, m] of results) console.log(`${s}  ${n}${m ? '\n      ' + m : ''}`);
const failed = results.filter(r => r[0] === 'FAIL').length;
console.log(`\n${results.length - failed}/${results.length} pasos OK`);
process.exit(failed ? 1 : 0);
