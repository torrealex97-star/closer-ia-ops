import type { Metrics } from './metrics';

// Fuentes por niveles de coste y riesgo (ADR-009: coste por oferta buena descendente). Orden de preferencia:
// official (API con permiso, gratis) → scrape (JobSpy desde GitHub, sin coste, con riesgo de bloqueo) → paid (Apify, por uso).
export type Tier = 'official' | 'scrape' | 'paid' | 'other';
export const TIER_LABEL: Record<Tier, string> = { official: 'API oficial', scrape: 'Scraping gratuito', paid: 'De pago (Apify)', other: 'Otras' };
const OFFICIAL = new Set(['infojobs', 'adzuna', 'jooble']);
const SCRAPE = new Set(['indeed', 'linkedin', 'glassdoor', 'google', 'zip_recruiter', 'zip-recruiter', 'jobspy']);
export const tierOf = (source: string): Tier =>
  OFFICIAL.has(source) ? 'official' : SCRAPE.has(source) ? 'scrape' : /^apify(-|$)/.test(source) ? 'paid' : 'other';

// Ofertas buenas por día de los niveles NO de pago en los últimos 7 días (el calor de las fuentes gratuitas).
export function freeGoodPerDay(m: Pick<Metrics, 'perSource'>, days = 7): number {
  const good = m.perSource.filter(s => tierOf(s.source) !== 'paid').reduce((a, s) => a + s.perDay.slice(-days).reduce((x, y) => x + y, 0), 0);
  return good / days;
}
// Política opt-in: si las fuentes gratuitas ya dan ≥ objetivo ofertas buenas al día, no se lanza gasto nuevo en Apify.
// Sin APIFY_SKIP_IF_GOOD_PER_DAY (o ≤ 0) no cambia nada: el comportamiento por defecto es el de siempre.
export function skipPaidTier(m: Pick<Metrics, 'perSource'> | null, env: NodeJS.ProcessEnv = process.env): { skip: boolean; reason?: string } {
  const target = Number(env.APIFY_SKIP_IF_GOOD_PER_DAY);
  if (!Number.isFinite(target) || target <= 0 || !m) return { skip: false };
  const rate = freeGoodPerDay(m);
  return rate >= target ? { skip: true, reason: `fuentes gratuitas: ${rate.toFixed(1)} buenas/día ≥ ${target}` } : { skip: false };
}
