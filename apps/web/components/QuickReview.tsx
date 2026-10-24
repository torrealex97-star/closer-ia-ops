'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, ExternalLink, LoaderCircle, MapPin, RefreshCcw, ShieldCheck, Undo2 } from 'lucide-react';
import { draftFromDetail, sendable, type DetailLike } from '../lib/reviewPayload';
import { spainSignal } from '../lib/esPlaces';
import { ROLE_LABELS, roleFromTitle, type RoleFamily } from '../lib/vocabulary';

// Revisión rápida: decide muchas ofertas de una vez. Aprobar solo abre la puerta humana: la alumna ve una
// oferta únicamente si además cumple las reglas del motor (perfil, idioma, vigencia). Todo es reversible.
type Item = { id: string; original_title: string | null; company: string | null; source_url: string | null; source: string; editorial_status: string; opportunity_status: string; created_at: string };
type Detail = DetailLike & { editorial_status: string };
type Snap = { location: string | null; salary: string | null };
type Outcome = { ok: boolean; text: string };
const MAX_ROWS = 100;
const POOL = 4;

async function admin<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/admin/${path}`, { headers: { 'Content-Type': 'application/json' }, ...init });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof (data as { detail?: string }).detail === 'string' ? (data as { detail: string }).detail : 'La operación falló.');
  return data as T;
}
// Ejecuta tareas con concurrencia limitada para no saturar los subrequests del motor.
async function pool<T>(items: T[], work: (item: T) => Promise<void>) {
  const queue = [...items];
  await Promise.all(Array.from({ length: Math.min(POOL, queue.length) }, async () => { for (let next = queue.shift(); next; next = queue.shift()) await work(next); }));
}

export default function QuickReview({ onSessionLost }: { onSessionLost: () => void }) {
  const [status, setStatus] = useState('draft');
  const [role, setRole] = useState<'' | RoleFamily | 'none'>('closer');
  const [source, setSource] = useState('');
  const [text, setText] = useState('');
  const [onlySpain, setOnlySpain] = useState(false);
  const [items, setItems] = useState<Item[]>([]);
  const [total, setTotal] = useState(0);
  const [snaps, setSnaps] = useState<Record<string, Snap>>({});
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [results, setResults] = useState<Record<string, Outcome>>({});
  const [busy, setBusy] = useState(true);
  const [working, setWorking] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const cache = useRef(new Map<string, Detail>());

  const lost = useCallback((err: Error) => { if (err.message.includes('Sesión')) onSessionLost(); setError(err.message); }, [onSessionLost]);
  const load = useCallback(() => {
    setBusy(true); setError('');
    admin<{ items: Item[]; total: number }>(`opportunities?limit=200&status=${status}`)
      .then(d => { setItems(d.items); setTotal(d.total); setPicked(new Set()); setResults({}); })
      .catch(lost).finally(() => setBusy(false));
  }, [status, lost]);
  useEffect(load, [load]);

  const sources = useMemo(() => [...new Set(items.map(i => i.source))].sort(), [items]);
  const q = text.trim().toLowerCase();
  const rows = useMemo(() => items.filter(i => {
    const r = roleFromTitle(i.original_title);
    if (role === 'none' ? r !== null : role && r !== role) return false;
    if (source && i.source !== source) return false;
    if (q && !`${i.original_title} ${i.company}`.toLowerCase().includes(q)) return false;
    if (onlySpain && spainSignal(i.original_title, snaps[i.id]?.location) === false) return false;
    return true;
  }).slice(0, MAX_ROWS), [items, role, source, q, onlySpain, snaps]);

  const detail = useCallback(async (id: string) => {
    const hit = cache.current.get(id);
    if (hit) return hit;
    const d = await admin<Detail>(`opportunities/${id}`);
    cache.current.set(id, d);
    return d;
  }, []);

  async function loadLocations() {
    setWorking('locations'); setError('');
    try {
      await pool(rows.filter(r => !snaps[r.id]), async r => {
        const d = await detail(r.id);
        setSnaps(old => ({ ...old, [r.id]: { location: d.job_snapshot.location, salary: d.job_snapshot.salary } }));
      });
    } catch (err) { lost(err as Error); } finally { setWorking(''); }
  }

  function toggle(id: string) { setPicked(old => { const n = new Set(old); if (n.has(id)) n.delete(id); else n.add(id); return n; }); }
  const allPicked = rows.length > 0 && rows.every(r => picked.has(r.id));
  const chosen = rows.filter(r => picked.has(r.id));

  async function run(kind: 'verify' | 'approve' | 'draft' | 'withdraw') {
    if (!chosen.length) return;
    if (kind === 'approve' && !window.confirm(`¿Aprobar ${chosen.length} oferta(s)? Las alumnas las verán solo si cumplen además las reglas del motor (perfil, idioma, vigencia). Puedes deshacerlo.`)) return;
    setWorking(kind); setError(''); setNotice('');
    let ok = 0;
    const patch = { approve: 'approved', draft: 'draft', withdraw: 'withdrawn' } as const;
    try {
      await pool(chosen, async r => {
        try {
          if (kind === 'verify') {
            const v = await admin<{ result: string; reason_code: string }>(`opportunities/${r.id}/verify`, { method: 'POST', body: '{}' });
            const label = v.result === 'open' ? 'Activa en el origen' : v.result === 'closed' ? 'Cerrada en el origen' : 'No verificable ahora';
            setResults(o => ({ ...o, [r.id]: { ok: v.result === 'open', text: `${label} · ${v.reason_code}` } })); if (v.result === 'open') ok++;
          } else {
            const d = await detail(r.id);
            const draft = draftFromDetail(d, roleFromTitle(r.original_title));
            const res = await admin<{ version: number }>(`opportunities/${r.id}`, { method: 'PATCH', body: JSON.stringify({ editorial_status: patch[kind], version_payload: sendable(draft), locale: 'es', reviewed_by: 'admin-web-rapida' }) });
            setResults(o => ({ ...o, [r.id]: { ok: true, text: `${kind === 'approve' ? 'Aprobada' : kind === 'draft' ? 'En borrador' : 'Retirada'} · v${res.version}` } })); ok++;
          }
        } catch (err) { if ((err as Error).message.includes('Sesión')) throw err; setResults(o => ({ ...o, [r.id]: { ok: false, text: (err as Error).message } })); }
      });
      setNotice(`${kind === 'verify' ? 'Verificadas' : 'Hechas'}: ${ok} de ${chosen.length}.${ok < chosen.length ? ' Revisa las filas marcadas.' : ''}`);
    } catch (err) { lost(err as Error); } finally { setWorking(''); }
  }

  const spain = (i: Item) => spainSignal(i.original_title, snaps[i.id]?.location);
  return <section aria-label="Revisión rápida">
    <div className="search-panel admin-toolbar">
      <label htmlFor="qr-status">Estado<select id="qr-status" value={status} onChange={e => setStatus(e.target.value)}><option value="draft">Borradores</option><option value="needs_review">A revisar</option><option value="approved">Aprobadas</option><option value="withdrawn">Retiradas</option></select></label>
      <label htmlFor="qr-role">Perfil (por el título)<select id="qr-role" value={role} onChange={e => setRole(e.target.value as typeof role)}><option value="">Todos</option>{Object.entries(ROLE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}<option value="none">Sin perfil claro</option></select></label>
      <label htmlFor="qr-source">Fuente<select id="qr-source" value={source} onChange={e => setSource(e.target.value)}><option value="">Todas</option>{sources.map(s => <option key={s} value={s}>{s}</option>)}</select></label>
      <label className="grow" htmlFor="qr-q">Buscar<input id="qr-q" placeholder="Título o empresa" value={text} onChange={e => setText(e.target.value)} /></label>
      <button disabled={busy} onClick={load}>{busy ? <LoaderCircle size={15} className="spin" /> : <RefreshCcw size={15} />} Actualizar</button>
    </div>
    <div className="admin-toolbar" style={{ justifyContent: 'space-between' }}>
      <div className="stat-strip" style={{ margin: 0 }}><span><strong>{rows.length}</strong>en pantalla{total > items.length ? ` (de ${total}; el panel carga 200)` : ''}</span><span><strong>{chosen.length}</strong>seleccionadas</span></div>
      <div className="admin-toolbar" style={{ margin: 0 }}>
        <label className="check-label" style={{ flexDirection: 'row', alignItems: 'center' }}><input type="checkbox" checked={onlySpain} onChange={e => setOnlySpain(e.target.checked)} /> Ocultar las que claramente no son de España</label>
        <button disabled={!rows.length || working !== ''} onClick={() => void loadLocations()}>{working === 'locations' ? <LoaderCircle size={15} className="spin" /> : <MapPin size={15} />} Cargar ubicación</button>
      </div>
    </div>
    {error && <div className="alert error" role="alert"><span>{error}</span></div>}
    {notice && <div className="auth-note" role="status" style={{ marginBottom: 16 }}>{notice}</div>}
    <div className="admin-toolbar" aria-label="Acciones sobre las seleccionadas">
      <button disabled={!chosen.length || working !== ''} onClick={() => void run('verify')}>{working === 'verify' ? <LoaderCircle size={15} className="spin" /> : <ShieldCheck size={15} />} Verificar vigencia</button>
      <button className="primary" disabled={!chosen.length || working !== ''} onClick={() => void run('approve')}>{working === 'approve' ? <LoaderCircle size={15} className="spin" /> : <Check size={15} />} Aprobar {chosen.length || ''}</button>
      <button disabled={!chosen.length || working !== ''} onClick={() => void run('draft')}><Undo2 size={15} /> Volver a borrador</button>
      <button disabled={!chosen.length || working !== ''} onClick={() => void run('withdraw')}>Retirar</button>
    </div>
    {busy ? <p className="muted"><LoaderCircle size={14} className="spin" /> Cargando…</p> : !rows.length ? <div className="empty"><h3>No hay ofertas con estos filtros.</h3><p className="card-meta">Cambia el estado o el perfil, o espera a la próxima recogida.</p></div> : <div className="table-wrap"><table className="data-table">
      <thead><tr><th style={{ width: 36 }}><input type="checkbox" aria-label="Seleccionar todas las visibles" checked={allPicked} onChange={() => setPicked(allPicked ? new Set() : new Set(rows.map(r => r.id)))} /></th><th>Oferta</th><th>Perfil</th><th>Ubicación</th><th>Fuente</th><th>Resultado</th><th /></tr></thead>
      <tbody>{rows.map(r => { const family = roleFromTitle(r.original_title); const sp = spain(r); const res = results[r.id]; return <tr key={r.id}>
        <td><input type="checkbox" aria-label={`Seleccionar ${r.original_title}`} checked={picked.has(r.id)} onChange={() => toggle(r.id)} /></td>
        <td className="primary-cell"><strong>{r.original_title ?? 'Sin título'}</strong><span>{r.company ?? 'Empresa no indicada'}{snaps[r.id]?.salary ? ` · ${snaps[r.id].salary}` : ''}</span></td>
        <td>{family ? <span className="status ok">{ROLE_LABELS[family]}</span> : <span className="status">Sin perfil claro</span>}</td>
        <td>{snaps[r.id] ? <>{snaps[r.id].location ?? 'No indicada'}{sp !== null && <span className={sp ? 'status ok' : 'status bad'} style={{ marginLeft: 6 }}>{sp ? 'España' : 'Fuera'}</span>}</> : <span className="muted">—</span>}</td>
        <td>{r.source}</td>
        <td>{res ? <span className={res.ok ? 'status ok' : 'status bad'} title={res.text}>{res.text.length > 48 ? res.text.slice(0, 46) + '…' : res.text}</span> : ''}</td>
        <td style={{ textAlign: 'right' }}>{r.source_url && <a href={r.source_url} target="_blank" rel="noopener noreferrer" aria-label={`Abrir el anuncio original de ${r.original_title}`}><ExternalLink size={14} /></a>}</td></tr>; })}</tbody></table></div>}
  </section>;
}
