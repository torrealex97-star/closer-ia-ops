// Corrección determinista de la formación: node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/training.mjs
import assert from 'node:assert/strict';
import {
  freezingFalls, gradeExam, moralFor, parseAmount, reviewCloseLine, reviewFreezing,
  reviewFreezingReply, reviewLogica, reviewPreCall, reviewYellows, yellowMistakes,
} from '../../apps/web/components/trainingCheck';
import { FINAL_EXAM, LOGICA, PRE_CALL_STEPS } from '../../apps/web/components/trainingContent';

// Formato español: el punto es de miles y la coma decimal.
assert.equal(parseAmount('3.200'), 3200);
assert.equal(parseAmount('192.000'), 192000);
assert.equal(parseAmount('192000'), 192000);
assert.equal(parseAmount('3.200,50'), 3200.5);
assert.equal(parseAmount('16 meses'), 16);
assert.equal(parseAmount('5000 €'), 5000);
assert.equal(parseAmount('mucho'), null, 'sin número no hay cantidad');
assert.equal(parseAmount(''), null);

// Cada paso de la secuencia trae un ejemplo bueno que cumple sus criterios y uno
// malo que no. Si el contenido cambia de forma incompatible, esto lo detecta.
for (const step of PRE_CALL_STEPS) {
  const good = reviewPreCall(step.id, step.exampleGood);
  const bad = reviewPreCall(step.id, step.exampleBad);
  assert.equal(good.met, good.total, `el ejemplo bueno de ${step.id} debería cumplir todo: ${JSON.stringify(good.criteria.filter(c => !c.ok))}`);
  assert.ok(bad.met < bad.total, `el ejemplo malo de ${step.id} no debería cumplir todo`);
  assert.equal(good.ratio, 100);
}
const apology = reviewPreCall('5min', 'Perdona por molestar, soy Ana. El martes a las 10:00 te llamo, ¿te viene bien?');
assert.equal(apology.criteria.find(item => item.id === 'tono').ok, false, 'detecta la sumisión');
assert.match(apology.criteria.find(item => item.id === 'tono').detail, /Sumisión/);
const long = reviewPreCall('1h', `${'Nos vemos en una hora con el enlace de Zoom. '.repeat(12)}¿Confirmas?`);
assert.equal(long.criteria.find(item => item.id === 'longitud').ok, false, 'un mensaje de 500 caracteres no es un mensaje');

// Venta lógica: las tres cuentas y la frase que no pide aprobación.
const ok = reviewLogica({ brecha: '3.200', coste: '192.000', meses: '16' });
assert.equal(ok.met, 3);
assert.deepEqual(ok.fields, { brecha: true, coste: true, meses: true });
const wrong = reviewLogica({ brecha: '3.200', coste: '19.200', meses: '16' });
assert.equal(wrong.fields.coste, false);
assert.match(wrong.criteria.find(item => item.id === 'coste').detail, /192\.000/);
assert.equal(reviewLogica({ brecha: '', coste: '', meses: '' }).met, 0);

const close = reviewCloseLine('Tienes dos caminos: seguir igual con 1.800 € al mes o empezar. En cinco años la diferencia son 192.000 €. Tú eliges.');
assert.equal(close.met, 3, 'cita la cifra, plantea los dos caminos y no pide aprobación');
const filler = reviewCloseLine(`Son ${LOGICA.expected.coste} € de diferencia. ¿Qué te parece?`);
assert.equal(filler.criteria.find(item => item.id === 'silencio').ok, false);
assert.equal(filler.criteria.find(item => item.id === 'disyuntiva').ok, false);

// Anti-freezing: marcas explícitas, sin analizar la voz.
const calm = reviewFreezingReply('Tienes razón, es razonable que sientas eso. Y al mismo tiempo, lo que también es cierto es que me has llamado tú. ¿Qué te hizo llamar?');
assert.deepEqual(
  { accepted: calm.accepted, validated: calm.validated, looping: calm.looping, calm: calm.calm, asked: calm.asked, defensive: calm.defensive, usedPero: calm.usedPero },
  { accepted: true, validated: true, looping: true, calm: true, asked: true, defensive: false, usedPero: false },
);
assert.equal(reviewFreezingReply('No es así, te equivocas.').defensive, true);
assert.equal(reviewFreezingReply('Entiendo que lo veas así, pero no es verdad.').usedPero, true);
const sustained = reviewFreezing(Array.from({ length: 5 }, () => 'De acuerdo contigo, es razonable. Y al mismo tiempo, ¿qué te frena?'));
assert.equal(sustained.met, sustained.total, 'cinco respuestas de protocolo sostienen todos los criterios');
const defended = Array.from({ length: 5 }, () => 'No es así, te equivocas.');
assert.equal(reviewFreezing(defended).criteria.find(item => item.id === 'defensa').ok, false);
assert.equal(freezingFalls(defended), 5);
assert.equal(freezingFalls(['De acuerdo contigo, es razonable.']), 0);
assert.equal(moralFor(0).level, 'Alta');
assert.equal(moralFor(1).level, 'Media');
assert.equal(moralFor(2).level, 'Baja');
assert.equal(moralFor(9).tone, 'bajo');

// Yellows: preguntas, concreción y longitud. El bloqueo cuenta lo mismo que la revisión.
const yellows = reviewYellows(['¿Cuánto facturas al mes exactamente?', 'Dame un ejemplo concreto de esta semana.']);
assert.equal(yellows.met, 3);
const noQuestion = reviewYellows(['Te cuento cómo funciona.', '¿Cuánto facturas?']);
assert.equal(noQuestion.criteria.find(item => item.id === 'pregunta').ok, false);
assert.match(noQuestion.criteria.find(item => item.id === 'pregunta').detail, /1 de 2/);
assert.equal(reviewYellows([`${'palabra '.repeat(60)}¿qué tal?`]).criteria.find(item => item.id === 'monologo').ok, false);
assert.equal(yellowMistakes(['Te cuento.', '¿Y eso?', 'Vale.']), 2);

// Examen: 85 % con seis respuestas únicas exige acertarlas todas.
const multiple = FINAL_EXAM.filter(question => question.type === 'multiple');
assert.equal(multiple.length, 6);
const perfect = Object.fromEntries(multiple.map(question => [question.id, question.correctAnswer]));
assert.deepEqual(gradeExam(perfect), { correct: 6, total: 6, score: 100, passed: true, wrong: [] });
const five = { ...perfect, [multiple[0].id]: multiple[0].options.find(option => option !== multiple[0].correctAnswer) };
const graded = gradeExam(five);
assert.equal(graded.score, 83);
assert.equal(graded.passed, false);
assert.deepEqual(graded.wrong, [multiple[0].id]);
assert.equal(gradeExam({}).passed, false);
assert.equal(gradeExam({}).score, 0);

console.log('PASS  formación: formato de cifras, criterios de los seis ejercicios, moral y examen 85 %');
