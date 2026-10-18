'use client';
import { useCallback, useEffect, useState } from 'react';
import { CloudDownload, LoaderCircle, Pencil, Play, Plus, RefreshCcw, Trash2 } from 'lucide-react';

// Apify: el scraping se ejecuta en la infraestructura de Apify (con sus proxies), no en la nuestra. De pago por uso:
// nada se lanza solo salvo los actores marcados como diarios, con tope mensual y límites por ejecución.
type Actor = { id: string; label: string; actor: string; source: string; input_template: Record<string, unknown> | null; max_items: number; memory_mb: number; timeout_s: number; schedule_daily: boolean };
type Run = { id: string; actor_id: string; run_id: string; status: string; started_at: string; finished_at: string | null; items_total: number | null; harvested: number; cost_usd: number | null; error: string | null };
type Data = { actors: Actor[]; runs: Run[]; presets: Array<{ label: string; actor: string; source: string }>; budget: { spent: number | null; limit: number }; has_key: boolean };
type Form = { id?: string; label: string; actor: string; source: string; input_template: string; max_items: number; memory_mb: number; timeout_s: number; schedule_daily: boolean };
const blank: Form = { label: '', actor: '', source: '', input_template: '', max_items: 500, memory_mb: 1024, timeout_s: 900, schedule_daily: false };
const fmt = (v: string | null) => v ? new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(v)) : '—';
const RUN: Record<string, string> = { RUNNING: 'En curso', SUCCEEDED: 'Terminada', FAILED: 'Fallida', 'TIMED-OUT': 'Tiempo agotado', ABORTED: 'Abortada' };

async function call<T>(init?: RequestInit): Promise<T> {
  const response = await fetch('/api/admin/apify', { headers: { 'Content-Type': 'application/json' }, ...init });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof (data as { detail?: string }).detail === 'string' ? (data as { detail: string }).detail : 'La operación falló.');
  return data as T;
}

export default function ApifyTab({ owner, onSessionLost, goApis }: { owner: boolean; onSessionLost: () => void; goApis: () => void }) {
  const [data, setData] = useState<Data | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [fields, setFields] = useState<Array<{ name: string; type: string; required: boolean }> | null>(null);
  const [busy, setBusy] = useState(true);
  const [working, setWorking] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const lost = useCallback((err: Error) => { if (err.message.includes('Sesión')) onSessionLost(); setError(err.message); }, [onSessionLost]);
  const load = useCallback(() => { setBusy(true); call<Data>().then(d => { setData(d); setError(''); }).catch(lost).finally(() => setBusy(false)); }, [lost]);
  useEffect(load, [load]);

  async function run(kind: string, action: () => Promise<string>) {
    setWorking(kind); setError(''); setNotice('');
    try { setNotice(await action()); load(); } catch (err) { lost(err as Error); } finally { setWorking(''); }
  }
  const post = (body: Record<string, unknown>) => call<Record<string, unknown>>({ method: 'POST', body: JSON.stringify(body) });
  const edit = (a: Actor) => { setFields(null); setForm({ id: a.id, label: a.label, actor: a.actor, source: a.source, input_template: a.input_template ? JSON.stringify(a.input_template, null, 2) : '', max_items: a.max_items, memory_mb: a.memory_mb, timeout_s: a.timeout_s, schedule_daily: a.schedule_daily }); };
  const actorName = (id: string) => data?.actors.find(a => a.id === id)?.label ?? '—';
  const pct = data && data.budget.spent !== null ? Math.min(100, Math.round((data.budget.spent / data.budget.limit) * 100)) : 0;

  return <section aria-label="Apify">
    <p className="card-meta" style={{ marginTop: 0, marginBottom: 20, maxWidth: 780 }}>Los scrapers de Apify corren en su infraestructura, con sus proxies: no necesitas montar nada y no hay bloqueos por tu IP. Es de pago por uso, así que nada se lanza solo salvo lo que marques como diario, con un tope mensual y límites por ejecución. Lo recogido entra como borrador en Fuentes externas, con puntuación.</p>
    {error && <div className="alert error" role="alert"><span>{error}</span></div>}
    {notice && <div className="auth-note" role="status" style={{ marginBottom: 16 }}>{notice}</div>}
    {data && !data.has_key && <div className="alert"><span>Falta la clave de Apify.</span><button onClick={goApis}>Guardarla en APIs</button></div>}
    {data && <article className="source-card" style={{ marginBottom: 20 }}>
      <div className="card-head"><div><span className="eyebrow">GASTO DEL MES EN APIFY</span><h3 style={{ marginTop: 4 }}>{data.budget.spent === null ? '—' : data.budget.spent.toFixed(2)} USD de {data.budget.limit} USD</h3>{data.budget.spent === null && <p className="card-meta" role="alert">No se pudo leer el gasto del mes: no se lanzará ninguna ejecución hasta poder comprobarlo.</p>}</div><span className={data.budget.spent === null ? 'status' : pct >= 90 ? 'status bad' : 'status'}>{data.budget.spent === null ? '—' : `${pct} %`}</span></div>
      <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Gasto del mes" style={{ height: 8, borderRadius: 99, background: 'var(--inset)', marginTop: 14, overflow: 'hidden' }}><div style={{ width: `${pct}%`, height: '100%', background: pct >= 90 ? 'var(--warning)' : 'var(--accent)' }} /></div>
      <p className="card-meta">Se suma el coste real de cada ejecución terminada y se reserva 1 USD por cada una en curso. Al llegar al tope no se lanza ninguna más. Es un límite de esta app: ponlo también en Apify (Settings → Billing → límite de gasto).</p>
    </article>}
    <div className="admin-toolbar" style={{ justifyContent: 'space-between' }}>
      <h2 className="section-title" style={{ margin: 0 }}>Actores</h2>
      <div className="admin-toolbar" style={{ margin: 0 }}>
        <button disabled={busy} onClick={load}>{busy ? <LoaderCircle size={15} className="spin" /> : <RefreshCcw size={15} />} Actualizar</button>
        <button disabled={working !== ''} onClick={() => void run('harvest', async () => { const r = await post({ action: 'harvest' }) as { results: Array<{ done: boolean; harvested: number }> }; return r.results.length ? `Recogidas ${r.results.length} ejecución(es): ${r.results.map(x => `${x.harvested} elementos${x.done ? '' : ' (continúa)'}`).join(', ')}.` : 'No hay ejecuciones pendientes de recoger.'; })}>{working === 'harvest' ? <LoaderCircle size={15} className="spin" /> : <CloudDownload size={15} />} Recoger resultados</button>
        {owner && <button className="primary" onClick={() => { setFields(null); setForm({ ...blank }); }}><Plus size={15} /> Añadir actor</button>}
      </div>
    </div>
    {owner && !data?.actors.length && data?.presets.map(p => <div className="search-panel admin-toolbar" key={p.actor} style={{ alignItems: 'center' }}>
      <span style={{ flex: '1 1 300px' }}><strong>{p.label}</strong><span className="card-meta" style={{ display: 'block', margin: 0 }}>{p.actor} · envoltorio de JobSpy mantenido por un autor de la comunidad (poco usado): comprueba su ficha antes de fiarte.</span></span>
      <button onClick={() => { setFields(null); setForm({ ...blank, label: p.label, actor: p.actor, source: p.source }); }}><Plus size={14} /> Usar este actor</button></div>)}
    {!busy && !data?.actors.length ? <div className="empty"><h3>Aún no hay actores configurados.</h3><p className="card-meta">Añade uno (por ejemplo JobSpy) con «Añadir actor».</p></div> : data && <div className="table-wrap" style={{ marginBottom: 24 }}><table className="data-table">
      <thead><tr><th>Actor</th><th>Fuente</th><th className="num">Máx. elementos</th><th>Límites</th><th>Diario</th><th /></tr></thead>
      <tbody>{data.actors.map(a => <tr key={a.id}>
        <td className="primary-cell"><strong>{a.label}</strong><span>{a.actor}</span></td><td>{a.source}</td><td className="num">{a.max_items}</td><td>{a.memory_mb} MB · {Math.round(a.timeout_s / 60)} min</td>
        <td><span className={a.schedule_daily ? 'status ok' : 'status'}>{a.schedule_daily ? 'Sí' : 'No'}</span></td>
        <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{owner && <>
          <button disabled={working !== ''} onClick={() => { if (window.confirm(`¿Lanzar «${a.label}» ahora? Gasta crédito de Apify (hasta ${a.max_items} elementos).`)) void run(`start-${a.id}`, async () => { await post({ action: 'start', id: a.id }); return 'Ejecución lanzada en Apify. Los resultados entran solos al terminar (o con «Recoger resultados»).'; }); }}>{working === `start-${a.id}` ? <LoaderCircle size={14} className="spin" /> : <Play size={14} />} Lanzar ahora</button>{' '}
          <button onClick={() => edit(a)} aria-label={`Editar ${a.label}`}><Pencil size={14} /></button>{' '}
          <button disabled={working !== ''} onClick={() => { if (window.confirm(`¿Borrar «${a.label}»? Se borra también su historial de ejecuciones.`)) void run('del', async () => { await post({ action: 'delete', id: a.id }); return 'Actor borrado.'; }); }} aria-label={`Borrar ${a.label}`}><Trash2 size={14} /></button></>}</td></tr>)}</tbody></table></div>}
    {form && owner && <form className="search-panel" style={{ marginBottom: 24, display: 'grid', gap: 14 }} onSubmit={e => { e.preventDefault(); void run('save', async () => { await post({ action: 'save', ...form }); setForm(null); return 'Actor guardado.'; }); }}>
      <h3 style={{ fontSize: 15 }}>{form.id ? 'Editar actor' : 'Añadir actor'}</h3>
      <div className="review-grid"><label htmlFor="ap-label">Nombre<input id="ap-label" required maxLength={80} value={form.label} onChange={e => setForm({ ...form, label: e.target.value })} /></label>
        <label htmlFor="ap-actor">Actor de Apify<input id="ap-actor" required placeholder="propietario/nombre" value={form.actor} onChange={e => setForm({ ...form, actor: e.target.value })} /></label></div>
      <div className="review-grid"><label htmlFor="ap-source">Código de la fuente<input id="ap-source" required placeholder="apify-jobspy" value={form.source} onChange={e => setForm({ ...form, source: e.target.value.toLowerCase() })} /></label>
        <label htmlFor="ap-max">Máximo de elementos por ejecución<input id="ap-max" type="number" min={10} max={5000} value={form.max_items} onChange={e => setForm({ ...form, max_items: Number(e.target.value) })} /></label></div>
      <div className="review-grid"><label htmlFor="ap-mem">Memoria (MB)<input id="ap-mem" type="number" min={256} max={4096} step={256} value={form.memory_mb} onChange={e => setForm({ ...form, memory_mb: Number(e.target.value) })} /></label>
        <label htmlFor="ap-time">Tiempo máximo (segundos)<input id="ap-time" type="number" min={60} max={3600} value={form.timeout_s} onChange={e => setForm({ ...form, timeout_s: Number(e.target.value) })} /></label></div>
      <label htmlFor="ap-tpl">Plantilla de entrada (opcional)<textarea id="ap-tpl" rows={6} placeholder='Vacío = se adapta al esquema del actor. Ejemplo: {"search_term": "{{query}}", "location": "{{location}}", "results_wanted": "{{max_items}}"}' value={form.input_template} onChange={e => setForm({ ...form, input_template: e.target.value })} /></label>
      <p className="card-meta" style={{ margin: 0 }}>Marcadores: {'{{query}}'}, {'{{location}}'}, {'{{country}}'}, {'{{max_items}}'}, {'{{hours_old}}'}, {'{{sites}}'}. {fields && <>Campos del actor: {fields.map(f => `${f.name} (${f.type}${f.required ? ', obligatorio' : ''})`).join(' · ')}.</>}</p>
      <label className="check-label" style={{ flexDirection: 'row', alignItems: 'center' }}><input type="checkbox" checked={form.schedule_daily} onChange={e => setForm({ ...form, schedule_daily: e.target.checked })} /> Lanzar cada día automáticamente (gasta crédito a diario, dentro del tope mensual)</label>
      <div className="admin-toolbar" style={{ margin: 0 }}>
        <button className="primary" disabled={working !== ''}>{working === 'save' ? <LoaderCircle size={15} className="spin" /> : null} Guardar</button>
        <button type="button" disabled={!form.actor || working !== ''} onClick={() => void run('schema', async () => { const r = await post({ action: 'schema', actor: form.actor }) as { fields: Array<{ name: string; type: string; required: boolean }> }; setFields(r.fields); return `El actor tiene ${r.fields.length} campos de entrada.`; })}>Ver campos del actor</button>
        <button type="button" onClick={() => setForm(null)}>Cancelar</button></div>
    </form>}
    <h2 className="section-title">Ejecuciones</h2>
    {!data?.runs.length ? <p className="muted">Aún no se ha lanzado ninguna.</p> : <div className="table-wrap"><table className="data-table">
      <thead><tr><th>Inicio</th><th>Actor</th><th>Estado</th><th className="num">Recogidos</th><th className="num">Coste (USD)</th><th>Detalle</th></tr></thead>
      <tbody>{data.runs.map(r => <tr key={r.id}><td>{fmt(r.started_at)}</td><td>{actorName(r.actor_id)}</td>
        <td><span className={r.status === 'SUCCEEDED' && r.finished_at ? 'status ok' : r.status === 'RUNNING' || r.status === 'SUCCEEDED' ? 'status' : 'status bad'}>{r.status === 'SUCCEEDED' && !r.finished_at ? 'Recogiendo' : RUN[r.status] ?? r.status}</span></td>
        <td className="num">{r.harvested}</td><td className="num">{r.cost_usd != null ? Number(r.cost_usd).toFixed(3) : '—'}</td><td>{r.error ?? (r.finished_at ? `Terminó ${fmt(r.finished_at)}` : '')}</td></tr>)}</tbody></table></div>}
  </section>;
}
