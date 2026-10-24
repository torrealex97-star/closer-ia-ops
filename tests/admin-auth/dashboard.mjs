// Panel de coordinación: node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/dashboard.mjs
import assert from 'node:assert/strict';
import { MIN_GROUP, funnel, moduleCoverage, needsNudge, scoreBuckets } from '../../apps/web/lib/studentDashboard';
import { REVIEW_REFS } from '../../apps/web/components/trainingRefs';

const student = (id, status = 'active') => ({ id, email: `${id}@t.dev`, status });
const sum = (over = {}) => ({ sessions: 1, last_seen: '2026-10-24T09:00:00Z', practice: { count: 0, avg: null }, training: { modules: [], examBest: null, examPassed: false }, ...over });
const students = [student('a'), student('b'), student('c'), student('d', 'invited'), student('p', 'paused')];
const summaries = new Map([
  ['a', sum({ practice: { count: 3, avg: 72 }, training: { modules: ['precall', 'star'], examBest: 100, examPassed: true } })],
  ['b', sum({ practice: { count: 1, avg: 35 } })],
  ['c', sum()],
  ['p', sum({ practice: { count: 9, avg: 90 } })], // pausada: no cuenta aunque tenga actividad
]);
let n = 0; const ok = name => { n += 1; console.log(`PASS  ${name}`); };

const steps = funnel(students, summaries);
assert.deepEqual(steps.map(s => [s.id, s.count]), [['invited', 4], ['entered', 3], ['practiced', 2], ['studied', 1], ['passed', 1]], 'las pausadas no cuentan; d (invitada) no ha entrado');
assert.deepEqual(steps.map(s => s.pct), [100, 75, 50, 25, 25]);
assert.deepEqual(funnel([], new Map()).map(s => s.pct), [null, null, null, null, null], 'sin alumnas el porcentaje es «—», no 0');
ok('embudo: pausadas fuera, porcentajes sobre las que tienen acceso y hueco sin alumnas');

const cover = moduleCoverage(students, summaries);
assert.equal(cover.length, REVIEW_REFS.length);
assert.deepEqual(cover.filter(c => c.count).map(c => [c.ref, c.count, c.pct]), [['precall', 1, 25], ['star', 1, 25]]);
ok('cobertura por módulo: solo cuenta alumnas con acceso');

assert.equal(scoreBuckets(students, summaries), null, `con menos de ${MIN_GROUP} alumnas con práctica no hay distribución`);
const five = [10, 45, 50, 71, 95].map((avg, i) => [student(`m${i}`), sum({ practice: { count: 1, avg } })]);
const group = students.concat(five.map(([st]) => st)); const gsum = new Map([...summaries, ...five.map(([st, su]) => [st.id, su])]);
const buckets = scoreBuckets(group, gsum);
assert.deepEqual(buckets.map(b => [b.id, b.count, b.pct]), [['low', 2, 29], ['mid', 2, 29], ['high', 3, 43]], 'siete notas (10, 35, 45, 50, 71, 72, 95); porcentajes sobre las que practicaron');
assert.equal(buckets.reduce((n, b) => n + b.count, 0), 7, 'la pausada (90) no entra y quien no practicó (c, nota null) no cuenta como un 0');
assert.ok(buckets.every(b => Number.isFinite(b.pct)), 'sin NaN');
// Cuatro activas que practican + una pausada: sin la pausada no se llega al grupo mínimo, así que no hay distribución.
const four = ['w', 'x', 'y', 'z'].map(id => [student(id), sum({ practice: { count: 1, avg: 60 } })]);
const withPaused = [...four.map(([st]) => st), student('q', 'paused')];
const wsum = new Map([...four.map(([st, su]) => [st.id, su]), ['q', sum({ practice: { count: 4, avg: 90 } })]]);
assert.equal(scoreBuckets(withPaused, wsum), null, 'una pausada no completa el grupo mínimo');
assert.equal(scoreBuckets([...four.map(([st]) => st), student('r')], new Map([...wsum, ['r', sum({ practice: { count: 1, avg: 80 } })]])).length, 3, 'con una activa más sí hay distribución');
assert.deepEqual(scoreBuckets(group.concat(student('m9')), new Map([...gsum, ['m9', sum()]])), buckets, 'una alumna más sin práctica no cambia la distribución');
ok('distribución de notas: umbral de grupo mínimo y sin ceros falsos');

const nudges = needsNudge(students, summaries);
assert.deepEqual(nudges.map(x => [x.id, x.reason]), [['c', 'Ha entrado, pero no ha practicado ni repasado nada'], ['d', 'Invitada, aún no ha entrado']]);
assert.ok(!nudges.some(x => x.id === 'p'), 'una pausada no necesita empujón');
assert.deepEqual(needsNudge([student('z')], new Map()).map(x => x.reason), ['No ha entrado en este periodo']);
ok('quién necesita un empujón: sin entrada, sin nada hecho, pausadas excluidas');
console.log(`\n${n}/${n} pasos OK`);
