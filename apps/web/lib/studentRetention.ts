import { madridDay, mondayOf, streaks, type ActivityRow } from './studentActivity';

// Reglas de retención: solo CÁLCULO. Ninguna de estas funciones envía nada (ni correo ni WhatsApp):
// el aviso real a una alumna es un mensaje automático a una persona y queda apagado hasta orden expresa.
// Los días son los de Europe/Madrid; «sin práctica» cuenta solo prácticas de la sala, no entradas.
type Row = Pick<ActivityRow, 'kind' | 'ref' | 'score' | 'created_at'>;

export const SOFT_IDLE_DAYS = 2;
export const STRONG_IDLE_DAYS = 4;
export const REVIEW_SCORE = 60;
export const REVIEW_STREAK = 3;
export const GOAL_TARGETS = { practices: 3, applications: 5, modules: 1 } as const;

const DAY_MS = 86_400_000;
const dayNumber = (key: string) => { const [y, m, d] = key.split('-').map(Number); return Date.UTC(y, m - 1, d) / DAY_MS; };

export type IdleNudge = {
  level: 'none' | 'soft' | 'strong';
  /** Días de calendario (Madrid) desde la última práctica; `null` si aún no ha practicado nunca (no es inactividad). */
  idleDays: number | null;
  /** Racha en juego cuando el aviso es preventivo (>0), o `null`. */
  streakAtRisk: number | null;
};

export function idleNudge(rows: Row[], now = new Date()): IdleNudge {
  const practices = rows.filter(row => row.kind === 'practice');
  if (!practices.length) return { level: 'none', idleDays: null, streakAtRisk: null };
  const last = practices.reduce((a, b) => (a.created_at > b.created_at ? a : b));
  const idleDays = Math.max(0, dayNumber(madridDay(now)) - dayNumber(madridDay(last.created_at)));
  const level = idleDays >= STRONG_IDLE_DAYS ? 'strong' : idleDays >= SOFT_IDLE_DAYS ? 'soft' : 'none';
  const current = streaks(rows, now).current;
  return { level, idleDays, streakAtRisk: level === 'soft' && current > 0 ? current : null };
}

export type DirectReview = { eligible: boolean; lastScores: number[] };
/** «Revisión directa de mentora»: las tres últimas prácticas puntuadas quedan por debajo de 60. */
export function directReview(rows: Row[]): DirectReview {
  const scores = rows.filter(row => row.kind === 'practice' && typeof row.score === 'number')
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1)).slice(0, REVIEW_STREAK).map(row => row.score as number);
  return { eligible: scores.length === REVIEW_STREAK && scores.every(score => score < REVIEW_SCORE), lastScores: scores };
}

export type Goal = { id: 'practices' | 'applications' | 'modules'; label: string; target: number; current: number | null; done: boolean };
/** Tres objetivos de la semana en curso (lunes a domingo, Madrid). `sentThisWeek` es `null` si no se pudieron leer las candidaturas. */
export function weeklyGoals(rows: Row[], sentThisWeek: number | null, now = new Date()): Goal[] {
  const week = mondayOf(madridDay(now));
  const inWeek = (row: Row) => mondayOf(madridDay(row.created_at)) === week;
  const practices = rows.filter(row => row.kind === 'practice' && inWeek(row)).length;
  const modules = new Set(rows.filter(row => row.kind === 'training_review' && row.ref && inWeek(row)).map(row => row.ref)).size;
  const goal = (id: Goal['id'], label: string, target: number, current: number | null): Goal => ({ id, label, target, current, done: current !== null && current >= target });
  return [
    goal('practices', 'Completar 3 prácticas en la sala', GOAL_TARGETS.practices, practices),
    goal('applications', 'Enviar 5 candidaturas', GOAL_TARGETS.applications, sentThisWeek),
    goal('modules', 'Repasar 1 módulo de formación', GOAL_TARGETS.modules, modules),
  ];
}

/** Candidaturas pasadas a «enviada» durante la semana en curso (por `applied_at`; los borradores no cuentan). */
export function sentThisWeek(apps: { applied_at: string | null }[], now = new Date()): number {
  const week = mondayOf(madridDay(now));
  return apps.filter(app => app.applied_at && mondayOf(madridDay(app.applied_at)) === week).length;
}
