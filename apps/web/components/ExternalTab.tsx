'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, ChevronLeft, ChevronRight, Download, ExternalLink, FileDown, LoaderCircle, Pause, Play, RefreshCcw, ShieldCheck, Sparkles, Undo2 } from 'lucide-react';
import { download, toCsv } from '../lib/csv';
import { ROLE_LABELS, type RoleFamily } from '../lib/vocabulary';

// Fuentes externas a escala: miles de ofertas filtradas, ordenadas por puntuación y paginadas en el servidor.
// Llegan como borradores; una alumna solo ve lo que apruebes y que además cumple las reglas básicas de la vista.
import MetricsPanel from './MetricsPanel';
import { NICHE_LABELS, PAY_LABELS, type OfferTags } from '../lib/offerTags';
import AiAgreement from './AiAgreement';
import SourceIdeas from './SourceIdeas';
type Offer = { id: string; source: string; title: string; company: string | null; location: string | null; url: string; salary: string | null; posted_at: string | null; first_seen_at: string; editorial_status: string; verified_result: string | null; role: string | null; spain: boolean | null; score: number; also_seen: string[]; ai_review?: AiReview | null; risk?: { level: 'WARNING' | 'BLOCKED'; flags: string[] } | null; tags?: OfferTags };
type AiReview = { verdict: string; confidence: number; reasons: string[]; red_flags: string[]; would_decide: string; gate: string; mode: string; applied: boolean; audit_sample?: boolean; link?: { result: string; reason: string }; jev?: { verdict: string | null; score: number | null; note: string | null } };
const WOULD: Record<string, string> = { approve: 'Aprobaría', withdraw: 'Retiraría', human: 'Cola humana' };
type Data = { offers: Offer[]; total: number; page: number; page_size: number; counts: Record<string, number>; sources: Array<{ source: string; total: number; live: number; approved: number; last_seen: string | null }>; runs: Array<{ source: string; via: string; received: number; accepted: number; note: string | null; created_at: string }>; paused: string[]; auto?: { used_today: number | null; cap: number } };
const STATUS: Record<string, string> = { draft: 'Borrador', needs_review: 'A revisar', approved: 'Aprobada', published: 'Publicada', withdrawn: 'Retirada' };
const PLURAL: Record<string, string> = { draft: 'borradores', needs_review: 'a revisar', approved: 'aprobadas', published: 'publicadas', withdrawn: 'retiradas' };
const VERDICT: Record<string, string> = { open: 'Activa', closed: 'Cerrada', unknown: 'No verificable' };
const KNOWN = [['infojobs', 'InfoJobs', 'API oficial'], ['adzuna', 'Adzuna', 'API oficial'], ['jooble', 'Jooble', 'API oficial'], ['indeed', 'Indeed', 'JobSpy'], ['linkedin', 'LinkedIn', 'JobSpy'], ['glassdoor', 'Glassdoor', 'JobSpy'], ['google', 'Google Jobs', 'JobSpy']] as const;
const fmt = (v: string | null) => v ? new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(v)) : '—';
const tone = (n: number) => n >= 70 ? 'status ok' : n >= 45 ? 'status' : 'status bad';

async function call<T>(init?: RequestInit, query = ''): Promise<T> {
  const response = await fetch(`/api/admin/external${query}`, { headers: { 'Content-Type': 'application/json' }, ...init });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof (data as { detail?: string }).detail === 'string' ? (data as { detail: string }).detail : 'La operación falló.');
  return data as T;
}

export default function ExternalTab({ owner, onSessionLost }: { owner: boolean; onSessionLost: () => void }) {
  const [data, setData] = useState<Data | null>(null);
  // La cola humana abre en las excepciones: los borradores los cierra la pasada automática
  // (reglas + IA) y no hace falta que una persona los mire primero. Si hoy no hay ninguna,
  // se dice cuántos borradores esperan y se ofrece el atajo, en vez de dejar la lista vacía.
  const [status, setStatus] = useState('needs_review');
  const [role, setRole] = useState<'' | RoleFamily | 'none'>('closer');
  const [source, setSource] = useState('');
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  const [onlySpain, setOnlySpain] = useState(true);
  const [minScore, setMinScore] = useState(0);
  const [ai, setAi] = useState('');
  const [sort, setSort] = useState<'score' | 'recent'>('score');
  const [page, setPage] = useState(1);
  const [topN, setTopN] = useState(25);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [verdicts, setVerdicts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(true);
  const [working, setWorking] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const lost = useCallback((err: Error) => { if (err.message.includes('Sesión')) onSessionLost(); setError(err.message); }, [onSessionLost]);

  const filters = useCallback(() => {
    const p = new URLSearchParams({ status, sort });
    if (role) p.set('role', role); if (source) p.set('source', source); if (onlySpain) p.set('spain', '1'); if (minScore) p.set('min_score', String(minScore)); if (query) p.set('q', query); if (ai) p.set('ai', ai);
    return p;
  }, [status, sort, role, source, onlySpain, minScore, query, ai]);
  const load = useCallback(() => {
    setBusy(true);
    const p = filters(); p.set('page', String(page));
    call<Data>(undefined, `?${p}`).then(d => { setData(d); setError(''); setPicked(new Set()); }).catch(lost).finally(() => setBusy(false));
  }, [filters, page, lost]);
  useEffect(load, [load]);
  useEffect(() => { clearTimeout(timer.current); timer.current = setTimeout(() => { setQuery(text.trim()); setPage(1); }, 350); return () => clearTimeout(timer.current); }, [text]);
  const change = <T,>(set: (v: T) => void) => (v: T) => { set(v); setPage(1); };

  const rows = data?.offers ?? [];
  const chosen = rows.filter(r => picked.has(r.id));
  const allPicked = rows.length > 0 && rows.every(r => picked.has(r.id));
  const pages = data ? Math.max(1, Math.ceil(data.total / data.page_size)) : 1;

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
        setVerdicts(old => ({ ...old, ...verdict })); setNotice(`Verificadas ${Object.keys(verdict).length} de ${ids.length}.`);
      } else {
        const r = await call<{ changed: number }>({ method: 'PATCH', body: JSON.stringify({ ids, editorial_status: kind }) });
        setNotice(`${r.changed} oferta(s) → ${STATUS[kind]}.`); load();
      }
    } catch (err) { lost(err as Error); } finally { setWorking(''); }
  }
  async function approveBest() {
    // «Las mejores» son borradores pendientes de la pasada automática, no las excepciones
    // (esas necesitan criterio humano y no se aprueban en bloque desde aquí).
    const f = { ...Object.fromEntries(filters()), status: 'draft' };
    const label = `${topN} mejores borradores${role ? ` de ${role === 'none' ? 'sin perfil' : ROLE_LABELS[role as RoleFamily]}` : ''}${onlySpain ? ' en España' : ''}${minScore ? ` con puntuación ≥ ${minScore}` : ''}`;
    if (!window.confirm(`¿Aprobar las ${label}? (${data?.total ?? 0} cumplen los filtros). Las alumnas verán las que además pasen las reglas de la vista. Puedes deshacerlo.`)) return;
    setWorking('best'); setError(''); setNotice('');
    try { const r = await call<{ matched: number; approved: number }>({ method: 'POST', body: JSON.stringify({ action: 'approve_top', n: topN, filters: f }) }); setNotice(`Aprobadas ${r.approved} de ${r.matched} que cumplían los filtros.`); load(); }
    catch (err) { lost(err as Error); } finally { setWorking(''); }
  }
  async function toggle(src: string, enabled: boolean) {
    setWorking(`toggle-${src}`); setError(''); setNotice('');
    try { await call({ method: 'PATCH', body: JSON.stringify({ source: src, enabled }) }); setNotice(`${src}: ${enabled ? 'reanudada' : 'pausada. No se recoge ni se muestra a las alumnas hasta que la reanudes'}.`); load(); }
    catch (err) { lost(err as Error); } finally { setWorking(''); }
  }
  // Misma revisión que hace el cron cada mañana: reglas primero y la IA solo en las dudosas.
  async function autoReview() {
    setWorking('auto'); setError(''); setNotice('');
    try {
      const r = await call<{ checked: number; approved: number; exceptions: number; moved?: number; cap: number; used_before: number | null; by_reason: Record<string, number>; ai?: { mode: string; applied: number; skipped?: string } | null }>({ method: 'POST', body: JSON.stringify({ action: 'auto_review' }) });
      const reasons = Object.entries(r.by_reason ?? {}).map(([k, v]) => `${k}: ${v}`).join(' · ');
      setNotice(`Revisadas ${r.checked}: ${r.approved} aprobadas solas · ${r.moved ?? r.exceptions} movidas a tu cola de excepciones${reasons ? ` (${reasons})` : ''}. Tope de hoy: ${r.used_before ?? 0}/${r.cap}.${r.ai?.skipped ? ` IA: ${r.ai.skipped}.` : r.ai ? ` IA ${r.ai.mode}: ${r.ai.applied} aplicadas.` : ''}`);
      load();
    } catch (err) { lost(err as Error); } finally { setWorking(''); }
  }
  async function collect() {
    setWorking('collect'); setError(''); setNotice('');
    try {
      const r = await call<{ outcomes: Array<{ provider?: string; source?: string; portal?: string; ok: boolean; accepted?: number; error?: string; skipped?: string; searches?: number; cost_usd?: number }> }>({ method: 'POST', body: JSON.stringify({ action: 'collect' }) });
      setNotice(r.outcomes.map(o => {
        const label = o.portal ?? o.provider ?? o.source ?? 'fuente';
        // Google Jobs y el respaldo por portal cuestan por búsqueda: se dice cuánto se gastó, no solo qué entró.
        const paid = o.ok && o.searches ? ` · ${o.searches} búsqueda(s) (~${o.cost_usd} USD)` : '';
        const why = o.skipped ? ` (${o.skipped})` : '';
        return `${label}: ${o.ok ? `${o.accepted ?? 0} guardadas${paid}${why}` : (o.error ?? 'falló')}`;
      }).join(' · ')); load();
    } catch (err) { lost(err as Error); } finally { setWorking(''); }
  }
  const csvColumns = [
    { header: 'Puntuación', value: (r: Offer) => r.score }, { header: 'Título', value: (r: Offer) => r.title }, { header: 'Empresa', value: (r: Offer) => r.company }, { header: 'Ubicación', value: (r: Offer) => r.location },
    { header: 'Salario', value: (r: Offer) => r.salary }, { header: 'Fuente', value: (r: Offer) => [r.source, ...(r.also_seen ?? [])].join(' + ') }, { header: 'Estado', value: (r: Offer) => STATUS[r.editorial_status] ?? r.editorial_status },
    { header: 'Publicada', value: (r: Offer) => r.posted_at }, { header: 'Enlace', value: (r: Offer) => r.url },
  ];
  async function exportAll() {
    setWorking('csv'); setError('');
    try {
      const all: Offer[] = [];
      for (let pg = 1; pg <= 20; pg++) { const p = filters(); p.set('page', String(pg)); p.set('page_size', '100'); const d = await call<Data>(undefined, `?${p}`); all.push(...d.offers); if (all.length >= d.total) break; }
      download(`ofertas-externas-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(all, csvColumns)); setNotice(`Exportadas ${all.length} ofertas (máximo 2.000 por archivo).`);
    } catch (err) { lost(err as Error); } finally { setWorking(''); }
  }

  const counts = data?.counts ?? {};
  return <section aria-label="Fuentes externas">
    <p className="card-meta" style={{ marginTop: 0, marginBottom: 20, maxWidth: 760 }}>InfoJobs, Adzuna y Jooble se recogen con sus claves (pestaña APIs) cada día a las 6:00. Google Jobs llega por SerpApi (hasta 7 búsquedas al día, 0,175 USD) y, si un portal no tiene API oficial (sin clave o caída), su búsqueda se hace en Google acotada a ese portal (hasta 4 más, 0,1 USD) para que no falte inventario; también entra desde el workflow de GitHub con JobSpy, y cualquier portal desde la pestaña Apify. Todo entra como borrador, con puntuación para quedarte con las mejores, y enlaza siempre al anuncio original.</p>
    {error && <div className="alert error" role="alert"><span>{error}</span></div>}
    {notice && <div className="auth-note" role="status" style={{ marginBottom: 16 }}>{notice}</div>}
    <div className="admin-toolbar" style={{ justifyContent: 'space-between' }}>
      <div className="stat-strip" style={{ margin: 0 }}>{Object.entries(PLURAL).map(([k, l]) => <span key={k}><strong>{counts[k] ?? 0}</strong>{l}</span>)}</div>
        <div className="admin-toolbar" style={{ gap: 8, margin: 0 }}>
        {owner && <button disabled={working !== ''} onClick={() => void autoReview()} title="Reglas: perfil, mercado, español, puntuación y enlace vivo. Solo lo dudoso va a tu cola.">{working === 'auto' ? <LoaderCircle size={15} className="spin" /> : <Sparkles size={15} />} Aprobar las claras</button>}
        {owner && <button disabled={working !== ''} onClick={() => void collect()}>{working === 'collect' ? <LoaderCircle size={15} className="spin" /> : <Download size={15} />} Recoger APIs ahora</button>}
        <span className="card-meta" style={{ margin: 0 }}>Aprobadas solas hoy: <strong>{data?.auto?.used_today ?? '—'}</strong>/{data?.auto?.cap ?? 100}</span>
      </div>
    </div>
    <MetricsPanel onSessionLost={onSessionLost} />
    <AiAgreement onSessionLost={onSessionLost} />
    <SourceIdeas />
    <div className="table-wrap" style={{ marginBottom: 20 }}><table className="data-table">
      <thead><tr><th>Fuente</th><th>Vía</th><th>Estado</th><th className="num">Activas</th><th className="num">Aprobadas</th><th>Última vez</th><th /></tr></thead>
      <tbody>{KNOWN.map(([code, name, via]) => { const st = data?.sources.find(x => x.source === code); const off = data?.paused.includes(code); return <tr key={code}>
        <td className="primary-cell"><strong>{name}</strong><span>{code}</span></td><td>{via}</td>
        <td><span className={off ? 'status bad' : st ? 'status ok' : 'status'}>{off ? 'Pausada' : st ? 'Activa' : 'Sin datos aún'}</span></td>
        <td className="num">{st?.live ?? 0}</td><td className="num">{st?.approved ?? 0}</td><td>{fmt(st?.last_seen ?? null)}</td>
        <td style={{ textAlign: 'right' }}>{owner && <button disabled={working !== ''} onClick={() => void toggle(code, !!off)} aria-label={`${off ? 'Reanudar' : 'Pausar'} ${name}`}>{off ? <Play size={14} /> : <Pause size={14} />} {off ? 'Reanudar' : 'Pausar'}</button>}</td></tr>; })}</tbody></table></div>
    {!!data?.runs.length && <p className="card-meta">Última entrada: {data.runs[0].source} vía {data.runs[0].via}, {data.runs[0].accepted} de {data.runs[0].received} guardadas · {fmt(data.runs[0].created_at)}</p>}
    <div className="search-panel admin-toolbar">
      <label htmlFor="ex-status">Estado<select id="ex-status" value={status} onChange={e => change(setStatus)(e.target.value)}>{Object.entries(STATUS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
      <label htmlFor="ex-role">Perfil (por el título)<select id="ex-role" value={role} onChange={e => change(setRole)(e.target.value as typeof role)}><option value="">Todos</option>{Object.entries(ROLE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}<option value="none">Sin perfil claro</option></select></label>
      <label htmlFor="ex-source">Fuente<select id="ex-source" value={source} onChange={e => change(setSource)(e.target.value)}><option value="">Todas</option>{(data?.sources ?? []).map(s => <option key={s.source} value={s.source}>{s.source}</option>)}</select></label>
      <label htmlFor="ex-min">Puntuación mínima<select id="ex-min" value={minScore} onChange={e => change(setMinScore)(Number(e.target.value))}><option value={0}>Cualquiera</option><option value={45}>≥ 45 (decente)</option><option value={60}>≥ 60 (buena)</option><option value={75}>≥ 75 (muy buena)</option></select></label>
      <label htmlFor="ex-ai">Revisor IA<select id="ex-ai" value={ai} onChange={e => change(setAi)(e.target.value)}><option value="">Todo</option><option value="human">Cola humana</option><option value="approve">Aprobaría</option><option value="withdraw">Retiraría</option><option value="none">Sin revisar</option></select></label>
      <label htmlFor="ex-sort">Orden<select id="ex-sort" value={sort} onChange={e => change(setSort)(e.target.value as typeof sort)}><option value="score">Mejor puntuación</option><option value="recent">Más recientes</option></select></label>
      <label className="grow" htmlFor="ex-q">Buscar<input id="ex-q" placeholder="Título o empresa" value={text} onChange={e => setText(e.target.value)} /></label>
      <button disabled={busy} onClick={load}>{busy ? <LoaderCircle size={15} className="spin" /> : <RefreshCcw size={15} />} Actualizar</button>
    </div>
    {status === 'needs_review' && data && data.total === 0 && (data.counts?.draft ?? 0) > 0 && <div className="alert" role="status" style={{ display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'space-between' }}>
      <span>No hay excepciones ahora mismo: las <strong>{data.counts.draft}</strong> oferta(s) pendientes esperan a la pasada automática (reglas + IA).</span>
      <button onClick={() => change(setStatus)('draft')}>Ver borradores</button>
    </div>}
    <div className="admin-toolbar" style={{ justifyContent: 'space-between' }}>
      <div className="stat-strip" style={{ margin: 0 }}><span><strong>{data?.total ?? '…'}</strong>cumplen los filtros</span><span><strong>{chosen.length}</strong>seleccionadas en esta página</span>
        {/* La cola entera, sin los filtros de perfil/España: si no, «cumplen los filtros» esconde el trabajo real. */}
        {status === 'needs_review' && data && <span><strong>{data.counts.needs_review ?? 0}</strong>en tu cola de excepciones (sin filtros)</span>}</div>
      <label className="check-label" style={{ flexDirection: 'row', alignItems: 'center' }}><input type="checkbox" checked={onlySpain} onChange={e => change(setOnlySpain)(e.target.checked)} /> Solo con señal clara de España</label>
    </div>
    {status === 'draft' && <div className="search-panel admin-toolbar" style={{ alignItems: 'center' }}>
      <Sparkles size={18} aria-hidden="true" />
      <label htmlFor="ex-topn" style={{ flexDirection: 'row', alignItems: 'center', flex: '0 0 auto' }}>Aprobar las <input id="ex-topn" type="number" min={1} max={500} value={topN} onChange={e => setTopN(Math.max(1, Math.min(500, Number(e.target.value) || 1)))} style={{ width: 84 }} /> mejores</label>
      <span className="card-meta" style={{ flex: '1 1 260px', margin: 0 }}>Toma los borradores que cumplen los filtros de arriba, empezando por la mayor puntuación. Es reversible.</span>
      <button className="primary" disabled={!data?.total || working !== ''} onClick={() => void approveBest()}>{working === 'best' ? <LoaderCircle size={15} className="spin" /> : <Check size={15} />} Aprobar las mejores</button>
    </div>}
    <div className="admin-toolbar">
      <button disabled={!chosen.length || working !== ''} onClick={() => void act('verify')}>{working === 'verify' ? <LoaderCircle size={15} className="spin" /> : <ShieldCheck size={15} />} Verificar vigencia</button>
      <button className="primary" disabled={!chosen.length || working !== ''} onClick={() => void act('approved')}><Check size={15} /> Aprobar {chosen.length || ''}</button>
      <button disabled={!chosen.length || working !== ''} onClick={() => void act('draft')}><Undo2 size={15} /> Volver a borrador</button>
      <button disabled={!chosen.length || working !== ''} onClick={() => void act('withdrawn')}>Retirar</button>
      <button disabled={!data?.total || working !== ''} onClick={() => void exportAll()}>{working === 'csv' ? <LoaderCircle size={15} className="spin" /> : <FileDown size={15} />} Exportar CSV</button>
    </div>
    {busy && !data ? <p className="muted"><LoaderCircle size={14} className="spin" /> Cargando…</p> : !rows.length ? <div className="empty"><h3>No hay ofertas externas con estos filtros.</h3><p className="card-meta">Guarda una clave en APIs, lanza una recogida o relaja los filtros.</p></div> : <>
      <div className="table-wrap"><table className="data-table">
        <thead><tr><th style={{ width: 36 }}><input type="checkbox" aria-label="Seleccionar todas las visibles" checked={allPicked} onChange={() => setPicked(allPicked ? new Set() : new Set(rows.map(r => r.id)))} /></th><th className="num">Punt.</th><th>Oferta</th><th>Perfil</th><th>Ubicación</th><th>Fuente</th><th>Revisor IA</th><th>Vigencia</th><th /></tr></thead>
        <tbody>{rows.map(r => <tr key={r.id}>
          <td><input type="checkbox" aria-label={`Seleccionar ${r.title}`} checked={picked.has(r.id)} onChange={() => setPicked(old => { const n = new Set(old); if (n.has(r.id)) n.delete(r.id); else n.add(r.id); return n; })} /></td>
          <td className="num"><span className={tone(r.score)}>{r.score}</span></td>
          <td className="primary-cell"><strong>{r.title}</strong><span>{r.company ?? 'Empresa no indicada'}{r.salary ? ` · ${r.salary}` : ''}</span>{r.tags && <span className="sub" data-testid="tags">{r.tags.niche ? `${NICHE_LABELS[r.tags.niche]} · ` : ''}{PAY_LABELS[r.tags.pay]}</span>}{r.risk && <span data-testid="risk"><span className={r.risk.level === 'BLOCKED' ? 'status bad' : 'status'}>{r.risk.level === 'BLOCKED' ? 'Oferta peligrosa' : 'Con avisos'}</span> {r.risk.flags.join(' ')}</span>}</td>
          <td>{r.role ? <span className="status ok">{ROLE_LABELS[r.role as RoleFamily] ?? r.role}</span> : <span className="status">Sin perfil claro</span>}</td>
          <td>{r.location ?? 'No indicada'}{r.spain !== null && <span className={r.spain ? 'status ok' : 'status bad'} style={{ marginLeft: 6 }}>{r.spain ? 'España' : 'Fuera'}</span>}</td>
          <td>{r.source}{r.also_seen?.length ? <span className="sub">también en {r.also_seen.join(', ')}</span> : null}</td>
          <td>{r.ai_review ? <span title={[...(r.ai_review.reasons ?? []), r.ai_review.link ? `Enlace: ${r.ai_review.link.result} (${r.ai_review.link.reason})` : '', r.ai_review.jev ? `Jev: ${r.ai_review.jev.verdict ?? '—'} ${r.ai_review.jev.score ?? ''}` : ''].filter(Boolean).join(' · ')}><span className={r.ai_review.would_decide === 'approve' ? 'status ok' : r.ai_review.would_decide === 'withdraw' ? 'status bad' : 'status'}>{WOULD[r.ai_review.would_decide] ?? r.ai_review.would_decide}</span><span className="sub">{r.ai_review.verdict} {r.ai_review.confidence}% · {r.ai_review.mode === 'shadow' ? 'shadow' : r.ai_review.applied ? 'aplicado' : 'live'}{r.ai_review.audit_sample ? ' · auditoría' : ''}</span></span> : <span className="muted">—</span>}</td>
          <td>{verdicts[r.id] ?? (r.verified_result ? VERDICT[r.verified_result] : <span className="muted">—</span>)}</td>
          <td style={{ textAlign: 'right' }}><a href={r.url} target="_blank" rel="noopener noreferrer" aria-label={`Abrir el anuncio original de ${r.title}`}><ExternalLink size={14} /></a></td></tr>)}</tbody></table></div>
      <div className="admin-toolbar" style={{ justifyContent: 'center', marginTop: 16 }}>
        <button disabled={page <= 1 || busy} onClick={() => setPage(p => p - 1)} aria-label="Página anterior"><ChevronLeft size={15} /></button>
        <span className="card-meta" style={{ margin: 0 }}>Página {page} de {pages}</span>
        <button disabled={page >= pages || busy} onClick={() => setPage(p => p + 1)} aria-label="Página siguiente"><ChevronRight size={15} /></button>
      </div></>}
  </section>;
}
