'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowDownToLine, ArrowUpRight, Bookmark, Check, CheckCheck, ChevronRight, CircleHelp, Clock3, Compass, Copy, ExternalLink, Globe2, Layers3, LoaderCircle, Search, SlidersHorizontal, Sparkles, X } from 'lucide-react';
import Sources from './Sources';
import CollectionPanel from './CollectionPanel';
import AIAnalysis from './AIAnalysis';
import type { components } from '../../../packages/contracts/api';

type Query = components['schemas']['SearchQuery'];
type Run = components['schemas']['SearchRun'];
type Job = components['schemas']['Job'];
type Config = components['schemas']['Configuration'];
type Saved = components['schemas']['SavedSearch'];
const defaults: Query = { role: 'digital_sales', keywords: '', market: 'any', language: 'es', require_spanish: true, work_mode: 'remote_hybrid', days: 10, salary_min: 0, salary_currency: 'EUR', salary_mode: 'prefer', include_unknown: true, sources: ['himalayas', 'weworkremotely', 'remotive', 'remoteok', 'arbeitnow', 'getonbrd-public'] };
const roles = { digital_sales: 'Closers, setters y comercial online', sales: 'Ventas · búsqueda amplia', closer: 'Closer de ventas', setter: 'Appointment setter', sdr: 'SDR / BDR', account_executive: 'Account executive', custom: 'Otro puesto' };
const statuses: Record<string, string> = { queued: 'En cola', running: 'Buscando', completed: 'Completada', partial: 'Resultados parciales', failed: 'No disponible', cancelled: 'Cancelada' };
const date = (value?: string | null) => value ? new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short' }).format(new Date(value)) : 'Fecha sin confirmar';
const active = (run: Run | null) => !!run && ['queued', 'running'].includes(run.status);

async function api<T>(path: string, body?: unknown, method = 'POST'): Promise<T> {
  const response = await fetch(`/api/backend/${path}`, { method: body === undefined ? 'GET' : method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(typeof error.detail === 'string' ? error.detail : 'No se pudo completar la operación. Revisa los campos e inténtalo otra vez.');
  }
  return response.json() as Promise<T>;
}

function compensation(job: Job) {
  if (!job.salary_min && !job.salary_max) return 'Compensación no publicada';
  const amount = (n: number) => new Intl.NumberFormat('es', { maximumFractionDigits: 0 }).format(n);
  const period: Record<string, string> = { annual: 'año', yearly: 'año', monthly: 'mes', hourly: 'hora', weekly: 'semana' };
  return `${job.salary_min ? amount(job.salary_min) : 'Hasta'}${job.salary_max ? ` – ${amount(job.salary_max)}` : ''} ${job.salary_currency || ''}${job.salary_period ? ` / ${period[job.salary_period] || job.salary_period}` : ''}`;
}

export default function Workspace() {
  const [config, setConfig] = useState<Config | null>(null);
  const [query, setQuery] = useState<Query>(defaults);
  const [run, setRun] = useState<Run | null>(null);
  const [history, setHistory] = useState<Run[]>([]);
  const [saved, setSaved] = useState<Saved[]>([]);
  const [tab, setTab] = useState<'search' | 'history' | 'sources'>('search');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState('');
  const [onlyStarred, setOnlyStarred] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [detail, setDetail] = useState<Job | null>(null);
  const [saveName, setSaveName] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  const pollFailures = useRef(0);

  useEffect(() => {
    Promise.all([api<Config>('config'), api<Run[]>('search-runs'), api<Saved[]>('saved-searches')])
      .then(([c, h, s]) => { setConfig(c); setQuery(old => ({ ...old, sources: c.sources.filter(source => source.available).map(source => source.code) })); setHistory(h); setSaved(s); })
      .catch(e => setError(e.message));
  }, []);
  useEffect(() => {
    if (!run || !active(run)) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const current = await api<Run>(`search-runs/${run!.id}`);
        if (stopped) return;
        setRun(current);
        pollFailures.current = 0;
        if (active(current)) timer = setTimeout(poll, 1500);
        else api<Run[]>('search-runs').then(h => { if (!stopped) setHistory(h); }).catch(() => {});
      } catch (e) {
        if (stopped) return;
        pollFailures.current += 1;
        setError((e as Error).message);
        if (pollFailures.current < 5) timer = setTimeout(poll, 4000);
      }
    }
    timer = setTimeout(poll, 700);
    return () => { stopped = true; clearTimeout(timer); };
  }, [run?.id, run?.status]); // polling belongs to the selected run, not each result batch
  useEffect(() => {
    if (detail && dialog.current && !dialog.current.open) dialog.current.showModal();
  }, [detail]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(''), 4500);
    return () => clearTimeout(timer);
  }, [notice]);

  const update = <K extends keyof Query>(key: K, value: Query[K]) => setQuery(q => ({ ...q, [key]: value }));
  async function search() {
    setBusy(true); setError(''); setSelected(new Set()); setFilter(''); setOnlyStarred(false); setShowAll(false); pollFailures.current = 0;
    try { setRun(await api<Run>('search-runs', { query, idempotency_key: crypto.randomUUID() })); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  async function openRun(id: string) {
    setError('');
    try { const r = await api<Run>(`search-runs/${id}`); setRun(r); setQuery({ ...r.query, days: Math.min(r.query.days || 10, 10) }); setSelected(new Set()); setFilter(''); setOnlyStarred(false); setTab('search'); }
    catch (e) { setError((e as Error).message); }
  }
  async function star(job: Job) {
    try {
      await api(`jobs/${job.id}/star`, { starred: !job.starred }, 'PATCH');
      setRun(r => r ? { ...r, jobs: r.jobs?.map(j => j.id === job.id ? { ...j, starred: !j.starred } : j) } : r);
    } catch (e) { setError((e as Error).message); }
  }
  async function exportJobs(format: 'csv' | 'json' | 'xlsx') {
    if (!run || !selected.size) return;
    setExporting(true); setError('');
    try {
      const response = await fetch('/api/backend/exports', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ run_id: run.id, job_ids: [...selected], format }) });
      if (!response.ok) throw new Error('No se pudo exportar la selección.');
      const url = URL.createObjectURL(await response.blob());
      const a = document.createElement('a'); a.href = url; a.download = `oportunidades.${format}`; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000); setNotice('Selección exportada con sus fuentes.');
    } catch (e) { setError((e as Error).message); }
    finally { setExporting(false); }
  }
  async function copyJobs(jobs: Job[]) {
    try {
      await navigator.clipboard.writeText(jobs.map(j => `${j.title} — ${j.company}\n${j.locations.join(', ') || 'Ubicación por confirmar'}\n${compensation(j)}\n${j.warnings.length ? 'Revisar: ' + j.warnings.join('; ') + '\n' : ''}Fuente: ${j.source}\n${j.source_url}`).join('\n\n————\n\n'));
      setNotice('Texto copiado con atribución y puntos pendientes de revisión.');
    } catch { setError('El navegador no permitió copiar. Puedes exportar la selección.'); }
  }
  async function saveSearch() {
    if (!saveName.trim()) return;
    try { const s = await api<Saved>('saved-searches', { name: saveName.trim(), query }); setSaved(old => [...old, s]); setSaveName(''); setNotice('Búsqueda guardada para repetirla.'); }
    catch (e) { setError((e as Error).message); }
  }
  const jobs = run?.jobs || [];
  const filtered = jobs.filter(j => (!onlyStarred || j.starred) && `${j.title} ${j.company} ${j.source}`.toLowerCase().includes(filter.toLowerCase()));
  const visible = showAll ? filtered : filtered.slice(0, 30);
  const fetched = run?.sources.reduce((sum, s) => sum + (s.fetched || 0), 0) || 0;

  return <div className="shell">
    <aside className="sidebar">
      <a className="brand" href="/" aria-label="WDC · Inicio"><span className="brand-mark">w.</span><span>Women Digital<br /><strong>Closer</strong></span></a>
      <div className="workspace-label">ESPACIO DEL EQUIPO</div>
      <nav aria-label="Navegación principal">
        <button className={tab === 'search' ? 'nav active' : 'nav'} onClick={() => setTab('search')}><Compass size={18} /> Oportunidades <span className="nav-dot" /></button>
        <button className={tab === 'history' ? 'nav active' : 'nav'} onClick={() => { setTab('history'); api<Run[]>('search-runs').then(setHistory).catch(e => setError(e.message)); }}><Clock3 size={18} /> Historial</button>
        <button className={tab === 'sources' ? 'nav active' : 'nav'} onClick={() => setTab('sources')}><Layers3 size={18} /> Red de oportunidades</button>
      </nav>
      <div className="sidebar-note"><span className="eyebrow">DE LA PREPARACIÓN<br />A LA OPORTUNIDAD</span><p>El siguiente paso profesional empieza con una buena selección.</p><div className="path-dots"><i /><span /><i /><span /><i /></div></div>
      <div className="local-user"><span className="avatar">EQ</span><div><strong>Equipo WDC</strong><small>Uso local · este ordenador</small></div></div>
    </aside>
    <div className="main-shell">
      <header className="topbar"><div>{config?.organization || 'Women Digital Closer'} <ChevronRight size={14} /> <strong>{tab === 'search' ? 'Oportunidades' : tab === 'history' ? 'Historial' : 'Red de oportunidades'}</strong></div><span className="local-badge"><span /> Versión local</span></header>
      <main>
        <div className="page-heading"><div><span className="eyebrow">{tab === 'search' ? 'CONEXIONES QUE ABREN CAMINO' : 'TU MESA DE TRABAJO'}</span><h1>{tab === 'search' ? 'Su próximo paso empieza aquí.' : tab === 'history' ? 'Cada búsqueda, a mano.' : 'Tu red de oportunidades.'}</h1><p>{tab === 'search' ? 'Encuentra oportunidades, revisa el encaje y prepara una selección para tus alumnas.' : tab === 'history' ? 'Recupera resultados y repite las búsquedas que te funcionan.' : 'Exploramos portales, comunidades y empresas para acercarte oportunidades relevantes.'}</p></div><span className="heading-icon"><Compass size={30} strokeWidth={1.2} /></span></div>
        {error && <div className="alert error" role="alert"><span>{error}</span><button aria-label="Cerrar aviso" onClick={() => setError('')}><X size={16} /></button></div>}
        {notice && <div className="toast" role="status"><CheckCheck size={18} />{notice}</div>}
        {tab === 'search' && <>
          <CollectionPanel />
          <form className="search-panel" onSubmit={e => { e.preventDefault(); search(); }}>
            <div className="panel-title"><span><Search size={17} /> ¿Qué oportunidad buscas?</span><span className="muted">Español · online o híbrido</span></div>
            <div className="search-grid">
              <label>Perfil profesional<select value={query.role} onChange={e => update('role', e.target.value as Query['role'])}>{Object.entries(roles).map(([v, label]) => <option key={v} value={v}>{label}</option>)}</select></label>
              <label>Mercado<select value={query.market} onChange={e => update('market', e.target.value as Query['market'])}><option value="any">Todos los mercados</option><option value="ES">España</option><option value="EU">Europa · cualquier país</option><option value="LATAM">Latinoamérica</option><option value="US">Estados Unidos</option></select></label>
              <label>Publicación<select value={query.days} onChange={e => update('days', Number(e.target.value))}><option value={1}>Últimas 24 horas</option><option value={3}>Últimas 72 horas</option><option value={7}>Últimos 7 días</option><option value={10}>Últimos 10 días</option></select></label>
              <button className="primary search-button" disabled={busy || active(run) || !config || !query.sources?.length}>{busy || active(run) ? <LoaderCircle className="spin" size={18} /> : <Search size={18} />}{active(run) ? 'Buscando…' : 'Buscar oportunidades'}</button>
            </div>
            <div className="search-bottom"><details className="advanced"><summary><SlidersHorizontal size={15} /> Afinar búsqueda</summary><div className="advanced-grid">
              <label>Palabras clave<input value={query.keywords} maxLength={120} placeholder="Ej. high ticket, SaaS…" onChange={e => update('keywords', e.target.value)} /></label>
              <label>Idioma mencionado<select value={query.language} onChange={e => update('language', e.target.value as Query['language'])}><option value="any">Cualquier idioma</option><option value="es">Español</option><option value="en">Inglés</option></select></label>
              <label>Modalidad<select value={query.work_mode} onChange={e => update('work_mode', e.target.value as Query['work_mode'])}><option value="remote_hybrid">Remoto o híbrido publicado</option><option value="remote">Solo remoto publicado</option><option value="any">Cualquier modalidad</option></select></label><label className="check-label"><input type="checkbox" checked={query.require_spanish} onChange={e => update('require_spanish', e.target.checked)} />Exigir evidencia de español (incluye bilingües)</label><label>Mínimo mensual<input type="number" min={0} max={100000} value={query.salary_min} onChange={e => update('salary_min', Number(e.target.value))} /></label>
              <label>Moneda<select value={query.salary_currency} onChange={e => update('salary_currency', e.target.value as Query['salary_currency'])}><option>EUR</option><option>USD</option></select></label>
              <label>Compensación<select value={query.salary_mode} onChange={e => update('salary_mode', e.target.value as Query['salary_mode'])}><option value="prefer">Preferencia, admite sin confirmar</option><option value="strict">Exigir mínimo publicado</option></select></label>
              <label className="check-label"><input type="checkbox" checked={query.include_unknown} onChange={e => update('include_unknown', e.target.checked)} />Incluir país o fecha sin confirmar</label>
              <fieldset><legend>Fuentes</legend>{config?.sources.filter(s => s.available).map(s => <label className="check-label" key={s.code}><input type="checkbox" checked={query.sources?.includes(s.code)} onChange={e => update('sources', e.target.checked ? [...(query.sources || []), s.code] : query.sources?.filter(v => v !== s.code))} />{s.name}</label>)}</fieldset>
            </div></details><span className="source-caption"><span className="status-dot" />{query.sources?.length || 0} fuentes seleccionadas</span></div>
            {query.role === 'custom' && !query.keywords && <p className="inline-hint">Escribe el puesto en «Afinar búsqueda → Palabras clave».</p>}
          </form>
          <p className="inline-hint">Incluye closer de ventas, closer digital, high ticket closer, appointment setter, setter, comercial digital, cerrador y venta de alto valor. Español/bilingüe con evidencia; remoto o híbrido con modalidad publicada.</p><div className="saved-strip"><Bookmark size={15} /><span>Repetir búsqueda:</span>{saved.slice(0, 4).map(s => <button key={s.id} onClick={() => { setQuery({ ...s.query, days: Math.min(s.query.days || 10, 10) }); setNotice('Filtros cargados. Pulsa Buscar oportunidades.'); }}>{s.name}</button>)}<details><summary>Guardar estos filtros <span>+</span></summary><div className="save-form"><label>Nombre<input value={saveName} maxLength={80} onChange={e => setSaveName(e.target.value)} placeholder="Ej. Closers España" /></label><button type="button" onClick={saveSearch} disabled={!saveName.trim()}>Guardar</button></div></details></div>
          {run && <section className="run-progress" aria-label="Progreso de búsqueda"><div className="run-heading"><strong aria-live="polite">{statuses[run.status]} <span className="muted">· {fetched} publicaciones revisadas</span></strong>{active(run) && <button onClick={async () => { try { setRun(await api<Run>(`search-runs/${run.id}/cancel`, {})); } catch (e) { setError((e as Error).message); } }}>Cancelar</button>}</div><div className="sources-progress">{run.sources.map(s => <div className={`source-progress ${s.status}`} key={s.code}>{s.status === 'running' ? <LoaderCircle size={15} className="spin" /> : s.status === 'completed' ? <Check size={15} /> : <span className="status-dot" />}<span>{s.name}</span><small>{s.status === 'completed' ? `${s.accepted} con encaje` : statuses[s.status] || s.status}</small>{s.warning && <p>{s.warning}</p>}</div>)}</div></section>}
          <section className="results-section"><div className="results-heading"><h2>{run ? 'Oportunidades encontradas' : 'Tu selección de oportunidades'} <span>{jobs.length}</span></h2><label className="star-filter"><input type="checkbox" checked={onlyStarred} onChange={e => setOnlyStarred(e.target.checked)} /><Bookmark size={15} /> Marcadas</label></div>
            {jobs.length > 0 && <div className="results-toolbar"><label className="result-search"><Search size={16} /><input aria-label="Filtrar resultados" placeholder="Filtrar por puesto, empresa o fuente" value={filter} onChange={e => setFilter(e.target.value)} /></label><button onClick={() => setSelected(selected.size === visible.length ? new Set() : new Set(visible.map(j => j.id)))}>{selected.size === visible.length && visible.length ? 'Quitar selección' : 'Seleccionar visibles'}</button></div>}
            {!visible.length ? <div className="empty"><span className="empty-icon">{active(run) ? <LoaderCircle size={28} className="spin" /> : <Compass size={32} strokeWidth={1.3} />}</span><h3>{active(run) ? 'Consultando las ofertas guardadas.' : jobs.length ? 'Ninguna oferta coincide con este filtro.' : run ? 'Sin oportunidades que cumplan estos criterios.' : 'Una buena oportunidad merece ser encontrada.'}</h3><p>{active(run) ? 'Esta consulta utiliza el catálogo local y no inicia extracciones de pago.' : run ? 'Prueba otros filtros. Puedes revisar la recogida diaria en Red de oportunidades.' : 'Elige un perfil y comienza la búsqueda. Aquí podrás comparar condiciones y preparar tu selección.'}</p>{!run && <div className="empty-steps"><span>01 Explora</span><ChevronRight size={14} /><span>02 Revisa</span><ChevronRight size={14} /><span>03 Comparte</span></div>}</div> : <div className="job-list">{visible.map(job => <article className={`job-row ${selected.has(job.id) ? 'selected' : ''}`} key={job.id}>
              <label className="select-job"><input type="checkbox" aria-label={`Seleccionar ${job.title}`} checked={selected.has(job.id)} onChange={e => setSelected(old => { const next = new Set(old); e.target.checked ? next.add(job.id) : next.delete(job.id); return next; })} /></label>
              <div className="company-monogram" aria-hidden="true">{job.company.slice(0, 2).toUpperCase()}</div>
              <div className="job-info"><div className="job-company">{job.company} <span>· {date(job.published_at)}</span></div><button className="job-title" onClick={() => setDetail(job)}>{job.title}<ArrowUpRight size={16} /></button><div className="job-meta"><span><Globe2 size={13} />{job.locations.join(', ') || 'País por confirmar'}</span><span>{compensation(job)}</span></div><div className="job-signals"><span className="source-tag">{job.source}</span>{job.warnings.length > 0 && <span className="review-tag">{job.warnings.length} aspectos por revisar</span>}</div></div>
              <div className="job-end"><button aria-label={job.starred ? `Desmarcar ${job.title}` : `Marcar ${job.title}`} className={`icon-button ${job.starred ? 'is-starred' : ''}`} onClick={() => star(job)}><Bookmark size={19} fill={job.starred ? 'currentColor' : 'none'} /></button><span className="score" title="Puntuación orientativa por coincidencia textual, fecha y filtros; no es probabilidad de contratación.">{job.score}<small>encaje /100</small></span></div>
            </article>)}</div>}
            {filtered.length > 30 && <button style={{ marginTop: 16 }} onClick={() => setShowAll(v => !v)}>{showAll ? 'Mostrar las 30 primeras' : `Ver las ${filtered.length} oportunidades`}</button>}
            {selected.size > 0 && <div className="selection-bar"><strong><CheckCheck size={18} />{selected.size} seleccionadas</strong><div><button onClick={() => copyJobs(jobs.filter(j => selected.has(j.id)))}><Copy size={15} />Copiar</button>{(['csv', 'xlsx', 'json'] as const).map(format => <button disabled={exporting} key={format} onClick={() => exportJobs(format)}><ArrowDownToLine size={15} />{format.toUpperCase()}</button>)}</div></div>}
          </section><p className="footnote"><CircleHelp size={14} /> El encaje es orientativo. Revisa requisitos y condiciones en la oferta original antes de compartirla.</p>
        </>}
        {tab === 'history' && <section className="history-list">{!history.length ? <div className="empty"><Clock3 size={32} /><h3>Todavía no hay búsquedas.</h3><p>Tu historial se guarda en este ordenador.</p><button className="primary" onClick={() => setTab('search')}>Buscar oportunidades</button></div> : history.map(h => <button key={h.id} className="history-row" onClick={() => openRun(h.id)}><span className="history-symbol"><Search size={20} /></span><span><strong>{roles[h.query.role || 'sales']}</strong><small>{date(h.created_at)} · {h.query.market === 'any' ? 'Todos los mercados' : h.query.market} · Últimos {h.query.days} días</small></span><span className="history-status">{statuses[h.status]}</span><ChevronRight size={18} /></button>)}</section>}
        {tab === 'sources' && config && <Sources config={config} onRefresh={async () => { const next = await api<Config>('config'); setConfig(next); setQuery(old => ({ ...old, sources: [...new Set([...(old.sources || []), ...next.sources.filter(s => s.available && !config.sources.some(previous => previous.code === s.code && previous.available)).map(s => s.code)])].filter(code => next.sources.some(s => s.code === code && s.available)) })); }} />}
      </main>
    </div>
    <dialog ref={dialog} onClose={() => setDetail(null)} onClick={e => { if (e.target === dialog.current) dialog.current.close(); }}>
      {detail && <div className="detail"><div className="detail-top"><span className="eyebrow">REVISAR OPORTUNIDAD</span><button className="icon-button" aria-label="Cerrar detalle" onClick={() => dialog.current?.close()}><X size={20} /></button></div><p className="job-company">{detail.company}</p><h2>{detail.title}</h2><p className="detail-compensation">{compensation(detail)}</p><div className="detail-signals"><h3><Sparkles size={16} /> Por qué aparece</h3>{detail.reasons.map(r => <p key={r}><Check size={14} /> {r}</p>)}</div>{detail.warnings.length > 0 && <div className="detail-warnings"><h3>Antes de compartir, confirma</h3><ul>{detail.warnings.map(w => <li key={w}>{w}</li>)}</ul></div>}{run && <AIAnalysis key={detail.id} runId={run.id} jobId={detail.id} />}<h3>Descripción original</h3><div className="description">{detail.description || 'La fuente no incluye una descripción.'}</div><div className="provenance"><strong>Fuente: {detail.source}</strong><span>Publicada: {date(detail.published_at)} · Capturada: {date(detail.captured_at)}</span><span>No se ha confirmado que siga aceptando candidaturas.</span></div><div className="detail-actions"><a className="primary" href={detail.source_url} target="_blank" rel="noopener noreferrer">Ver oferta original <ExternalLink size={16} /></a><button onClick={() => copyJobs([detail])}><Copy size={16} /> Copiar</button></div></div>}
    </dialog>
  </div>;
}
