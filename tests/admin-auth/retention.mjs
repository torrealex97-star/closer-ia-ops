// Reglas de retención (solo cálculo):
// node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/retention.mjs
import assert from 'node:assert/strict';
import { directReview, idleNudge, sentThisWeek, weeklyGoals } from '../../apps/web/lib/studentRetention.ts';

const results = [];
const step = async (name, fn) => { try { await fn(); results.push(['PASS', name]); } catch (e) { results.push(['FAIL', name, e.message.split('\n')[0]]); } };
const NOW = new Date('2026-10-28T10:00:00Z'); // miércoles
const at = (day, time = '12:00:00') => `${day}T${time}Z`;
const practice = (day, score = 70) => ({ kind: 'practice', ref: 'cold_call', score, created_at: at(day) });
const session = day => ({ kind: 'session', ref: null, score: null, created_at: at(day) });

await step('sin ninguna práctica no es inactividad: «—», no un aviso', () => {
  assert.deepEqual(idleNudge([session('2026-10-27')], NOW), { level: 'none', idleDays: null, streakAtRisk: null });
});
await step('aviso preventivo a los 2 días y fuerte a los 4; hoy y ayer no avisan', () => {
  assert.equal(idleNudge([practice('2026-10-28')], NOW).level, 'none');
  assert.equal(idleNudge([practice('2026-10-27')], NOW).level, 'none');
  assert.equal(idleNudge([practice('2026-10-26')], NOW).level, 'soft');
  assert.equal(idleNudge([practice('2026-10-25')], NOW).level, 'soft');
  assert.equal(idleNudge([practice('2026-10-24')], NOW).level, 'strong');
  assert.equal(idleNudge([practice('2026-10-24')], NOW).idleDays, 4);
});
await step('la racha en juego solo se cita en el aviso preventivo y si existe', () => {
  const rows = [practice('2026-10-24'), practice('2026-10-25'), practice('2026-10-26')];
  assert.equal(idleNudge(rows, NOW).streakAtRisk, null); // hace 2 días: la racha cuenta hasta ayer → ya rota (current 0)
  const live = [practice('2026-10-26'), session('2026-10-27')];
  assert.equal(idleNudge(live, NOW).level, 'soft'); assert.equal(idleNudge(live, NOW).streakAtRisk, 2);
  assert.equal(idleNudge([practice('2026-10-20')], NOW).streakAtRisk, null);
});
await step('el día es el de Madrid: una práctica a las 23:30 UTC ya es del día siguiente', () => {
  const late = [{ kind: 'practice', ref: 'x', score: 70, created_at: '2026-10-26T23:30:00Z' }]; // 27-oct 00:30 en Madrid
  assert.equal(idleNudge(late, NOW).idleDays, 1);
});
await step('revisión directa: <60 en las tres últimas prácticas; una buena o solo dos no basta', () => {
  assert.equal(directReview([practice('2026-10-20', 50), practice('2026-10-21', 55), practice('2026-10-22', 40)]).eligible, true);
  assert.equal(directReview([practice('2026-10-20', 50), practice('2026-10-21', 80), practice('2026-10-22', 40)]).eligible, false);
  assert.equal(directReview([practice('2026-10-21', 55), practice('2026-10-22', 40)]).eligible, false);
  assert.equal(directReview([practice('2026-10-18', 90), practice('2026-10-20', 50), practice('2026-10-21', 55), practice('2026-10-22', 40)]).eligible, true); // las tres últimas
  assert.equal(directReview([practice('2026-10-20', 60), practice('2026-10-21', 55), practice('2026-10-22', 40)]).eligible, false); // 60 no es < 60
  assert.equal(directReview([]).eligible, false);
});
await step('objetivos de la semana: lunes a domingo de Madrid; candidaturas ilegibles = null, no 0', () => {
  const rows = [practice('2026-10-26'), practice('2026-10-27'), practice('2026-10-28'), practice('2026-10-25'), { kind: 'training_review', ref: 'precall', score: null, created_at: at('2026-10-27') }, { kind: 'training_review', ref: 'precall', score: null, created_at: at('2026-10-28') }];
  const [p, a, m] = weeklyGoals(rows, 2, NOW);
  assert.deepEqual([p.current, p.done, a.current, a.done, m.current, m.done], [3, true, 2, false, 1, true]); // el domingo 25 es de la semana pasada
  const unknown = weeklyGoals(rows, null, NOW)[1]; assert.equal(unknown.current, null); assert.equal(unknown.done, false);
  assert.equal(weeklyGoals([], 0, NOW).every(g => g.current === 0 && !g.done), true);
});
await step('candidaturas enviadas esta semana: por fecha de envío; borradores sin fecha no cuentan', () => {
  assert.equal(sentThisWeek([{ applied_at: at('2026-10-27') }, { applied_at: at('2026-10-20') }, { applied_at: null }], NOW), 1);
});

for (const [s, n, m] of results) console.log(s, ' ', n, m ?? '');
const bad = results.filter(r => r[0] === 'FAIL').length;
console.log(`\n${results.length - bad}/${results.length} pasos OK`);
process.exit(bad ? 1 : 0);
