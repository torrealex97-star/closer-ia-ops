// Puntuación y huella de ofertas: node --experimental-strip-types tests/admin-auth/score.mjs
import assert from 'node:assert/strict';
import { enrich, fingerprintOf } from '../../apps/web/lib/offerScore.ts';

const now = Date.parse('2026-10-16T12:00:00Z');
const best = enrich({ title: 'Closer High Ticket', company: 'Acme', location: 'Madrid, España', salary: '30.000 € brutos/año', posted_at: '2026-10-15', raw: { is_remote: true },
  description: 'Buscamos una persona con experiencia en ventas para el equipo comercial de la empresa. Comisiones altas. '.repeat(5) }, now);
const meh = enrich({ title: 'Asesor comercial', company: 'Beta', location: 'Sevilla, España', posted_at: '2026-10-08', description: 'Trabajo en la empresa con ventas para el cliente' }, now);
const abroad = enrich({ title: 'Closer', company: 'Gamma', location: 'Austin, Texas', posted_at: '2026-10-15', description: 'Closer needed for our sales team' }, now);
const noRole = enrich({ title: 'Desarrollador Backend', company: 'Delta', location: 'Madrid, España' }, now);
assert.equal(best.role, 'closer'); assert.equal(best.spain, true); assert.ok(best.score >= 90, `best=${best.score}`);
assert.ok(best.score > meh.score && meh.score > abroad.score, `${best.score} > ${meh.score} > ${abroad.score}`);
assert.equal(abroad.spain, false); assert.ok(abroad.score <= 30, `abroad=${abroad.score}`);
assert.equal(noRole.role, null); assert.ok(noRole.score < meh.score);
assert.ok(enrich({ title: 'Closer', location: null }, now).spain === null);
// Huella: la misma oferta con otra grafía/fuente coincide; empresa distinta o ciudad distinta no.
const a = fingerprintOf({ title: 'Closer de ventas (H/M)', company: 'Acme S.L.', location: 'Madrid, España' });
assert.equal(a, fingerprintOf({ title: 'closer de ventas', company: 'ACME', location: 'Madrid' }));
assert.notEqual(a, fingerprintOf({ title: 'Closer de ventas', company: 'Otra', location: 'Madrid' }));
assert.notEqual(a, fingerprintOf({ title: 'Closer de ventas', company: 'Acme', location: 'Barcelona' }));
assert.equal(fingerprintOf({ title: 'Closer', company: null }), null);
console.log('PASS  puntuación y huella: ordena mejor→peor y deduplica variantes');
