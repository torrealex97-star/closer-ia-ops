'use client';
import { useCallback, useEffect, useState } from 'react';
import { KeyRound, LoaderCircle, PlugZap, Trash2 } from 'lucide-react';

type Connection = { provider: string; name: string; configured: boolean; last4: string | null; updated_by: string | null; updated_at: string | null; last_test_at: string | null; last_test_ok: boolean | null; last_test_detail: string | null };
const fmt = (v: string | null) => v ? new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(v)) : '—';

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
    <div className="run-progress classification-summary"><strong>APIs y conexiones</strong>
      <span className="muted">Las claves se guardan cifradas en el servidor y nunca vuelven al navegador (solo ves los últimos 4 caracteres). «Probar» usa endpoints gratuitos del proveedor: no gasta crédito. Guardar una clave no activa ningún gasto: el motor cloud público no usa proveedores de pago hasta que lo ordenes.</span></div>
    {error && <div className="alert error" role="alert">{error}</div>}
    {notice && <div className="alert" role="status">{notice}</div>}
    {busy === 'load' ? <p className="muted"><LoaderCircle size={14} className="spin" /> Cargando…</p> : <div className="job-list">{items.map(c => <article className="job-row" key={c.provider}><div className="job-info">
      <div className="job-company">{c.name} {c.configured && <span>· clave …{c.last4}</span>}</div>
      <div className="job-signals">
        <span className={c.configured ? (c.last_test_ok === false ? 'review-tag' : 'source-tag ok') : 'source-tag'}>{c.configured ? (c.last_test_ok == null ? 'Guardada · sin probar' : c.last_test_ok ? 'Válida' : 'Rechazada') : 'Sin clave'}</span>
        {c.last_test_at && <span className="muted">{c.last_test_detail} · {fmt(c.last_test_at)}</span>}
        {c.updated_by && <span className="muted">cambiada por {c.updated_by} · {fmt(c.updated_at)}</span>}
      </div>
      <form className="source-actions" style={{ marginTop: 8 }} onSubmit={e => { e.preventDefault(); void run(c.provider, async () => { await api({ method: 'PUT', body: JSON.stringify({ provider: c.provider, secret: secrets[c.provider] }) }); setSecrets(s => ({ ...s, [c.provider]: '' })); return `Clave de ${c.name} guardada.`; }); }}>
        {owner && <input type="password" autoComplete="off" placeholder={c.configured ? 'Pegar una clave nueva para sustituirla' : 'Pegar la clave de API'} value={secrets[c.provider] ?? ''} onChange={e => setSecrets(s => ({ ...s, [c.provider]: e.target.value }))} aria-label={`Clave de ${c.name}`} style={{ minWidth: 260 }} />}
        {owner && <button className="primary" disabled={busy !== null || !(secrets[c.provider] ?? '').trim()}><KeyRound size={14} /> Guardar</button>}
        <button type="button" disabled={busy !== null || !c.configured} onClick={() => void run(c.provider, async () => { const r = await api<{ ok: boolean; detail: string }>({ method: 'POST', body: JSON.stringify({ provider: c.provider }) }); return `${c.name}: ${r.detail}.`; })}>
          {busy === c.provider ? <LoaderCircle size={14} className="spin" /> : <PlugZap size={14} />} Probar</button>
        {owner && c.configured && <button type="button" disabled={busy !== null} onClick={() => { if (window.confirm(`¿Borrar la clave de ${c.name}?`)) void run(c.provider, async () => { await api({ method: 'DELETE' }, `?provider=${c.provider}`); return `Clave de ${c.name} borrada.`; }); }}><Trash2 size={14} /> Borrar</button>}
      </form></div></article>)}</div>}
    {!owner && <p className="muted">Solo el propietario puede guardar o borrar claves.</p>}
  </section>;
}
