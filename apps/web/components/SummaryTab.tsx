'use client';
import { useCallback, useEffect, useState } from 'react';
import { ArrowRight, LoaderCircle, RefreshCcw } from 'lucide-react';

// Resumen: cuánto falta para el objetivo (ofertas de closer en España visibles para las alumnas) y qué hacer ahora.
export const TARGET_CLOSERS_ES = 20;
type Overview = { external?: { pending: number; needs_review?: number; sources: Array<{ source: string; live: number; approved: number }> }; engine: { catalog_active: number; last_run: { day: string; status: string } | null } | null; sources: Array<{ code: string; name: string; run_status: string | null }>; pool: { eligible: number | null; by_role: Record<string, number> } };
type Student = { items: Array<{ id: string }>; total: number };
type Go = (tab: 'quick' | 'external' | 'apify' | 'review' | 'catalog' | 'sources' | 'apis') => void;

async function get<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...init });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof (data as { detail?: string }).detail === 'string' ? (data as { detail: string }).detail : 'La consulta falló.');
  return data as T;
}
const search = (role: string | null) => get<Student>('/api/backend/opportunities/search', { method: 'POST', body: JSON.stringify({ role, market: 'ES', days: 10, include_bilingual: false, starred_only: false, include_extra_roles: true }) });

export default function SummaryTab({ go, onSessionLost }: { go: Go; onSessionLost: () => void }) {
  const [closers, setClosers] = useState<number | null>(null);
  const [allEs, setAllEs] = useState<number | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [overview, setOverview] = useState<Overview | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const load = useCallback(() => {
    setBusy(true); setError('');
    // Cada consulta es independiente: si una falla, el resto del resumen se muestra igual.
    const errors: string[] = [];
    const safe = <T,>(p: Promise<T>) => p.catch((err: Error) => { errors.push(err.message); return null; });
    Promise.all([safe(search('closer')), safe(search(null)), safe(get<{ counts: Record<string, number> }>('/api/admin/opportunities?limit=1')), safe(get<Overview>('/api/admin/overview'))])
      .then(([c, a, o, ov]) => {
        if (c) setClosers(c.items.length);
        if (a) setAllEs(a.items.length);
        if (o) setCounts(o.counts ?? {});
        if (ov) setOverview(ov);
        if (errors.some(m => m.includes('Sesión'))) onSessionLost();
        setError(errors[0] ?? '');
      }).finally(() => setBusy(false));
  }, [onSessionLost]);
  useEffect(load, [load]);

  const visible = closers ?? 0;
  const pct = Math.min(100, Math.round((visible / TARGET_CLOSERS_ES) * 100));
  // Dos colas distintas, nunca una suma: lo que la máquina clasifica sola y lo que de verdad
  // necesita criterio humano. Sumarlas hacía parecer que miles de borradores esperaban a una persona.
  const engineExceptions = counts.needs_review ?? 0;
  const extExceptions = overview?.external?.needs_review ?? 0;
  const exceptions = engineExceptions + extExceptions; // las del motor y las de fuentes externas: ambas esperan criterio humano
  const drafts = counts.draft ?? 0;
  const extPending = overview?.external?.pending ?? 0;
  const failed = overview?.sources.filter(s => s.run_status === 'failed') ?? [];
  const poolClosers = overview?.pool.by_role.closer ?? 0;
  const reached = visible >= TARGET_CLOSERS_ES;
  const steps: Array<{ text: string; action: string; tab: Parameters<Go>[0] }> = [];
  if (engineExceptions > 0) steps.push({ text: `Hay ${engineExceptions} oferta(s) del motor que la clasificación automática no pudo cerrar. Revisa solo esas.`, action: 'Ver excepciones', tab: 'review' });
  if (extExceptions > 0) steps.push({ text: `Hay ${extExceptions} oferta(s) de fuentes externas que las reglas no pudieron cerrar. Revisa solo esas.`, action: 'Ver excepciones', tab: 'external' });
  if (extPending > 0) steps.push({ text: `Hay ${extPending} borrador(es) de fuentes externas esperando la pasada automática (reglas + IA). No hace falta que las revises a mano.`, action: 'Clasificar ahora', tab: 'external' });
  if (failed.length) steps.push({ text: `${failed.length} fuente(s) fallan en la última recogida: ${failed.slice(0, 3).map(f => f.name).join(', ')}${failed.length > 3 ? '…' : ''}.`, action: 'Ver fuentes', tab: 'sources' });
  if (!reached && exceptions === 0 && extPending === 0) steps.push({ text: 'No quedan ofertas por revisar. Para llegar al objetivo hacen falta más: lanza un actor de Apify (scraping a escala sin proxies propios) o guarda las claves de InfoJobs, Adzuna y Jooble.', action: 'Abrir Apify', tab: 'apify' });
  if (reached && !steps.length) steps.push({ text: 'Objetivo cumplido. Prueba la vista de alumna para comprobar cómo se ve.', action: 'Probar ofertas', tab: 'catalog' });

  return <section aria-label="Resumen">
    {error && <div className="alert error" role="alert"><span>{error}</span></div>}
    <div className="admin-toolbar" style={{ justifyContent: 'flex-end' }}><button disabled={busy} onClick={load}>{busy ? <LoaderCircle size={15} className="spin" /> : <RefreshCcw size={15} />} Actualizar</button></div>
    <article className="source-card" style={{ marginBottom: 20 }}>
      <div className="card-head"><div><span className="eyebrow">OBJETIVO</span><h3 style={{ fontSize: 18, marginTop: 4 }}>Ofertas de closer en España visibles para las alumnas</h3></div>
        <span className={reached ? 'status ok' : 'status'}>{reached ? 'Cumplido' : `Faltan ${Math.max(0, TARGET_CLOSERS_ES - visible)}`}</span></div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 16 }}><span style={{ fontFamily: "'Libre Caslon Display',Georgia,serif", fontSize: 56, lineHeight: 1 }}>{closers ?? '…'}</span><span className="muted">de {TARGET_CLOSERS_ES}</span></div>
      <div role="progressbar" aria-valuemin={0} aria-valuemax={TARGET_CLOSERS_ES} aria-valuenow={visible} aria-label="Progreso hacia el objetivo" style={{ height: 8, borderRadius: 99, background: 'var(--inset)', marginTop: 16, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: reached ? 'var(--sage)' : 'var(--accent)', transition: 'width .3s' }} /></div>
      <p className="card-meta">Cuenta lo que una alumna ve hoy con perfil Closer, mercado España y publicadas en los últimos 10 días: solo ofertas aprobadas o publicadas que además cumplen las reglas del motor.</p>
    </article>
    <div className="card-grid" style={{ marginBottom: 20 }}>
      <article className="source-card"><span className="eyebrow">VISIBLES EN ESPAÑA (TODOS LOS PERFILES)</span><div className="stat-strip" style={{ margin: '8px 0 0' }}><span><strong style={{ fontSize: 28 }}>{allEs ?? '…'}</strong>ofertas</span></div></article>
      <article className="source-card"><span className="eyebrow">EXCEPCIONES PARA TI</span><div className="stat-strip" style={{ margin: '8px 0 0' }}><span><strong style={{ fontSize: 28 }}>{busy ? '…' : exceptions}</strong>necesitan criterio humano</span></div></article>
      <article className="source-card"><span className="eyebrow">POR CLASIFICAR (AUTOMÁTICO)</span><div className="stat-strip" style={{ margin: '8px 0 0' }}><span><strong style={{ fontSize: 28 }}>{busy ? '…' : drafts}</strong>reglas + IA, sin ti</span></div></article>
      <article className="source-card"><span className="eyebrow">LISTAS PARA APROBAR (CUALQUIER MERCADO)</span><div className="stat-strip" style={{ margin: '8px 0 0' }}><span><strong style={{ fontSize: 28 }}>{overview ? poolClosers : '…'}</strong>de perfil closer que ya cumplen las reglas</span></div></article>
      <article className="source-card"><span className="eyebrow">FUENTES CON FALLO</span><div className="stat-strip" style={{ margin: '8px 0 0' }}><span><strong style={{ fontSize: 28 }}>{overview ? failed.length : '…'}</strong>de {overview?.sources.length ?? '…'} en el motor cloud</span></div></article>
    </div>
    <h2 className="section-title">Qué hacer ahora</h2>
    <div className="card-grid" style={{ gridTemplateColumns: '1fr' }}>{steps.map(s => <article className="source-card" key={s.tab}><div className="card-head"><p style={{ fontSize: 14 }}>{s.text}</p><button className="primary" onClick={() => go(s.tab)}>{s.action} <ArrowRight size={14} /></button></div></article>)}</div>
  </section>;
}
