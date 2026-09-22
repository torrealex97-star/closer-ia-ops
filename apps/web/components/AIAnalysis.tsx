'use client';
import { useEffect, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { request } from './client';
type Analysis = { id: string; status: string; model: string; provider?: string; error?: string; usage?: { input_tokens: number; output_tokens: number }; result?: { summary: string; fit: string; confidence: string; requirements: string[]; questions: string[]; evidence: string } };
export default function AIAnalysis({ runId, jobId }: { runId: string; jobId: string }) {
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { let stopped = false; request<Analysis | null>(`ai/jobs/${jobId}`).then(result => { if (!stopped) setAnalysis(result); }).catch(e => { if (!stopped) setError(e.message); }); return () => { stopped = true; }; }, [jobId]);
  useEffect(() => {
    if (!analysis || !['queued', 'running'].includes(analysis.status)) return;
    let stopped = false; let pending = false;
    const timer = setInterval(async () => { if (pending) return; pending = true; try { const result = await request<Analysis>(`ai/analyses/${analysis.id}`); if (!stopped) setAnalysis(result); } catch (e) { if (!stopped) setError((e as Error).message); } finally { pending = false; } }, 2000);
    return () => { stopped = true; clearInterval(timer); };
  }, [analysis?.id, analysis?.status]);
  async function analyze() { setBusy(true); setError(''); try { setAnalysis(await request<Analysis>('ai/analyses', { run_id: runId, job_id: jobId })); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }
  const pending = busy || !!analysis && ['queued', 'running'].includes(analysis.status);
  return <section className="ai-analysis"><h3><Sparkles size={16} /> Segunda lectura con IA</h3><p>Resumen, requisitos y preguntas para revisar el encaje. Envía solo el texto de esta oferta al proveedor de IA configurado en Fuentes. El análisis se guarda para reutilizarlo.</p>{error && <p role="alert" className="alert error">{error}</p>}
    {!!analysis && ['failed', 'uncertain'].includes(analysis.status) && <p className="alert error">{analysis.error || 'Análisis interrumpido. No se reintenta automáticamente para evitar duplicar consumo.'}</p>}
    {analysis?.result ? <><p><strong>{analysis.result.fit} · confianza {analysis.result.confidence}</strong></p><p>{analysis.result.summary}</p><h4>Requisitos publicados</h4><ul>{analysis.result.requirements.map((v, i) => <li key={i}>{v}</li>)}</ul><h4>Qué confirmar</h4><ul>{analysis.result.questions.map((v, i) => <li key={i}>{v}</li>)}</ul>{analysis.result.evidence && <blockquote>{analysis.result.evidence}</blockquote>}<small>{analysis.provider || 'openai'} · {analysis.model} · {analysis.usage ? `${analysis.usage.input_tokens} tokens de entrada / ${analysis.usage.output_tokens} de salida` : 'Consumo no informado'} · Resultado guardado. Revisión humana necesaria.</small></> : <button disabled={pending || !!analysis && ['failed', 'uncertain'].includes(analysis.status)} onClick={analyze}>{pending ? 'Analizando… puedes cerrar esta oferta' : 'Analizar esta oferta con IA'}</button>}
  </section>;
}
