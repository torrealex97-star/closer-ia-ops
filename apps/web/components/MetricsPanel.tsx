'use client';
import { useEffect, useState } from 'react';
import { LoaderCircle } from 'lucide-react';

import { TIER_LABEL, type Tier } from '../lib/sourceTiers';
type Metrics = { perTier: Array<{ tier: Tier; total: number; good: number }>; days: string[]; goodPerDay: Record<string, number>; perSource: Array<{ source: string; total: number; good: number; approved: number }>;
  apify: { cost_usd: number; runs: number; good_offers: number; cost_per_good: number | null }; review: { human_decisions: number; ai_decisions: number; minutes: null } };

// Métricas de los últimos 14 días: ofertas buenas (≥ 60 y España) por día y fuente, coste por oferta buena y trabajo de revisión.
export default function MetricsPanel({ onSessionLost }: { onSessionLost: () => void }) {
  const [m, setM] = useState<Metrics | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    fetch('/api/admin/metrics', { cache: 'no-store' }).then(async r => { const d = await r.json().catch(() => ({})); if (r.status === 401) onSessionLost(); if (!r.ok) throw new Error(d.detail ?? 'No se pudieron cargar las métricas.'); setM(d); }).catch((e: Error) => setError(e.message));
  }, [onSessionLost]);
  if (error) return <p className="card-meta" role="alert">{error}</p>;
  if (!m) return <p className="muted"><LoaderCircle size={14} className="spin" /> Cargando métricas…</p>;
  const total = Object.values(m.goodPerDay).reduce((a, b) => a + b, 0);
  const max = Math.max(1, ...Object.values(m.goodPerDay));
  return <details className="search-panel" style={{ marginBottom: 16 }} data-testid="metrics">
    <summary><strong>Métricas · últimos 14 días</strong> — {total} ofertas buenas ({(total / 14).toFixed(1)}/día)</summary>
    <div className="stat-strip">
      <span><strong>{m.apify.cost_usd.toFixed(2)} $</strong>gasto Apify ({m.apify.runs} ejecuciones)</span>
      <span><strong>{m.apify.cost_per_good === null ? '—' : `${m.apify.cost_per_good.toFixed(3)} $`}</strong>por oferta buena de Apify</span>
      <span><strong>{m.review.human_decisions}</strong>decisiones humanas</span>
      <span><strong>{m.review.ai_decisions}</strong>decisiones del revisor IA</span>
    </div>
    {!!m.perTier.length && <p className="card-meta" data-testid="tiers">Por nivel: {m.perTier.map(t => `${TIER_LABEL[t.tier]} ${t.good} buenas de ${t.total}`).join(' · ')}</p>}
    <p className="card-meta">«Buena» = puntuación ≥ 60 y España clara. Minutos de revisión: <strong>no se miden</strong> (la app no registra tiempo; solo cuenta decisiones).</p>
    <div aria-label="Ofertas buenas por día" style={{ display: 'flex', gap: 3, alignItems: 'flex-end', height: 60 }}>{m.days.map(d => <div key={d} title={`${d}: ${m.goodPerDay[d]}`} style={{ flex: 1, background: 'currentColor', opacity: 0.55, height: `${Math.max(3, (m.goodPerDay[d] / max) * 100)}%` }} />)}</div>
    <div className="table-wrap" style={{ marginTop: 12 }}><table className="data-table"><thead><tr><th>Fuente</th><th className="num">Nuevas</th><th className="num">Buenas</th><th className="num">Aprobadas</th></tr></thead>
      <tbody>{m.perSource.length ? m.perSource.map(s => <tr key={s.source}><td>{s.source}</td><td className="num">{s.total}</td><td className="num">{s.good}</td><td className="num">{s.approved}</td></tr>) : <tr><td colSpan={4} className="muted">Sin ofertas nuevas en el periodo.</td></tr>}</tbody></table></div>
  </details>;
}
