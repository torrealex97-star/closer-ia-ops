// Spike de voz — pruebas deterministas sin red: node spikes/voice/tests/voice.mjs
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { scriptedLLM, downLLM } from '../providers.mjs';
import { runSession, LIMITS } from '../session.mjs';
import { buildFeedback } from '../feedback.mjs';

const dir = new URL('../personalities/', import.meta.url);
const personalities = Object.fromEntries(readdirSync(dir).filter(f => f.endsWith('.json')).map(f => { const p = JSON.parse(readFileSync(new URL(f, dir), 'utf8')); return [p.id, p]; }));
const results = []; const step = async (name, fn) => { try { await fn(); results.push(['PASS', name]); } catch (e) { results.push(['FAIL', name, e.message.split('\n')[0]]); } };
const cliente = personalities['cliente-esceptico'], entrev = personalities['entrevistador-agencia'];

await step('personalidades válidas: id único, reglas y rúbrica compilables', async () => {
  assert.ok(Object.keys(personalities).length >= 2);
  for (const p of Object.values(personalities)) { assert.ok(p.id && p.opening && p.rubric.length >= 3 && p.fallback.length); for (const r of [...p.rules.map(x => x.when), ...p.rubric.map(x => x.evidence)]) new RegExp(r, 'i'); }
});
await step('el feedback SOLO cita fragmentos literales de lo que dijo la alumna', async () => {
  const s = await runSession({ personality: cliente, llm: scriptedLLM(cliente), learnerTurns: ['Hola, ¿qué objetivos tenéis este trimestre?', 'El precio incluye resultados: un caso con ROI del 3x', '¿Agendamos una llamada el jueves?'] });
  const f = buildFeedback(s, cliente);
  assert.equal(f.observed, 3); assert.equal(f.total, 3);
  const said = s.transcript.filter(t => t.role === 'user');
  for (const i of f.items) { assert.equal(i.status, 'observado'); assert.ok(said.some(t => t.n === i.turn && t.text.includes(i.quote)), `cita inexistente: ${i.quote}`); }
});
await step('sin evidencia = «no observado» (no «malo») y sin cita ni puntuación', async () => {
  const s = await runSession({ personality: cliente, llm: scriptedLLM(cliente), learnerTurns: ['Buenas tardes', 'Gracias por su tiempo'] });
  const f = buildFeedback(s, cliente);
  assert.equal(f.observed, 0); assert.ok(f.items.every(i => i.status === 'no_observado' && i.quote === null && i.turn === null));
  assert.ok(!('score' in f), 'no se inventa una puntuación');
});
await step('cambiar de personalidad no cambia el código: la misma sesión se adapta (venta vs entrevista)', async () => {
  const s = await runSession({ personality: entrev, llm: scriptedLLM(entrev), learnerTurns: ['Tengo tres años de experiencia', 'Cerraba un 25 % con un ratio de conversión estable', 'Ante una objeción escucho y pregunto por el valor'] });
  assert.equal(s.transcript[0].text, entrev.opening); assert.match(s.transcript[2].text, /cifra de cierre/);
  const f = buildFeedback(s, entrev); assert.equal(f.observed, 2); assert.equal(f.items.find(i => i.id === 'organizacion').status, 'no_observado');
});
await step('proveedor caído: se DECLARA, no se inventa respuesta y el informe lo dice', async () => {
  const s = await runSession({ personality: cliente, llm: downLLM, learnerTurns: ['¿Qué necesitas?', 'otra'] });
  assert.equal(s.error, 'proveedor_no_disponible'); assert.equal(s.transcript.filter(t => t.role === 'assistant').length, 1, 'solo la apertura');
  const f = buildFeedback(s, cliente); assert.equal(f.incomplete, true); assert.match(f.note, /interrumpió/);
});
await step('tope de coste por sesión: corta y lo declara', async () => {
  const many = Array.from({ length: LIMITS.maxTurns + 5 }, (_, i) => `intervención ${i}?`);
  const s = await runSession({ personality: cliente, llm: scriptedLLM(cliente), learnerTurns: many });
  assert.equal(s.truncated, true); assert.equal(s.transcript.filter(t => t.role === 'user').length, LIMITS.maxTurns);
  assert.equal(buildFeedback(s, cliente).incomplete, true);
});
for (const [s, n, m] of results) console.log(`${s}  ${n}${m ? '\n      ' + m : ''}`);
const failed = results.filter(r => r[0] === 'FAIL').length; console.log(`\n${results.length - failed}/${results.length} pasos OK`); process.exit(failed ? 1 : 0);
