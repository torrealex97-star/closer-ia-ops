import { test, expect } from '@playwright/test';
import { analyzeSignals } from '../../apps/web/app/api/practice/signals';
import type { PracticeTurn } from '../../apps/web/app/api/practice/signals';
import { cleanDebrief } from '../../apps/web/app/api/practice/debrief';
import { stageFor } from '../../apps/web/app/api/practice/prompts';
import { scenarioById } from '../../apps/web/components/practiceScenarios';

// Estas pruebas no abren navegador: importan los módulos puros que usa la ruta.
// Las señales no dependen del modelo y deben ser estables palabra por palabra.
const say = (content: string): PracticeTurn => ({ role: 'user', content });
const them = (content: string): PracticeTurn => ({ role: 'coach', content });

test('el «pero» después de validar se detecta con su frase literal', () => {
  const turns = [them('Es caro.'), say('Entiendo que es caro, pero no veo claro qué incluye.')];
  const signals = analyzeSignals(turns, 'venta');
  const signal = signals.find(item => item.id === 'pero');
  expect(signal).toBeTruthy();
  expect(signal!.label).toBe('Validaste con «pero»');
  expect(signal!.quote).toContain('pero');
  expect(signal!.quote).toContain('Entiendo que es caro');
});

test('«este jueves» no es una muletilla; un «bueno» de verdad sí', () => {
  const limpia = analyzeSignals([say('Te propongo una reunión de quince minutos este jueves a las 10:00.')], 'venta');
  expect(limpia.map(item => item.id)).not.toContain('relleno');
  const rellena = analyzeSignals([say('Bueno, te llamo para ver cómo lo lleváis.')], 'venta');
  expect(rellena.map(item => item.id)).toContain('relleno');
});

test('el relleno después del precio va primero y cita lo que se dijo', () => {
  const turns = [say('La inversión son 3.000 €. Bueno, ¿qué te parece?')];
  const signals = analyzeSignals(turns, 'venta');
  expect(signals[0].id).toBe('stfu');
  expect(signals[0].label).toBe('Relleno después del precio');
  expect(signals[0].quote.toLowerCase()).toContain('bueno');
});

test('una conversación sin siguiente paso lo señala; una con día y hora no', () => {
  const abierta = [say('¿Cómo lo gestionáis ahora?'), say('Entiendo, tiene sentido.'), say('Me gustaría entender el detalle.')];
  expect(analyzeSignals(abierta, 'venta').map(item => item.id)).toContain('sin-paso');
  const cerrada = [...abierta, say('Te propongo una reunión de quince minutos el jueves a las 10:00.')];
  expect(analyzeSignals(cerrada, 'venta').map(item => item.id)).not.toContain('sin-paso');
});

test('en una entrevista sin preguntas se avisa, y nunca se devuelven más de tres señales', () => {
  const turns = [
    them('Cuéntame tu experiencia.'),
    say('Llevo tres años en ventas.'),
    say('Sé usar el CRM.'),
    say('Sí.'),
  ];
  const signals = analyzeSignals(turns, 'entrevista');
  expect(signals.map(item => item.id)).toContain('sin-preguntas');
  expect(signals.length).toBeLessThanOrEqual(3);
  expect(new Set(signals.map(item => item.id)).size).toBe(signals.length);
});

test('la puntuación global es la media de los ejes y la cita inventada se descarta', () => {
  const scenario = scenarioById('venta-fria')!;
  const literal = 'he visto que perdéis seguimientos';
  const raw = JSON.stringify({
    summary: 'Resumen de la práctica.',
    focus: 'Cerrar con día y hora.',
    strengths: ['Preguntas'],
    improvements: ['Concretar el cierre'],
    axes: [
      { id: 'apertura', score: 80, note: 'Buena apertura.', quote: literal },
      { id: 'descubrimiento', score: 60, note: 'Falta cifra.', quote: 'Esto no lo dijo la alumna en ningún momento' },
      { id: 'objecion', score: 40, note: 'Sin objeción.', quote: '' },
      { id: 'cierre', score: 20, note: 'Sin paso.', quote: '' },
    ],
    model: 'Marta, ¿qué pasa cuando un cliente ya dijo que sí?',
    next: 'Repite cerrando con el jueves a las 10:00.',
  });
  const turns = [them('¿Sí? Dime.'), say('Hola Marta, te llamo porque he visto que perdéis seguimientos.')];
  const debrief = cleanDebrief(raw, turns, scenario)!;
  expect(debrief.score).toBe(50);
  expect(debrief.axes.map(axis => axis.id)).toEqual(['apertura', 'descubrimiento', 'objecion', 'cierre']);
  expect(debrief.axes[0].quote).toBe(literal);
  // La cita que no está en la conversación desaparece; la nota del eje se mantiene.
  expect(debrief.axes[1].quote).toBe('');
  expect(debrief.axes[1].note).toBe('Falta cifra.');
  expect(debrief.scenario).toBe(scenario.title);
});

test('el personaje sube de nivel con las respuestas y una situación suave cede antes', () => {
  const suave = { ...scenarioById('venta-fria')!, intensity: 'suave' as const };
  expect(stageFor(suave, 1)).toBe(1);
  expect(stageFor(suave, 2)).toBe(2);
  const dura = scenarioById('venta-cerrada')!;
  expect(stageFor(dura, 1)).toBe(1);
  expect(stageFor(dura, 4)).toBe(2);
  expect(stageFor(dura, 7)).toBe(3);
  expect(stageFor(dura, 14)).toBe(3);
});

test('la entrevista por perfil puntúa seis criterios y pesa la nota, no hace media simple', () => {
  const scenario = scenarioById('perfil-exigente')!;
  const axes = [
    { id: 'confianza', score: 80, note: '', quote: '' },
    { id: 'claridad', score: 80, note: '', quote: '' },
    { id: 'evidencia', score: 40, note: '', quote: '' },
    { id: 'objecion', score: 60, note: '', quote: '' },
    { id: 'encaje', score: 60, note: '', quote: '' },
    { id: 'iniciativa', score: 100, note: '', quote: '' },
  ];
  const base = { summary: 'Entrevista senior.', focus: 'Cifras.', strengths: [], improvements: [], model: '', next: 'Repite.' };
  const debrief = cleanDebrief(JSON.stringify({ ...base, axes }), [say('Hola.')], scenario)!;
  expect(debrief.axes.map(axis => axis.id)).toEqual(['confianza', 'claridad', 'evidencia', 'objecion', 'encaje', 'iniciativa']);
  // 25/20/20/15/10/10 → 20+16+8+9+6+10 = 69; la media simple habría dado 70.
  expect(debrief.score).toBe(69);
  // Un eje de menos no se acepta: nunca se inventa un feedback parcial.
  expect(cleanDebrief(JSON.stringify({ ...base, axes: axes.slice(0, 5) }), [say('Hola.')], scenario)).toBeNull();
  // La rúbrica genérica de cuatro ejes sigue intacta para las entrevistas sin perfil.
  const generica = scenarioById('entrevista-closer')!;
  expect(cleanDebrief(JSON.stringify({ ...base, axes }), [say('Hola.')], generica)).toBeNull();
});

test('la nota se acota a 0-100 y un feedback sin los cuatro ejes no se acepta', () => {
  const scenario = scenarioById('entrevista-closer')!;
  const base = {
    summary: 'Resumen.',
    focus: 'Concreción.',
    strengths: [],
    improvements: [],
    model: '',
    next: 'Repite.',
  };
  const clamped = cleanDebrief(JSON.stringify({
    ...base,
    axes: [
      { id: 'claridad', score: 140, note: '', quote: '' },
      { id: 'evidencia', score: -20, note: '', quote: '' },
      { id: 'objecion', score: 55, note: '', quote: '' },
      { id: 'iniciativa', score: 75, note: '', quote: '' },
    ],
  }), [say('Hola.')], scenario)!;
  expect(clamped.axes.map(axis => axis.score)).toEqual([100, 0, 55, 75]);
  expect(clamped.score).toBe(58);

  const incomplete = cleanDebrief(JSON.stringify({
    ...base,
    axes: [{ id: 'claridad', score: 50, note: '', quote: '' }],
  }), [say('Hola.')], scenario);
  expect(incomplete).toBeNull();
});
