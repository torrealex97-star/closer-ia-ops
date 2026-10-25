import { PRACTICE_AXIS_IDS, PRACTICE_AXIS_LABELS } from '../components/practiceAxes';
import { ORG } from './external';
import { serviceRest } from './supabaseAuth';
import { listStudents, type StudentRow } from './students';

// Actividad de alumnas: señales de uso para los paneles de progreso. Se escribe
// solo desde el servidor (service role) y se lee acotada por organización. No
// guarda conversaciones ni texto libre: práctica = una sesión con feedback
// (nota global y nota de cada eje de la rúbrica), formación = una revisión de
// ejercicio o la corrección del examen.
export const ACTIVITY_KINDS = ['session', 'practice', 'training_review', 'training_exam'] as const;
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];
export const TRAINING_REFS = ['precall', 'logica', 'descubrimiento', 'freezing', 'yellows', 'star', 'cierres'] as const;
export type TrainingRef = (typeof TRAINING_REFS)[number];
// Mismo umbral que `trainingCheck.EXAM_PASS`; el servidor lo recalcula para no
// fiarse del `passed` que envía el navegador.
export const EXAM_PASS = 85;
export const ACTIVITY_DAYS = 30;
// Ventanas que el panel puede pedir. Cualquier otro valor se queda en 30 días.
export const ACTIVITY_WINDOWS = [7, 30, 90] as const;
export const activityWindow = (value: unknown): number => {
  const days = typeof value === 'string' ? Number(value) : value;
  return ACTIVITY_WINDOWS.includes(days as (typeof ACTIVITY_WINDOWS)[number]) ? (days as number) : ACTIVITY_DAYS;
};

export type EventRow = {
  id: string;
  student_id: string;
  kind: ActivityKind;
  ref: string | null;
  score: number | null;
  detail: Record<string, unknown>;
  created_at: string;
};

export type AxisStat = { id: string; label: string; average: number; count: number };
export type ScenarioStat = { id: string; count: number; average: number | null; last: string | null };
export type WeekStat = { start: string; count: number; average: number | null };

export type Summary = {
  sessions: number;
  lastSeen: string | null;
  practice: { count: number; last: string | null; best: number | null; average: number | null };
  training: { modules: string[]; lastReview: string | null; examBest: number | null; examPassed: boolean; examLast: string | null };
  // Días seguidos con al menos una práctica, contando hasta hoy o ayer.
  streak: number;
  // Media por criterio de la rúbrica. Solo ejes realmente puntuados.
  axes: AxisStat[];
  // Situaciones practicadas, para ver dónde se repite y qué cuesta más.
  scenarios: ScenarioStat[];
  // Hasta seis semanas con prácticas, de la más antigua a la más reciente.
  weeks: WeekStat[];
};

export type StudentProgress = Summary & {
  windowDays: number;
  recent: EventRow[];
  // Resumen sin ventana (logros y racha).
  lifetime: Summary;
  // Prácticas de la semana en curso (calendario de Madrid).
  thisWeek: { count: number; average: number | null };
  // Alguno de los dos listados llegó al tope y puede faltar actividad antigua.
  truncated: boolean;
};

const json = async (response: Response) => response.json().catch(() => null);
const since = (days: number) => new Date(Date.now() - days * 864e5).toISOString();
const isInteger = (value: unknown, min: number, max: number): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
const average = (values: number[]) => values.length ? Math.round(values.reduce((total, value) => total + value, 0) / values.length) : null;
const latest = (rows: EventRow[]) => rows.reduce<string | null>((last, event) => (!last || event.created_at > last ? event.created_at : last), null);
// Las alumnas están en España: el día y la semana se cortan en el calendario de
// Madrid, no en UTC. Con UTC, una práctica a las 00:30 contaba en el día anterior
// (y podía romper la racha o mover la barra de la semana).
const MADRID = 'Europe/Madrid';
const dayFormat = new Intl.DateTimeFormat('en-CA', { timeZone: MADRID, year: 'numeric', month: '2-digit', day: '2-digit' });
const dayKey = (value: string | number) => dayFormat.format(new Date(value));
const dayMinus = (key: string, days: number) => {
  const date = new Date(`${key}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
};
// Lunes de la semana de una fecha: agrupa la evolución sin depender del mes.
const weekStart = (value: string | number) => {
  const key = dayKey(value);
  const date = new Date(`${key}T00:00:00.000Z`);
  return dayMinus(key, (date.getUTCDay() + 6) % 7);
};

// `detail` se guarda como JSON pequeño y con claves permitidas: nada de texto libre.
export function sanitizeDetail(kind: ActivityKind, value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const raw = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  if (kind === 'practice') {
    if (isInteger(raw.turns, 1, 40)) out.turns = raw.turns;
    if (isInteger(raw.axes, 1, 12)) out.axes = raw.axes;
    if (raw.kind === 'venta' || raw.kind === 'entrevista') out.kind = raw.kind;
    // Nota por eje: solo ids de la rúbrica y enteros 0-100. Lo que no encaja se
    // descarta; nunca se guarda una clave inventada ni una nota fuera de rango.
    if (raw.scores && typeof raw.scores === 'object' && !Array.isArray(raw.scores)) {
      const scores: Record<string, number> = {};
      for (const [id, score] of Object.entries(raw.scores as Record<string, unknown>)) {
        if (!PRACTICE_AXIS_IDS.includes(id)) continue;
        if (!isInteger(score, 0, 100)) continue;
        scores[id] = score;
        if (Object.keys(scores).length >= PRACTICE_AXIS_IDS.length) break;
      }
      if (Object.keys(scores).length) out.scores = scores;
    }
  }
  if (kind === 'training_review') {
    if (isInteger(raw.met, 0, 20)) out.met = raw.met;
    if (isInteger(raw.total, 1, 20) && (out.met === undefined || (out.met as number) <= raw.total)) out.total = raw.total;
    if (out.met !== undefined && out.total === undefined) delete out.met;
  }
  if (kind === 'training_exam') {
    if (isInteger(raw.correct, 0, 20)) out.correct = raw.correct;
    if (isInteger(raw.total, 1, 20)) out.total = raw.total;
    if (isInteger(raw.score, 0, 100)) out.score = raw.score;
    if (typeof raw.passed === 'boolean') out.passed = raw.passed;
  }
  return JSON.stringify(out).length <= 2000 ? out : null;
}

export async function recordActivity(
  studentId: string,
  kind: ActivityKind,
  input: { ref?: string | null; score?: number | null; detail?: unknown } = {},
): Promise<boolean> {
  if (!/^[0-9a-f-]{36}$/.test(studentId) || !ACTIVITY_KINDS.includes(kind)) return false;
  const ref = typeof input.ref === 'string' && input.ref.length <= 80 ? input.ref : null;
  const score = typeof input.score === 'number' && Number.isFinite(input.score) ? Math.round(input.score) : null;
  if (score !== null && (score < 0 || score > 100)) return false;
  const detail = sanitizeDetail(kind, input.detail);
  if (!detail) return false;
  const response = await serviceRest('student_activity', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ org_id: ORG, student_id: studentId, kind, ref, score, detail }),
  }).catch(() => null);
  return Boolean(response?.ok);
}

// Una entrada cuenta como «está dentro» sin escribir en cada carga: 10 minutos
// por instancia. Es best-effort (serverless), suficiente para el panel.
const touched = new Map<string, number>();
const TOUCH_MS = 10 * 60 * 1000;
export async function touchSession(studentId: string): Promise<void> {
  const now = Date.now();
  if ((touched.get(studentId) ?? 0) > now - TOUCH_MS) return;
  touched.set(studentId, now);
  const ok = await recordActivity(studentId, 'session');
  if (!ok) touched.delete(studentId);
}

// Lectura acotada. Si la tabla no existe todavía o Supabase falla, devuelve null:
// quien llama decide qué hacer, y nunca lo convierte en ceros.
const SELECT = 'select=id,student_id,kind,ref,score,detail,created_at&order=created_at.desc';
type Read = { rows: EventRow[]; truncated: boolean };
async function readActivity(query: string, limit: number): Promise<Read | null> {
  const response = await serviceRest(`student_activity?${query}&${SELECT}&limit=${limit}`).catch(() => null);
  const rows = response?.ok ? await json(response) : null;
  if (!Array.isArray(rows)) return null;
  // Tope alcanzado: se dice, para que el panel no presente una lista cortada como completa.
  return { rows: rows as EventRow[], truncated: rows.length >= limit };
}

export async function activitySince(days = ACTIVITY_DAYS, limit = 5000): Promise<Read | null> {
  return readActivity(`org_id=eq.${ORG}&created_at=gte.${encodeURIComponent(since(days))}`, limit);
}

// Actividad de siempre (sin ventana) para logros y racha: cambiar el periodo del
// panel no debe retirar un logro ya conseguido.
const LIFETIME_LIMIT = 2000;

// Función pura: la UI y las pruebas parten de los mismos eventos. `now` se puede
// fijar en las pruebas; la racha no depende del orden en que lleguen las filas.
export function summarize(events: EventRow[], now = Date.now()): Summary {
  const sessions = events.filter(e => e.kind === 'session');
  const practiceEvents = events.filter(e => e.kind === 'practice');
  const practice = practiceEvents.filter(e => typeof e.score === 'number');
  const reviews = events.filter(e => e.kind === 'training_review' && e.ref);
  const exams = events.filter(e => e.kind === 'training_exam');
  const moduleSet = new Set(reviews.map(e => e.ref as string));
  const bestExam = exams.reduce<EventRow | null>((best, e) => (best === null || (e.score ?? -1) > (best.score ?? -1) ? e : best), null);
  const scores = practice.map(e => e.score as number);

  // Racha: días (calendario de Madrid) consecutivos con práctica, terminando hoy
  // o ayer. Si la última práctica es más antigua, la racha está rota y vale 0.
  const practiceDays = new Set(practiceEvents.map(e => dayKey(e.created_at)));
  const todayKey = dayKey(now);
  const yesterday = dayMinus(todayKey, 1);
  let cursor: string | null = practiceDays.has(todayKey) ? todayKey : practiceDays.has(yesterday) ? yesterday : null;
  let streak = 0;
  while (cursor) {
    streak += 1;
    const previous = dayMinus(cursor, 1);
    cursor = practiceDays.has(previous) ? previous : null;
  }

  // Notas por eje: solo prácticas que traen el desglose (las antiguas no lo tienen).
  const axisBuckets = new Map<string, number[]>();
  for (const event of practiceEvents) {
    const raw = event.detail?.scores;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
      if (!(id in PRACTICE_AXIS_LABELS) || typeof value !== 'number') continue;
      const bucket = axisBuckets.get(id);
      if (bucket) bucket.push(value); else axisBuckets.set(id, [value]);
    }
  }
  const axes: AxisStat[] = PRACTICE_AXIS_IDS
    .filter(id => axisBuckets.has(id))
    .map(id => ({ id, label: PRACTICE_AXIS_LABELS[id], average: average(axisBuckets.get(id)!) ?? 0, count: axisBuckets.get(id)!.length }));

  // Situaciones: veces y media por escenario, de la más practicada a la menos.
  const scenarioMap = new Map<string, { scores: number[]; count: number; last: string | null }>();
  for (const event of practiceEvents) {
    if (!event.ref) continue;
    const entry = scenarioMap.get(event.ref) ?? { scores: [], count: 0, last: null };
    entry.count += 1;
    if (typeof event.score === 'number') entry.scores.push(event.score);
    if (!entry.last || event.created_at > entry.last) entry.last = event.created_at;
    scenarioMap.set(event.ref, entry);
  }
  const scenarios: ScenarioStat[] = [...scenarioMap.entries()]
    .map(([id, entry]) => ({ id, count: entry.count, average: average(entry.scores), last: entry.last }))
    .sort((a, b) => b.count - a.count || a.id.localeCompare(b.id));

  // Evolución por semana (lunes UTC), máximo seis.
  const weekMap = new Map<string, number[]>();
  for (const event of practice) {
    const start = weekStart(event.created_at);
    const bucket = weekMap.get(start) ?? [];
    bucket.push(event.score as number);
    weekMap.set(start, bucket);
  }
  const weeks: WeekStat[] = [...weekMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-6)
    .map(([start, values]) => ({ start, count: values.length, average: average(values) }));

  return {
    sessions: sessions.length,
    lastSeen: latest(sessions),
    practice: {
      count: practice.length,
      last: latest(practice),
      best: scores.length ? Math.max(...scores) : null,
      average: average(scores),
    },
    training: {
      modules: [...moduleSet].sort(),
      lastReview: latest(reviews),
      examBest: bestExam?.score ?? null,
      examPassed: (bestExam?.score ?? -1) >= EXAM_PASS,
      examLast: latest(exams),
    },
    streak,
    axes,
    scenarios,
    weeks,
  };
}

// ---- Lectura de equipo para la coordinadora ----
// Se agrega a partir de los mismos resúmenes que ve cada alumna: nada nuevo se
// mide aquí, solo se suma. Un criterio sin notas no aparece (no vale 0).
export type TeamAxis = { id: string; label: string; average: number; practices: number; students: number };
export type TeamWeek = { start: string; count: number; average: number | null; students: number };
export type TeamSummary = {
  students: number;
  practicing: number;
  practiceTotal: number;
  practiceAverage: number | null;
  // Criterios con al menos una nota, de la rúbrica a la más baja.
  axes: TeamAxis[];
  weakest: TeamAxis | null;
  weakestScenario: { id: string; count: number; average: number | null } | null;
  weeks: TeamWeek[];
  // Alumnas con racha de dos días o más.
  inStreak: number;
  // Sin practicar nunca (habiendo entrado) o sin practicar desde hace más de 7 días.
  needsHelp: number;
  neverEntered: number;
};

/** El criterio más bajo de una alumna, con su media y cuántas prácticas lo miden. */
export function weakestAxis(summary: Summary): AxisStat | null {
  const graded = summary.axes.filter(axis => axis.count > 0);
  return graded.length ? [...graded].sort((a, b) => a.average - b.average)[0] : null;
}

export type RiskLevel = 'alto' | 'medio' | 'ok';
export type Risk = { id: 'sin_entrar' | 'sin_practicar' | 'inactiva' | 'practicando'; label: string; level: RiskLevel };
/**
 * Seguimiento, no nota: clasifica por uso (¿entra? ¿practica? ¿cuándo fue la
 * última vez?) y nunca por la puntuación, que es una estimación de rúbrica.
 */
export function riskOf(summary: Summary, now = Date.now()): Risk {
  if (!summary.lastSeen) return { id: 'sin_entrar', label: 'Nunca ha entrado', level: 'alto' };
  if (summary.practice.count === 0) return { id: 'sin_practicar', label: 'Entra, no practica', level: 'alto' };
  const last = summary.practice.last ? Date.parse(summary.practice.last) : NaN;
  if (!Number.isFinite(last) || now - last > 7 * 864e5) return { id: 'inactiva', label: 'Sin practicar desde hace más de 7 días', level: 'medio' };
  return { id: 'practicando', label: 'Practica esta semana', level: 'ok' };
}

/** Suma la actividad de todas las alumnas de la ventana. */
export function teamSummary(rows: Array<{ summary: Summary }>, now = Date.now()): TeamSummary {
  const practiceTotal = rows.reduce((total, row) => total + row.summary.practice.count, 0);
  // Media ponderada por prácticas, no media de medias: una alumna con 20 prácticas
  // no puede pesar lo mismo que otra con una.
  const weighted = rows.reduce((total, row) => total + (row.summary.practice.average ?? 0) * row.summary.practice.count, 0);
  const axisMap = new Map<string, { label: string; sum: number; practices: number; students: number }>();
  for (const { summary } of rows) {
    for (const axis of summary.axes) {
      if (!axis.count) continue;
      const entry = axisMap.get(axis.id) ?? { label: axis.label, sum: 0, practices: 0, students: 0 };
      entry.sum += axis.average * axis.count;
      entry.practices += axis.count;
      entry.students += 1;
      axisMap.set(axis.id, entry);
    }
  }
  const axes: TeamAxis[] = PRACTICE_AXIS_IDS
    .filter(id => axisMap.has(id))
    .map(id => {
      const entry = axisMap.get(id)!;
      return { id, label: entry.label, average: Math.round(entry.sum / entry.practices), practices: entry.practices, students: entry.students };
    });
  const scenarioMap = new Map<string, { sum: number; graded: number; count: number }>();
  for (const { summary } of rows) {
    for (const scenario of summary.scenarios) {
      const entry = scenarioMap.get(scenario.id) ?? { sum: 0, graded: 0, count: 0 };
      entry.count += scenario.count;
      if (scenario.average !== null) { entry.sum += scenario.average * scenario.count; entry.graded += scenario.count; }
      scenarioMap.set(scenario.id, entry);
    }
  }
  const scenarios = [...scenarioMap.entries()].map(([id, entry]) => ({ id, count: entry.count, average: entry.graded ? Math.round(entry.sum / entry.graded) : null }));
  const gradedScenarios = scenarios.filter(s => s.average !== null);
  const weakestScenario = gradedScenarios.length
    ? [...gradedScenarios].sort((a, b) => (a.average as number) - (b.average as number) || b.count - a.count)[0]
    : null;
  const weekMap = new Map<string, { sum: number; graded: number; count: number; students: number }>();
  for (const { summary } of rows) {
    for (const week of summary.weeks) {
      const entry = weekMap.get(week.start) ?? { sum: 0, graded: 0, count: 0, students: 0 };
      entry.count += week.count;
      entry.students += 1;
      if (week.average !== null) { entry.sum += week.average * week.count; entry.graded += week.count; }
      weekMap.set(week.start, entry);
    }
  }
  const weeks: TeamWeek[] = [...weekMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-6)
    .map(([start, entry]) => ({ start, count: entry.count, average: entry.graded ? Math.round(entry.sum / entry.graded) : null, students: entry.students }));
  return {
    students: rows.length,
    practicing: rows.filter(row => row.summary.practice.count > 0).length,
    practiceTotal,
    practiceAverage: practiceTotal ? Math.round(weighted / practiceTotal) : null,
    axes,
    weakest: axes.length ? [...axes].sort((a, b) => a.average - b.average)[0] : null,
    weakestScenario,
    weeks,
    inStreak: rows.filter(row => row.summary.streak >= 2).length,
    needsHelp: rows.filter(row => riskOf(row.summary, now).level === 'alto').length,
    neverEntered: rows.filter(row => !row.summary.lastSeen).length,
  };
}

export type StudentWithProgress = { student: StudentRow; summary: Summary; recent: EventRow[] };
export type OrgProgress = {
  windowDays: number;
  progress: StudentWithProgress[];
  // Agregado del equipo para la coordinadora (medias ponderadas, criterio más
  // débil y evolución). Se calcula con los mismos resúmenes de cada alumna.
  team: TeamSummary;
  totals: { students: number; active: number; entered7: number; practiced7: number; practiced: number; neverPracticed: number; examPassed: number; neverEntered: number };
  // false = no se pudo leer la actividad (tabla sin migrar, Supabase caído).
  // El panel debe decirlo y no pintar esos huecos como ceros.
  activityAvailable: boolean;
  truncated: boolean;
};

export async function studentProgress(studentId: string, days = ACTIVITY_DAYS): Promise<StudentProgress | null> {
  const [windowed, lifetime] = await Promise.all([
    readActivity(`org_id=eq.${ORG}&student_id=eq.${studentId}&created_at=gte.${encodeURIComponent(since(days))}`, 600),
    readActivity(`org_id=eq.${ORG}&student_id=eq.${studentId}`, LIFETIME_LIMIT),
  ]);
  if (!windowed) return null;
  const summary = summarize(windowed.rows);
  // «Esta semana» es la semana en curso, no la última con práctica: si aún no ha
  // practicado, cuenta 0 aunque arrastre historial de la semana pasada.
  const current = summary.weeks.find(week => week.start === weekStart(Date.now()));
  // Si la lectura de siempre falla, se usa la ventana: mejor una racha corta que un logro inventado.
  return {
    ...summary,
    windowDays: days,
    recent: windowed.rows.slice(0, 40),
    lifetime: summarize((lifetime ?? windowed).rows),
    thisWeek: { count: current?.count ?? 0, average: current?.average ?? null },
    truncated: windowed.truncated || Boolean(lifetime?.truncated),
  };
}

// El panel de la coordinadora: todas las alumnas de la organización y su
// actividad reciente. Una alumna sin filas aparece con «sin actividad», no con 0.
export async function orgProgress(days = ACTIVITY_DAYS): Promise<OrgProgress | null> {
  const [students, read] = await Promise.all([listStudents(), activitySince(days)]);
  // La lista de alumnas manda: si la actividad no se puede leer, el panel sigue
  // mostrando quién tiene acceso, con la actividad marcada como no disponible.
  if (!students) return null;
  const events = read?.rows ?? [];
  const byStudent = new Map<string, EventRow[]>();
  for (const event of events) {
    const bucket = byStudent.get(event.student_id);
    if (bucket) bucket.push(event); else byStudent.set(event.student_id, [event]);
  }
  const week = Date.now() - 7 * 864e5;
  const progress = students.map(student => {
    const mine = byStudent.get(student.id) ?? [];
    return { student, summary: summarize(mine), recent: mine.slice(0, 30) };
  });
  return {
    windowDays: days,
    progress,
    team: teamSummary(progress),
    activityAvailable: Boolean(read),
    truncated: Boolean(read?.truncated),
    totals: {
      students: students.length,
      active: students.filter(s => s.status === 'active').length,
      entered7: progress.filter(p => p.summary.lastSeen && Date.parse(p.summary.lastSeen) >= week).length,
      practiced7: progress.filter(p => p.summary.practice.last && Date.parse(p.summary.practice.last) >= week).length,
      practiced: progress.filter(p => p.summary.practice.count > 0).length,
      neverPracticed: progress.filter(p => p.summary.practice.count === 0).length,
      examPassed: progress.filter(p => p.summary.training.examPassed).length,
      neverEntered: progress.filter(p => !p.summary.lastSeen).length,
    },
  };
}
