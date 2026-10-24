import { REVIEW_REFS } from '../components/trainingRefs';

// Agregados para el panel de coordinación. Solo datos reales de la actividad de las alumnas: lo que no se sabe es `null`,
// nunca un cero, y las distribuciones no se calculan con menos de MIN_GROUP alumnas con actividad (no señalar a nadie).
export const MIN_GROUP = 5;
export type DashStudent = { id: string; email: string; status: 'invited' | 'active' | 'paused' };
export type DashSummary = { sessions: number; last_seen: string | null; practice: { count: number; avg: number | null }; training: { modules: string[]; examBest: number | null; examPassed: boolean } };

export type FunnelStep = { id: string; label: string; count: number; pct: number | null };
// Embudo sobre las alumnas no pausadas: invitadas → han entrado → han practicado → han repasado un módulo → examen superado.
export function funnel(students: DashStudent[], summaries: Map<string, DashSummary>): FunnelStep[] {
  const base = students.filter(student => student.status !== 'paused');
  const seen = (test: (s: DashSummary) => boolean) => base.filter(student => { const s = summaries.get(student.id); return Boolean(s && test(s)); }).length;
  const counts: [string, string, number][] = [
    ['invited', 'Con acceso', base.length],
    ['entered', 'Han entrado', seen(s => s.sessions > 0)],
    ['practiced', 'Han practicado', seen(s => s.practice.count > 0)],
    ['studied', 'Han repasado algún módulo', seen(s => s.training.modules.length > 0)],
    ['passed', 'Examen superado', seen(s => s.training.examPassed)],
  ];
  return counts.map(([id, label, count]) => ({ id, label, count, pct: base.length ? Math.round((count / base.length) * 100) : null }));
}

export type ModuleCoverage = { ref: string; count: number; pct: number | null };
export function moduleCoverage(students: DashStudent[], summaries: Map<string, DashSummary>): ModuleCoverage[] {
  const base = students.filter(student => student.status !== 'paused');
  return REVIEW_REFS.map(ref => {
    const count = base.filter(student => summaries.get(student.id)?.training.modules.includes(ref)).length;
    return { ref, count, pct: base.length ? Math.round((count / base.length) * 100) : null };
  });
}

export type ScoreBucket = { id: 'low' | 'mid' | 'high'; label: string; count: number; pct: number };
// Distribución de la nota media de práctica entre las alumnas con acceso (las pausadas no cuentan) que han practicado; `pct`
// es sobre ESAS alumnas, no sobre todas. `null` si hay menos de MIN_GROUP: no señalar a nadie.
export function scoreBuckets(students: DashStudent[], summaries: Map<string, DashSummary>): ScoreBucket[] | null {
  const avgs = students.filter(student => student.status !== 'paused')
    .map(student => summaries.get(student.id)?.practice.avg).filter((v): v is number => typeof v === 'number');
  if (avgs.length < MIN_GROUP) return null;
  const counts = [['low', 'Menos de 40', avgs.filter(v => v < 40).length], ['mid', 'De 40 a 69', avgs.filter(v => v >= 40 && v < 70).length], ['high', '70 o más', avgs.filter(v => v >= 70).length]] as const;
  return counts.map(([id, label, count]) => ({ id, label, count, pct: Math.round((count / avgs.length) * 100) }));
}

export const NUDGE_LIMIT = 8;
export type Nudge = { id: string; email: string; reason: string };
// Quién necesita un empujón: con acceso (no pausada) y sin entrar en el periodo, o entrada sin ninguna práctica ni repaso.
export function needsNudge(students: DashStudent[], summaries: Map<string, DashSummary>): Nudge[] {
  const out: Nudge[] = [];
  for (const student of students) {
    if (student.status === 'paused') continue;
    const s = summaries.get(student.id);
    if (!s || s.sessions === 0) out.push({ id: student.id, email: student.email, reason: student.status === 'invited' ? 'Invitada, aún no ha entrado' : 'No ha entrado en este periodo' });
    else if (s.practice.count === 0 && s.training.modules.length === 0) out.push({ id: student.id, email: student.email, reason: 'Ha entrado, pero no ha practicado ni repasado nada' });
  }
  return out;
}
