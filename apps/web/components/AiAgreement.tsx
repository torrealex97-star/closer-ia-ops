'use client';
import { useCallback, useEffect, useState } from 'react';
import { LoaderCircle, RefreshCcw } from 'lucide-react';

// Acuerdo del revisor IA (modo sombra) con las decisiones de las personas: puerta de salida de shadow → live.
// «—» + causa cuando no hay pares; error ≠ vacío; el veredicto se escribe en texto (no solo color).
type Agreement = { proposed: number; deferred: number; pending: number; pairs: number; agree: number; false_approve: number; false_withdraw: number; ai_approvals_decided: number;
  agree_rate: number | null; false_approve_rate: number | null; verdict: 'insufficient' | 'not_ready' | 'ready'; min_pairs: number; max_false_approve_rate: number };
const pct = (r: number | null) => (r === null ? '—' : `${Math.round(r * 1000) / 10} %`.replace('.', ','));

export default function AiAgreement({ onSessionLost }: { onSessionLost: () => void }) {
  const [a, setA] = useState<Agreement | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(true);
  const load = useCallback(() => {
    setBusy(true); setError('');
    fetch('/api/admin/ai-agreement', { cache: 'no-store' }).then(async r => { const d = await r.json().catch(() => ({})); if (r.status === 401) onSessionLost(); if (!r.ok) throw new Error(d.detail ?? 'No se pudo cargar el acuerdo IA/humano.'); setA(d); })
      .catch((e: Error) => { setA(null); setError(e.message); }).finally(() => setBusy(false));
  }, [onSessionLost]);
  useEffect(load, [load]);

  if (busy && !a) return <p className="muted" role="status"><LoaderCircle size={14} className="spin" /> Cargando acuerdo IA/humano…</p>;
  if (error || !a) return <div className="alert error" role="alert" data-testid="agreement-error"><span>{error || 'No se pudo cargar el acuerdo IA/humano.'}</span> <button onClick={load} disabled={busy}><RefreshCcw size={14} /> Reintentar</button></div>;

  const verdict = a.verdict === 'ready' ? `Cumple la puerta propuesta (≥ ${a.min_pairs} pares y falsas aprobaciones ≤ ${a.max_false_approve_rate * 100} %). La decisión de pasar a «live» sigue siendo tuya.`
    : a.verdict === 'not_ready' ? `No cumple: demasiadas aprobaciones de la IA que una persona retiró (límite ${a.max_false_approve_rate * 100} %). Mantener en sombra.`
    : `Aún no hay base: ${a.pairs} de ${a.min_pairs} pares comparados. Sigue decidiendo ofertas a mano; la IA anota sin aplicar nada.`;
  return <details className="search-panel" style={{ marginBottom: 16 }} data-testid="ai-agreement" open={a.pairs > 0}>
    <summary><strong>Revisor IA vs. personas: {a.pairs ? `${pct(a.agree_rate)} de acuerdo` : 'sin pares todavía'}</strong> <span className="card-meta" style={{ margin: 0 }}>({a.pairs} comparadas)</span></summary>
    <div className="stat-strip">
      <span><strong>{pct(a.agree_rate)}</strong>{a.pairs ? 'coinciden con la persona' : 'coinciden: aún sin pares'}</span>
      <span><strong>{a.false_approve}</strong>falsas aprobaciones (IA aprobaría, persona retira){a.false_approve_rate === null ? '' : ` · ${pct(a.false_approve_rate)} de sus aprobaciones`}</span>
      <span><strong>{a.false_withdraw}</strong>falsas retiradas (IA retiraría, persona aprueba)</span>
      <span><strong>{a.pending}</strong>propuestas sin decisión humana aún</span>
    </div>
    <p className="card-meta" data-testid="agreement-verdict"><strong>Veredicto:</strong> {verdict}</p>
    <p className="card-meta">Solo cuentan ofertas donde la IA propuso aprobar o retirar y después decidió una persona. «Dudosa → persona» ({a.deferred}) no se compara. Las decisiones aplicadas por la IA no entran. Un conjunto dorado etiquetado a mano sigue siendo la prueba más fiable.</p>
    <div className="table-wrap"><table className="data-table" data-testid="agreement-table"><caption className="card-meta" style={{ textAlign: 'left' }}>Detalle del acuerdo</caption>
      <thead><tr><th scope="col">Concepto</th><th scope="col" className="num">Ofertas</th></tr></thead>
      <tbody>
        <tr><th scope="row" style={{ fontWeight: 400 }}>Coinciden</th><td className="num">{a.agree}</td></tr>
        <tr><th scope="row" style={{ fontWeight: 400 }}>Falsas aprobaciones</th><td className="num">{a.false_approve}</td></tr>
        <tr><th scope="row" style={{ fontWeight: 400 }}>Falsas retiradas</th><td className="num">{a.false_withdraw}</td></tr>
        <tr><th scope="row" style={{ fontWeight: 400 }}>Sin decisión humana</th><td className="num">{a.pending}</td></tr>
        <tr><th scope="row" style={{ fontWeight: 400 }}>Dudosas (a persona)</th><td className="num">{a.deferred}</td></tr>
      </tbody></table></div>
  </details>;
}
