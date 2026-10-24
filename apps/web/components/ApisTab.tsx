'use client';
import { useCallback, useEffect, useState } from 'react';
import { KeyRound, LoaderCircle, PlugZap, Trash2 } from 'lucide-react';

type Connection = { provider: string; name: string; configured: boolean; last4: string | null; updated_by: string | null; updated_at: string | null; last_test_at: string | null; last_test_ok: boolean | null; last_test_detail: string | null };
const fmt = (v: string | null) => v ? new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(v)) : '—';
const PURPOSE: Record<string, string> = { apify: 'Extracción de portales con actores de Apify.', serpapi: 'Búsqueda de ofertas indexadas en Google (incluye InfoJobs y LinkedIn). El cron la usa 7 veces al día para closer en España y LatAm y hasta 4 más para cubrir los portales sin API oficial propia (~0,275 USD/día).', groq: 'Clasificación y resúmenes con IA (proveedor por defecto).', openai: 'Análisis individual de ofertas con IA.',
  infojobs: 'API oficial de InfoJobs (cuenta de desarrollador gratuita, con aprobación). Formato: client_id:client_secret.', adzuna: 'API de Adzuna (clave gratuita). Formato: app_id:app_key.', jooble: 'API de Jooble (clave gratuita en es.jooble.org/api/about: cada país tiene su propia clave; la de jooble.org solo trae ofertas de EE. UU.).' };

async function api<T>(init?: RequestInit, query = ''): Promise<T> {
  const response = await fetch(`/api/admin/connections${query}`, { headers: { 'Content-Type': 'application/json' }, ...init });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof (data as { detail?: string }).detail === 'string' ? (data as { detail: string }).detail : 'La operación falló.');
  return data as T;
}

export default function ApisTab({ owner, onSessionLost }: { owner: boolean; onSessionLost: () => void }) {
  const [items, setItems] = useState<Connection[]>([]);
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>('load');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const load = useCallback(() => {
    api<{ connections: Connection[] }>().then(d => { setItems(d.connections); setError(''); })
      .catch(err => { if ((err as Error).message.includes('Sesión')) onSessionLost(); setError((err as Error).message); })
      .finally(() => setBusy(null));
  }, [onSessionLost]);
  useEffect(load, [load]);
  async function run(provider: string, action: () => Promise<string>) {
    setBusy(provider); setError(''); setNotice('');
    try { setNotice(await action()); load(); } catch (err) { setError((err as Error).message); setBusy(null); }
  }
  return <section aria-label="APIs y conexiones">
    <p className="card-meta" style={{ marginTop: 0, marginBottom: 20, maxWidth: 720 }}>Las claves se guardan cifradas en el servidor y no vuelven al navegador: solo ves los últimos 4 caracteres. «Probar» usa llamadas gratuitas del proveedor, así que no gasta crédito. Guardar una clave no activa ningún gasto; el motor cloud solo usará un proveedor de pago cuando lo ordenes.</p>
    {error && <div className="alert error" role="alert"><span>{error}</span></div>}
    {notice && <div className="auth-note" role="status" style={{ marginBottom: 20 }}>{notice}</div>}
    {busy === 'load' ? <p className="muted"><LoaderCircle size={14} className="spin" /> Cargando…</p> : <div className="card-grid">{items.map(c => {
      const state = !c.configured ? ['Sin clave', 'status'] : c.last_test_ok == null ? ['Guardada · sin probar', 'status'] : c.last_test_ok ? ['Válida', 'status ok'] : ['Rechazada', 'status bad'];
      return <article className="source-card" key={c.provider}>
        <div className="card-head"><div><h3>{c.name}</h3><p className="card-meta" style={{ marginTop: 4 }}>{PURPOSE[c.provider]}</p></div><span className={state[1]}>{state[0]}</span></div>
        {c.configured && <p className="card-meta">Clave …{c.last4}{c.last_test_at ? ` · ${c.last_test_detail} (${fmt(c.last_test_at)})` : ''}{c.updated_by ? ` · cambiada por ${c.updated_by}, ${fmt(c.updated_at)}` : ''}</p>}
        <form className="card-form" onSubmit={e => { e.preventDefault(); void run(c.provider, async () => { await api({ method: 'PUT', body: JSON.stringify({ provider: c.provider, secret: secrets[c.provider] }) }); setSecrets(s => ({ ...s, [c.provider]: '' })); return `Clave de ${c.name} guardada.`; }); }}>
          {owner && <input id={`key-${c.provider}`} type="password" autoComplete="off" placeholder={c.configured ? 'Pegar una clave nueva para sustituirla' : 'Pegar la clave de API'} value={secrets[c.provider] ?? ''} onChange={e => setSecrets(s => ({ ...s, [c.provider]: e.target.value }))} aria-label={`Clave de ${c.name}`} />}
          {owner && <button className="primary" disabled={busy !== null || !(secrets[c.provider] ?? '').trim()}><KeyRound size={14} /> Guardar</button>}
          <button type="button" disabled={busy !== null || !c.configured} onClick={() => void run(c.provider, async () => { const r = await api<{ ok: boolean; detail: string }>({ method: 'POST', body: JSON.stringify({ provider: c.provider }) }); return `${c.name}: ${r.detail}.`; })}>
            {busy === c.provider ? <LoaderCircle size={14} className="spin" /> : <PlugZap size={14} />} Probar</button>
          {owner && c.configured && <button type="button" disabled={busy !== null} onClick={() => { if (window.confirm(`¿Borrar la clave de ${c.name}?`)) void run(c.provider, async () => { await api({ method: 'DELETE' }, `?provider=${c.provider}`); return `Clave de ${c.name} borrada.`; }); }}><Trash2 size={14} /> Borrar</button>}
        </form></article>; })}</div>}
    {!owner && <p className="muted" style={{ marginTop: 20 }}>Solo el propietario puede guardar o borrar claves.</p>}
  </section>;
}
