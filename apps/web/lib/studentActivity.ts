import { FINAL_EXAM } from '../components/trainingContent';
import { EXAM_PASS } from '../components/trainingCheck';
import { REVIEW_REFS } from '../components/trainingRefs';
import { ORG } from './external';
import { pagedRest, serviceRest } from './supabaseAuth';

// Actividad de la alumna en el portal (tabla `student_activity`, solo service role). Principios:
// - el servidor decide la nota del examen a partir de las respuestas acertadas, nunca el `score` del navegador;
// - un hueco no es un cero: sin lectura de la tabla se devuelve `null`, no un resumen vacío;
// - el día y la semana son los de Europe/Madrid (una práctica a las 00:30 cuenta para el día nuevo).
export type ActivityKind = 'session' | 'training_review' | 'training_exam' | 'practice';
export type ActivityRow = { id?: string; student_id?: string; kind: ActivityKind; ref: string | null; score: number | null; detail: Record<string, unknown>; created_at: string };

export { REVIEW_REFS };
export const EXAM_TOTAL = FINAL_EXAM.filter(question => question.type === 'multiple').length;
const READ_LIMIT = 5000;
const TZ = 'Europe/Madrid';
const DAY_MS = 86_400_000;

const isInt = (value: unknown, min: number, max: number): value is number => typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

export type ActivityInput = { kind: ActivityKind; ref: string | null; score: number | null; detail: Record<string, unknown> };
export type Checked = { ok: true; value: ActivityInput; passed?: boolean } | { ok: false; detail: string };

// Valida lo que envía el navegador. `session` no se acepta desde fuera: la crea el login.
export function checkActivity(body: unknown): Checked {
  if (!isRecord(body)) return { ok: false, detail: 'Cuerpo no válido.' };
  const { kind, ref, score, detail } = body;
  if (score !== undefined && score !== null && !isInt(score, 0, 100)) return { ok: false, detail: 'La nota debe ser un entero de 0 a 100.' };
  const info = detail === undefined ? {} : detail;
  if (!isRecord(info)) return { ok: false, detail: 'Detalle no válido.' };
  if (kind === 'training_review') {
    if (typeof ref !== 'string' || !(REVIEW_REFS as readonly string[]).includes(ref)) return { ok: false, detail: 'Módulo de formación desconocido.' };
    if (!isInt(info.met, 0, 50) || !isInt(info.total, 1, 50) || info.met > info.total) return { ok: false, detail: 'Criterios cumplidos no válidos.' };
    return { ok: true, value: { kind, ref, score: null, detail: { met: info.met, total: info.total } } };
  }
  if (kind === 'training_exam') {
    if (ref !== 'final') return { ok: false, detail: 'Examen desconocido.' };
    // Sin respuestas acertadas no hay nota: el servidor la calcula y recalcula «superado».
    if (!isInt(info.correct, 0, EXAM_TOTAL) || info.total !== EXAM_TOTAL || info.correct > EXAM_TOTAL) return { ok: false, detail: 'El examen necesita las respuestas acertadas y el total de preguntas.' };
    const computed = Math.round((info.correct / EXAM_TOTAL) * 100);
    const passed = computed >= EXAM_PASS;
    return { ok: true, passed, value: { kind, ref, score: computed, detail: { correct: info.correct, total: EXAM_TOTAL, passed } } };
  }
  if (kind === 'practice') {
    if (typeof ref !== 'string' || !/^[a-z0-9_-]{1,60}$/i.test(ref)) return { ok: false, detail: 'Escenario no válido.' };
    if (!isInt(score, 0, 100)) return { ok: false, detail: 'La práctica necesita una nota de 0 a 100.' };
    const clean: Record<string, unknown> = {};
    if (isRecord(info.axes)) {
      const axes = Object.entries(info.axes).filter(([key, value]) => /^[a-z0-9_]{1,30}$/i.test(key) && isInt(value, 0, 100)).slice(0, 8);
      if (axes.length) clean.axes = Object.fromEntries(axes);
    }
    if (typeof info.difficulty === 'string' && /^[\p{L} ]{1,20}$/u.test(info.difficulty)) clean.difficulty = info.difficulty;
    if (info.mode === 'texto' || info.mode === 'voz') clean.mode = info.mode;
    return { ok: true, value: { kind, ref, score, detail: clean } };
  }
  return { ok: false, detail: 'Tipo de actividad no válido.' };
}

// Tope blando por alumna (memoria de la instancia): frena un bucle del navegador sin tocar la base.
const recent = new Map<string, number[]>();
export function allowWrite(studentId: string, now = Date.now()): boolean {
  const hits = (recent.get(studentId) ?? []).filter(t => now - t < 10 * 60_000);
  if (hits.length >= 60) { recent.set(studentId, hits); return false; }
  hits.push(now); recent.set(studentId, hits);
  return true;
}

export async function recordActivity(studentId: string, input: ActivityInput): Promise<boolean> {
  if (!/^[0-9a-f-]{36}$/.test(studentId)) return false;
  const r = await serviceRest('student_activity', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ org_id: ORG, student_id: studentId, kind: input.kind, ref: input.ref, score: input.score, detail: input.detail }) });
  return r.ok;
}

const SELECT = 'id,student_id,kind,ref,score,detail,created_at';
// `null` = no se pudo leer (tabla ausente o Supabase caído): quien llama lo declara, no lo convierte en ceros.
export async function readActivity(opts: { studentId?: string; sinceIso?: string }): Promise<{ rows: ActivityRow[]; truncated: boolean } | null> {
  const filters = [`org_id=eq.${ORG}`];
  if (opts.studentId) filters.push(`student_id=eq.${opts.studentId}`);
  if (opts.sinceIso) filters.push(`created_at=gte.${encodeURIComponent(opts.sinceIso)}`);
  // Por páginas: PostgREST corta cada respuesta en `db-max-rows` (1.000) y una sola petición dejaba `truncated` siempre en falso.
  return pagedRest<ActivityRow>(`student_activity?${filters.join('&')}&select=${SELECT}`, 'created_at.desc,id.desc', READ_LIMIT);
}

// ---- Calendario de Madrid ---------------------------------------------------

const dayFormat = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
export const madridDay = (date: Date | string | number) => dayFormat.format(new Date(date));
const shiftDay = (key: string, days: number) => { const [y, m, d] = key.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10); };
export const mondayOf = (key: string) => { const [y, m, d] = key.split('-').map(Number); const dow = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7; return shiftDay(key, -dow); };

export function streaks(rows: Pick<ActivityRow, 'created_at'>[], now = new Date()): { current: number; best: number } {
  const days = new Set(rows.map(row => madridDay(row.created_at)));
  if (!days.size) return { current: 0, best: 0 };
  let best = 0;
  for (const day of days) {
    if (days.has(shiftDay(day, -1))) continue; // solo cuenta desde el inicio de cada racha
    let length = 1; while (days.has(shiftDay(day, length))) length += 1;
    best = Math.max(best, length);
  }
  const today = madridDay(now);
  let cursor = days.has(today) ? today : shiftDay(today, -1);
  let current = 0; while (days.has(cursor)) { current += 1; cursor = shiftDay(cursor, -1); }
  return { current, best };
}

// ---- Resumen ----------------------------------------------------------------

export type Achievement = { id: string; label: string; unlocked: boolean };
type Totals = {
  practice: { count: number; avg: number | null; best: number | null };
  training: { modules: string[]; examBest: number | null; examPassed: boolean; examAttempts: number };
};
function totals(rows: ActivityRow[]): Totals {
  const practice = rows.filter(row => row.kind === 'practice' && typeof row.score === 'number').map(row => row.score as number);
  const exams = rows.filter(row => row.kind === 'training_exam' && typeof row.score === 'number');
  const reviewed = new Set(rows.filter(row => row.kind === 'training_review' && row.ref).map(row => row.ref as string));
  const examBest = exams.length ? Math.max(...exams.map(row => row.score as number)) : null;
  return {
    practice: { count: practice.length, avg: practice.length ? Math.round(practice.reduce((a, b) => a + b, 0) / practice.length) : null, best: practice.length ? Math.max(...practice) : null },
    training: { modules: REVIEW_REFS.filter(ref => reviewed.has(ref)), examBest, examPassed: examBest !== null && examBest >= EXAM_PASS, examAttempts: exams.length },
  };
}

export function achievements(life: Totals, streak: { best: number }): Achievement[] {
  return [
    { id: 'first_practice', label: 'Primera práctica', unlocked: life.practice.count >= 1 },
    { id: 'five_practices', label: 'Cinco prácticas', unlocked: life.practice.count >= 5 },
    { id: 'training_complete', label: 'Formación completa', unlocked: life.training.modules.length === REVIEW_REFS.length },
    { id: 'exam_passed', label: 'Examen superado', unlocked: life.training.examPassed },
    { id: 'streak_3', label: 'Racha de 3 días', unlocked: streak.best >= 3 },
    { id: 'streak_7', label: 'Racha de 7 días', unlocked: streak.best >= 7 },
  ];
}

export type Progress = {
  days: number; sessions: number; last_seen: string | null; truncated: boolean;
  practice: Totals['practice']; training: Totals['training'];
  streak: { current: number; best: number };
  weekly: { week: string; avg: number | null; count: number }[];
  axes: { axis: string; avg: number }[];
  recent: ActivityRow[];
  lifetime: Totals & { achievements: Achievement[] };
};

// `rows` llega de más reciente a más antigua; la ventana y el resumen «de siempre» salen de la misma lectura.
export function summarize(rows: ActivityRow[], days: number, now = new Date(), truncated = false): Progress {
  const since = now.getTime() - days * DAY_MS;
  const windowed = rows.filter(row => new Date(row.created_at).getTime() >= since);
  const life = totals(rows); const streak = streaks(rows, now);
  const thisMonday = mondayOf(madridDay(now));
  const weekly = Array.from({ length: 6 }, (_, i) => shiftDay(thisMonday, -7 * (5 - i))).map(week => {
    const scores = rows.filter(row => row.kind === 'practice' && typeof row.score === 'number' && mondayOf(madridDay(row.created_at)) === week).map(row => row.score as number);
    return { week, avg: scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null, count: scores.length };
  });
  const byAxis = new Map<string, number[]>();
  for (const row of windowed) if (row.kind === 'practice' && isRecord(row.detail.axes)) for (const [axis, value] of Object.entries(row.detail.axes)) if (typeof value === 'number') byAxis.set(axis, [...(byAxis.get(axis) ?? []), value]);
  return {
    days, truncated,
    sessions: windowed.filter(row => row.kind === 'session').length,
    last_seen: rows[0]?.created_at ?? null,
    ...totals(windowed), streak, weekly,
    axes: [...byAxis].map(([axis, values]) => ({ axis, avg: Math.round(values.reduce((a, b) => a + b, 0) / values.length) })),
    recent: windowed.slice(0, 20),
    lifetime: { ...life, achievements: achievements(life, streak) },
  };
}

export const periodDays = (value: unknown, fallback = 30) => { const n = Number(value); return n === 7 || n === 30 || n === 90 ? n : fallback; };
