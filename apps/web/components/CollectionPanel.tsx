'use client';

import { useEffect, useState } from 'react';
import { Clock3, RefreshCw } from 'lucide-react';
import { request } from './client';
import type { components } from '../../../packages/contracts/api';

type Status = components['schemas']['CollectionStatus'];
type Settings = components['schemas']['CollectionSettings'];
const states: Record<string, string> = { queued: 'En cola', running: 'Actualizando', completed: 'Actualizada', partial: 'Actualizada con avisos', failed: 'No disponible' };

export default function CollectionPanel({ editable = false }: { editable?: boolean }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [form, setForm] = useState<Settings | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let stopped = false;
    let pending = false;
    async function load() {
      if (pending) return;
      pending = true;
      try {
        const value = await request<Status>('collection');
        if (!stopped) { setStatus(value); setForm(old => old || value.settings); setError(''); }
      } catch (e) { if (!stopped) setError((e as Error).message); }
      finally { pending = false; }
    }
    void load();
    const timer = setInterval(load, 15000);
    return () => { stopped = true; clearInterval(timer); };
  }, []);
  async function action(save: boolean) {
    setBusy(true); setError('');
    try { setStatus(await request<Status>(save ? 'collection/settings' : 'collection/refresh', save ? form : {}, save ? 'PUT' : 'POST')); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  const active = status?.latest && ['queued', 'running'].includes(status.latest.status);
  return <section className="collection-panel" aria-label="Catálogo de los últimos 10 días">
    <div className="panel-title"><span><Clock3 size={17} /> Ofertas guardadas · últimos 10 días</span>{status && <strong>{status.catalog_total} en catálogo</strong>}</div>
    <p>Un catálogo con las ofertas de APIs públicas y fuentes conectadas que cumplen los requisitos. Buscar no lanza scrapers ni usa IA. Las ofertas se retiran 10 días después de incorporarse.</p>
    {error && <p className="alert error" role="alert">{error}</p>}
    {status && <>
      <div className="collection-stats"><span>{status.added_last_24h} incorporadas en 24 h</span><span>{status.settings.enabled ? `Recogida diaria a las ${String(status.settings.hour).padStart(2, '0')}:00 · Madrid` : 'Recogida automática pausada'}</span><span>{status.latest ? `${states[status.latest.status] || status.latest.status} · ${status.latest.day}` : 'Primera recogida pendiente'}</span></div>
      {editable && form && <>
        <form className="connection-grid" onSubmit={e => { e.preventDefault(); void action(true); }}>
          <label className="check-label"><input type="checkbox" checked={form.enabled} onChange={e => setForm({ ...form, enabled: e.target.checked })} />Recoger ofertas cada día</label>
          <label>Presupuesto diario de scraping<select value={form.daily_budget_eur} onChange={e => setForm({ ...form, daily_budget_eur: Number(e.target.value) })}><option value={1}>1 € al día</option><option value={2}>2 € al día</option></select></label>
          <label>Hora de recogida · Madrid<select value={form.hour} onChange={e => setForm({ ...form, hour: Number(e.target.value) })}>{Array.from({ length: 24 }, (_, hour) => <option key={hour} value={hour}>{String(hour).padStart(2, '0')}:00</option>)}</select></label>
          <button disabled={busy}>Guardar recogida diaria</button>
        </form>
        <p className="inline-hint">Reservado hoy: {status.reserved_eur.toFixed(2)} € de {status.settings.daily_budget_eur} €. Uso comunicado por Apify: {status.actual_usd.toFixed(4)} USD. Las reservas se mantienen todo el día aunque el consumo sea menor.</p>
        <p className="inline-hint">Tope para los eventos de scraping iniciados desde esta app, con margen del 30 % sobre el cambio del BCE. No incluye cuotas, almacenamiento, impuestos, IA ni ejecuciones externas. Los actores sin límite compatible se omiten.</p>
        <button disabled={busy || !!active} onClick={() => void action(false)}><RefreshCw size={15} />{active ? 'Actualizando catálogo…' : 'Recoger ofertas de hoy'}</button>
        <p className="inline-hint">Una recogida al día entre todas las fuentes conectadas. Repetir el botón no vuelve a cobrar. La app y el ordenador deben estar encendidos; al abrir después de la hora, recoge el día actual sin recuperar días anteriores.</p>
        <p className="inline-hint">Las APIs y feeds públicos se recogen sin Apify y continúan aunque se agote el presupuesto de scraping.</p>
        {status.latest && <details><summary>Estado de cada fuente</summary><div className="sources-progress">{status.latest.sources.map(source => <div className="source-progress" key={source.code}><strong>{source.name}</strong><small>{states[source.status] || source.status} · {source.accepted} con encaje</small>{source.warning && <p>{source.warning}</p>}</div>)}</div></details>}
      </>}
    </>}
  </section>;
}
