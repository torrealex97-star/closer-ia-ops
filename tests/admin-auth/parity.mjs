// Comprueba que apps/web/lib/vocabulary.ts no se desvía del vocabulario del motor (worker.js).
// Uso: node --experimental-strip-types tests/admin-auth/parity.mjs
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import * as vocab from '../../apps/web/lib/vocabulary.ts';

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
assert.equal(vocab.roleFromTitle('Setter y Closer de Ventas'), 'closer');
assert.equal(vocab.roleFromTitle('Agente Comercial'), 'account_executive');
assert.equal(vocab.roleFromTitle('Desarrollador Backend'), null);
assert.equal(vocab.spainSignal('Closer', 'Madrid, España'), true);
assert.equal(vocab.spainSignal('Closer', 'Austin, Texas'), false);
assert.equal(vocab.spainSignal('Closer', null), null);
console.log('PASS  vocabulario del panel = vocabulario del motor');
