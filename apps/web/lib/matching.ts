import { externalForStudent } from './externalSurface';
import { getProfile, type Profile } from './students';
import { fold } from './vocabulary';

// Matching (incremento 3.1): RECOMIENDA ofertas ya aprobadas a una alumna según SU perfil. Solo lectura: no envía nada,
// no aplica a nada y no guarda resultados. Explicable (cada punto tiene su motivo) y sin inventar: lo que no se sabe
// se lista en `unknowns` en vez de suponerse.
export type Opp = { id: string; role: string; role_label: string; original_title: string; company: string; compensation: string; modality: string; location: string; published_at: string | null; source_url: string; description: string };
export type Match = { opportunity: Opp; score: number; reasons: string[]; unknowns: string[] };
export type MatchProfile = Pick<Profile, 'city' | 'target_roles' | 'languages'>;
export const MAX_MATCHES = 20;

const days = (iso: string | null, now: number) => iso && Number.isFinite(Date.parse(iso)) ? Math.max(0, (now - Date.parse(iso)) / 864e5) : null;

export function scoreOpportunity(p: MatchProfile, o: Opp, now = Date.now()): Match | null {
  const reasons: string[] = [], unknowns: string[] = [];
  let score = 0;
  // Perfil: si eligió perfiles, la oferta DEBE ser de uno de ellos; si no eligió, no se descarta nada pero puntúa menos.
  if (p.target_roles.length) {
    if (!p.target_roles.includes(o.role)) return null;
    score += 50; reasons.push(`Es de tu perfil: ${o.role_label}`);
  } else { score += 20; unknowns.push('No has elegido perfiles de interés'); }
  // Ubicación: remoto o misma ciudad. Sin ciudad en el perfil o sin ubicación en la oferta, no se supone nada.
  const city = fold(p.city).trim();
  if (o.modality === 'Remoto') { score += 15; reasons.push('Remoto'); }
  else if (city && o.location && !/no indicada/i.test(o.location) && fold(o.location).includes(city)) { score += 15; reasons.push(`En tu ciudad (${p.city})`); }
  else if (!city) unknowns.push('No has indicado tu ciudad');
  else if (/no indicada/i.test(o.location)) unknowns.push('La oferta no indica ubicación');
  // Condiciones y frescura (solo lo declarado en el anuncio).
  if (o.compensation && !/no publicado/i.test(o.compensation)) { score += 10; reasons.push('Publica la retribución'); } else unknowns.push('No publica la retribución');
  const age = days(o.published_at, now);
  if (age === null) unknowns.push('Fecha de publicación no indicada');
  else if (age <= 3) { score += 15; reasons.push('Publicada hace pocos días'); } else if (age <= 7) { score += 8; reasons.push('Publicada esta semana'); }
  return { opportunity: { ...o, description: (o.description ?? '').slice(0, 400) }, score: Math.min(100, score), reasons, unknowns };
}

// Orden estable: puntuación, luego más reciente y luego título. Solo las `MAX_MATCHES` primeras.
export function rankMatches(p: MatchProfile, opps: Opp[], now = Date.now()): Match[] {
  return opps.map(o => scoreOpportunity(p, o, now)).filter((m): m is Match => m !== null)
    .sort((a, b) => b.score - a.score || (Date.parse(b.opportunity.published_at ?? '') || 0) - (Date.parse(a.opportunity.published_at ?? '') || 0) || a.opportunity.original_title.localeCompare(b.opportunity.original_title))
    .slice(0, MAX_MATCHES);
}

export type Recommendation = { ready: boolean; hint?: string; matches: Match[] };
// Las ofertas salen de las ya aprobadas por el equipo y filtradas por las reglas de la vista de alumna (perfil, España, idioma, antigüedad).
export async function recommendForStudent(userId: string, loadProfile: typeof getProfile = getProfile, load: typeof externalForStudent = externalForStudent): Promise<Recommendation> {
  const profile = await loadProfile(userId);
  if (!profile?.consent_at) return { ready: false, hint: 'Completa y guarda tu perfil para ver ofertas para ti.', matches: [] };
  if (!profile.languages.includes('es') && !profile.languages.includes('en')) return { ready: false, hint: 'Indica en tu perfil si hablas español o inglés.', matches: [] };
  const opps = await load({ role: null, market: 'any', days: 10, include_bilingual: profile.languages.includes('en'), starred_only: false }).catch(() => []);
  return { ready: true, matches: rankMatches(profile, opps as unknown as Opp[]) };
}
