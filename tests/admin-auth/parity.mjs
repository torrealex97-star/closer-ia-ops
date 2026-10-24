// Comprueba que apps/web/lib/vocabulary.ts no se desvía del vocabulario del motor (worker.js).
// Uso: node --experimental-strip-types tests/admin-auth/parity.mjs
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import * as vocab from '../../apps/web/lib/vocabulary.ts';
import * as places from '../../apps/web/lib/esPlaces.ts';

const worker = readFileSync(new URL('../../sites/engine/worker.js', import.meta.url), 'utf8');
const grab = name => {
  const start = worker.indexOf(`const ${name} =`);
  const end = worker.indexOf('\n};', start) + 3;
  const block = worker.slice(start, name === 'ROLE_KEYWORDS' ? end : worker.indexOf('];', start) + 2);
  return new Function(`${block}; return ${name};`)();
};
assert.deepEqual(vocab.ROLE_KEYWORDS, grab('ROLE_KEYWORDS'), 'ROLE_KEYWORDS desviado del motor');
assert.deepEqual(vocab.ES_HINTS, grab('ES_HINTS'), 'ES_HINTS desviado del motor');
assert.deepEqual(vocab.NON_ES_HINTS, grab('NON_ES_HINTS'), 'NON_ES_HINTS desviado del motor');
// El gazetteer es un literal de plantilla: se corta hasta su cierre y se compara lista a lista.
const grabPlaces = () => {
  const start = worker.indexOf('const ES_PLACES = `');
  const end = worker.indexOf('`.split(', start);
  assert.ok(start > 0 && end > start, 'ES_PLACES no está en el worker');
  return worker.slice(start + 'const ES_PLACES = `'.length, end).split('\n');
};
assert.deepEqual(places.ES_PLACES, grabPlaces(), 'el gazetteer de España está desviado del motor');
assert.equal(vocab.roleFromTitle('Setter y Closer de Ventas'), 'closer');
assert.equal(vocab.roleFromTitle('Agente Comercial'), 'account_executive');
assert.equal(vocab.roleFromTitle('Desarrollador Backend'), null);
assert.equal(places.spainSignal('Closer', 'Madrid, España'), true);
assert.equal(places.spainSignal('Closer', 'Austin, Texas'), false);
assert.equal(places.spainSignal('Closer', null), null);
// Municipios que antes se perdían: la ubicación manda, no el título ni la descripción.
for (const city of ['Boiro', 'O Chazo, Boiro', 'Marzán, O Rosal', 'Carballedo', 'Crémenes', 'Uña', 'Salou', 'Alcobendas', 'Murcia', 'Comunidad de Madrid']) {
  assert.equal(places.spainSignal('Closer de ventas', city), true, city);
}
assert.equal(places.spainSignal('Closer', 'Córdoba, Argentina'), true, 'sin país extranjero en la ubicación, Córdoba es España');
assert.equal(places.spainSignal('Closer', 'Austin, Texas'), false);
// «una» es una palabra española corriente: el gazetteer solo mira la ubicación, nunca el título.
assert.equal(places.spainSignal('Closer para una empresa', 'Lisboa'), false, 'la palabra «una» no basta');
assert.equal(places.placeInSpain('Ourense'), true);
assert.equal(places.placeInSpain('Lisboa'), false);
assert.equal(places.placeInSpain(null), false);
console.log('PASS  vocabulario y gazetteer del panel = los del motor');
