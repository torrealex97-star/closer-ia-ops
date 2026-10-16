'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ExternalLink, LoaderCircle, RefreshCcw } from 'lucide-react';

// «Probar ofertas»: todo el catálogo recogido (admin) y, aparte, lo que ve hoy una alumna
// (solo ofertas aprobadas/publicadas) con los mismos filtros que la vista pública.
type Item = { id: string; original_title: string | null; company: string | null; source_url: string | null; source: string; editorial_status: string; opportunity_status: string; created_at: string };
type Student = { id: string; role_label: string; original_title: string; company: string; compensation: string; location: string; modality: string; source_name: string; source_url: string; published_at: string | null };
const EDITORIAL: Record<string, string> = { draft: 'Borrador', needs_review: 'A revisar', approved: 'Aprobada', published: 'Publicada', withdrawn: 'Retirada' };
const ACTIVITY: Record<string, string> = { active: 'Activa', verifying: 'Verificando', closed: 'Cerrada' };
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
    <div className="admin-toolbar" role="group" aria-label="Vista">
      <button className={mode === 'admin' ? 'primary' : ''} aria-pressed={mode === 'admin'} onClick={() => setMode('admin')}>Catálogo completo</button>
      <button className={mode === 'student' ? 'primary' : ''} aria-pressed={mode === 'student'} onClick={() => setMode('student')}>Vista de alumna</button>
    </div>
    <div className="search-panel admin-toolbar">
      <label className="grow" htmlFor="catalog-q">Buscar<input id="catalog-q" placeholder="Título o empresa" value={text} onChange={e => setText(e.target.value)} /></label>
      {mode === 'admin' ? <>
        <label htmlFor="catalog-status">Estado<select id="catalog-status" value={status} onChange={e => setStatus(e.target.value)}><option value="">Todos</option>{Object.entries(EDITORIAL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
        <label htmlFor="catalog-source">Fuente<select id="catalog-source" value={source} onChange={e => setSource(e.target.value)}><option value="">Todas</option>{sources.map(s => <option key={s} value={s}>{s}</option>)}</select></label>
      </> : <>
        <label htmlFor="catalog-role">Perfil<select id="catalog-role" value={role} onChange={e => setRole(e.target.value)}><option value="">Todos</option><option value="closer">Closer</option><option value="setter">Setter</option><option value="cold_caller">Cold Caller</option><option value="account_executive">Ejecutivo comercial</option><option value="sdr">SDR / BDR</option></select></label>
        <label htmlFor="catalog-market">Mercado<select id="catalog-market" value={market} onChange={e => setMarket(e.target.value)}><option value="any">Todos</option><option value="ES">España</option><option value="EU">Europa</option><option value="LATAM">Latinoamérica</option><option value="US">Estados Unidos</option></select></label>
        <label htmlFor="catalog-days">Publicada<select id="catalog-days" value={days} onChange={e => setDays(Number(e.target.value))}><option value={1}>Últimas 24 h</option><option value={3}>Últimos 3 días</option><option value={7}>Últimos 7 días</option><option value={10}>Últimos 10 días</option></select></label>
      </>}
      <button disabled={busy} onClick={load}>{busy ? <LoaderCircle size={15} className="spin" /> : <RefreshCcw size={15} />} Actualizar</button>
    </div>
    {error && <div className="alert error" role="alert"><span>{error}</span></div>}
    <p className="card-meta" style={{ marginTop: 0, marginBottom: 16 }}>{mode === 'admin'
      ? `Todo lo que recogió el motor, borradores incluidos. ${busy ? '' : `${shown.length} mostradas${!q && total > items.length ? ` de ${total}; filtra para ver el resto` : ''}.`}`
      : `Exactamente lo que vería una alumna ahora mismo: solo ofertas aprobadas o publicadas. ${busy ? '' : `${shownStudent.length} visibles.`}`}</p>
    {busy ? <p className="muted"><LoaderCircle size={14} className="spin" /> Cargando…</p> : mode === 'admin'
      ? !shown.length ? <div className="empty"><h3>Sin resultados con estos filtros.</h3></div> : <div className="table-wrap"><table className="data-table">
        <thead><tr><th>Oferta</th><th>Fuente</th><th>Estado</th><th>Vigencia</th><th>Recogida</th><th /></tr></thead>
        <tbody>{shown.map(i => <tr key={i.id}><td className="primary-cell"><strong>{i.original_title ?? 'Sin título'}</strong><span>{i.company ?? 'Empresa no indicada'}</span></td>
          <td>{i.source}</td><td><span className={i.editorial_status === 'approved' || i.editorial_status === 'published' ? 'status ok' : 'status'}>{EDITORIAL[i.editorial_status] ?? i.editorial_status}</span></td>
          <td>{ACTIVITY[i.opportunity_status] ?? i.opportunity_status}</td><td>{date(i.created_at)}</td>
          <td style={{ textAlign: 'right' }}>{i.source_url && <a href={i.source_url} target="_blank" rel="noopener noreferrer" aria-label={`Abrir el anuncio original de ${i.original_title}`}><ExternalLink size={14} /></a>}</td></tr>)}</tbody></table></div>
      : !shownStudent.length ? <div className="empty"><h3>Ahora mismo una alumna no vería ninguna oferta.</h3><p className="card-meta">Aprueba o publica ofertas en Revisión para que aparezcan.</p></div> : <div className="table-wrap"><table className="data-table">
        <thead><tr><th>Oferta</th><th>Perfil</th><th>Compensación</th><th>Ubicación</th><th>Publicada</th><th /></tr></thead>
        <tbody>{shownStudent.map(i => <tr key={i.id}><td className="primary-cell"><strong>{i.original_title}</strong><span>{i.company} · {i.source_name}</span></td><td>{i.role_label}</td><td>{i.compensation}</td><td>{i.modality} · {i.location}</td><td>{date(i.published_at)}</td>
          <td style={{ textAlign: 'right' }}><a href={i.source_url} target="_blank" rel="noopener noreferrer" aria-label={`Abrir el anuncio original de ${i.original_title}`}><ExternalLink size={14} /></a></td></tr>)}</tbody></table></div>}
  </section>;
}
