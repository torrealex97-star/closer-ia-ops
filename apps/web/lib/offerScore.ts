import { spainSignal } from './esPlaces';
import { fold, roleFromTitle } from './vocabulary';

// Puntuación 0-100 para ordenar miles de ofertas y quedarse con las mejores. Solo usa lo que la oferta dice:
// perfil por el título (closer > setter > …), España explícita, sueldo publicado, frescura y calidad del texto.
// Es una ayuda para priorizar; aprobar sigue siendo una decisión del operador.
export type Scorable = { title: string; company?: string | null; location?: string | null; salary?: string | null; description?: string | null; posted_at?: string | null; raw?: Record<string, unknown> };
export type Enrichment = { role: string | null; spain: boolean | null; score: number; fingerprint: string | null };

const SPANISH = /\b(?:de|la|el|los|las|para|con|en|y|que|una|un|experiencia|ventas|empresa|buscamos|incorporar|comercial|trabajo|oferta|requisitos|funciones|salario|jornada)\b/g;
export const spanishWords = (text: string) => (fold(text).match(SPANISH) ?? []).length;

const ROLE_POINTS: Record<string, number> = { closer: 40, setter: 30, cold_caller: 25, account_executive: 20, sdr: 18 };
const VERTICAL = /high.?ticket|alto ticket|infoproduct|coaching|mentor[ií]a|formaci[oó]n|academia|educaci[oó]n|bootcamp|programa de/i;

export function fingerprintOf(c: Scorable): string | null {
  const company = fold(c.company).replace(/[^a-z0-9]+/g, ' ').replace(/\b(sl|slu|sa|sociedad limitada|s l|s a)\b/g, '').trim();
  if (!company) return null;
  const title = fold(c.title).replace(/\((?:[^)]*[mhf]\/[mhf][^)]*|h\/m|m\/h)\)/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  const city = fold(c.location).split(',')[0].replace(/[^a-z0-9]+/g, ' ').trim();
  return `${company}|${title}|${city}`.slice(0, 240);
}

export function enrich(c: Scorable, now = Date.now()): Enrichment {
  const role = roleFromTitle(c.title);
  const spain = spainSignal(c.title, c.location);
  const text = `${c.title} ${c.description ?? ''}`;
  let score = role ? ROLE_POINTS[role] : 0;
  if (VERTICAL.test(text.slice(0, 800))) score += 5;
  score += spain === true ? 20 : spain === null ? 5 : -30;
  if (c.salary) score += 8;
  if (/comisi[oó]n|variable/i.test(c.description ?? '')) score += 4;
  if (c.raw?.is_remote === true) score += 4;
  if (c.posted_at) {
    const days = (now - Date.parse(c.posted_at)) / 86400000;
    score += days <= 2 ? 10 : days <= 5 ? 6 : days <= 10 ? 2 : 0;
  }
  const length = (c.description ?? '').length;
  score += length >= 1000 ? 6 : length >= 300 ? 4 : 0;
  if (spanishWords(text) >= 3) score += 5;
  return { role, spain, score: Math.max(0, Math.min(100, Math.round(score))), fingerprint: fingerprintOf(c) };
}
