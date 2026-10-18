'use client';
import { useCallback, useEffect, useState } from 'react';
import { LoaderCircle, RefreshCcw } from 'lucide-react';
import { TIER_LABEL, type Tier } from '../lib/sourceTiers';

// Métricas de los últimos 14 días. Reglas de `dashboard-design`: sin dato = «—» con su causa, error ≠ vacío (con reintentar),
// gráfico con eje en 0, etiquetas directas, colores solo por tokens, y tabla alternativa al gráfico.
type Metrics = { perTier: Array<{ tier: Tier; total: number; good: number }>; days: string[]; goodPerDay: Record<string, number>; perSource: Array<{ source: string; total: number; good: number; approved: number }>;
  apify: { cost_usd: number | null; runs: number | null; good_offers: number; cost_per_good: number | null }; review: { human_decisions: number | null; ai_decisions: number | null; minutes: null } };

const day = new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const label = (iso: string) => day.format(new Date(`${iso}T00:00:00Z`));
const usd = new Intl.NumberFormat('es', { style: 'currency', currency: 'USD', maximumFractionDigits: 3 });
const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)} %` : '—');

// Barras verticales SVG con base en 0: valor máximo en el eje, fechas inicial/final y el día más alto etiquetado.
function DayBars({ days, values }: { days: string[]; values: number[] }) {
  const W = 560, H = 120, PAD = 22, max = Math.max(1, ...values), slot = W / days.length, bar = Math.max(4, slot - 6);
  const peak = values.indexOf(Math.max(...values));
  const total = values.reduce((a, b) => a + b, 0);
  return <svg viewBox={`0 0 ${W} ${H + PAD}`} role="img" width="100%" style={{ maxWidth: W, display: 'block' }}
    aria-label={`Ofertas buenas por día del ${label(days[0])} al ${label(days.at(-1) as string)}: ${total} en total${total ? `, máximo ${values[peak]} el ${label(days[peak])}` : ''}.`}>
    <line x1="0" y1={H} x2={W} y2={H} stroke="var(--line)" strokeWidth="1" />
    <text x="0" y="10" fontSize="11" fill="var(--secondary)">{max}</text>
    {values.map((v, i) => { const h = v ? Math.max(2, (v / max) * (H - 18)) : 0; return <g key={days[i]}>
      <rect x={i * slot + (slot - bar) / 2} y={H - h} width={bar} height={h} rx="2" fill="var(--accent)"><title>{`${label(days[i])}: ${v}`}</title></rect>
      {i === peak && v > 0 && <text x={i * slot + slot / 2} y={H - h - 4} fontSize="11" fontWeight="600" textAnchor="middle" fill="var(--ink)">{v}</text>}
    </g>; })}
    <text x="0" y={H + 16} fontSize="11" fill="var(--secondary)">{label(days[0])}</text>
    <text x={W} y={H + 16} fontSize="11" textAnchor="end" fill="var(--secondary)">{label(days.at(-1) as string)}</text>
  </svg>;
}

export default function MetricsPanel({ onSessionLost }: { onSessionLost: () => void }) {
  const [m, setM] = useState<Metrics | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(true);
  const load = useCallback(() => {
    setBusy(true); setError('');
    fetch('/api/admin/metrics', { cache: 'no-store' }).then(async r => { const d = await r.json().catch(() => ({})); if (r.status === 401) onSessionLost(); if (!r.ok) throw new Error(d.detail ?? 'No se pudieron cargar las métricas.'); setM(d); })
      .catch((e: Error) => { setM(null); setError(e.message); }).finally(() => setBusy(false));
  }, [onSessionLost]);
  useEffect(load, [load]);

  if (busy && !m) return <p className="muted" role="status"><LoaderCircle size={14} className="spin" /> Cargando métricas…</p>;
  if (error || !m) return <div className="alert error" role="alert" data-testid="metrics-error"><span>{error || 'No se pudieron cargar las métricas.'}</span> <button onClick={load} disabled={busy}><RefreshCcw size={14} /> Reintentar</button></div>;

  const values = m.days.map(d => m.goodPerDay[d] ?? 0), total = values.reduce((a, b) => a + b, 0);
  const newOffers = m.perSource.reduce((a, s) => a + s.total, 0);
  const perDay = (total / m.days.length).toFixed(1).replace('.', ',');
  return <details className="search-panel" style={{ marginBottom: 16 }} data-testid="metrics" open={newOffers > 0}>
    <summary><strong>Últimos 14 días: {total} ofertas buenas</strong> <span className="card-meta" style={{ margin: 0 }}>({perDay} al día · de {newOffers} nuevas)</span></summary>
    {newOffers === 0 ? <div className="empty" data-testid="metrics-empty"><h3>Sin ofertas nuevas en estos 14 días.</h3><p className="card-meta">Lanza una recogida desde «Recoger APIs ahora» o revisa que las fuentes no estén pausadas. Esto no significa que las fuentes funcionen: significa que no ha entrado nada.</p></div> : <>
      <div className="stat-strip">
        <span><strong>{m.apify.runs && m.apify.cost_usd !== null ? usd.format(m.apify.cost_usd) : '—'}</strong>gasto Apify{m.apify.runs === null ? ': no se pudo leer' : m.apify.runs ? ` (${m.apify.runs} ejecuciones)` : ': sin ejecuciones'}</span>
        <span><strong>{m.apify.cost_per_good === null ? '—' : usd.format(m.apify.cost_per_good)}</strong>{m.apify.cost_per_good === null ? (m.apify.runs === null ? 'por oferta buena de Apify: gasto no disponible' : m.apify.runs ? 'por oferta buena de Apify: aún sin ofertas buenas' : 'por oferta buena de Apify: sin ejecuciones') : 'por oferta buena de Apify'}</span>
        <span><strong>{m.review.human_decisions ?? '—'}</strong>decisiones humanas{m.review.human_decisions === null ? ': no se pudo leer' : ''}</span>
        <span><strong>{m.review.ai_decisions ?? '—'}</strong>decisiones del revisor IA{m.review.ai_decisions === null ? ': no se pudo leer' : ''}</span>
      </div>
      <p className="card-meta">«Buena» = puntuación ≥ 60 y España clara. Minutos de revisión: <strong>no se miden</strong> (la app no registra tiempo; solo cuenta decisiones).</p>
      <DayBars days={m.days} values={values} />
      <details style={{ marginTop: 8 }}><summary className="card-meta">Ver tabla por día</summary>
        <div className="table-wrap"><table className="data-table" data-testid="metrics-days"><caption className="card-meta" style={{ textAlign: 'left' }}>Ofertas buenas por día</caption><thead><tr><th scope="col">Día</th><th scope="col" className="num">Buenas</th></tr></thead>
          <tbody>{m.days.map((d, i) => <tr key={d}><th scope="row" style={{ fontWeight: 400 }}>{label(d)}</th><td className="num">{values[i]}</td></tr>)}</tbody></table></div></details>
      {!!m.perTier.length && <div className="table-wrap" style={{ marginTop: 12 }}><table className="data-table" data-testid="metrics-tiers"><caption className="card-meta" style={{ textAlign: 'left' }}>Por nivel de fuente</caption>
        <thead><tr><th scope="col">Nivel</th><th scope="col" className="num">Nuevas</th><th scope="col" className="num">Buenas</th><th scope="col" className="num">% buenas</th></tr></thead>
        <tbody>{m.perTier.map(t => <tr key={t.tier}><th scope="row" style={{ fontWeight: 400 }}>{TIER_LABEL[t.tier]}</th><td className="num">{t.total}</td><td className="num">{t.good}</td><td className="num">{pct(t.good, t.total)}</td></tr>)}</tbody></table></div>}
      <div className="table-wrap" style={{ marginTop: 12 }}><table className="data-table"><caption className="card-meta" style={{ textAlign: 'left' }}>Por fuente</caption>
        <thead><tr><th scope="col">Fuente</th><th scope="col" className="num">Nuevas</th><th scope="col" className="num">Buenas</th><th scope="col" className="num">Aprobadas</th></tr></thead>
        <tbody>{m.perSource.map(s => <tr key={s.source}><th scope="row" style={{ fontWeight: 400 }}>{s.source}</th><td className="num">{s.total}</td><td className="num">{s.good}</td><td className="num">{s.approved}</td></tr>)}</tbody></table></div>
    </>}
  </details>;
}
