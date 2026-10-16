'use client';
import { useEffect, useState } from 'react';
import { KeyRound, LoaderCircle } from 'lucide-react';

// Destino del enlace del correo de Supabase: el token llega en el # de la URL (nunca en una
// petición al servidor hasta que se envía la contraseña nueva).
export default function AdminReset() {
  const [token, setToken] = useState<string | null>(null);
  const [problem, setProblem] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  useEffect(() => {
    const params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const at = params.get('access_token');
    if (at) setToken(at);
    else setProblem(params.get('error_description')?.includes('expired') || params.get('error_code') === 'otp_expired'
      ? 'El enlace ha caducado. Pide uno nuevo desde el acceso al panel.' : 'Este enlace no es válido. Pide uno nuevo desde el acceso al panel.');
    history.replaceState(null, '', window.location.pathname); // el token no se queda en la barra de direcciones
  }, []);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setError('');
    if (password !== confirm) { setError('Las contraseñas no coinciden.'); return; }
    setBusy(true);
    try {
      const r = await fetch('/api/admin/auth/reset', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ access_token: token, password }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.detail ?? 'No se pudo guardar la contraseña.');
      setDone(true);
    } catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  }
  return <div className="auth-wrap"><div className="auth-card">
    <a className="brand" href="/admin" aria-label="Closer IA OPs · panel"><span className="brand-mark">w.</span><span>Women Digital<br /><strong>Closer</strong></span></a>
    {done ? <><div><span className="eyebrow">LISTO</span><h1>Contraseña guardada</h1><p>Ya puedes entrar al panel con tu email y la contraseña nueva.</p></div><a className="primary" href="/admin">Ir al panel</a></>
      : problem ? <><div><span className="eyebrow">ENLACE NO VÁLIDO</span><h1>Pide un enlace nuevo</h1><p>{problem}</p></div><a className="primary" href="/admin">Volver al acceso</a></>
      : !token ? <p className="muted"><LoaderCircle className="spin" size={18} /> Comprobando enlace…</p>
      : <><div><span className="eyebrow">CREAR CONTRASEÑA</span><h1>Elige tu contraseña</h1><p>Mínimo 10 caracteres.</p></div>
        <form onSubmit={submit}>
          <label htmlFor="new-password">Contraseña nueva<input id="new-password" type="password" minLength={10} required value={password} onChange={e => setPassword(e.target.value)} autoFocus autoComplete="new-password" /></label>
          <label htmlFor="confirm-password">Repite la contraseña<input id="confirm-password" type="password" minLength={10} required value={confirm} onChange={e => setConfirm(e.target.value)} autoComplete="new-password" /></label>
          {error && <div className="alert error" role="alert"><span>{error}</span></div>}
          <button className="primary" disabled={busy || !password}>{busy ? <LoaderCircle size={16} className="spin" /> : <KeyRound size={16} />} Guardar contraseña</button>
        </form></>}
  </div></div>;
}
