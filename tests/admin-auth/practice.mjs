// Catálogo de la sala de práctica: cada situación visible tiene su personaje en el servidor y ninguna expone su prompt.
// node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/practice.mjs
import assert from 'node:assert/strict';
import { PRACTICE_SCENARIOS, scenarioById } from '../../apps/web/components/practiceScenarios.ts';
import { buildPersonaPrompt, axesFor, debriefInstructions, debriefSchema } from '../../apps/web/app/api/practice/prompts.ts';
import { analyzeSignals } from '../../apps/web/app/api/practice/signals.ts';

const results = [];
const step = async (name, fn) => { try { await fn(); results.push(['PASS', name]); } catch (e) { results.push(['FAIL', name, e.message.split('\n')[0]]); } };

await step('ids únicos y cada situación tiene todo lo que la UI muestra', () => {
  const ids = PRACTICE_SCENARIOS.map(s => s.id); assert.equal(new Set(ids).size, ids.length);
  for (const s of PRACTICE_SCENARIOS) {
    assert.ok(s.title && s.context && s.summary && s.opening && s.level, s.id);
    assert.ok(s.objectives.length >= 3 && s.objectives.length <= 5, `${s.id}: objetivos`);
    assert.ok(s.minutes >= 5 && s.minutes <= 12, `${s.id}: minutos`);
    assert.ok(['venta', 'entrevista'].includes(s.kind) && ['suave', 'real', 'dura'].includes(s.intensity), s.id);
    assert.equal(scenarioById(s.id), s);
  }
});
await step('todas tienen personaje en el servidor, con sus tres niveles y rúbrica', () => {
  for (const s of PRACTICE_SCENARIOS) {
    const prompt = buildPersonaPrompt(s, 1);
    assert.match(prompt, /Nivel 1: .+\n- Nivel 2: .+\n- Nivel 3: .+/, s.id);
    assert.match(prompt, /Te desarman: .+/, s.id); assert.ok(prompt.includes(s.objectives[0]), s.id);
    assert.ok(axesFor(s).length >= 4, `${s.id}: ejes`); assert.ok(debriefSchema(s), s.id);
  }
});
await step('el catálogo cubre los nichos y los entrevistadores pedidos, todo ficticio', () => {
  for (const id of ['venta-infoproducto', 'venta-saas-b2b', 'venta-clinica', 'venta-reformas', 'venta-fitness', 'entrevista-rrhh', 'entrevista-head-sales']) assert.ok(scenarioById(id), id);
  assert.equal(PRACTICE_SCENARIOS.filter(s => s.kind === 'venta').length, 10);
  assert.equal(PRACTICE_SCENARIOS.filter(s => s.kind === 'entrevista').length, 9);
  for (const s of PRACTICE_SCENARIOS.filter(x => /^venta-(infoproducto|saas|clinica|reformas|fitness)/.test(x.id))) assert.match(s.context, /fictici/i, `${s.id}: debe decir que es ficticia`);
});
await step('el servicio de la sala no promete resultados clínicos ni de ingresos en los textos visibles', () => {
  for (const s of PRACTICE_SCENARIOS) assert.ok(!/garantiz|100 % seguro|sin riesgo|ganar \d/i.test(`${s.summary} ${s.opening} ${s.objectives.join(' ')}`), s.id);
});

const say = content => ({ role: 'user', content });
await step('señales: apertura sumisa y entusiasmo de más, con cita literal y solo en venta', () => {
  const sumisa = analyzeSignals([say('Hola, disculpa que te moleste, gracias por tu tiempo. Te llamo por el software.')], 'venta');
  assert.ok(sumisa.some(s => s.id === 'sumision' && /disculpa|gracias por tu tiempo/i.test(s.quote)));
  const gushing = analyzeSignals([say('Hola Marta, ¿tienes dos minutos?'), say('¡Qué increíble lo que me cuentas! Me encanta tu proyecto.')], 'venta');
  assert.ok(gushing.some(s => s.id === 'entusiasmo' && /increíble|encanta/i.test(s.quote)));
  // En una entrevista «gracias por su tiempo» es cortesía normal, no una señal.
  assert.ok(!analyzeSignals([say('Buenos días, gracias por su tiempo. Me llamo Ana.')], 'entrevista').some(s => s.id === 'sumision'));
  // Una apertura firme no dispara ni una ni otra.
  assert.ok(!analyzeSignals([say('Hola Marta, soy Ana. ¿Tienes dos minutos para que te cuente por qué te llamo?')], 'venta').some(s => ['sumision', 'entusiasmo'].includes(s.id)));
  // Máximo tres señales por práctica, y todas con cita.
  const many = analyzeSignals([say('Disculpa, gracias por tu tiempo, bueno, ¡qué increíble!'), say('ok'), say('vale')], 'venta');
  assert.ok(many.length <= 3 && many.every(s => s.quote));
});
await step('el feedback pide una sola tarea de 24 horas, no varias prácticas', () => {
  for (const s of PRACTICE_SCENARIOS) assert.match(debriefInstructions(s), /next: una sola tarea para las próximas 24 horas/, s.id);
});

for (const [s, n, m] of results) console.log(s, ' ', n, m ?? '');
const bad = results.filter(r => r[0] === 'FAIL').length;
console.log(`\n${results.length - bad}/${results.length} pasos OK`);
process.exit(bad ? 1 : 0);
