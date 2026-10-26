import { scenarioById } from '../../../components/practiceScenarios';
import { buildPersonaPrompt, debriefInstructions, debriefSchema } from './prompts';
import { cleanDebrief } from './debrief';
import { analyzeSignals } from './signals';
import type { PracticeTurn } from './signals';
import { clientIp, createTurnBudget } from '../../../lib/practiceBudget';

export const dynamic = 'force-dynamic';

// Sala de práctica: el proveedor se configura por entorno y la ruta queda apagada
// por defecto. La clave vive solo en el servidor y nunca viaja al navegador.
// El acceso es abierto (sin código de cohorte): el gasto se contiene con los topes
// de turnos por IP y globales de más abajo, que son la única puerta que queda.
const GROQ_BASE = (process.env.GROQ_BASE_URL || 'https://api.groq.com/openai/v1').replace(/\/$/, '');
const ALLOWED_MODEL = ['openai/gpt-oss-20b', 'openai/gpt-oss-120b'];
const MODEL = ALLOWED_MODEL.includes(process.env.PRACTICE_MODEL || '') ? process.env.PRACTICE_MODEL! : ALLOWED_MODEL[0];
// El tope de turnos no puede quedar por debajo de lo que permite la UI: con 16,
// una conversación larga llegaba a un estado en el que ni la réplica ni el
// feedback podían enviarse (422 para siempre). La UI corta en 20 turnos y este
// margen deja sitio al feedback.
const MAX_TURNS = 24;
const MAX_TURN_CHARS = 800;
// El tope de caracteres tiene que cubrir una conversación completa del tope de la
// UI (20 turnos: 10 mensajes de 800 + 10 réplicas de 900 = 17.000). Con 6.000, una
// alumna que escribía largo dejaba de poder enviar y tampoco podía pedir feedback
// (la ruta valida el mismo tope en el debrief).
const MAX_TOTAL_CHARS = 18000;
const DAILY_TURNS = Number(process.env.PRACTICE_DAILY_TURNS || 400);
const IP_DAILY_TURNS = 60;

type Body = { scenario?: unknown; messages?: unknown; mode?: unknown };

// Topes por instancia (ver lib/practiceBudget): la IP no puede salir de un valor que elija quien llama y el mapa
// tiene tope duro. En serverless son best-effort, por eso además se limita cada petición (turnos y caracteres) y el
// gasto por llamada (max_tokens).
const budget = createTurnBudget();

function readTurns(value: unknown): PracticeTurn[] | null {
  if (!Array.isArray(value) || !value.length || value.length > MAX_TURNS) return null;
  const turns: PracticeTurn[] = [];
  let total = 0;
  for (const item of value) {
    if (typeof item !== 'object' || item === null) return null;
    const { role, content } = item as { role?: unknown; content?: unknown };
    if ((role !== 'user' && role !== 'coach') || typeof content !== 'string') return null;
    const text = content.trim();
    if (!text || text.length > MAX_TURN_CHARS) return null;
    total += text.length;
    if (total > MAX_TOTAL_CHARS) return null;
    turns.push({ role, content: text });
  }
  return turns;
}

type GroqResult = { ok: true; content: string } | { ok: false; error: 'missing_key' | 'rate_limited' | 'provider' | 'unavailable' | 'invalid_output' };

async function askGroq(payload: unknown): Promise<GroqResult> {
  const key = process.env.GROQ_API_KEY;
  if (!key) return { ok: false, error: 'missing_key' };
  try {
    const response = await fetch(`${GROQ_BASE}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(20000),
      cache: 'no-store',
    });
    if (!response.ok) return { ok: false, error: response.status === 429 ? 'rate_limited' : 'provider' };
    const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const content = data.choices?.[0]?.message?.content;
    return typeof content === 'string' && content.trim() ? { ok: true, content } : { ok: false, error: 'invalid_output' };
  } catch {
    return { ok: false, error: 'unavailable' };
  }
}

export async function POST(request: Request) {
  const origin = request.headers.get('origin');
  const host = request.headers.get('host') ?? '';
  if (origin && origin !== `https://${host}` && origin !== `http://${host}`) {
    return Response.json({ detail: 'Origen no permitido' }, { status: 403 });
  }
  if (!process.env.GROQ_API_KEY) {
    return Response.json({ detail: 'La sala de práctica no está configurada en este despliegue.' }, { status: 503 });
  }
  let body: Body;
  try { body = await request.json() as Body; } catch { return Response.json({ detail: 'Cuerpo no válido' }, { status: 422 }); }
  const scenario = typeof body.scenario === 'string' ? scenarioById(body.scenario) : null;
  if (!scenario) return Response.json({ detail: 'Situación desconocida' }, { status: 422 });
  const turns = readTurns(body.messages);
  if (!turns) return Response.json({ detail: 'La conversación no es válida o es demasiado larga.' }, { status: 422 });
  const mode = body.mode === 'debrief' ? 'debrief' : 'reply';
  const ip = clientIp(request.headers);
  if (budget.spend(`ip:${ip}`, IP_DAILY_TURNS) === null || budget.spend('global', DAILY_TURNS) === null) {
    return Response.json({ detail: 'La sala de práctica ha llegado a su límite de hoy. Vuelve mañana o pide a tu coordinadora que lo amplíe.' }, { status: 429 });
  }
  const studentTurns = turns.filter(turn => turn.role === 'user').length;

  if (mode === 'debrief') {
    const transcript = turns.map(turn => `${turn.role === 'coach' ? 'INTERLOCUTOR' : 'ALUMNA'}: ${turn.content}`).join('\n');
    const result = await askGroq({
      model: MODEL,
      messages: [
        { role: 'system', content: debriefInstructions(scenario) },
        { role: 'user', content: `Conversación:\n${transcript}\n\nDevuelve el feedback con el esquema indicado.` },
      ],
      temperature: 0.3,
      max_tokens: 900,
      response_format: { type: 'json_schema', json_schema: { name: 'practice_debrief', strict: true, schema: debriefSchema(scenario) } },
    });
    if (!result.ok) return failure(result.error);
    const debrief = cleanDebrief(result.content, turns, scenario);
    if (!debrief) return Response.json({ detail: 'El proveedor devolvió un feedback que no se puede verificar. No se muestra nada inventado.' }, { status: 502 });
    // Las señales son deterministas y no dependen del modelo: se calculan aquí y
    // viajan con el feedback (también al historial local).
    return Response.json({ debrief: { ...debrief, signals: analyzeSignals(turns, scenario.kind) } });
  }

  const messages = [
    { role: 'system', content: buildPersonaPrompt(scenario, studentTurns) },
    ...turns.map(turn => ({ role: turn.role === 'coach' ? 'assistant' : 'user', content: turn.content })),
  ];
  const result = await askGroq({ model: MODEL, messages, temperature: 0.75, max_tokens: 260 });
  if (!result.ok) return failure(result.error);
  return Response.json({ reply: result.content.trim().slice(0, 900), turns: turns.length });
}

function failure(code: 'missing_key' | 'rate_limited' | 'provider' | 'unavailable' | 'invalid_output') {
  const detail = code === 'rate_limited'
    ? 'El proveedor de IA ha limitado las peticiones. Espera un momento y vuelve a intentarlo.'
    : code === 'missing_key'
      ? 'La sala de práctica no está configurada en este despliegue.'
      : 'No se ha podido completar la respuesta. La conversación no se ha perdido: vuelve a intentarlo.';
  return Response.json({ detail }, { status: code === 'missing_key' ? 503 : code === 'rate_limited' ? 429 : 502 });
}
