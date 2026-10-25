// Agregación de actividad: node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/activity.mjs
import assert from 'node:assert/strict';
import { EXAM_PASS, riskOf, sanitizeDetail, summarize, teamSummary, weakestAxis } from '../../apps/web/lib/studentActivity.ts';

const at = (day, hour = 9) => new Date(Date.UTC(2026, 9, day, hour)).toISOString();
const event = (kind, extra = {}) => ({ id: crypto.randomUUID(), student_id: 's1', kind, ref: null, score: null, detail: {}, created_at: at(20), ...extra });
// Fecha fija: la racha depende de hoy, así que la prueba no puede depender del reloj real.
const now = Date.UTC(2026, 9, 22, 12);

// Sin señales: todo «—» (null), nunca 0 en la nota ni en el examen.
const empty = summarize([], now);
assert.deepEqual(empty, {
  sessions: 0, lastSeen: null,
  practice: { count: 0, last: null, best: null, average: null },
  training: { modules: [], lastReview: null, examBest: null, examPassed: false, examLast: null },
  streak: 0, axes: [], scenarios: [], weeks: [],
});

// Con señales: la última entrada manda; la práctica promedia solo las que tienen
// nota; los módulos son distintos; el examen se queda con la mejor nota.
const events = [
  event('session', { created_at: at(21, 10) }),
  event('session', { created_at: at(20, 8) }),
  event('practice', { ref: 'venta-fria', score: 60, created_at: at(20, 9), detail: { kind: 'venta', scores: { apertura: 60, descubrimiento: 50, objecion: 70, cierre: 60 } } }),
  event('practice', { ref: 'objeciones-precio', score: 80, created_at: at(21, 9), detail: { kind: 'venta', scores: { apertura: 80, descubrimiento: 70, objecion: 90, cierre: 80 } } }),
  event('practice', { ref: 'venta-fria', score: 90, created_at: at(22, 9), detail: { kind: 'venta', scores: { apertura: 90, descubrimiento: 80, objecion: 90, cierre: 100 } } }),
  event('practice', { ref: 'entrevista-closer', score: null, created_at: at(22, 11) }),
  event('training_review', { ref: 'precall', detail: { met: 4, total: 4 }, created_at: at(19) }),
  event('training_review', { ref: 'precall', detail: { met: 4, total: 4 }, created_at: at(21) }),
  event('training_review', { ref: 'logica', detail: { met: 2, total: 3 }, created_at: at(19) }),
  event('training_exam', { ref: 'final', score: 70, detail: { passed: false }, created_at: at(18) }),
  event('training_exam', { ref: 'final', score: 90, detail: { passed: true }, created_at: at(22) }),
];
const summary = summarize(events, now);
assert.equal(summary.sessions, 2);
assert.equal(summary.lastSeen, at(21, 10));
assert.deepEqual(summary.practice, { count: 3, last: at(22, 9), best: 90, average: 77 });
assert.deepEqual(summary.training.modules, ['logica', 'precall'], 'módulos distintos y ordenados');
assert.equal(summary.training.lastReview, at(21));
assert.equal(summary.training.examBest, 90);
assert.equal(summary.training.examPassed, true);
assert.equal(summary.training.examLast, at(22), 'la última corrección es la más reciente, no la mejor');
assert.equal(EXAM_PASS, 85);
assert.equal(summarize([event('training_exam', { score: 84 })], now).training.examPassed, false);
assert.equal(summarize([event('training_exam', { score: 85 })], now).training.examPassed, true);

// Racha: días consecutivos con práctica hasta hoy (o ayer si hoy no hay).
assert.equal(summary.streak, 3, '20, 21 y 22 con práctica');
// El día se corta en el calendario de Madrid, no en UTC: una práctica a las
// 00:30 del 23 en Madrid (22:30 UTC del 22) cuenta como el día 23.
const lateNight = [
  event('practice', { score: 70, created_at: new Date(Date.UTC(2026, 9, 22, 22, 30)).toISOString() }),
  event('practice', { score: 70, created_at: new Date(Date.UTC(2026, 9, 22, 8)).toISOString() }),
];
assert.equal(summarize(lateNight, Date.UTC(2026, 9, 23, 9)).streak, 2, '22 y 23 en Madrid, aunque en UTC las dos sean el 22');
assert.equal(summarize([event('practice', { score: 70, created_at: at(21) })], now).streak, 1, 'ayer también cuenta');
assert.equal(summarize([event('practice', { score: 70, created_at: at(19) })], now).streak, 0, 'una racha rota vale 0, no un dato viejo');
assert.equal(summarize([event('practice', { score: 70, created_at: at(20) }), event('practice', { score: 70, created_at: at(22) })], now).streak, 1, 'un hueco corta la racha');

// Competencias: media por criterio, solo ejes puntuados y en el orden de la rúbrica.
assert.deepEqual(summary.axes, [
  { id: 'apertura', label: 'Apertura y marco', average: 77, count: 3 },
  { id: 'descubrimiento', label: 'Descubrimiento', average: 67, count: 3 },
  { id: 'objecion', label: 'Objeciones', average: 83, count: 3 },
  { id: 'cierre', label: 'Cierre', average: 80, count: 3 },
]);
assert.deepEqual(summarize([event('practice', { score: 70, detail: {} })], now).axes, [], 'sin desglose no se inventan ejes');

// Situaciones: veces, media y última; la que no tiene nota queda con average null.
assert.deepEqual(summary.scenarios.map(s => [s.id, s.count, s.average]), [
  ['venta-fria', 2, 75],
  ['entrevista-closer', 1, null],
  ['objeciones-precio', 1, 80],
]);
assert.equal(summary.scenarios[0].last, at(22, 9));

// Evolución: semanas (lunes UTC), solo prácticas con nota y hasta seis.
assert.deepEqual(summary.weeks, [{ start: '2026-10-19', count: 3, average: 77 }]);
const spread = [at(1), at(8), at(15), at(22), at(21), at(20), at(19)].map((created_at, i) => event('practice', { score: 60 + i, created_at }));
assert.equal(summarize(spread, now).weeks.length, 4, 'máximo seis semanas, aquí cuatro');
assert.deepEqual(summarize(spread, now).weeks.map(w => w.start), ['2026-09-28', '2026-10-05', '2026-10-12', '2026-10-19'], 'semanas ordenadas de la más antigua a la más reciente');

// El detalle se recorta a claves conocidas y rechaza lo que no cabe.
assert.deepEqual(sanitizeDetail('practice', { turns: 6, axes: 4, texto: 'no se guarda' }), { turns: 6, axes: 4 });
assert.deepEqual(sanitizeDetail('practice', { turns: 99, axes: 0 }), {}, 'fuera de rango: se descarta');
assert.deepEqual(sanitizeDetail('practice', { kind: 'venta', scores: { apertura: 70, cierre: 60 } }), { kind: 'venta', scores: { apertura: 70, cierre: 60 } });
assert.deepEqual(sanitizeDetail('practice', { kind: 'otro', scores: { apertura: 70 } }), { scores: { apertura: 70 } }, 'un tipo que no es venta/entrevista se descarta');
assert.deepEqual(sanitizeDetail('practice', { scores: { inventado: 80, cierre: 101, claridad: '80', evidencia: 61.5, encaje: 55 } }), { scores: { encaje: 55 } }, 'solo ids de la rúbrica con enteros 0-100');
assert.deepEqual(sanitizeDetail('training_review', { met: 3 }), {}, 'sin total no se guarda met');
assert.deepEqual(sanitizeDetail('training_review', { met: 4, total: 3 }), {}, 'met > total no se guarda');
assert.deepEqual(sanitizeDetail('training_exam', { correct: 6, total: 6, passed: true }), { correct: 6, total: 6, passed: true });
assert.deepEqual(sanitizeDetail('training_exam', { passed: 'sí' }), {}, 'passed no booleano se descarta');
assert.deepEqual(sanitizeDetail('practice', { nota: 'x'.repeat(4000) }), {}, 'las claves desconocidas no se guardan');
assert.deepEqual(sanitizeDetail('practice', 'texto'), {});
assert.deepEqual(sanitizeDetail('practice', null), {});

// ---- Lectura de equipo (panel de la coordinadora) ----
// Sin alumnas no hay cifras que enseñar: null, no ceros.
const emptyTeam = teamSummary([], now);
assert.deepEqual(emptyTeam, {
  students: 0, practicing: 0, practiceTotal: 0, practiceAverage: null,
  axes: [], weakest: null, weakestScenario: null, weeks: [],
  inStreak: 0, needsHelp: 0, neverEntered: 0,
});

// Dos alumnas: una constante y otra con más volumen y peor nota. La media del
// equipo se pondera por prácticas (no media de medias) y el criterio débil sale
// de la misma ponderación.
const a = summarize([
  event('session', { student_id: 'a', created_at: at(22, 10) }),
  event('practice', { student_id: 'a', ref: 'venta-fria', score: 80, created_at: at(21, 9), detail: { scores: { apertura: 80, cierre: 60 } } }),
  event('practice', { student_id: 'a', ref: 'venta-fria', score: 80, created_at: at(22, 9), detail: { scores: { apertura: 80, cierre: 60 } } }),
], now);
const b = summarize(Array.from({ length: 6 }, (_, i) => event('practice', {
  student_id: 'b', ref: 'venta-fria', score: 60, created_at: at(20 + (i % 3), 8),
  detail: { scores: { apertura: 60, cierre: 90 } },
})), now);
const team = teamSummary([{ summary: a }, { summary: b }], now);
assert.equal(team.students, 2);
assert.equal(team.practicing, 2);
assert.equal(team.practiceTotal, 8);
assert.equal(team.practiceAverage, 65, '(80×2 + 60×6) / 8');
assert.deepEqual(team.axes.map(axis => [axis.id, axis.average, axis.practices, axis.students]), [
  ['apertura', 65, 8, 2],
  ['cierre', 83, 8, 2],
]);
assert.equal(team.weakest.id, 'apertura');
assert.deepEqual(team.weakestScenario, { id: 'venta-fria', count: 8, average: 65 });
assert.deepEqual(team.weeks, [{ start: '2026-10-19', count: 8, average: 65, students: 2 }]);
assert.equal(team.inStreak, 2, 'las dos practicaron al menos dos días seguidos (A: 2, B: 3)');
assert.equal(team.needsHelp, 1, 'la alumna B no tiene ninguna entrada');
assert.equal(team.neverEntered, 1);

// Seguimiento por uso, nunca por nota: una alumna constante con 60 no es «alerta»
// y otra con 90 que lleva diez días sin practicar sí.
assert.equal(riskOf(summarize([], now), now).id, 'sin_entrar');
assert.equal(riskOf(summarize([event('session', { created_at: at(22) })], now), now).id, 'sin_practicar');
assert.equal(riskOf(b, now).id, 'sin_entrar', 'sin entrada no hay seguimiento posible');
const stale = summarize([
  event('session', { created_at: at(22) }),
  event('practice', { score: 90, created_at: at(10), detail: { scores: { cierre: 90 } } }),
], now);
assert.equal(riskOf(stale, now).id, 'inactiva');
assert.equal(riskOf(stale, now).level, 'medio');
assert.equal(riskOf(a, now).id, 'practicando');
assert.equal(riskOf(a, now).level, 'ok');
assert.equal(weakestAxis(a).id, 'cierre');
assert.equal(weakestAxis(summarize([], now)), null, 'sin notas no hay criterio débil');

console.log('PASS  actividad: agregación por alumna, ejes, racha, semanas, examen, equipo y saneado del detalle');
