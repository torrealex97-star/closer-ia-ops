import { EXAM_PASS } from '../components/trainingCheck';
import { REVIEW_REFS } from '../components/trainingRefs';
import { madridDay } from './studentActivity';
import type { ActivityRow } from './studentActivity';

// Métricas de la alumna, definidas aquí y en ningún otro sitio (ADR-014). Todo se DERIVA de la actividad y de las candidaturas:
// no hay tabla de XP que se pueda inflar. Lo que no se mide es `null`, nunca un cero.
export const XP = { session: 5, module: 20, examPassed: 100, practice: 10, practicesPerDay: 3 } as const;
// XP por candidatura según hasta dónde ha llegado (declarado por la alumna): enviarla ya cuenta; una respuesta, aunque sea un
// rechazo, cuenta más (no se penaliza que digan que no).
export const APP_XP: Record<string, number> = { applied: 15, responded: 40, interview: 90, offer: 190, rejected: 40 };
export const LEVEL_FLOORS = [0, 100, 250, 500, 900, 1400, 2000, 3000] as const;

export type XpPart = { id: string; label: string; xp: number };
export type XpResult = { xp: number; level: number; floor: number; next: number | null; parts: XpPart[] };

export function xpAndLevel(rows: Pick<ActivityRow, 'kind' | 'ref' | 'score' | 'created_at'>[], appStatuses: string[] | null): XpResult {
  const sessionDays = new Set(rows.filter(row => row.kind === 'session').map(row => madridDay(row.created_at)));
  const modules = new Set(rows.filter(row => row.kind === 'training_review' && row.ref && (REVIEW_REFS as readonly string[]).includes(row.ref)).map(row => row.ref));
  const passed = rows.some(row => row.kind === 'training_exam' && typeof row.score === 'number' && row.score >= EXAM_PASS);
  // Antifraude: solo cuentan las tres primeras prácticas de cada día (Madrid).
  const perDay = new Map<string, number>(); let practiceXp = 0;
  for (const row of [...rows].sort((a, b) => a.created_at.localeCompare(b.created_at))) {
    if (row.kind !== 'practice' || typeof row.score !== 'number') continue;
    const day = madridDay(row.created_at); const n = perDay.get(day) ?? 0;
    if (n >= XP.practicesPerDay) continue;
    perDay.set(day, n + 1); practiceXp += XP.practice + Math.round(row.score / 10);
  }
  const appXp = (appStatuses ?? []).reduce((sum, status) => sum + (APP_XP[status] ?? 0), 0);
  const parts: XpPart[] = [
    { id: 'sessions', label: 'Días que has entrado', xp: sessionDays.size * XP.session },
    { id: 'modules', label: 'Módulos repasados', xp: modules.size * XP.module },
    { id: 'exam', label: 'Examen superado', xp: passed ? XP.examPassed : 0 },
    { id: 'practice', label: 'Prácticas', xp: practiceXp },
    { id: 'applications', label: 'Candidaturas', xp: appXp },
  ];
  const xp = parts.reduce((sum, part) => sum + part.xp, 0);
  let level = 0; LEVEL_FLOORS.forEach((floor, i) => { if (xp >= floor) level = i; });
  return { xp, level: level + 1, floor: LEVEL_FLOORS[level], next: LEVEL_FLOORS[level + 1] ?? null, parts };
}

export type Mastery = { ref: string; count: number; avg: number; best: number };
// Nota media por escenario de práctica (los escenarios aún no llevan nicho: cuando lo lleven, se agrupará por nicho).
export function masteryByScenario(rows: Pick<ActivityRow, 'kind' | 'ref' | 'score'>[]): Mastery[] {
  const by = new Map<string, number[]>();
  for (const row of rows) if (row.kind === 'practice' && row.ref && typeof row.score === 'number') by.set(row.ref, [...(by.get(row.ref) ?? []), row.score]);
  return [...by].map(([ref, scores]) => ({ ref, count: scores.length, avg: Math.round(scores.reduce((a, b) => a + b, 0) / scores.length), best: Math.max(...scores) }))
    .sort((a, b) => b.count - a.count || b.avg - a.avg || a.ref.localeCompare(b.ref));
}

export type AppFunnel = { total: number; sent: number; responded: number; interviews: number; offers: number; rejected: number; responseRate: number | null };
const SENT = new Set(['applied', 'responded', 'interview', 'offer', 'rejected']);
const RESPONDED = new Set(['responded', 'interview', 'offer', 'rejected']);
// Tasa de respuesta = candidaturas con respuesta / candidaturas enviadas; sin enviadas no hay tasa (`null`, «—»).
export function applicationFunnel(statuses: string[]): AppFunnel {
  const sent = statuses.filter(status => SENT.has(status)).length;
  const responded = statuses.filter(status => RESPONDED.has(status)).length;
  return {
    total: statuses.length, sent, responded,
    interviews: statuses.filter(status => status === 'interview' || status === 'offer').length,
    offers: statuses.filter(status => status === 'offer').length,
    rejected: statuses.filter(status => status === 'rejected').length,
    responseRate: sent ? Math.round((responded / sent) * 100) : null,
  };
}
