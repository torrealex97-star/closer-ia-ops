// Revisión determinista de los ejercicios de formación. Sin IA y sin red: cada
// criterio es una regla explicable sobre el texto de la alumna. Un criterio no
// cumple no es «suspenso»: la UI lo presenta como algo que falta, con su motivo.

import { FINAL_EXAM, LOGICA } from './trainingContent';
import type { BankQuestion } from './trainingContent';

export type Criterion = { id: string; label: string; ok: boolean; detail: string };
export type Review = { criteria: Criterion[]; met: number; total: number; ratio: number };
export type FreezingReply = {
  /** Se defendió: justificación o negación del ataque. */
  defensive: boolean;
  /** Usó «pero» al validar, la ley de hierro rota. */
  usedPero: boolean;
  accepted: boolean;
  validated: boolean;
  looping: boolean;
  calm: boolean;
  asked: boolean;
};
export type LogicaInput = { brecha: string; coste: string; meses: string };
export type LogicaReview = Review & { fields: { brecha: boolean; coste: boolean; meses: boolean } };

export const EXAM_PASS = 85;

const test = (text: string, pattern: RegExp) => pattern.test(text);
export const isQuestion = (text: string) => /[?¿]/.test(text);
// Pedir información no siempre lleva signo de interrogación: «dame un ejemplo»
// también abre al lead. El ejercicio cuenta ambas formas.
export const elicits = (text: string) => isQuestion(text) || /\b(dame|cu[eé]ntame|dime|describe|explica|pregunta)\b/i.test(text);

// «192.000», «192000», «192.000,50» y «16 meses» se leen igual que los escribiría
// una persona en España. Un texto sin número devuelve null, nunca 0.
export function parseAmount(raw: string): number | null {
  const cleaned = raw
    .toLowerCase()
    .replace(/€|\$|euros?|eur|al mes|\/\s*mes|meses?|mes\b/g, '')
    .replace(/\s/g, '');
  if (!cleaned) return null;
  const normalized = cleaned.replace(/\./g, '').replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(normalized)) return null;
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

const review = (criteria: Criterion[]): Review => {
  const met = criteria.filter(item => item.ok).length;
  return { criteria, met, total: criteria.length, ratio: Math.round((met / criteria.length) * 100) };
};

const missing = (label: string) => `Falta: ${label.toLowerCase()}.`;
const good = (label: string) => `Cumple: ${label.toLowerCase()}.`;

// ---- Pre-llamada ------------------------------------------------------------

const MOMENT = /(lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo|\d{1,2}[:.]\d{2}|\b\d{1,2}\s*h\b|mañana|hoy|en \d+|dentro de \d+|(en|dentro de) (una?|media|dos|tres|cuatro|cinco|diez|quince) (hora|horas|minuto|minutos))/i;
const ACTION = /[?¿]|\b(confirma|conf[ií]rmame|av[ií]same|escr[ií]beme|responde|resp[oó]ndeme|guarda|dime|p[aá]same|te (paso|mando|llamo|cuento|enseño|explico|dejo)|elige|nos vemos|quedamos|hasta (mañana|luego|pronto))\b/i;
const APOLOGY = /(perdona|perd[oó]n|disculpa|siento (molestar|importun)|molest|no te quito m[aá]s tiempo|gracias por tu tiempo)/i;

const STEP_RULES: Record<string, { id: string; label: string; pattern: RegExp }[]> = {
  inmediato: [
    { id: 'razones', label: 'Da razones concretas para asistir', pattern: /(veremos|te dir[eé]|saldr[aá]s|plan|por qu[eé]|diagn[oó]stico)/i },
    { id: 'material', label: 'Adjunta o menciona material preparatorio', pattern: /(tarea|vsl|v[ií]deo|enlace|preparaci[oó]n|documento)/i },
  ],
  '5min': [
    { id: 'presenta', label: 'Se presenta como una persona real', pattern: /(soy |me llamo )/i },
    { id: 'canal', label: 'Abre un canal para dudas', pattern: /(escr[ií]beme|por aqu[ií]|dime|preg[uú]ntame|whatsapp)/i },
  ],
  'noche-anterior': [
    { id: 'video', label: 'Propone un vídeo o una nota de voz', pattern: /(v[ií]deo|audio|nota de voz)/i },
    { id: 'caso', label: 'Menciona su caso o algo concreto suyo', pattern: /(tu caso|he visto|a medida|para ti|lo que me contaste)/i },
  ],
  manana: [
    { id: 'prueba', label: 'Cita un caso concreto o un resultado', pattern: /(cerr[oó]|%|\d+\s*(€|euros)|caso de)/i },
  ],
  '1h': [
    { id: 'plataforma', label: 'Ofrece elegir plataforma o enlace', pattern: /(zoom|meet|enlace|link|videollamada)/i },
  ],
  '15min': [
    { id: 'enlace', label: 'Incluye el enlace de la sala', pattern: /(https?:\/\/|enlace|link)/i },
    { id: 'salida', label: 'Deja una salida digna si no puede', pattern: /(reprogram|otro d[ií]a|si algo surge|si no puedes|si te surge)/i },
  ],
};

export function reviewPreCall(stepId: string, text: string): Review {
  const body = text.trim();
  const criteria: Criterion[] = [
    { id: 'momento', label: 'Menciona el día o la hora', ok: test(body, MOMENT), detail: test(body, MOMENT) ? good('Menciona el día o la hora') : missing('di cuándo es la cita') },
    { id: 'accion', label: 'Pide una acción o fija el siguiente paso', ok: test(body, ACTION), detail: test(body, ACTION) ? good('Pide una acción o fija el siguiente paso') : missing('una pregunta, una confirmación o un siguiente paso concreto') },
    { id: 'tono', label: 'Sin disculpas ni sumisión', ok: !test(body, APOLOGY), detail: test(body, APOLOGY) ? 'Sumisión: pides perdón o restas valor a su tiempo. En este mensaje no hace falta.' : good('Sin disculpas ni sumisión') },
    { id: 'longitud', label: 'Entre 40 y 400 caracteres', ok: body.length >= 40 && body.length <= 400, detail: body.length < 40 ? `Falta: tiene ${body.length} caracteres; un mensaje así no dice nada.` : body.length > 400 ? `Falta: ${body.length} caracteres es un correo, no un mensaje.` : `Cumple: ${body.length} caracteres.` },
  ];
  for (const rule of STEP_RULES[stepId] ?? []) {
    const ok = rule.pattern.test(body);
    criteria.push({ id: rule.id, label: rule.label, ok, detail: ok ? good(rule.label) : missing(rule.label.toLowerCase()) });
  }
  return review(criteria);
}

// ---- Venta lógica -----------------------------------------------------------

const near = (value: number | null, expected: number) => value !== null && Math.abs(value - expected) < 1;

export function reviewLogica(input: LogicaInput): LogicaReview {
  const brecha = parseAmount(input.brecha);
  const coste = parseAmount(input.coste);
  const meses = parseAmount(input.meses);
  const fields = {
    brecha: near(brecha, LOGICA.expected.brecha),
    coste: near(coste, LOGICA.expected.coste),
    meses: near(meses, LOGICA.expected.mesesDeAhorro),
  };
  const criteria: Criterion[] = [
    {
      id: 'brecha',
      label: `Brecha mensual: ${LOGICA.expected.brecha.toLocaleString('es-ES')} €`,
      ok: fields.brecha,
      detail: fields.brecha ? good('Brecha mensual') : brecha === null ? 'Falta un número en la brecha mensual.' : `Falta: con 5.000 € de meta y 1.800 € de ingreso, la brecha son ${LOGICA.expected.brecha.toLocaleString('es-ES')} €.`,
    },
    {
      id: 'coste',
      label: `Coste de inacción a cinco años: ${LOGICA.expected.coste.toLocaleString('es-ES')} €`,
      ok: fields.coste,
      detail: fields.coste ? good('Coste de inacción') : coste === null ? 'Falta un número en el coste de inacción.' : `Falta: ${LOGICA.expected.brecha.toLocaleString('es-ES')} € × 12 meses × 5 años = ${LOGICA.expected.coste.toLocaleString('es-ES')} €.`,
    },
    {
      id: 'meses',
      label: `Meses de ahorro para igualar un mes de brecha: ${LOGICA.expected.mesesDeAhorro}`,
      ok: fields.meses,
      detail: fields.meses ? good('Meses de ahorro') : meses === null ? 'Falta un número en los meses de ahorro.' : `Falta: ${LOGICA.expected.brecha.toLocaleString('es-ES')} € ÷ 200 € al mes = ${LOGICA.expected.mesesDeAhorro} meses.`,
    },
  ];
  return { ...review(criteria), fields };
}

export function reviewCloseLine(text: string): Review {
  const body = text.trim();
  const numbers = (body.match(/\d[\d.,]*/g) ?? []).map(parseAmount);
  const citesCost = numbers.some(value => near(value, LOGICA.expected.coste));
  const filler = /(qu[eé] te parece|c[oó]mo lo ves|te parece bien|dime algo)/i.test(body);
  const disjunction = /(seguir (igual|como)|dos caminos|poner un sistema|empezar hoy|decides|t[uú] eliges)/i.test(body);
  const criteria: Criterion[] = [
    { id: 'cifra', label: 'Cita el coste de seguir igual', ok: citesCost, detail: citesCost ? good('Cita el coste de seguir igual') : `Falta: sin el número (${LOGICA.expected.coste.toLocaleString('es-ES')} €) no hay brecha, solo opinión.` },
    { id: 'disyuntiva', label: 'Plantea los dos caminos', ok: disjunction, detail: disjunction ? good('Plantea los dos caminos') : missing('los dos caminos: seguir igual o empezar') },
    { id: 'silencio', label: 'No rellena el silencio pidiendo aprobación', ok: !filler, detail: filler ? 'Falta: después del número no preguntes «¿qué te parece?». Deja que responda ella.' : good('No rellena el silencio') },
  ];
  return review(criteria);
}

// ---- Anti-freezing ----------------------------------------------------------

const DEFENSIVE = /(no es (as[ií]|cierto)|te equivocas|est[aá]s equivocad|no entiendes|nada que ver|yo no he dicho|eso no es verdad)/i;

export function reviewFreezingReply(text: string): FreezingReply {
  const body = text.trim();
  return {
    defensive: test(body, DEFENSIVE),
    usedPero: /\bpero\b/i.test(body),
    accepted: /(de acuerdo|tienes raz[oó]n|acepto|es cierto|es justo)/i.test(body),
    validated: /(razonable|tiene sentido|normal que|entiendo que|es l[oó]gico|comprendo)/i.test(body),
    looping: /(y al mismo tiempo|lo que tambi[eé]n es cierto|y aun as[ií]|dicho esto)/i.test(body),
    calm: !/(!!|\b[A-ZÁÉÍÓÚÑ]{5,}\b)/.test(body) && body.length <= 420,
    asked: isQuestion(body),
  };
}

// Un criterio se considera sostenido si aparece en al menos el 60 % de las
// respuestas: una excepción no destruye el protocolo, un patrón sí.
const majority = (count: number, total: number) => total > 0 && count >= Math.ceil(total * 0.6);

export function reviewFreezing(answers: string[]): Review {
  const replies = answers.map(reviewFreezingReply);
  const total = replies.length;
  const count = (predicate: (reply: FreezingReply) => boolean) => replies.filter(predicate).length;
  const build = (id: string, label: string, predicate: (reply: FreezingReply) => boolean, hint: string): Criterion => {
    const hits = count(predicate);
    const ok = majority(hits, total);
    return { id, label, ok, detail: ok ? `Cumple en ${hits} de ${total} respuestas.` : `${hint} (${hits} de ${total} respuestas).` };
  };
  return review([
    build('acepta', 'Acepta el ataque', reply => reply.accepted, 'Falta aceptar: «tienes razón» o «de acuerdo»'),
    build('valida', 'Valida la emoción', reply => reply.validated, 'Falta validar: «es razonable que sientas eso»'),
    build('looping', 'Hace looping con «y al mismo tiempo»', reply => reply.looping, 'Falta el looping: «y al mismo tiempo, lo que también es cierto es que…»'),
    build('pero', 'No usa «pero» al validar', reply => !reply.usedPero, 'Usaste «pero» al validar: rompe el acuerdo que acabas de dar'),
    build('defensa', 'No se defiende', reply => !reply.defensive, 'Te defendiste o negaste el ataque'),
    build('calma', 'Baja el ritmo en vez de acelerar', reply => reply.calm, 'Subiste el tono o alargaste la justificación'),
    build('pregunta', 'Devuelve una pregunta', reply => reply.asked, 'Falta devolver una pregunta al personaje'),
  ]);
}

/** Caídas de moral: cada respuesta defensiva o con «pero» cuenta una. */
export const freezingFalls = (answers: string[]) => answers.map(reviewFreezingReply).filter(reply => reply.defensive || reply.usedPero).length;

export function moralFor(falls: number): { level: 'Alta' | 'Media' | 'Baja'; tone: 'alto' | 'medio' | 'bajo'; detail: string } {
  const index = falls <= 0 ? 0 : falls === 1 ? 1 : 2;
  const level = ['Alta', 'Media', 'Baja'][index] as 'Alta' | 'Media' | 'Baja';
  const tone = ['alto', 'medio', 'bajo'][index] as 'alto' | 'medio' | 'bajo';
  const detail = [
    'Mantienes el tono: ni te defiendes ni rellenas el silencio.',
    'Se ha colado una defensa o un «pero». Baja el ritmo y vuelve a aceptar.',
    'Te has defendido más de una vez. Antes de seguir, lee el módulo de reactivación.',
  ][index];
  return { level, tone, detail };
}

// ---- Yellows ----------------------------------------------------------------

export function reviewYellows(answers: string[]): Review {
  const replies = answers.map(text => text.trim()).filter(Boolean);
  const total = replies.length;
  const withQuestion = replies.filter(elicits).length;
  const concrete = replies.some(text => /(ejemplo|concret|cu[aá]nt|exact|cu[eé]ntame|describe)/i.test(text));
  const short = replies.every(text => text.length <= 400);
  return review([
    {
      id: 'pregunta',
      label: 'Pide información en cada mensaje',
      ok: total > 0 && withQuestion === total,
      detail: total === 0 ? 'Falta escribir al menos un mensaje.' : withQuestion === total ? `Cumple en ${total} de ${total} mensajes.` : `Falta: ${total - withQuestion} de ${total} mensajes no piden nada.`,
    },
    {
      id: 'concreto',
      label: 'Pide un ejemplo o una cifra',
      ok: concrete,
      detail: concrete ? 'Cumple: pides algo comprobable.' : 'Falta: pregunta por un ejemplo, una cifra o un caso concreto.',
    },
    {
      id: 'monologo',
      label: 'Sin monólogos (máximo 400 caracteres)',
      ok: short,
      detail: short ? 'Cumple: ningún mensaje pasa de 400 caracteres.' : 'Falta: alguno de tus mensajes pasa de 400 caracteres. Con un lead cerrado, un párrafo largo lo cierra más.',
    },
  ]);
}

/** Aviso de ritmo: tres mensajes seguidos sin pregunta bloquean el avance. */
export const yellowMistakes = (answers: string[]) => answers.filter(text => text.trim() && !elicits(text)).length;
export const YELLOW_BLOCK = 3;

// ---- Examen -----------------------------------------------------------------

export type ExamResult = { correct: number; total: number; score: number; passed: boolean; wrong: string[] };

export function gradeExam(answers: Record<string, string>): ExamResult {
  const multiple = FINAL_EXAM.filter(question => question.type === 'multiple');
  const wrong = multiple.filter(question => (answers[question.id] ?? '') !== question.correctAnswer).map(question => question.id);
  const correct = multiple.length - wrong.length;
  const score = Math.round((correct / multiple.length) * 100);
  return { correct, total: multiple.length, score, passed: score >= EXAM_PASS, wrong };
}


// ---- Bancos de situaciones (cierres, descubrimiento) -------------------------

export type BankResult = { correct: number; total: number; wrong: string[] };
// Corrección por clave: una pregunta sin responder cuenta como fallo y se señala, no se supone.
export function gradeBank(bank: BankQuestion[], answers: Record<string, string>): BankResult {
  const wrong = bank.filter(question => answers[question.id] !== question.answer).map(question => question.id);
  return { correct: bank.length - wrong.length, total: bank.length, wrong };
}
