'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, ExternalLink, LoaderCircle, RefreshCcw, ShieldCheck, Undo2, Download } from 'lucide-react';
import { ROLE_LABELS, roleFromTitle, spainSignal, type RoleFamily } from '../lib/vocabulary';

// Fuentes externas: APIs oficiales con clave (InfoJobs, Adzuna, Jooble) y recolectores programados (JobSpy en GitHub).
// Llegan como borradores; una alumna solo ve lo que apruebas aquí y que además cumple las reglas básicas de la vista.
type Offer = { id: string; source: string; title: string; company: string | null; location: string | null; url: string; salary: string | null; posted_at: string | null; first_seen_at: string; editorial_status: string; verified_result: string | null };
type Data = { offers: Offer[]; counts: Record<string, number>; sources: Array<{ source: string; total: number; live: number; approved: number; last_seen: string | null }>; runs: Array<{ source: string; via: string; received: number; accepted: number; note: string | null; created_at: string }> };
const STATUS: Record<string, string> = { draft: 'Borrador', needs_review: 'A revisar', approved: 'Aprobada', published: 'Publicada', withdrawn: 'Retirada' };
const VERDICT: Record<string, string> = { open: 'Activa', closed: 'Cerrada', unknown: 'No verificable' };
const fmt = (v: string | null) => v ? new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(v)) : '—';

async function call<T>(init?: RequestInit, query = ''): Promise<T> {
  const response = await fetch(`/api/admin/external${query}`, { headers: { 'Content-Type': 'application/json' }, ...init });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof (data as { detail?: string }).detail === 'string' ? (data as { detail: string }).detail : 'La operación falló.');
  return data as T;
}

export default function ExternalTab({ owner, onSessionLost }: { owner: boolean; onSessionLost: () => void }) {
  const [data, setData] = useState<Data | null>(null);
  const [status, setStatus] = useState('draft');
  const [role, setRole] = useState<'' | RoleFamily | 'none'>('closer');
  const [source, setSource] = useState('');
  const [text, setText] = useState('');
  const [onlySpain, setOnlySpain] = useState(true);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [verdicts, setVerdicts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(true);
  const [working, setWorking] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const lost = useCallback((err: Error) => { if (err.message.includes('Sesión')) onSessionLost(); setError(err.message); }, [onSessionLost]);
  const load = useCallback(() => {
    setBusy(true);
    call<Data>(undefined, `?status=${status}`).then(d => { setData(d); setError(''); setPicked(new Set()); }).catch(lost).finally(() => setBusy(false));
  }, [status, lost]);
  useEffect(load, [load]);

  const q = text.trim().toLowerCase();
  const rows = useMemo(() => (data?.offers ?? []).filter(o => {
    const r = roleFromTitle(o.title);
    if (role === 'none' ? r !== null : role && r !== role) return false;
    if (source && o.source !== source) return false;
    if (q && !`${o.title} ${o.company}`.toLowerCase().includes(q)) return false;
    if (onlySpain && spainSignal(o.title, o.location) !== true) return false;
    return true;
  }), [data, role, source, q, onlySpain]);
  const chosen = rows.filter(r => picked.has(r.id));
  const allPicked = rows.length > 0 && rows.every(r => picked.has(r.id));

  async function act(kind: 'verify' | 'approved' | 'draft' | 'withdrawn') {
    if (!chosen.length) return;
    if (kind === 'approved' && !window.confirm(`¿Aprobar ${chosen.length} oferta(s)? Las alumnas las verán si cumplen las reglas básicas (perfil, España, español, antigüedad). Puedes deshacerlo.`)) return;
    setWorking(kind); setError(''); setNotice('');
    try {
      const ids = chosen.map(c => c.id);
      if (kind === 'verify') {
        const verdict: Record<string, string> = {};
        for (let i = 0; i < ids.length; i += 25) {
          const r = await call<{ results: Array<{ id: string; result: string; reason: string }> }>({ method: 'POST', body: JSON.stringify({ action: 'verify', ids: ids.slice(i, i + 25) }) });
          for (const x of r.results) verdict[x.id] = `${VERDICT[x.result]} · ${x.reason}`;
        }
        setVerdicts(old => ({ ...old, ...verdict }));
        setNotice(`Verificadas ${Object.keys(verdict).length} de ${ids.length}.`);
      } else {
        const r = await call<{ changed: number }>({ method: 'PATCH', body: JSON.stringify({ ids, editorial_status: kind }) });
        setNotice(`${r.changed} oferta(s) → ${STATUS[kind]}.`); load();
      }
    } catch (err) { lost(err as Error); } finally { setWorking(''); }
  }
  async function collect() {
    setWorking('collect'); setError(''); setNotice('');
    try {
      const r = await call<{ outcomes: Array<{ provider: string; ok: boolean; accepted?: number; error?: string }> }>({ method: 'POST', body: JSON.stringify({ action: 'collect' }) });
      setNotice(r.outcomes.map(o => `${o.provider}: ${o.ok ? `${o.accepted} guardadas` : o.error}`).join(' · ')); load();
    } catch (err) { lost(err as Error); } finally { setWorking(''); }
  }

  return <section aria-label="Fuentes externas">
    <p className="card-meta" style={{ marginTop: 0, marginBottom: 20, maxWidth: 760 }}>InfoJobs, Adzuna y Jooble se recogen con sus claves (pestaña APIs) cada día a las 6:00. LinkedIn, Indeed y Google Jobs llegan desde el workflow de GitHub con JobSpy. Todo entra como borrador; las alumnas solo ven lo que apruebes. Estas ofertas enlazan siempre al anuncio original.</p>
    {error && <div className="alert error" role="alert"><span>{error}</span></div>}
    {notice && <div className="auth-note" role="status" style={{ marginBottom: 16 }}>{notice}</div>}
    <div className="admin-toolbar" style={{ justifyContent: 'space-between' }}>
      <div className="stat-strip" style={{ margin: 0 }}>{(data?.sources ?? []).map(s => <span key={s.source}><strong>{s.live}</strong>{s.source}{s.approved ? ` (${s.approved} aprobadas)` : ''}</span>)}{data && !data.sources.length && <span>Sin ofertas externas todavía</span>}</div>
      {owner && <button disabled={working !== ''} onClick={() => void collect()}>{working === 'collect' ? <LoaderCircle size={15} className="spin" /> : <Download size={15} />} Recoger APIs ahora</button>}
    </div>
    {!!data?.runs.length && <p className="card-meta">Última entrada: {data.runs[0].source} vía {data.runs[0].via}, {data.runs[0].accepted} de {data.runs[0].received} guardadas · {fmt(data.runs[0].created_at)}</p>}
    <div className="search-panel admin-toolbar">
      <label htmlFor="ex-status">Estado<select id="ex-status" value={status} onChange={e => setStatus(e.target.value)}>{Object.entries(STATUS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
      <label htmlFor="ex-role">Perfil (por el título)<select id="ex-role" value={role} onChange={e => setRole(e.target.value as typeof role)}><option value="">Todos</option>{Object.entries(ROLE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}<option value="none">Sin perfil claro</option></select></label>
      <label htmlFor="ex-source">Fuente<select id="ex-source" value={source} onChange={e => setSource(e.target.value)}><option value="">Todas</option>{(data?.sources ?? []).map(s => <option key={s.source} value={s.source}>{s.source}</option>)}</select></label>
      <label className="grow" htmlFor="ex-q">Buscar<input id="ex-q" placeholder="Título o empresa" value={text} onChange={e => setText(e.target.value)} /></label>
      <button disabled={busy} onClick={load}>{busy ? <LoaderCircle size={15} className="spin" /> : <RefreshCcw size={15} />} Actualizar</button>
    </div>
    <div className="admin-toolbar" style={{ justifyContent: 'space-between' }}>
      <div className="stat-strip" style={{ margin: 0 }}><span><strong>{rows.length}</strong>en pantalla</span><span><strong>{chosen.length}</strong>seleccionadas</span></div>
      <label className="check-label" style={{ flexDirection: 'row', alignItems: 'center' }}><input type="checkbox" checked={onlySpain} onChange={e => setOnlySpain(e.target.checked)} /> Solo con señal clara de España</label>
    </div>
    <div className="admin-toolbar">
      <button disabled={!chosen.length || working !== ''} onClick={() => void act('verify')}>{working === 'verify' ? <LoaderCircle size={15} className="spin" /> : <ShieldCheck size={15} />} Verificar vigencia</button>
      <button className="primary" disabled={!chosen.length || working !== ''} onClick={() => void act('approved')}><Check size={15} /> Aprobar {chosen.length || ''}</button>
      <button disabled={!chosen.length || working !== ''} onClick={() => void act('draft')}><Undo2 size={15} /> Volver a borrador</button>
      <button disabled={!chosen.length || working !== ''} onClick={() => void act('withdrawn')}>Retirar</button>
    </div>
    {busy ? <p className="muted"><LoaderCircle size={14} className="spin" /> Cargando…</p> : !rows.length ? <div className="empty"><h3>No hay ofertas externas con estos filtros.</h3><p className="card-meta">Guarda una clave en APIs, lanza una recogida o quita «Solo con señal clara de España».</p></div> : <div className="table-wrap"><table className="data-table">
      <thead><tr><th style={{ width: 36 }}><input type="checkbox" aria-label="Seleccionar todas las visibles" checked={allPicked} onChange={() => setPicked(allPicked ? new Set() : new Set(rows.map(r => r.id)))} /></th><th>Oferta</th><th>Perfil</th><th>Ubicación</th><th>Fuente</th><th>Vigencia</th><th /></tr></thead>
      <tbody>{rows.map(r => { const f = roleFromTitle(r.title); const sp = spainSignal(r.title, r.location); return <tr key={r.id}>
        <td><input type="checkbox" aria-label={`Seleccionar ${r.title}`} checked={picked.has(r.id)} onChange={() => setPicked(old => { const n = new Set(old); if (n.has(r.id)) n.delete(r.id); else n.add(r.id); return n; })} /></td>
        <td className="primary-cell"><strong>{r.title}</strong><span>{r.company ?? 'Empresa no indicada'}{r.salary ? ` · ${r.salary}` : ''}</span></td>
        <td>{f ? <span className="status ok">{ROLE_LABELS[f]}</span> : <span className="status">Sin perfil claro</span>}</td>
        <td>{r.location ?? 'No indicada'}{sp !== null && <span className={sp ? 'status ok' : 'status bad'} style={{ marginLeft: 6 }}>{sp ? 'España' : 'Fuera'}</span>}</td>
        <td>{r.source}</td><td>{verdicts[r.id] ?? (r.verified_result ? VERDICT[r.verified_result] : <span className="muted">—</span>)}</td>
        <td style={{ textAlign: 'right' }}><a href={r.url} target="_blank" rel="noopener noreferrer" aria-label={`Abrir el anuncio original de ${r.title}`}><ExternalLink size={14} /></a></td></tr>; })}</tbody></table></div>}
  </section>;
}
