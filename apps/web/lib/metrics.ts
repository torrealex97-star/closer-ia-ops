import { isHumanReviewer, ORG } from './external';
import { serviceRest } from './supabaseAuth';
import { tierOf, type Tier } from './sourceTiers';

// Métricas de oferta (incremento 0.2). Todo se calcula de datos reales; lo que no se mide se declara `null`
// (p. ej. minutos de revisión: la app no registra el tiempo, solo cuántas decisiones tomó una persona).
export const GOOD_SCORE = 60;
export type OfferRow = { source: string; score: number | null; spain: boolean | null; editorial_status: string; first_seen_at: string; reviewed_by: string | null; reviewed_at: string | null };
export type DecidedRow = Pick<OfferRow, 'reviewed_by' | 'reviewed_at'>;
export type RunRow = { cost_usd: number | string | null; started_at: string; status?: string };
export type Metrics = {
  days: string[]; goodPerDay: Record<string, number>; perSource: Array<{ source: string; total: number; good: number; approved: number; perDay: number[] }>;
  perTier: Array<{ tier: Tier; total: number; good: number }>;
  // null = no se pudo leer (distinto de 0): un hueco no es un cero.
  apify: { cost_usd: number | null; runs: number | null; good_offers: number; cost_per_good: number | null };
  review: { human_decisions: number | null; ai_decisions: number | null; minutes: null };
};
// «Buena» = puntuación ≥ GOOD_SCORE y señal clara de España (la misma vara que el filtro del panel).
export const isGood = (o: OfferRow) => (o.score ?? 0) >= GOOD_SCORE && o.spain === true;
const dayKey = (iso: string) => iso.slice(0, 10);

// `runs` null = lectura fallida. `decidedRows`: decisiones tomadas en la ventana sobre CUALQUIER oferta (no solo las vistas en ella);
// undefined = se deducen de `offers`; null = lectura fallida.
export function computeMetrics(offers: OfferRow[], runs: RunRow[] | null, now: Date, windowDays = 14, decidedRows?: DecidedRow[] | null): Metrics {
  const days = Array.from({ length: windowDays }, (_, i) => dayKey(new Date(now.getTime() - (windowDays - 1 - i) * 864e5).toISOString()));
  const index = new Map(days.map((d, i) => [d, i]));
  const goodPerDay = Object.fromEntries(days.map(d => [d, 0])) as Record<string, number>;
  const by = new Map<string, Metrics['perSource'][number]>();
  for (const o of offers) {
    const i = o.first_seen_at ? index.get(dayKey(o.first_seen_at)) : undefined; if (i === undefined) continue;
    const s = by.get(o.source) ?? { source: o.source, total: 0, good: 0, approved: 0, perDay: Array(windowDays).fill(0) };
    s.total++;
    if (isGood(o)) { s.good++; s.perDay[i]++; goodPerDay[days[i]]++; }
    if (o.editorial_status === 'approved' || o.editorial_status === 'published') s.approved++;
    by.set(o.source, s);
  }
  const apifyGood = offers.filter(o => o.source.startsWith('apify') && isGood(o) && (o.first_seen_at ? index.has(dayKey(o.first_seen_at)) : false)).length;
  const cost = (runs ?? []).reduce((a, r) => a + (Number(r.cost_usd) || 0), 0);
  const since = now.getTime() - windowDays * 864e5;
  const decided = decidedRows === null ? null : (decidedRows ?? offers).filter(o => o.reviewed_at && Date.parse(o.reviewed_at) >= since);
  return {
    days, goodPerDay, perTier: (['official', 'scrape', 'paid', 'other'] as Tier[]).map(t => { const l = [...by.values()].filter(x => tierOf(x.source) === t); return { tier: t, total: l.reduce((a, x) => a + x.total, 0), good: l.reduce((a, x) => a + x.good, 0) }; }).filter(t => t.total),
    perSource: [...by.values()].sort((a, b) => b.good - a.good || a.source.localeCompare(b.source)),
    apify: runs === null ? { cost_usd: null, runs: null, good_offers: apifyGood, cost_per_good: null } : { cost_usd: Math.round(cost * 100) / 100, runs: runs.length, good_offers: apifyGood, cost_per_good: apifyGood ? Math.round((cost / apifyGood) * 1000) / 1000 : null },
    // Sólo cuenta como humana la decisión de una persona: las de las reglas y la cola automática también son de la máquina.
    review: { human_decisions: decided === null ? null : decided.filter(o => isHumanReviewer(o.reviewed_by)).length, ai_decisions: decided === null ? null : decided.filter(o => o.reviewed_by === 'ai-review').length, minutes: null },
  };
}

export async function loadMetrics(now = new Date(), windowDays = 14): Promise<Metrics | null> {
  const since = encodeURIComponent(new Date(now.getTime() - windowDays * 864e5).toISOString());
  const [o, r, d] = await Promise.all([
    serviceRest(`external_offers?org_id=eq.${ORG}&first_seen_at=gte.${since}&select=source,score,spain,editorial_status,first_seen_at,reviewed_by,reviewed_at&limit=10000`),
    serviceRest(`apify_runs?org_id=eq.${ORG}&started_at=gte.${since}&select=cost_usd,started_at,status&limit=1000`).catch(() => null),
    // Decisiones de la ventana sobre cualquier oferta (también las vistas antes de la ventana).
    serviceRest(`external_offers?org_id=eq.${ORG}&reviewed_at=gte.${since}&select=reviewed_by,reviewed_at&limit=10000`).catch(() => null),
  ]);
  if (!o.ok) return null;
  const offers = await o.json().catch(() => null);
  const runs = r?.ok ? await r.json().catch(() => null) : null;
  const decided = d?.ok ? await d.json().catch(() => null) : null;
  return Array.isArray(offers) ? computeMetrics(offers, Array.isArray(runs) ? runs : null, now, windowDays, Array.isArray(decided) ? decided : null) : null;
}
