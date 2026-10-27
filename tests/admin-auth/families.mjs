// El panel cruza los conectores del motor con los portales del catálogo. Antes lo hacía por código exacto,
// así que «Himalayas · Fuera del cloud» salía mientras himalayas-closer la recogía. Esta prueba fija el
// cruce por familia y la suma de cifras (y que un conector caído no se disuelva en un «completada»).
// Uso: node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/families.mjs
import assert from 'node:assert/strict';
import { catalogCodeFor, groupByFamily } from '../../apps/web/lib/sourceFamilies.ts';

const results = [];
const step = (name, fn) => { try { fn(); results.push(['PASS', name]); } catch (e) { results.push(['FAIL', name, e.message.split('\n')[0]]); } };

step('cada conector del motor cae en su portal del catálogo', () => {
  assert.equal(catalogCodeFor('himalayas-closer'), 'himalayas');
  assert.equal(catalogCodeFor('himalayas'), 'himalayas');
  assert.equal(catalogCodeFor('freehire-closer'), 'freehire');
  assert.equal(catalogCodeFor('freehire-latam-closer'), 'freehire');
  assert.equal(catalogCodeFor('freehire-latam'), 'freehire');
  assert.equal(catalogCodeFor('jobtoday-closer-ciudades'), 'jobtoday');
  assert.equal(catalogCodeFor('jobtoday'), 'jobtoday');
  assert.equal(catalogCodeFor('getonbrd'), 'getonbrd');
  // Lo que no es una familia conocida se queda como está (no se inventa un portal).
  assert.equal(catalogCodeFor('ats-teamtailor-monestcapital'), 'ats-teamtailor-monestcapital');
  assert.equal(catalogCodeFor('monestcapital'), 'monestcapital');
});

const row = (code, patch = {}) => ({ code, name: code, run_status: 'completed', fetched: 10, catalog: 5, eligible: 1, selected: 0, warning: null, ...patch });

step('las cifras del portal suman las de todos sus conectores', () => {
  const fam = groupByFamily([
    row('himalayas-closer', { fetched: 20, catalog: 12, eligible: 3 }),
    row('freehire', { fetched: 278, catalog: 851, eligible: 19 }),
    row('freehire-closer', { fetched: 11, catalog: 9, eligible: 3 }),
  ]);
  const him = fam.get('himalayas');
  assert.equal(him.connectors, 1);
  assert.equal(him.fetched, 20);
  const free = fam.get('freehire');
  assert.equal(free.connectors, 2, 'freehire y freehire-closer son el mismo portal');
  assert.equal(free.fetched, 289);
  assert.equal(free.catalog, 860);
  assert.equal(free.eligible, 22);
  assert.deepEqual(free.connectors_detail.map(c => c.code), ['freehire', 'freehire-closer']);
});

step('un conector caído deja el portal «con fallo», no «completada»', () => {
  const fam = groupByFamily([
    row('jobtoday-vendedor', { run_status: 'completed' }),
    row('jobtoday-closer-remoto', { run_status: 'failed', warning: 'HTTP 410' }),
    row('jobtoday-asesor-de-ventas', { run_status: 'deferred', warning: 'Aplazada' }),
  ]);
  const jt = fam.get('jobtoday');
  assert.equal(jt.connectors, 3);
  assert.equal(jt.run_status, 'failed');
  assert.match(jt.warning, /HTTP 410/);
  assert.match(jt.warning, /Aplazada/);
});

step('una recogida desconocida no falsea el estado (— sigue siendo —)', () => {
  const fam = groupByFamily([row('himalayas-closer', { run_status: null, fetched: null })]);
  const him = fam.get('himalayas');
  assert.equal(him.run_status, null);
  assert.equal(him.fetched, null);
});

for (const [status, name, message] of results) console.log(`${status}  ${name}${message ? '\n      ' + message : ''}`);
const failed = results.filter(r => r[0] === 'FAIL').length;
console.log(`\n${results.length - failed}/${results.length} pasos OK`);
process.exit(failed ? 1 : 0);
