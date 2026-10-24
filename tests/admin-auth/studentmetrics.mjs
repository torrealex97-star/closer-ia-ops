// Métricas de la alumna: node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/studentmetrics.mjs
import assert from 'node:assert/strict';
import { APP_XP, LEVEL_FLOORS, XP, applicationFunnel, masteryByScenario, xpAndLevel } from '../../apps/web/lib/studentMetrics';
import { REFER, readyToRefer, retention } from '../../apps/web/lib/studentDashboard';

const row = (kind, created_at, extra = {}) => ({ kind, ref: null, score: null, created_at, ...extra });
let n = 0; const ok = name => { n += 1; console.log(`PASS  ${name}`); };

// XP derivado: sin actividad es 0 y nivel 1; cada parte suma por separado.
const empty = xpAndLevel([], []);
assert.deepEqual([empty.xp, empty.level, empty.floor, empty.next], [0, 1, 0, 100]);
assert.equal(xpAndLevel([], null).xp, 0, 'sin poder leer las candidaturas no se inventan puntos');
const rows = [
  row('session', '2026-10-20T09:00:00Z'), row('session', '2026-10-20T18:00:00Z'), row('session', '2026-10-21T09:00:00Z'),
  row('training_review', '2026-10-20T10:00:00Z', { ref: 'precall' }), row('training_review', '2026-10-20T10:05:00Z', { ref: 'precall' }), row('training_review', '2026-10-20T10:10:00Z', { ref: 'star' }),
  row('training_review', '2026-10-20T10:15:00Z', { ref: 'modulo-falso' }),
  row('training_exam', '2026-10-21T10:00:00Z', { ref: 'final', score: 100 }),
  row('practice', '2026-10-21T11:00:00Z', { ref: 'venta-fria', score: 70 }),
];
const got = xpAndLevel(rows, ['applied', 'responded', 'draft']);
const part = id => got.parts.find(p => p.id === id).xp;
assert.equal(part('sessions'), 2 * XP.session, 'dos días distintos, no tres entradas');
assert.equal(part('modules'), 2 * XP.module, 'un módulo cuenta una vez y uno desconocido no cuenta');
assert.equal(part('exam'), XP.examPassed);
assert.equal(part('practice'), XP.practice + 7);
assert.equal(part('applications'), APP_XP.applied + APP_XP.responded, 'un borrador no puntúa');
assert.equal(got.xp, 10 + 40 + 100 + 17 + 55);
assert.deepEqual([got.level, got.floor, got.next], [2, 100, 250], '222 XP: nivel 2');
ok('XP y nivel derivados: sin duplicar días ni módulos, sin puntos por borradores');

// Antifraude: solo las tres primeras prácticas del día.
const spam = Array.from({ length: 10 }, (_, i) => row('practice', `2026-10-21T0${i}:00:00Z`, { ref: 'venta-fria', score: 100 }));
assert.equal(xpAndLevel(spam, []).parts.find(p => p.id === 'practice').xp, 3 * (XP.practice + 10));
assert.equal(xpAndLevel([...spam, row('practice', '2026-10-22T09:00:00Z', { ref: 'venta-fria', score: 0 })], []).parts.find(p => p.id === 'practice').xp, 3 * 20 + XP.practice, 'otro día vuelve a contar');
assert.equal(LEVEL_FLOORS.length, 8); assert.equal(xpAndLevel(Array.from({ length: 40 }, (_, d) => row('session', `2026-09-${String((d % 28) + 1).padStart(2, '0')}T09:00:00Z`)), ['offer', 'offer', 'offer', 'offer', 'offer', 'offer', 'offer', 'offer', 'offer', 'offer', 'offer', 'offer', 'offer', 'offer', 'offer', 'offer']).next, null, 'en el último nivel no hay siguiente');
ok('antifraude: tres prácticas por día y último nivel sin siguiente');

// Maestría por escenario.
const m = masteryByScenario([row('practice', 'x', { ref: 'a', score: 60 }), row('practice', 'x', { ref: 'a', score: 80 }), row('practice', 'x', { ref: 'b', score: 90 }), row('session', 'x', { ref: 'a', score: 5 }), row('practice', 'x', { ref: 'c' })]);
assert.deepEqual(m, [{ ref: 'a', count: 2, avg: 70, best: 80 }, { ref: 'b', count: 1, avg: 90, best: 90 }], 'solo prácticas con nota; sin nota no hay media inventada');
ok('maestría por escenario');

// Embudo de candidaturas y tasa de respuesta.
assert.equal(applicationFunnel([]).responseRate, null, 'sin enviadas no hay tasa');
assert.equal(applicationFunnel(['draft', 'opened', 'discarded']).responseRate, null, 'borradores no son enviadas');
const f = applicationFunnel(['draft', 'applied', 'applied', 'responded', 'interview', 'offer', 'rejected', 'discarded']);
assert.deepEqual([f.total, f.sent, f.responded, f.interviews, f.offers, f.rejected, f.responseRate], [8, 6, 4, 2, 1, 1, 67]);
ok('embudo de candidaturas: tasa de respuesta sobre enviadas y «—» sin enviadas');

// Retención y candidatas a derivar.
const now = new Date('2026-10-24T12:00:00Z');
const st = (id, status, created_at) => ({ id, email: `${id}@t.dev`, status, created_at });
const students = [st('a', 'active', '2026-07-01T00:00:00Z'), st('b', 'active', '2026-07-02T00:00:00Z'), st('c', 'active', '2026-10-20T00:00:00Z'), st('d', 'paused', '2026-07-01T00:00:00Z'), st('e', 'active', undefined)];
const sum = (over = {}) => ({ sessions: 0, last_seen: null, practice: { count: 0, avg: null }, training: { modules: [], examBest: null, examPassed: false }, apps: null, ...over });
const sums = new Map([['a', sum({ sessions: 2 })], ['b', sum()], ['c', sum({ sessions: 5 })], ['d', sum({ sessions: 5 })]]);
assert.deepEqual(retention(students, sums, 90, now), { minAgeDays: 90, eligible: 2, retained: 1, pct: 50 }, 'c es demasiado reciente, d está pausada y e no tiene fecha de alta');
assert.equal(retention(students, sums, 400, now).pct, null, 'sin alumnas con esa antigüedad no hay porcentaje');
const rich = sum({ sessions: 1, practice: { count: REFER.practices, avg: REFER.avg }, training: { modules: [], examBest: 100, examPassed: true }, apps: { sent: REFER.sent, responded: 1 } });
const ref = readyToRefer(students, new Map([['a', rich], ['b', { ...rich, apps: null }], ['c', { ...rich, practice: { count: 9, avg: 69 } }], ['d', rich]]));
assert.deepEqual(ref.map(r => r.id), ['a'], 'b no tiene candidaturas legibles, c no llega a la nota y d está pausada');
assert.equal(ref[0].reasons.length, 3);
ok('retención y candidatas a derivar: reglas explicables y huecos sin ceros falsos');
console.log(`\n${n}/${n} pasos OK`);
