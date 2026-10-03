'use client';
import { useEffect, useState } from 'react';
import { BrainCircuit, RefreshCcw } from 'lucide-react';
import { request } from './client';
import type { components } from '../../../packages/contracts/api';

type Item = { id: string; job_id: string; status: string; title: string; company: string; source?: string; provider?: string; model?: string; error?: string; latency_ms?: number; created_at: string; completed_at?: string | null; usage?: { input_tokens?: number; output_tokens?: number } | null; result?: { role_family: string; confidence: string; reason: string; evidence: string } | null; proposed?: { role_family?: string; confidence?: string; reason?: string; evidence?: string } | null };
type Status = components['schemas']['ClassificationStatus'];
const FAMILIES: Record<string, string> = { closer: 'Closer', setter: 'Setter', cold_caller: 'Cold Caller', account_executive: 'Ejecutivo comercial', sdr: 'SDR / BDR', not_sales: 'No comercial', uncertain: 'Sin base para decidir' };
const STATES: Record<string, string> = { queued: 'En cola', running: 'Clasificando', completed: 'Completada', failed: 'Fallida', uncertain: 'Interrumpida' };
const date = (value?: string | null) => value ? new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(value)) : '—';

// Admin overview of every AI classification: state, family, evidence, cost signals.
// Nothing here silently treats the model as truth; failures stay visible.
export default function ClassificationsPanel() {
  const [items, setItems] = useState<Item[]>([]);
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(true);
  function refresh() {
    setBusy(true);
    Promise.all([request<Item[]>('ai/classifications'), request<Status>('ai/classification')])
      .then(([list, s]) => { setItems(list); setStatus(s); setError(''); })
      .catch(e => setError((e as Error).message))
      .finally(() => setBusy(false));
  }
  useEffect(refresh, []);
  const completed = items.filter(i => i.status === 'completed');
  const failed = items.filter(i => ['failed', 'uncertain'].includes(i.status));
  const tokens = items.reduce((sum, i) => sum + (i.usage?.input_tokens || 0) + (i.usage?.output_tokens || 0), 0);
  return <section aria-label="Clasificaciones IA">
    {error && <div className="alert error" role="alert">{error}</div>}
    <div className="run-progress classification-summary">
      <strong>Motor: {status?.enabled ? 'activado' : 'desactivado'} <span className="muted">· {status?.has_token ? 'clave guardada' : 'sin clave'}</span> · {status?.model} · {status?.used_today}/{status?.daily_limit} hoy</strong>
      <span className="muted">{completed.length} completadas · {failed.length} con aviso · {tokens.toLocaleString('es')} tokens acumulados</span>
      <div className="source-actions"><button disabled={busy} onClick={refresh}><RefreshCcw size={15} /> Actualizar</button></div>
    </div>
    {!items.length && !busy ? <div className="empty"><BrainCircuit size={32} strokeWidth={1.3} /><h3>Todavía no hay clasificaciones.</h3><p>Usa «Clasificar con IA» en el detalle de una oferta cuyo título no encaje en el vocabulario.</p></div> :
      <div className="job-list">{items.map(item => <article className="job-row" key={item.id}>
        <div className="company-monogram" aria-hidden="true">{item.company.slice(0, 2).toUpperCase()}</div>
        <div className="job-info">
          <div className="job-company">{item.company} <span>· {date(item.created_at)} · {item.provider}/{item.model}</span></div>
          <span className="job-title" style={{ cursor: 'default' }}>{item.title}</span>
          <div className="job-signals">
            <span className={`source-tag ${item.status === 'completed' ? 'ok' : ''}`}>{STATES[item.status] || item.status}</span>
            {item.result && <span className="source-tag family">{FAMILIES[item.result.role_family] || item.result.role_family}</span>}
            {item.result && <span className="source-tag">confianza {item.result.confidence}</span>}
            {item.latency_ms != null && <span className="source-tag">{(item.latency_ms / 1000).toFixed(1)} s</span>}
            {item.usage && <span className="source-tag">{(item.usage.input_tokens || 0) + (item.usage.output_tokens || 0)} tokens</span>}
          </div>
          {item.result?.reason && <p className="muted" style={{ marginTop: 8, fontSize: 12 }}>{item.result.reason}</p>}
          {item.result?.evidence && <blockquote className="classification-evidence">“{item.result.evidence}”</blockquote>}
          {item.status !== 'completed' && item.proposed && <p className="muted" style={{ marginTop: 8, fontSize: 12 }}><strong>Familia propuesta (no validada, para revisión humana):</strong> {FAMILIES[item.proposed.role_family || ''] || item.proposed.role_family} · confianza {item.proposed.confidence} · cita propuesta: “{item.proposed.evidence}”</p>}
          {item.error && <p className="review-tag" style={{ marginTop: 6 }}>{item.error}</p>}
        </div>
      </article>)}</div>}
  </section>;
}
