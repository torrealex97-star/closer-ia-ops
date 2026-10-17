import { ORG } from './external';
import { serviceRest } from './supabaseAuth';

// Métricas de oferta (incremento 0.2). Todo se calcula de datos reales; lo que no se mide se declara `null`
// (p. ej. minutos de revisión: la app no registra el tiempo, solo cuántas decisiones tomó una persona).
export const GOOD_SCORE = 60;
export type OfferRow = { source: string; score: number | null; spain: boolean | null; editorial_status: string; first_seen_at: string; reviewed_by: string | null; reviewed_at: string | null };
export type RunRow = { cost_usd: number | string | null; started_at: string; status?: string };
export type Metrics = {
  days: string[]; goodPerDay: Record<string, number>; perSource: Array<{ source: string; total: number; good: number; approved: number; perDay: number[] }>;
  apify: { cost_usd: number; runs: number; good_offers: number; cost_per_good: number | null };
  review: { human_decisions: number; ai_decisions: number; minutes: null };
};
// «Buena» = puntuación ≥ GOOD_SCORE y señal clara de España (la misma vara que el filtro del panel).
export const isGood = (o: OfferRow) => (o.score ?? 0) >= GOOD_SCORE && o.spain === true;
const dayKey = (iso: string) => iso.slice(0, 10);

export function computeMetrics(offers: OfferRow[], runs: RunRow[], now: Date, windowDays = 14): Metrics {
  const days = Array.from({ length: windowDays }, (_, i) => dayKey(new Date(now.getTime() - (windowDays - 1 - i) * 864e5).toISOString()));
  const index = new Map(days.map((d, i) => [d, i]));
  const goodPerDay = Object.fromEntries(days.map(d => [d, 0])) as Record<string, number>;
  const by = new Map<string, Metrics['perSource'][number]>();
  for (const o of offers) {
    const i = index.get(dayKey(o.first_seen_at)); if (i === undefined) continue;
    const s = by.get(o.source) ?? { source: o.source, total: 0, good: 0, approved: 0, perDay: Array(windowDays).fill(0) };
    s.total++;
    if (isGood(o)) { s.good++; s.perDay[i]++; goodPerDay[days[i]]++; }
    if (o.editorial_status === 'approved' || o.editorial_status === 'published') s.approved++;
    by.set(o.source, s);
  }
  const apifyGood = offers.filter(o => o.source.startsWith('apify') && isGood(o) && index.has(dayKey(o.first_seen_at))).length;
  const cost = runs.reduce((a, r) => a + (Number(r.cost_usd) || 0), 0);
  const since = now.getTime() - windowDays * 864e5;
  const decided = offers.filter(o => o.reviewed_at && Date.parse(o.reviewed_at) >= since);
  return {
    days, goodPerDay, perSource: [...by.values()].sort((a, b) => b.good - a.good || a.source.localeCompare(b.source)),
    apify: { cost_usd: Math.round(cost * 100) / 100, runs: runs.length, good_offers: apifyGood, cost_per_good: apifyGood ? Math.round((cost / apifyGood) * 1000) / 1000 : null },
    review: { human_decisions: decided.filter(o => o.reviewed_by !== 'ai-review' && o.reviewed_by !== 'auto-vigencia').length, ai_decisions: decided.filter(o => o.reviewed_by === 'ai-review').length, minutes: null },
  };
}

export async function loadMetrics(now = new Date(), windowDays = 14): Promise<Metrics | null> {
  const since = encodeURIComponent(new Date(now.getTime() - windowDays * 864e5).toISOString());
  const [o, r] = await Promise.all([
    serviceRest(`external_offers?org_id=eq.${ORG}&first_seen_at=gte.${since}&select=source,score,spain,editorial_status,first_seen_at,reviewed_by,reviewed_at&limit=10000`),
    serviceRest(`apify_runs?org_id=eq.${ORG}&started_at=gte.${since}&select=cost_usd,started_at,status&limit=1000`),
  ]);
  if (!o.ok) return null;
  const offers = await o.json().catch(() => null), runs = r.ok ? await r.json().catch(() => []) : [];
  return Array.isArray(offers) ? computeMetrics(offers, Array.isArray(runs) ? runs : [], now, windowDays) : null;
}
