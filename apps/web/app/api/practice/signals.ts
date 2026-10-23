// Señales de estilo de la práctica: se calculan sin IA, con la frase literal que
// las dispara. Son observaciones, no veredictos: el feedback del modelo decide.
export type PracticeTurn = { role: 'user' | 'coach'; content: string };

export type PracticeSignal = {
  id: string;
  label: string;
  detail: string;
  quote: string;
};

const EMPATHY = ['entiendo', 'comprendo', 'tiene sentido', 'razon', 'de acuerdo', 'es logico', 'es normal', 'razonable', 'te creo', 'lo veo'];
// «este» NO es relleno: en español es el demostrativo de «este jueves» o «este
// caso», y marcarlo convertía una frase normal en una muletilla.
const FILLER = /\b(bueno|o sea|digamos|eh)\b|¿(verdad|no|qué te parece)\?/i;
const PRICE = /(\d[\d.,]*\s*(€|euros?))|(inversi[oó]n[^.]{0,40}\d)|(cuesta\s+\d)/i;
const NEXT_STEP = /\b(reuni[oó]n|llamada|agenda|empezar|empezamos|siguiente paso|te env[ií]o|te paso|jueves|viernes|lunes|martes|mi[eé]rcoles|mañana|prueba|demo)\b/i;

const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

// Divide en frases conservando el texto original: la cita debe poder buscarse
// literalmente en el mensaje de la alumna.
function clauses(text: string): string[] {
  return text.split(/(?<=[.!?…])\s+|\n+/).map(part => part.trim()).filter(Boolean);
}

function clauseWith(text: string, index: number) {
  const found = clauses(text).find(part => normalize(part).includes(normalize(text.slice(index, index + 5))));
  return found ?? text.trim();
}

function quoteAround(text: string, pattern: RegExp) {
  const match = pattern.exec(text);
  if (!match || match.index === undefined) return '';
  const start = text.lastIndexOf('.', match.index) + 1;
  const end = text.indexOf('.', match.index + match[0].length);
  return text.slice(start, end === -1 ? text.length : end + 1).trim() || clauseWith(text, match.index);
}

function wordCount(text: string) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

// «Pero» después de validar: destruye el rapport que la propia alumna acaba de crear.
function contradictoryValidation(turns: PracticeTurn[]): PracticeSignal | null {
  for (const turn of turns) {
    const text = turn.content;
    const normalized = normalize(text);
    const empathyAt = EMPATHY.map(marker => normalized.indexOf(marker)).find(index => index >= 0);
    const butAt = normalized.search(/\bpero\b/);
    if (empathyAt === undefined || butAt < 0 || butAt < empathyAt) continue;
    return {
      id: 'pero',
      label: 'Validaste con «pero»',
      detail: 'El «pero» borra la validación anterior. Cambiarlo por «y» mantiene el acuerdo y abre el reencuadre.',
      quote: quoteAround(text, /\bpero\b/i),
    };
  }
  return null;
}

// Relleno después del precio: quien habla primero después del precio, pierde.
function fillerAfterPrice(turns: PracticeTurn[]): PracticeSignal | null {
  for (const turn of turns) {
    const text = turn.content;
    const price = PRICE.exec(text);
    if (!price || price.index === undefined) continue;
    const after = text.slice(price.index + price[0].length);
    const filler = FILLER.exec(after);
    if (!filler) continue;
    return {
      id: 'stfu',
      label: 'Relleno después del precio',
      detail: 'Después de decir el precio, el silencio trabaja para ti. Cualquier «bueno» o «¿qué te parece?» invita a negociar.',
      quote: quoteAround(after, FILLER) || after.trim().slice(0, 120),
    };
  }
  return null;
}

function noNextStep(turns: PracticeTurn[]): PracticeSignal | null {
  const student = turns.filter(turn => turn.role === 'user');
  if (student.length < 3) return null;
  if (student.some(turn => NEXT_STEP.test(turn.content))) return null;
  return {
    id: 'sin-paso',
    label: 'Sin siguiente paso concreto',
    detail: 'La conversación se queda en el interés. Un día, una hora y una acción pequeña convierten el interés en algo que se puede cumplir.',
    quote: student[student.length - 1].content.trim().slice(0, 140),
  };
}

function noQuestions(turns: PracticeTurn[], kind: 'venta' | 'entrevista'): PracticeSignal | null {
  const student = turns.filter(turn => turn.role === 'user');
  if (!student.length) return null;
  if (student.some(turn => turn.content.includes('?'))) return null;
  return {
    id: 'sin-preguntas',
    label: kind === 'venta' ? 'No has preguntado nada' : 'No has hecho ninguna pregunta',
    detail: kind === 'venta'
      ? 'Sin una pregunta no hay descubrimiento: el interlocutor solo puede responder a lo que ya has dicho.'
      : 'La entrevista también se juega al final: una pregunta demuestra interés real por el puesto.',
    quote: student[student.length - 1].content.trim().slice(0, 140),
  };
}

function longMessages(turns: PracticeTurn[]): PracticeSignal | null {
  const long = turns.find(turn => turn.role === 'user' && turn.content.length > 320);
  if (!long) return null;
  return {
    id: 'largo',
    label: 'Un mensaje demasiado largo',
    detail: `Ese mensaje tiene ${long.content.length} caracteres. En una llamada real, tres frases seguidas suelen perder al interlocutor.`,
    quote: long.content.trim().slice(0, 120),
  };
}

function shortAnswers(turns: PracticeTurn[]): PracticeSignal | null {
  const short = turns.filter(turn => turn.role === 'user' && wordCount(turn.content) <= 4);
  if (short.length < 2) return null;
  return {
    id: 'cortas',
    label: 'Respuestas demasiado cortas',
    detail: `${short.length} de tus respuestas tienen cuatro palabras o menos. Una frase con contexto abre más que un «sí» o un «vale».`,
    quote: short[0].content.trim(),
  };
}

function filler(turns: PracticeTurn[]): PracticeSignal | null {
  for (const turn of turns) {
    if (turn.role !== 'user' || !FILLER.test(turn.content)) continue;
    return {
      id: 'relleno',
      label: 'Muletillas al responder',
      detail: 'El relleno resta autoridad. Decir la frase sin «bueno», «o sea» ni «¿verdad?» suena más firme.',
      quote: quoteAround(turn.content, FILLER),
    };
  }
  return null;
}

// Prioridad docente: primero lo que más cuesta una venta, después el estilo.
export function analyzeSignals(turns: PracticeTurn[], kind: 'venta' | 'entrevista'): PracticeSignal[] {
  const candidates = [
    fillerAfterPrice(turns),
    contradictoryValidation(turns),
    kind === 'venta' ? noNextStep(turns) : null,
    noQuestions(turns, kind),
    longMessages(turns),
    filler(turns),
    shortAnswers(turns),
  ].filter((signal): signal is PracticeSignal => Boolean(signal?.quote));

  const seen = new Set<string>();
  const stfuQuote = candidates.find(signal => signal.id === 'stfu')?.quote;
  return candidates.filter(signal => {
    if (seen.has(signal.id)) return false;
    // El relleno tras el precio ya se cuenta como STFU: repetir la misma frase
    // con otro nombre solo confunde en el feedback.
    if (signal.id === 'relleno' && stfuQuote && normalize(signal.quote) === normalize(stfuQuote)) return false;
    seen.add(signal.id);
    return true;
  }).slice(0, 3);
}
