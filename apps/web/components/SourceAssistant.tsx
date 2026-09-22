'use client';
import { useState } from 'react';
import { LoaderCircle, Sparkles, X } from 'lucide-react';
import type { components } from '../../../packages/contracts/api';
import { request } from './client';
type Source = components['schemas']['SourceInfo'];
type Plan = { id: string; actor_title: string; actor_url: string; pricing_model: string; connection: { name: string; max_items: number; max_charge_usd: number }; message: string; pricing?: { pricingPerEvent?: { actorChargeEvents?: Record<string, { eventTitle?: string; eventPriceUsd?: number; eventTieredPricingUsd?: Record<string, { tieredEventPriceUsd?: number }> }> } } };
export default function SourceAssistant({ source, sources, onClose, onConnected, onAdvanced }: { source: string; sources: Source[]; onClose: () => void; onConnected: () => Promise<void>; onAdvanced: () => void }) {
  const [selected, setSelected] = useState(source);
  const [urls, setUrls] = useState('');
  const [limit, setLimit] = useState(25);
  const [budget, setBudget] = useState(1);
  const [keywords, setKeywords] = useState('closer de ventas, closer digital, high ticket closer, appointment setter, setter, cold caller, llamadas en frío, comercial digital, cerrador, venta de alto valor');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [plan, setPlan] = useState<Plan | null>(null);
  function changed() { setPlan(null); setError(''); }
  async function prepare() {
    setBusy(true); setError(''); setPlan(null);
    try { setPlan(await request<Plan>('source-assistant/prepare', { source: selected, urls: urls.split('\n').map(u => u.trim()).filter(Boolean), keywords: keywords.split(',').map(k => k.trim()).filter(Boolean), max_items: limit, max_charge_usd: budget })); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function connect() {
    if (!plan) return;
    setBusy(true); setError('');
    try { await request('source-assistant/connect', { plan_id: plan.id }); await onConnected(); onClose(); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <section className="connection-form" aria-label="Asistente de fuente">
    <div className="panel-title"><h2><Sparkles size={18} /> Añadir una fuente, paso a paso</h2><button disabled={busy} aria-label="Cerrar asistente" onClick={onClose}><X size={16} /></button></div>
    <p>Elige dónde buscar y pega sus enlaces. Buscaremos un scraper compatible y configuraremos sus campos. Preparar y guardar no lanzan una extracción.</p>
    <fieldset disabled={busy} className="assistant-fields"><div className="connection-grid">
      <label>1. ¿Dónde quieres buscar?<select value={selected} onChange={e => { setSelected(e.target.value); changed(); }}>{sources.filter(s => !s.available && s.category !== 'Mis conexiones').map(s => <option key={s.code} value={s.code}>{s.name}</option>)}</select></label>
      <label>Ofertas por extracción<select value={limit} onChange={e => { setLimit(Number(e.target.value)); changed(); }}><option value={25}>25 · empezar con poco consumo</option><option value={50}>50 ofertas</option><option value={100}>100 ofertas</option></select></label>
      <label className="wide">2. Pega enlaces de búsqueda o páginas<textarea rows={3} value={urls} onChange={e => { setUrls(e.target.value); changed(); }} placeholder="https://www.infojobs.net/ofertas-trabajo/closer" /><small>Un enlace por línea. Si eliges InfoJobs puedes dejarlo vacío y buscar por los términos preparados. «Otra web» intenta reconocer la fuente a partir del enlace.</small></label>
      <label>Términos a buscar (separados por comas)<textarea rows={3} value={keywords} onChange={e => { setKeywords(e.target.value); changed(); }} /></label>
      <label>Límite de cargos solicitado · USD<input type="number" min={0.1} max={5} step={0.1} value={budget} onChange={e => { setBudget(Number(e.target.value)); changed(); }} /><small>El proveedor aplica este límite según su modalidad de cobro. Revisa su precio antes de ejecutar.</small></label>
    </div></fieldset>
    {error && <p role="alert" className="alert error">{error}</p>}
    {!plan && <button className="primary" disabled={busy} onClick={prepare}>{busy ? <LoaderCircle className="spin" size={16} /> : <Sparkles size={16} />}{busy ? 'Buscando y preparando…' : '3. Preparar mi fuente'}</button>}
    {plan && <div className="prepared-source"><span className="eyebrow">LISTA PARA GUARDAR</span><h3>{plan.connection.name}</h3><p>Hemos elegido <a href={plan.actor_url} target="_blank" rel="noopener noreferrer">{plan.actor_title} ↗</a> y preparado sus instrucciones para un máximo de {plan.connection.max_items} registros.</p><p>{plan.message}</p><p>Tope solicitado: <strong>{plan.connection.max_charge_usd} USD</strong>. Cobro: {plan.pricing_model === 'PAY_PER_EVENT' ? 'por eventos o resultados' : 'por resultado'}.</p>{Object.entries(plan.pricing?.pricingPerEvent?.actorChargeEvents || {}).map(([key, p]) => <small key={key}>{p.eventTitle || key}: {p.eventPriceUsd !== undefined ? `${p.eventPriceUsd} USD por evento` : p.eventTieredPricingUsd?.FREE?.tieredEventPriceUsd !== undefined ? `${p.eventTieredPricingUsd.FREE.tieredEventPriceUsd} USD por evento en plan Free` : 'precio según plan; consultar proveedor'}</small>)}<small>Estos precios de referencia no son una cotización total. Guardar no ejecuta el scraper; podrás iniciarlo desde Mis conexiones.</small><button className="primary" disabled={busy} onClick={connect}>{busy ? 'Guardando…' : 'Guardar fuente preparada'}</button></div>}
    <button className="text-button" disabled={busy} onClick={onAdvanced}>Necesito una configuración avanzada</button>
  </section>;
}
