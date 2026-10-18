'use client';
import { useCallback, useEffect, useState } from 'react';
import { CircleCheck, CircleDashed, CircleX, CloudDownload, LoaderCircle, Pencil, Play, Plus, RefreshCcw, Trash2, TriangleAlert } from 'lucide-react';

// Apify: el scraping se ejecuta en la infraestructura de Apify (con sus proxies), no en la nuestra. De pago por uso:
// nada se lanza solo salvo los actores marcados como diarios, con tope mensual y límites por ejecución.
type Actor = { id: string; label: string; actor: string; source: string; input_template: Record<string, unknown> | null; max_items: number; memory_mb: number; timeout_s: number; schedule_daily: boolean };
type Run = { id: string; actor_id: string; run_id: string; status: string; started_at: string; finished_at: string | null; items_total: number | null; harvested: number; cost_usd: number | null; error: string | null };
type PortalView = { id: string; name: string; plain: string; caution?: string; daily: boolean; maxItems: number; state: 'off' | 'new' | 'running' | 'ok' | 'trying' | 'down'; headline: string; detail: string; recipes: Array<{ name: string; state: string; detail: string }> };
const RUN_CAP = 2, TEST_CAP = 0.5; // topes duros que la app pide a Apify (mismos valores que lib/apify.ts)
// Estado = texto + icono (nunca solo color).
const STATE_META = { ok: { cls: 'status ok', Icon: CircleCheck }, running: { cls: 'status', Icon: LoaderCircle }, trying: { cls: 'status', Icon: TriangleAlert }, down: { cls: 'status bad', Icon: CircleX }, new: { cls: 'status', Icon: CircleDashed }, off: { cls: 'status', Icon: CircleDashed } } as const;
type Data = { portals?: PortalView[]; actors: Actor[]; runs: Run[]; presets: Array<{ label: string; actor: string; source: string }>; budget: { spent: number | null; limit: number }; has_key: boolean };
type Form = { id?: string; label: string; actor: string; source: string; input_template: string; max_items: number; memory_mb: number; timeout_s: number; schedule_daily: boolean };
const blank: Form = { label: '', actor: '', source: '', input_template: '', max_items: 500, memory_mb: 1024, timeout_s: 900, schedule_daily: false };
const fmt = (v: string | null) => v ? new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(v)) : '—';
const RUN: Record<string, string> = { RUNNING: 'Buscando…', SUCCEEDED: 'Terminada', FAILED: 'Falló', 'TIMED-OUT': 'Tardó demasiado', ABORTED: 'Cancelada' };

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
  // Mientras haya una búsqueda en curso, se recogen y refrescan los resultados solos cada 30 s (y, si una falla, entra el repuesto).
  const anyRunning = Boolean(data?.portals?.some(p => p.state === 'running'));
  useEffect(() => { if (!anyRunning) return; const t = setInterval(() => { call<Record<string, unknown>>({ method: 'POST', body: JSON.stringify({ action: 'harvest' }) }).catch(() => undefined).finally(load); }, 30000); return () => clearInterval(t); }, [anyRunning, load]);

  async function run(kind: string, action: () => Promise<string>) {
    setWorking(kind); setError(''); setNotice('');
    try { setNotice(await action()); load(); } catch (err) { lost(err as Error); } finally { setWorking(''); }
  }
  const post = (body: Record<string, unknown>) => call<Record<string, unknown>>({ method: 'POST', body: JSON.stringify(body) });
  const edit = (a: Actor) => { setFields(null); setForm({ id: a.id, label: a.label, actor: a.actor, source: a.source, input_template: a.input_template ? JSON.stringify(a.input_template, null, 2) : '', max_items: a.max_items, memory_mb: a.memory_mb, timeout_s: a.timeout_s, schedule_daily: a.schedule_daily }); };
  const actorName = (id: string) => data?.actors.find(a => a.id === id)?.label ?? '—';
  const pct = data && data.budget.spent !== null ? Math.min(100, Math.round((data.budget.spent / data.budget.limit) * 100)) : 0;

  return <section aria-label="Apify">
    <div className="search-panel" style={{ marginBottom: 20, maxWidth: 820 }}>
      <h2 className="section-title" style={{ marginTop: 0 }}>Cómo funciona, en 3 líneas</h2>
      <ol style={{ margin: 0, paddingLeft: 20, display: 'grid', gap: 6 }}>
        <li>Esta pestaña busca <strong>ofertas de trabajo</strong> en portales como Indeed o InfoJobs, usando un servicio externo de pago por uso llamado <strong>Apify</strong>.</li>
        <li>Tú solo eliges <strong>en qué portales buscar</strong> y pulsas el botón. No necesitas saber cómo funciona por dentro.</li>
        <li>Si un buscador falla, la app <strong>prueba otro sola</strong> hasta que uno funcione. Lo que encuentra entra como borrador: <strong>nada se publica sin que lo apruebes</strong>.</li>
      </ol>
    </div>
    {error && <div className="alert error" role="alert"><span>{error}</span></div>}
    {notice && <div className="auth-note" role="status" style={{ marginBottom: 16 }}>{notice}</div>}
    {data && !data.has_key && <div className="search-panel" style={{ marginBottom: 20, borderColor: 'var(--warning)' }} role="alert">
      <h3 style={{ marginTop: 0 }}>Antes de empezar: falta conectar tu cuenta de Apify</h3>
      <ol style={{ margin: '0 0 12px', paddingLeft: 20, display: 'grid', gap: 4 }}>
        <li>Crea una cuenta gratis en <a href="https://console.apify.com" target="_blank" rel="noopener noreferrer">console.apify.com</a>.</li>
        <li>Dentro, ve a <strong>Settings → API &amp; Integrations</strong> y copia tu «Personal API token».</li>
        <li>Pégalo en la pestaña <strong>APIs</strong> de este panel (se guarda cifrado).</li>
      </ol>
      <button onClick={goApis}>Ir a pegar la clave</button></div>}
    {data && <article className="source-card" style={{ marginBottom: 20 }}>
      <div className="card-head"><div><span className="eyebrow">GASTO DEL MES EN APIFY</span><h3 style={{ marginTop: 4 }}>{data.budget.spent === null ? '—' : data.budget.spent.toFixed(2)} USD de {data.budget.limit} USD</h3>{data.budget.spent === null && <p className="card-meta" role="alert">No se pudo leer el gasto del mes: no se lanzará ninguna ejecución hasta poder comprobarlo.</p>}</div><span className={data.budget.spent === null ? 'status' : pct >= 90 ? 'status bad' : 'status'}>{data.budget.spent === null ? '—' : `${pct} %`}</span></div>
      <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Gasto del mes" style={{ height: 8, borderRadius: 99, background: 'var(--inset)', marginTop: 14, overflow: 'hidden' }}><div style={{ width: `${pct}%`, height: '100%', background: pct >= 90 ? 'var(--warning)' : 'var(--accent)' }} /></div>
      <p className="card-meta">Se suma el coste real de cada ejecución terminada y se reserva 1 USD por cada una en curso. Al llegar al tope no se lanza ninguna más. Es un límite de esta app: ponlo también en Apify (Settings → Billing → límite de gasto).</p>
    </article>}
    {data?.portals && <>
      <div className="admin-toolbar" style={{ justifyContent: 'space-between' }}><h2 className="section-title" style={{ margin: 0 }}>Portales de empleo</h2>
        <button disabled={working !== '' || busy} onClick={() => void run('refresh', async () => { await post({ action: 'harvest' }); return 'Resultados actualizados.'; })}>{working === 'refresh' ? <LoaderCircle size={15} className="spin" /> : <RefreshCcw size={15} />} Actualizar resultados</button></div>
      <p className="card-meta" style={{ marginTop: 0 }}>Cada tarjeta es un portal. «Probar con 10 ofertas» es lo más seguro para empezar: cuesta céntimos y comprueba que todo funciona.</p>
      <div className="card-grid" style={{ marginBottom: 28 }}>{data.portals.map(p => {
        const meta = STATE_META[p.state];
        return <article className="source-card" key={p.id} data-testid={`portal-${p.id}`}>
          <div className="card-head"><h3>{p.name}</h3><span className={meta.cls}><meta.Icon size={13} aria-hidden="true" className={p.state === 'running' ? 'spin' : undefined} /> {p.headline}</span></div>
          <p className="card-meta">{p.plain}</p>
          {p.caution && <p className="inline-hint">{p.caution}</p>}
          <p style={{ margin: '8px 0' }}>{p.detail}</p>
          {owner ? <div className="admin-toolbar" style={{ margin: '8px 0' }}>
            <button disabled={working !== '' || !data.has_key} onClick={() => { if (window.confirm(`Prueba pequeña en ${p.name}: máximo 10 ofertas y un tope de ${TEST_CAP} USD. ¿Lanzarla?`)) void run(`test-${p.id}`, async () => (await post({ action: 'search_now', portal: p.id, test: true }) as { message: string }).message); }}>{working === `test-${p.id}` ? <LoaderCircle size={14} className="spin" /> : <Play size={14} />} Probar con 10 ofertas</button>
            <button className="primary" disabled={working !== '' || !data.has_key} onClick={() => { if (window.confirm(`Buscar ofertas en ${p.name}. Gasta crédito de Apify: tope de ${RUN_CAP} USD por búsqueda (hasta ${p.maxItems} ofertas) y${data.budget.spent === null ? ' no se pudo leer lo gastado este mes' : ` este mes llevas ${data.budget.spent.toFixed(2)} de ${data.budget.limit} USD`}. ¿Seguir?`)) void run(`go-${p.id}`, async () => (await post({ action: 'search_now', portal: p.id }) as { message: string }).message); }}>{working === `go-${p.id}` ? <LoaderCircle size={14} className="spin" /> : <CloudDownload size={14} />} Buscar ahora</button>
            <label className="check-label" style={{ flexDirection: 'row', alignItems: 'center' }}><input type="checkbox" checked={p.daily} disabled={working !== ''} onChange={e => { const on = e.target.checked; /* se lee ya: React restaura el valor controlado antes de que termine la petición */ void run(`daily-${p.id}`, async () => { await post({ action: 'portal_daily', portal: p.id, on }); return on ? `Búsqueda diaria activada en ${p.name}.` : `Búsqueda diaria desactivada en ${p.name}.`; }); }} /> Buscar cada día</label></div>
            : <p className="card-meta">Solo el propietario puede lanzar búsquedas. Búsqueda diaria: <strong>{p.daily ? 'activada' : 'desactivada'}</strong>.</p>}
          <details><summary>Buscadores de repuesto ({p.recipes.length})</summary>
            <ul style={{ margin: '8px 0 0', paddingLeft: 18, display: 'grid', gap: 4 }}>{p.recipes.map(r => <li key={r.name}><strong>{r.name}</strong>: {r.detail}</li>)}</ul>
            <p className="card-meta">Se usan por orden. Si uno falla o no encuentra ofertas, se pasa al siguiente automáticamente.</p></details>
        </article>; })}</div></>}
    <details className="search-panel" style={{ marginBottom: 24 }} data-testid="apify-advanced"><summary><strong>Opciones avanzadas</strong>&nbsp;<span className="card-meta" style={{ margin: 0 }}>(solo si sabes lo que haces: añadir un buscador a mano)</span></summary>
    <div style={{ marginTop: 16 }}>
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
    </div></details>
    <h2 className="section-title">Últimas búsquedas</h2>
    {!data?.runs.length ? <p className="muted">Aún no se ha lanzado ninguna.</p> : <div className="table-wrap"><table className="data-table">
      <thead><tr><th>Inicio</th><th>Actor</th><th>Estado</th><th className="num">Recogidos</th><th className="num">Coste (USD)</th><th>Detalle</th></tr></thead>
      <tbody>{data.runs.map(r => <tr key={r.id}><td>{fmt(r.started_at)}</td><td>{actorName(r.actor_id)}</td>
        <td><span className={r.status === 'SUCCEEDED' && r.finished_at ? 'status ok' : r.status === 'RUNNING' || r.status === 'SUCCEEDED' ? 'status' : 'status bad'}>{r.status === 'SUCCEEDED' && !r.finished_at ? 'Recogiendo' : RUN[r.status] ?? r.status}</span></td>
        <td className="num">{r.harvested}</td><td className="num">{r.cost_usd != null ? Number(r.cost_usd).toFixed(3) : '—'}</td><td>{r.error ?? (r.finished_at ? `Terminó ${fmt(r.finished_at)}` : '')}</td></tr>)}</tbody></table></div>}
  </section>;
}
