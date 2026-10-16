'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ExternalLink, LoaderCircle, RefreshCcw, Search } from 'lucide-react';

// «Probar ofertas»: ver TODO el catálogo recogido (admin) y, aparte, lo que ve hoy una alumna
// (solo ofertas aprobadas/publicadas) con los mismos filtros que la vista pública.
type Item = { id: string; original_title: string | null; company: string | null; source_url: string | null; source: string; editorial_status: string; opportunity_status: string; created_at: string };
type Student = { id: string; role_label: string; original_title: string; company: string; compensation: string; location: string; modality: string; source_name: string; source_url: string; published_at: string | null };
const EDITORIAL: Record<string, string> = { draft: 'Borrador', needs_review: 'A revisar', approved: 'Aprobada', published: 'Publicada', withdrawn: 'Retirada' };
const date = (v: string | null) => v ? new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short' }).format(new Date(v)) : '—';

async function get<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...init });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof (data as { detail?: string }).detail === 'string' ? (data as { detail: string }).detail : 'La consulta falló.');
  return data as T;
}

export default function CatalogTab({ onSessionLost }: { onSessionLost: () => void }) {
  const [mode, setMode] = useState<'admin' | 'student'>('admin');
  const [status, setStatus] = useState('');
  const [source, setSource] = useState('');
  const [text, setText] = useState('');
  const [role, setRole] = useState('');
  const [market, setMarket] = useState('any');
  const [days, setDays] = useState(10);
  const [items, setItems] = useState<Item[]>([]);
  const [total, setTotal] = useState(0);
  const [student, setStudent] = useState<Student[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const load = useCallback(() => {
    setBusy(true); setError('');
    const job = mode === 'admin'
      ? get<{ items: Item[]; total: number }>(`/api/admin/opportunities?limit=200${status ? `&status=${status}` : ''}${source ? `&source=${encodeURIComponent(source)}` : ''}`).then(d => { setItems(d.items); setTotal(d.total); })
      : get<{ items: Student[] }>('/api/backend/opportunities/search', { method: 'POST', body: JSON.stringify({ role: role || null, market, days, include_bilingual: true, starred_only: false, include_extra_roles: true }) }).then(d => setStudent(d.items));
    job.catch(err => { if ((err as Error).message.includes('Sesión')) onSessionLost(); setError((err as Error).message); }).finally(() => setBusy(false));
  }, [mode, status, source, role, market, days, onSessionLost]);
  useEffect(load, [load]);
  const sources = useMemo(() => [...new Set(items.map(i => i.source))].sort(), [items]);
  const q = text.trim().toLowerCase();
  const shown = items.filter(i => !q || `${i.original_title} ${i.company}`.toLowerCase().includes(q));
  const shownStudent = student.filter(i => !q || `${i.original_title} ${i.company}`.toLowerCase().includes(q));
  return <section aria-label="Probar ofertas">
    <div className="run-progress classification-summary">
      <strong>Probar ofertas</strong>
      <span className="muted">{mode === 'admin' ? 'Todo lo que ha recogido el motor, incluidos borradores. Hasta 200 por consulta: filtra por estado o fuente.' : 'Exactamente lo que vería una alumna ahora mismo con estos filtros: solo ofertas aprobadas o publicadas.'}</span>
      <div className="source-actions">
        <button className={mode === 'admin' ? 'primary' : ''} aria-pressed={mode === 'admin'} onClick={() => setMode('admin')}>Catálogo completo</button>
        <button className={mode === 'student' ? 'primary' : ''} aria-pressed={mode === 'student'} onClick={() => setMode('student')}>Vista de alumna</button>
        <label className="result-search" style={{ maxWidth: 220 }}><Search size={14} /><input placeholder="Buscar título o empresa" value={text} onChange={e => setText(e.target.value)} aria-label="Buscar título o empresa" /></label>
        {mode === 'admin' ? <>
          <select aria-label="Estado editorial" value={status} onChange={e => setStatus(e.target.value)}><option value="">Todos los estados</option>{Object.entries(EDITORIAL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          <select aria-label="Fuente" value={source} onChange={e => setSource(e.target.value)}><option value="">Todas las fuentes</option>{sources.map(s => <option key={s} value={s}>{s}</option>)}</select>
        </> : <>
          <select aria-label="Perfil" value={role} onChange={e => setRole(e.target.value)}><option value="">Todos los perfiles</option><option value="closer">Closer</option><option value="setter">Setter</option><option value="cold_caller">Cold Caller</option><option value="account_executive">Ejecutivo comercial</option><option value="sdr">SDR / BDR</option></select>
          <select aria-label="Mercado" value={market} onChange={e => setMarket(e.target.value)}><option value="any">Todos los mercados</option><option value="ES">España</option><option value="EU">Europa</option><option value="LATAM">Latinoamérica</option><option value="US">Estados Unidos</option></select>
          <select aria-label="Antigüedad" value={days} onChange={e => setDays(Number(e.target.value))}><option value={1}>24 horas</option><option value={3}>3 días</option><option value={7}>7 días</option><option value={10}>10 días</option></select>
        </>}
        <button disabled={busy} onClick={load}><RefreshCcw size={15} /> Actualizar</button>
      </div>
    </div>
    {error && <div className="alert error" role="alert">{error}</div>}
    {busy ? <p className="muted"><LoaderCircle size={14} className="spin" /> Cargando…</p> : mode === 'admin' ? <>
      <p className="muted">{shown.length} mostradas{!q && total > items.length ? ` de ${total}` : ''}.</p>
      {!shown.length ? <div className="empty"><h3>Sin resultados con estos filtros.</h3></div> : <div className="job-list">{shown.map(i => <article className="job-row" key={i.id}><div className="job-info">
        <div className="job-company">{i.company ?? 'Empresa no indicada'} <span>· {i.source}</span></div>
        <div className="job-title" style={{ cursor: 'default' }}>{i.original_title}</div>
        <div className="job-signals"><span className="source-tag">{EDITORIAL[i.editorial_status] ?? i.editorial_status}</span><span className="source-tag">{i.opportunity_status}</span><span className="source-tag">{date(i.created_at)}</span>
          {i.source_url && <a href={i.source_url} target="_blank" rel="noopener noreferrer">Anuncio original <ExternalLink size={12} /></a>}</div></div></article>)}</div>}
    </> : <>
      <p className="muted">{shownStudent.length} oferta(s) visibles para una alumna.</p>
      {!shownStudent.length ? <div className="empty"><h3>Ahora mismo una alumna no vería ninguna.</h3><p>Aprueba o publica ofertas en la pestaña Revisión para que aparezcan.</p></div> : <div className="job-list">{shownStudent.map(i => <article className="job-row" key={i.id}><div className="job-info">
        <div className="job-company">{i.company} <span>· {i.role_label} · {i.source_name}</span></div>
        <div className="job-title" style={{ cursor: 'default' }}>{i.original_title}</div>
        <div className="job-signals"><span className="source-tag">{i.compensation}</span><span className="source-tag">{i.modality} · {i.location}</span><span className="source-tag">{date(i.published_at)}</span>
          <a href={i.source_url} target="_blank" rel="noopener noreferrer">Anuncio original <ExternalLink size={12} /></a></div></div></article>)}</div>}
    </>}
  </section>;
}
