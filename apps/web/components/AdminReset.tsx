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
  return <section className="empty" style={{ maxWidth: 420, margin: '8vh auto' }}>
    {done ? <><h3>Contraseña guardada</h3><p className="muted">Ya puedes entrar al panel con tu email y la contraseña nueva.</p><a className="primary" href="/admin">Ir al panel</a></>
      : problem ? <><h3>Enlace no válido</h3><p className="alert error" role="alert">{problem}</p><a href="/admin">Volver al acceso</a></>
      : !token ? <><LoaderCircle className="spin" size={20} /> Comprobando enlace…</>
      : <form onSubmit={submit}>
        <h3>Crea tu contraseña</h3><p className="muted">Mínimo 10 caracteres.</p>
        <label style={{ display: 'block', marginTop: 12 }}>Contraseña nueva<input type="password" minLength={10} required value={password} onChange={e => setPassword(e.target.value)} autoFocus autoComplete="new-password" style={{ width: '100%', marginTop: 4 }} /></label>
        <label style={{ display: 'block', marginTop: 12 }}>Repite la contraseña<input type="password" minLength={10} required value={confirm} onChange={e => setConfirm(e.target.value)} autoComplete="new-password" style={{ width: '100%', marginTop: 4 }} /></label>
        {error && <div className="alert error" role="alert" style={{ marginTop: 8 }}>{error}</div>}
        <button className="primary" disabled={busy || !password} style={{ marginTop: 12, width: '100%' }}>{busy ? <LoaderCircle size={15} className="spin" /> : <KeyRound size={15} />} Guardar contraseña</button>
      </form>}
  </section>;
}
