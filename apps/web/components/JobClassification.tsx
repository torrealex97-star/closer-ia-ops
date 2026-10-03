'use client';
import { useEffect, useState } from 'react';
import { BrainCircuit } from 'lucide-react';
import { request } from './client';

type Detail = {
  id: string; status: string; provider?: string; model?: string; error?: string;
  latency_ms?: number; job_id?: string;
  usage?: { input_tokens?: number; output_tokens?: number } | null;
  result?: { role_family: string; confidence: string; reason: string; evidence: string } | null;
};
const FAMILIES: Record<string, string> = {
  closer: 'Closer', setter: 'Setter', cold_caller: 'Cold Caller',
  account_executive: 'Ejecutivo comercial', sdr: 'SDR / BDR',
  not_sales: 'No comercial', uncertain: 'Sin base para decidir',
};

// Admin-only AI classification for offers the deterministic vocabulary cannot place.
// Always attributed, never silent; a failed/hallucinated result is shown as such.
export default function JobClassification({ jobId, onClassified }: { jobId: string; onClassified?: () => void }) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { let stopped = false; request<Detail | null>(`ai/classifications/${jobId}`).then(r => { if (!stopped) setDetail(r); }).catch(() => {}); return () => { stopped = true; }; }, [jobId]);
  useEffect(() => {
    if (!detail || !['queued', 'running'].includes(detail.status)) return;
    let stopped = false; let pending = false;
    const timer = setInterval(async () => {
      if (pending) return; pending = true;
      try { const r = await request<Detail>(`ai/classifications/${detail.job_id}`); if (!stopped) setDetail(r); } catch (e) { if (!stopped) setError((e as Error).message); } finally { pending = false; }
    }, 2000);
    return () => { stopped = true; clearInterval(timer); };
  }, [detail?.job_id, detail?.status]);
  async function classify() {
    setBusy(true); setError('');
    try {
      await request('ai/classify', { job_ids: [jobId], retry_failed: true });
      const r = await request<Detail>(`ai/classifications/${jobId}`);
      setDetail(r); onClassified?.();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  const pending = busy || !!detail && ['queued', 'running'].includes(detail.status);
  return <section className="ai-analysis classification-panel">
    <h3><BrainCircuit size={16} /> Clasificación con IA</h3>
    <p>Para ofertas cuyo título no está en el vocabulario: la IA propone una familia con evidencia literal. Se envía solo el texto de esta oferta al proveedor configurado y el resultado se guarda con atribución.</p>
    {error && <p role="alert" className="alert error">{error}</p>}
    {!!detail && ['failed', 'uncertain'].includes(detail.status) && <p className="alert error">{detail.error || 'Clasificación interrumpida. No se reintenta automáticamente.'}</p>}
    {detail?.result ? <>
      <p><strong>{FAMILIES[detail.result.role_family] || detail.result.role_family} · confianza {detail.result.confidence}</strong></p>
      <p>{detail.result.reason}</p>
      {detail.result.evidence && <blockquote>“{detail.result.evidence}”</blockquote>}
      <small>{detail.provider} · {detail.model} · {detail.usage ? `${detail.usage.input_tokens ?? 0} tokens de entrada / ${detail.usage.output_tokens ?? 0} de salida` : 'consumo no informado'} · Resultado guardado. Revisión humana antes de publicar.</small>
      <div className="source-actions"><button disabled={pending} onClick={classify}>Volver a clasificar</button></div>
    </> : <button disabled={pending} onClick={classify}>{pending ? 'Clasificando… puedes cerrar esta oferta' : 'Clasificar con IA'}</button>}
  </section>;
}
