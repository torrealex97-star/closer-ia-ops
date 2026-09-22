'use client';

import IntegrationSettings from './IntegrationSettings';
import SourceAssistant from './SourceAssistant';
import { request } from './client';
import { useEffect, useState } from 'react';
import { ExternalLink, Layers3, Plus, Search, X } from 'lucide-react';
import type { components } from '../../../packages/contracts/api';

type Config = components['schemas']['Configuration'];
type Input = components['schemas']['ConnectionInput'];
type Connection = Omit<Input, 'token' | 'clear_token'> & { id: string; has_token: boolean; run_status?: string; run_id?: string; actual_cost_usd?: number };
const mapping = { title: 'title', company: 'companyName', description: 'description', source_url: 'url', locations: 'location', published_at: 'postedAt', work_mode: 'workMode' };
const fresh = (): Input => ({ name: '', build: 'latest', auto_mapping: false, clear_token: false, source: 'custom', actor_id: '', dataset_id: '', enabled: true, urls: [], url_field: 'startUrls', url_format: 'objects', actor_input: {}, mapping, max_items: 100, max_charge_usd: 1 });
const presets: Record<string, string> = { infojobs: 'haketa/infojobs-scraper', computrabajo: 'haketa/computrabajo-scraper', linkedin: 'curious_coder/linkedin-jobs-scraper', workana: 'automation-lab/workana-freelance-projects-scraper', getonbrd: 'scrapers_lat/getonbrd-scraper' };
// WDC operators connect sources using the existing paper/plum surfaces,
// native controls and 4px rhythm. The connection form is the focal point.
export default function Sources({ config, onRefresh }: { config: Config; onRefresh: () => Promise<void> }) {
  const [wizard, setWizard] = useState<string | null>(null);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [form, setForm] = useState<Input | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [urls, setUrls] = useState('');
  const [inputJSON, setInputJSON] = useState('{}');
  const [mappingJSON, setMappingJSON] = useState(JSON.stringify(mapping, null, 2));
  const [filter, setFilter] = useState('');
  const [category, setCategory] = useState('Todas');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const refresh = async () => { await Promise.all([request<Connection[]>('source-connections').then(setConnections), onRefresh()]); };
  const activeIds = connections.filter(c => c.run_id && ['READY', 'RUNNING', 'TIMING-OUT', 'ABORTING'].includes(c.run_status || '')).map(c => c.id).join(',');
  useEffect(() => {
    if (!activeIds) return;
    let pending = false; let stopped = false;
    const timer = setInterval(async () => {
      if (pending) return; pending = true;
      try { await Promise.all(activeIds.split(',').map(id => request(`source-connections/${id}/check`, {}))); if (!stopped) await refresh(); }
      catch (e) { if (!stopped) setError((e as Error).message); } finally { pending = false; }
    }, 5000);
    return () => { stopped = true; clearInterval(timer); };
  }, [activeIds]);
  useEffect(() => { request<Connection[]>('source-connections').then(setConnections).catch(e => setError(e.message)); }, []);
  const update = <K extends keyof Input>(key: K, value: Input[K]) => setForm(old => old && ({ ...old, [key]: value }));
  function open(source = 'custom', connection?: Connection, advanced = false) {
    if (!connection && !advanced) { setForm(null); setWizard(source); window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
    setWizard(null);
    const value: Input = connection ? { ...fresh(), ...connection, token: '', clear_token: false } : { ...fresh(), source, name: config.sources.find(s => s.code === source)?.name || 'Mi fuente', actor_id: presets[source] || '' };
    if (!connection && source === 'infojobs') { value.actor_input = { keywords: ['closer de ventas', 'closer digital', 'high ticket closer', 'appointment setter', 'setter', 'comercial digital', 'cerrador', 'venta de alto valor'], onlyTeleworking: true, maxItems: 100 }; value.mapping = { ...mapping, company: 'company', locations: 'city', published_at: 'publishedAt', work_mode: 'teleworking' }; }
    setForm(value); setEditing(connection?.id || null); setUrls((value.urls || []).join('\n'));
    setInputJSON(JSON.stringify(value.actor_input || {}, null, 2)); setMappingJSON(JSON.stringify(value.mapping || mapping, null, 2)); setError(''); setMessage('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  async function save() {
    if (!form) return;
    setBusy(true); setError('');
    try {
      const body = { ...form, urls: urls.split('\n').map(s => s.trim()).filter(Boolean), actor_input: JSON.parse(inputJSON), mapping: JSON.parse(mappingJSON) };
      if (!body.actor_input || Array.isArray(body.actor_input) || !body.mapping || Array.isArray(body.mapping)) throw new Error('Input y mapeo deben ser objetos JSON.');
      await request(editing ? `source-connections/${editing}` : 'source-connections', body, editing ? 'PATCH' : 'POST');
      setForm(null); await refresh(); setMessage('Conexión guardada. Comprueba el dataset o ejecuta el scraper para obtener resultados.');
    } catch (e) { setError(e instanceof SyntaxError ? 'El JSON no es válido. Revisa comas y comillas.' : (e as Error).message); }
    finally { setBusy(false); }
  }
  async function action(c: Connection, kind: 'check' | 'scrape' | 'resolve') {
    setBusy(true); setError(''); setMessage('');
    try {
      const result = await request<{ message?: string }>(`source-connections/${c.id}/${kind}`, kind === 'resolve' ? { reviewed_apify_console: true } : {});
      await refresh(); setMessage(result.message || (kind === 'resolve' ? 'Conexión desbloqueada tras tu revisión en Apify.' : 'Scraper iniciado en Apify. Pulsa «Comprobar» para actualizar su estado y recoger el dataset al terminar.'));
    } catch (e) { setError((e as Error).message); await refresh().catch(() => {}); }
    finally { setBusy(false); }
  }
  const catalog = config.sources.filter(s => s.category !== 'Mis conexiones').sort((a, b) => Number(a.category === 'Internacional') - Number(b.category === 'Internacional'));
  const shown = catalog.filter(s => (category === 'Todas' || s.category?.includes(category)) && `${s.name} ${s.note} ${s.category}`.toLowerCase().includes(filter.toLowerCase()));
  return <div className="sources-workspace">
    <div className="source-intro"><div><span className="eyebrow">ESPAÑOL · REMOTO · HÍBRIDO</span><h2>Abre nuevas puertas para tus alumnas.</h2><p>Prioriza España y LATAM. Las fuentes internacionales complementan la búsqueda de ofertas en español o bilingües.</p></div><button className="primary" onClick={() => open()}><Plus size={16} /> Añadir fuente</button></div>
    {error && <p className="alert error" role="alert">{error}</p>}{message && <p className="alert" role="status">{message}</p>}
    <IntegrationSettings onChanged={refresh} />
    {wizard && <SourceAssistant key={wizard} source={wizard} sources={config.sources} onClose={() => setWizard(null)} onConnected={refresh} onAdvanced={() => open(wizard, undefined, true)} />}
    {form && <form className="connection-form" onSubmit={e => { e.preventDefault(); save(); }}>
      <div className="panel-title"><h2>{editing ? 'Editar conexión' : 'Conectar con Apify'}</h2><button type="button" aria-label="Cerrar conexión" onClick={() => setForm(null)}><X size={16} /></button></div>
      <p>Guarda el token de Apify y un Actor o dataset. Cada Actor tiene su formato: revisa su pestaña Input y adapta el mapeo con una muestra de salida. Guardar no ejecuta una extracción.</p>
      <div className="connection-grid">
        <label>Nombre de la conexión<input required value={form.name} maxLength={100} onChange={e => update('name', e.target.value)} /></label>
        <label>Fuente<select value={form.source} onChange={e => update('source', e.target.value)}>{catalog.filter(s => !s.available).map(s => <option key={s.code} value={s.code}>{s.name}</option>)}</select></label>
        <label>Token API de Apify<input type="password" autoComplete="new-password" value={form.token || ''} placeholder={editing ? 'Vacío conserva el token guardado' : 'apify_api_…'} onChange={e => update('token', e.target.value)} /></label>
        <label>Actor ID<input value={form.actor_id} placeholder="usuario/nombre-del-actor" onChange={e => update('actor_id', e.target.value)} /></label>
        <label>Dataset ID existente (opcional)<input value={form.dataset_id} placeholder="ID del dataset de Apify" onChange={e => update('dataset_id', e.target.value)} /></label>
        <label>Máximo de registros a importar<input type="number" min={1} max={500} value={form.max_items} onChange={e => update('max_items', Number(e.target.value))} /></label>
        <label className="wide">Enlaces a scrapear · uno por línea<textarea rows={4} value={urls} placeholder="https://…/busqueda-de-closer" onChange={e => setUrls(e.target.value)} /><small>Búsquedas, grupos, páginas o empresas. Solo contenido al que tengas acceso. Los enlaces se envían al Actor configurado.</small></label>
        <label>Campo de enlaces del Actor<input value={form.url_field} placeholder="startUrls / urls / searchUrl" onChange={e => update('url_field', e.target.value)} /></label>
        <label>Formato que espera el Actor<select value={form.url_format} onChange={e => update('url_format', e.target.value)}><option value="objects">Lista de objetos con url</option><option value="strings">Lista de enlaces</option><option value="single">Un enlace</option></select></label>
        <label>Tope solicitado a Apify · USD<input type="number" min={0.1} max={10} step={0.1} value={form.max_charge_usd} onChange={e => update('max_charge_usd', Number(e.target.value))} /><small>Se envía maxTotalChargeUsd; comprueba qué cargos cubre según el Actor. Ejecución limitada a 90 s.</small></label>
        <div className="connection-checks"><label className="check-label"><input type="checkbox" checked={form.enabled} onChange={e => update('enabled', e.target.checked)} /> Conexión activa</label>{editing && <label className="check-label"><input type="checkbox" checked={!!form.clear_token} onChange={e => update('clear_token', e.target.checked)} /> Eliminar token guardado</label>}</div>
      </div>
      <details><summary>Instrucciones y campos del proveedor</summary><div className="connection-grid">
        <label>Input adicional del Actor · JSON<textarea rows={9} spellCheck={false} value={inputJSON} onChange={e => setInputJSON(e.target.value)} /><small>Aquí van keywords, país, límite del Actor y modalidad. Son criterios fijos de captación; los filtros de Oportunidades se aplican después al dataset.</small></label>
        <label>Mapeo de la salida · JSON<textarea rows={9} spellCheck={false} value={mappingJSON} onChange={e => setMappingJSON(e.target.value)} /><small>Izquierda: campo de la app. Derecha: campo del Actor (admite company.name). Para posts sin título, quita title y mapea description al texto. Fecha ISO/Unix; modalidad al campo remoto/híbrido.</small></label>
      </div></details>
      <div className="connection-footer"><small>Token solo en el servidor local, archivo con permisos del propietario; nunca se devuelve al navegador. No es una bóveda cifrada.</small><button className="primary" disabled={busy} type="submit">{busy ? 'Guardando…' : 'Guardar conexión'}</button></div>
    </form>}
    <section><div className="results-heading"><h2>Mis conexiones <span>{connections.length}</span></h2><a href="https://console.apify.com" target="_blank" rel="noopener noreferrer">Consola Apify <ExternalLink size={13} /></a></div>
      {!connections.length ? <p className="connection-empty">Aún no has conectado proveedores. Elige un portal del catálogo o añade los enlaces de una comunidad.</p> : <div className="source-grid">{connections.map(c => <article className="source-card" key={c.id}><div><Layers3 size={20} /><span className={c.enabled && c.dataset_id ? 'available' : 'pending'}>{!c.enabled ? 'Desactivada' : c.dataset_id ? 'Dataset configurado' : 'Sin dataset'}</span></div><h2>{c.name}</h2><p>{c.has_token ? 'Token guardado' : 'Sin token'} · {(c.urls || []).length} enlaces · {c.max_items} registros máx.</p>{c.run_status && <p>Extracción: {c.run_status}{typeof c.actual_cost_usd === 'number' ? ` · ${c.actual_cost_usd.toFixed(3)} USD reportados` : ''}</p>}{c.run_id && <a href={`https://console.apify.com/actors/runs/${c.run_id}`} target="_blank" rel="noopener noreferrer">Ver ejecución <ExternalLink size={12} /></a>}{['UNKNOWN', 'STARTING'].includes(c.run_status || '') && <button disabled={busy} onClick={() => action(c, 'resolve')}>Ya revisé Apify: desbloquear</button>}<div className="source-actions"><button disabled={busy} onClick={() => open(c.source, c)}>Editar</button><button disabled={busy} onClick={() => action(c, 'check')}>Comprobar</button></div><button disabled={busy || !c.actor_id || !c.has_token || !c.enabled || ['STARTING', 'READY', 'RUNNING', 'UNKNOWN', 'TIMING-OUT', 'ABORTING'].includes(c.run_status || '')} onClick={() => action(c, 'scrape')}>Ejecutar scraper · puede generar coste</button></article>)}</div>}
    </section>
    <section><div className="results-heading"><h2>Catálogo de fuentes <span>{catalog.length}</span></h2></div><p className="catalog-note">Las fuentes «Por conectar» necesitan un Actor compatible y comprobar su salida. Figurar aquí no garantiza acceso público, cobertura completa ni ofertas actuales.</p>
      <div className="source-filters"><label><span><Search size={14} /> Buscar fuente</span><input value={filter} onChange={e => setFilter(e.target.value)} placeholder="InfoJobs, comunidades, LATAM…" /></label><label>Prioridad<select value={category} onChange={e => setCategory(e.target.value)}>{['Todas', 'España', 'LATAM', 'Europa', 'Comunidades', 'Freelance', 'Empresas', 'Internacional'].map(c => <option key={c}>{c}</option>)}</select></label></div>
      <div className="source-grid">{shown.map(s => <article className="source-card" key={s.code}><div><span className="eyebrow">{s.category}</span><span className={s.available ? 'available' : 'pending'}>{s.available ? 'API pública activa' : 'Por conectar'}</span></div><h2>{s.name}</h2><p>{s.note}</p><div className="source-actions">{s.website && <a href={s.website} target="_blank" rel="noopener noreferrer">Visitar <ExternalLink size={12} /></a>}{!s.available && <><a href={s.setup_url} target="_blank" rel="noopener noreferrer">Ver proveedor <ExternalLink size={12} /></a><button onClick={() => open(s.code)}>Conectar</button></>}</div></article>)}</div>{!shown.length && <p>No hay fuentes con ese filtro. Puedes añadir una fuente personalizada.</p>}
    </section>
  </div>;
}
