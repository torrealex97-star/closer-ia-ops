// Actividad y progreso de la alumna: node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/activity.mjs
import assert from 'node:assert/strict';
import { achievements, allowWrite, checkActivity, EXAM_TOTAL, madridDay, mondayOf, periodDays, REVIEW_REFS, streaks, summarize } from '../../apps/web/lib/studentActivity';
import { FINAL_EXAM } from '../../apps/web/components/trainingContent';

const at = iso => ({ created_at: iso });
const row = (kind, iso, extra = {}) => ({ kind, ref: null, score: null, detail: {}, created_at: iso, ...extra });
let n = 0; const ok = name => { n += 1; console.log(`PASS  ${name}`); };

// 1. Validación: lo que acepta y lo que no (el navegador nunca fija la nota del examen).
assert.equal(EXAM_TOTAL, 6);
assert.equal(checkActivity(null).ok, false);
assert.equal(checkActivity({ kind: 'session' }).ok, false, 'la entrada la crea el login, no el navegador');
assert.equal(REVIEW_REFS.length, 8, 'cinco ejercicios, los diez cierres, los nueve pasos y el banco de entrevista');
assert.equal(checkActivity({ kind: 'training_review', ref: 'modulo-falso', detail: { met: 1, total: 1 } }).ok, false);
assert.equal(checkActivity({ kind: 'training_review', ref: 'precall', detail: { met: 5, total: 4 } }).ok, false, 'más cumplidos que criterios');
assert.equal(checkActivity({ kind: 'training_review', ref: 'descubrimiento', detail: { met: 4, total: 5 } }).ok, true);
assert.equal(checkActivity({ kind: 'training_exam', ref: 'final', score: 101 }).ok, false);
assert.equal(checkActivity({ kind: 'training_exam', ref: 'final', score: 100 }).ok, false, 'sin respuestas no hay nota');
assert.equal(checkActivity({ kind: 'training_exam', ref: 'final', detail: { correct: 6, total: 6 } }).ok, false, 'un recuento del navegador ya no vale: hacen falta las respuestas');
const key = Object.fromEntries(FINAL_EXAM.filter(q => q.type === 'multiple').map(q => [q.id, q.correctAnswer]));
const wrongTwo = Object.fromEntries(Object.entries(key).map(([id, v], i) => [id, i < 2 ? 'respuesta inventada' : v]));
const forged = checkActivity({ kind: 'training_exam', ref: 'final', score: 100, detail: { answers: wrongTwo, correct: 6, total: 6, passed: true } });
assert.ok(forged.ok); assert.equal(forged.value.score, 67, '4 de 6 acertadas; ni el score ni el recuento del navegador cuentan'); assert.equal(forged.passed, false); assert.equal(forged.value.detail.passed, false);
const full = checkActivity({ kind: 'training_exam', ref: 'final', score: 0, detail: { answers: key } });
assert.ok(full.ok); assert.equal(full.value.score, 100); assert.equal(full.passed, true);
assert.equal(checkActivity({ kind: 'training_exam', ref: 'final', detail: { answers: {} } }).value.score, 0, 'sin responder es 0, no un error');
assert.equal(checkActivity({ kind: 'practice', ref: 'precio', detail: {} }).ok, false, 'la práctica exige nota');
const practice = checkActivity({ kind: 'practice', ref: 'precio', score: 70, detail: { axes: { empatia: 80, 'x y': 5, cierre: 999 }, difficulty: 'Media', mode: 'voz', extra: 'no' } });
assert.ok(practice.ok); assert.deepEqual(practice.value.detail, { axes: { empatia: 80 }, difficulty: 'Media', mode: 'voz' }, 'solo ejes válidos y campos conocidos');
ok('validación: el servidor decide la nota del examen y descarta lo que no reconoce');

// 2. Día y semana en Madrid, no en UTC.
assert.equal(madridDay('2026-10-24T22:30:00Z'), '2026-10-25', '00:30 en Madrid ya es el día siguiente');
assert.equal(madridDay('2026-10-24T21:30:00Z'), '2026-10-24');
assert.equal(mondayOf('2026-10-25'), '2026-10-19'); assert.equal(mondayOf('2026-10-19'), '2026-10-19');
ok('el día y la semana son los de Europe/Madrid');

// 3. Racha: consecutiva hasta hoy (o ayer), la mejor de siempre aparte.
const now = new Date('2026-10-24T10:00:00Z');
assert.deepEqual(streaks([], now), { current: 0, best: 0 });
assert.deepEqual(streaks([at('2026-10-24T08:00:00Z'), at('2026-10-23T08:00:00Z'), at('2026-10-22T08:00:00Z')], now), { current: 3, best: 3 });
assert.deepEqual(streaks([at('2026-10-23T08:00:00Z'), at('2026-10-22T08:00:00Z')], now), { current: 2, best: 2 }, 'si hoy aún no hay actividad, la racha de ayer sigue viva');
assert.deepEqual(streaks([at('2026-10-20T08:00:00Z'), at('2026-10-12T08:00:00Z'), at('2026-10-11T08:00:00Z'), at('2026-10-10T08:00:00Z')], now), { current: 0, best: 3 });
assert.deepEqual(streaks([at('2026-10-23T22:30:00Z'), at('2026-10-23T08:00:00Z')], now), { current: 2, best: 2 }, 'las 22:30 UTC del 23 son del 24 en Madrid');
ok('racha actual y mejor racha');

// 4. Resumen: ventana, «de siempre», huecos y logros.
const rows = [
  row('training_exam', '2026-10-24T09:00:00Z', { ref: 'final', score: 33, detail: { passed: false } }),
  row('practice', '2026-10-23T09:00:00Z', { ref: 'precio', score: 80, detail: { axes: { empatia: 90, cierre: 70 } } }),
  row('practice', '2026-10-22T09:00:00Z', { ref: 'tiempo', score: 60, detail: { axes: { empatia: 70 } } }),
  row('training_exam', '2026-10-21T09:00:00Z', { ref: 'final', score: 100, detail: { passed: true } }),
  ...REVIEW_REFS.map((ref, i) => row('training_review', `2026-10-${String(20 - i).padStart(2, '0')}T09:00:00Z`, { ref, detail: { met: 3, total: 3 } })),
  row('session', '2026-10-24T08:00:00Z'), row('session', '2026-08-01T08:00:00Z'),
  row('practice', '2026-07-01T09:00:00Z', { ref: 'viejo', score: 40 }),
].sort((a, b) => b.created_at.localeCompare(a.created_at));
const week = summarize(rows, 7, now);
assert.equal(week.sessions, 1, 'solo la entrada de la semana');
assert.equal(week.practice.count, 2); assert.equal(week.practice.avg, 70); assert.equal(week.practice.best, 80);
assert.equal(week.training.examBest, 100); assert.equal(week.training.examPassed, true, 'el mejor intento cuenta');
assert.deepEqual(week.axes, [{ axis: 'empatia', avg: 80 }, { axis: 'cierre', avg: 70 }]);
assert.equal(week.recent[0].kind, 'training_exam'); assert.equal(week.recent[0].score, 33, 'lo más reciente primero');
const all = summarize(rows, 90, now);
assert.equal(week.lifetime.practice.count, 3, 'el resumen de siempre no depende del periodo'); assert.equal(all.lifetime.practice.count, 3);
assert.equal(week.lifetime.training.modules.length, REVIEW_REFS.length);
const byId = Object.fromEntries(week.lifetime.achievements.map(a => [a.id, a.unlocked]));
assert.equal(byId.first_practice, true); assert.equal(byId.five_practices, false); assert.equal(byId.training_complete, true); assert.equal(byId.exam_passed, true);
assert.equal(week.weekly.length, 6); assert.equal(week.weekly.at(-1).week, '2026-10-19');
assert.equal(week.weekly.at(-1).avg, 70, 'media de la semana en curso'); assert.equal(week.weekly[0].avg, null, 'una semana sin prácticas es un hueco, no un 0');
const empty = summarize([], 30, now);
assert.equal(empty.practice.avg, null); assert.equal(empty.training.examBest, null); assert.equal(empty.last_seen, null); assert.equal(empty.streak.current, 0);
assert.ok(achievements(empty.lifetime, empty.streak).every(a => !a.unlocked));
ok('resumen: ventana, de siempre, huecos sin ceros falsos y logros');

// 5. Periodo y tope de escritura.
assert.equal(periodDays('7'), 7); assert.equal(periodDays('45'), 30); assert.equal(periodDays(undefined, 90), 90);
const t0 = 1_000_000; for (let i = 0; i < 60; i++) assert.equal(allowWrite('s-1', t0 + i), true);
assert.equal(allowWrite('s-1', t0 + 100), false, 'más de 60 en 10 minutos se frena'); assert.equal(allowWrite('s-2', t0 + 100), true, 'cada alumna tiene su cupo');
assert.equal(allowWrite('s-1', t0 + 11 * 60_000), true, 'el cupo se renueva');
ok('periodos permitidos y tope de escritura por alumna');
console.log(`\n${n}/${n} pasos OK`);
