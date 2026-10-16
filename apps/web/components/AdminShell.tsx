'use client';
import { useCallback, useEffect, useState } from 'react';
import { Activity, Check, KeyRound, LoaderCircle, LogOut, RefreshCcw, ShieldCheck, Trash2, UserPlus, Users } from 'lucide-react';
import CloudAdminPanel from './CloudAdminPanel';

// Cáscara del panel hospedado: acceso por email + contraseña (Supabase Auth, solo usuarios invitados),
// recuperación por correo y pestañas Revisión / Fuentes y conexiones / Usuarios.
type Me = { email: string; role: 'owner' | 'admin' };
type Tab = 'review' | 'sources' | 'users';

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/admin/${path}`, { headers: { 'Content-Type': 'application/json' }, ...init });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof (data as { detail?: string }).detail === 'string' ? (data as { detail: string }).detail : 'La operación falló.');
  return data as T;
}

function Login({ onLogin }: { onLogin: (me: Me) => void }) {
  const [mode, setMode] = useState<'login' | 'forgot'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError(''); setNotice('');
    try {
      if (mode === 'login') onLogin(await api<Me & { authenticated: true }>('session', { method: 'POST', body: JSON.stringify({ email, password }) }));
      else { const r = await api<{ message: string }>('auth/recover', { method: 'POST', body: JSON.stringify({ email }) }); setNotice(r.message); }
    } catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  }
  return <section className="empty" style={{ maxWidth: 420, margin: '8vh auto' }}>
    <form onSubmit={submit}>
      <h3>{mode === 'login' ? 'Panel de administración' : 'Recuperar contraseña'}</h3>
      <p className="muted">{mode === 'login' ? 'Acceso solo para usuarios invitados.' : 'Escribe tu email y te enviaremos un enlace para crear una contraseña nueva.'}</p>
      <label style={{ display: 'block', marginTop: 12 }}>Email
        <input type="email" value={email} onChange={e => setEmail(e.target.value)} autoFocus autoComplete="username" required style={{ width: '100%', marginTop: 4 }} /></label>
      {mode === 'login' && <label style={{ display: 'block', marginTop: 12 }}>Contraseña
        <input type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" required style={{ width: '100%', marginTop: 4 }} /></label>}
      {error && <div className="alert error" role="alert" style={{ marginTop: 8 }}>{error}</div>}
      {notice && <div className="alert" role="status" style={{ marginTop: 8 }}>{notice}</div>}
      <button className="primary" disabled={busy || !email || (mode === 'login' && !password)} style={{ marginTop: 12, width: '100%' }}>
        {busy ? <LoaderCircle size={15} className="spin" /> : mode === 'login' ? <ShieldCheck size={15} /> : <KeyRound size={15} />} {mode === 'login' ? 'Entrar' : 'Enviar enlace'}</button>
      <p style={{ marginTop: 12, textAlign: 'center' }}>
        <button type="button" className="link-button" onClick={() => { setMode(mode === 'login' ? 'forgot' : 'login'); setError(''); setNotice(''); }}>
          {mode === 'login' ? '¿Has olvidado tu contraseña?' : 'Volver a entrar'}</button></p>
    </form>
  </section>;
}

type Overview = {
  generated_at: string;
  engine: { catalog_active: number; raw_items: number; last_run: { day: string; status: string; completed_at: string | null } | null } | null;
  sources: Array<{ code: string; name: string; run_status: string | null; fetched: number | null; catalog: number; eligible: number; selected: number; warning: string | null }>;
  audit: { day: string; slugs: Array<{ source: string; slug: string; status: string; http_status: number | null; canonical_url: string | null }> } | null;
  connections: Array<{ id: string; name: string; status: 'ok' | 'error' | 'not_configured'; detail: string; ms?: number }>;
  paid: Array<{ id: string; name: string; status: string; detail: string }>;
};
const CONN: Record<string, string> = { ok: 'Conectado', error: 'Con fallo', not_configured: 'No configurado' };
const RUN: Record<string, string> = { completed: 'Completada', failed: 'Fallida', running: 'En curso', queued: 'En cola', skipped: 'Omitida' };

function SourcesTab({ onSessionLost }: { onSessionLost: () => void }) {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(true);
  const load = useCallback(() => {
    setBusy(true);
    api<Overview>('overview').then(d => { setData(d); setError(''); })
      .catch(err => { if ((err as Error).message.includes('Sesión')) onSessionLost(); setError((err as Error).message); })
      .finally(() => setBusy(false));
  }, [onSessionLost]);
  useEffect(load, [load]);
  return <section aria-label="Fuentes y conexiones">
    <div className="run-progress classification-summary">
      <strong>Fuentes y conexiones</strong>
      <span className="muted">Estado real leído ahora del motor y de los servicios conectados. Solo lectura: activar o pausar fuentes llegará en el siguiente corte.</span>
      <div className="source-actions"><button disabled={busy} onClick={load}><RefreshCcw size={15} /> Actualizar</button></div>
    </div>
    {error && <div className="alert error" role="alert">{error}</div>}
    {busy && !data && <p className="muted"><LoaderCircle size={14} className="spin" /> Comprobando…</p>}
    {data && <>
      <h3>Conexiones</h3>
      <div className="job-list">{[...data.connections, ...data.paid].map(c => <article className="job-row" key={c.id}><div className="job-info">
        <div className="job-company">{c.name}</div>
        <div className="job-signals"><span className={c.status === 'ok' ? 'source-tag ok' : c.status === 'error' ? 'review-tag' : 'source-tag'}>{CONN[c.status]}</span>
          <span className="muted">{c.detail}{'ms' in c && c.ms ? ` · ${c.ms} ms` : ''}</span></div></div></article>)}</div>
      <h3>Fuentes de datos {data.engine?.last_run && <span className="muted">· última recogida {data.engine.last_run.day} ({RUN[data.engine.last_run.status] ?? data.engine.last_run.status})</span>}</h3>
      {!data.sources.length ? <p className="muted">El motor no devolvió fuentes.</p> : <div className="job-list">{data.sources.map(s => <article className="job-row" key={s.code}><div className="job-info">
        <div className="job-company">{s.name} <span>· {s.code}</span></div>
        <div className="job-signals">
          <span className={s.run_status === 'completed' ? 'source-tag ok' : s.run_status === 'failed' ? 'review-tag' : 'source-tag'}>{s.run_status ? RUN[s.run_status] ?? s.run_status : 'Sin recogida'}</span>
          <span className="source-tag">leídas: {s.fetched ?? '—'}</span><span className="source-tag">catálogo: {s.catalog}</span>
          <span className="source-tag">elegibles: {s.eligible}</span><span className="source-tag">seleccionadas: {s.selected}</span>
        </div>
        {s.warning && <p className="muted" style={{ fontSize: 12 }}>{s.warning}</p>}</div></article>)}</div>}
      <h3>Auditoría de enlaces JobToday {data.audit && <span className="muted">· {data.audit.day}</span>}</h3>
      {!data.audit ? <p className="muted">Sin auditoría disponible hoy.</p> : <div className="job-list">{data.audit.slugs.map(a => <article className="job-row" key={a.source}><div className="job-info">
        <div className="job-company">{a.source} <span>· {a.slug}</span></div>
        <div className="job-signals"><span className={a.status === 'ok' ? 'source-tag ok' : 'review-tag'}>{a.status}</span>
          <span className="source-tag">HTTP {a.http_status ?? '—'}</span>{a.canonical_url && <span className="muted">→ {a.canonical_url}</span>}</div></div></article>)}</div>}
    </>}
  </section>;
}

type Row = { email: string; role: 'owner' | 'admin'; invited_by: string | null; created_at: string };
function UsersTab({ me, onSessionLost }: { me: Me; onSessionLost: () => void }) {
  const [users, setUsers] = useState<Row[]>([]);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'admin' | 'owner'>('admin');
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const load = useCallback(() => {
    setBusy(true);
    api<{ users: Row[] }>('users').then(d => { setUsers(d.users); setError(''); })
      .catch(err => { if ((err as Error).message.includes('Sesión')) onSessionLost(); setError((err as Error).message); })
      .finally(() => setBusy(false));
  }, [onSessionLost]);
  useEffect(load, [load]);
  async function invite(e: React.FormEvent) {
    e.preventDefault(); setError(''); setNotice('');
    try {
      const r = await api<{ email_sent: boolean }>('users', { method: 'POST', body: JSON.stringify({ email, role }) });
      setNotice(r.email_sent ? `Invitación enviada a ${email}.` : `${email} añadido, pero el correo no salió: pídele que use «¿Has olvidado tu contraseña?».`);
      setEmail(''); load();
    } catch (err) { setError((err as Error).message); }
  }
  async function remove(target: string) {
    if (!window.confirm(`¿Quitar el acceso a ${target}?`)) return;
    setError(''); setNotice('');
    try { await api(`users?email=${encodeURIComponent(target)}`, { method: 'DELETE' }); setNotice(`Acceso retirado a ${target}.`); load(); }
    catch (err) { setError((err as Error).message); }
  }
  const owner = me.role === 'owner';
  return <section aria-label="Usuarios del panel">
    <div className="run-progress classification-summary"><strong>Usuarios con acceso</strong>
      <span className="muted">Solo pueden entrar las personas de esta lista. Cada una crea su propia contraseña desde el correo de invitación.</span></div>
    {error && <div className="alert error" role="alert">{error}</div>}
    {notice && <div className="alert" role="status">{notice}</div>}
    {owner && <form onSubmit={invite} className="source-actions" style={{ margin: '12px 0' }}>
      <input type="email" required placeholder="email@ejemplo.com" value={email} onChange={e => setEmail(e.target.value)} aria-label="Email a invitar" />
      <select value={role} onChange={e => setRole(e.target.value as 'admin' | 'owner')} aria-label="Rol"><option value="admin">Administrador</option><option value="owner">Propietario</option></select>
      <button className="primary" disabled={!email}><UserPlus size={15} /> Invitar</button></form>}
    {busy ? <p className="muted"><LoaderCircle size={14} className="spin" /> Cargando…</p> : <div className="job-list">{users.map(u => <article className="job-row" key={u.email}><div className="job-info">
      <div className="job-company">{u.email} {u.email === me.email && <span>· tú</span>}</div>
      <div className="job-signals"><span className={u.role === 'owner' ? 'source-tag ok' : 'source-tag'}>{u.role === 'owner' ? 'Propietario' : 'Administrador'}</span>
        <span className="muted">desde {new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(u.created_at))}</span>
        {owner && u.email !== me.email && <button onClick={() => void remove(u.email)} aria-label={`Quitar acceso a ${u.email}`}><Trash2 size={14} /> Quitar</button>}</div></div></article>)}</div>}
  </section>;
}

export default function AdminShell() {
  const [state, setState] = useState<'checking' | 'out' | 'in' | 'unconfigured'>('checking');
  const [me, setMe] = useState<Me | null>(null);
  const [tab, setTab] = useState<Tab>('review');
  useEffect(() => {
    fetch('/api/admin/session').then(r => r.json()).then((s: { configured?: boolean; authenticated?: boolean; email?: string; role?: Me['role'] }) => {
      if (s.authenticated && s.email && s.role) { setMe({ email: s.email, role: s.role }); setState('in'); } else setState(s.configured ? 'out' : 'unconfigured');
    }).catch(() => setState('out'));
  }, []);
  const lost = useCallback(() => { setMe(null); setState('out'); }, []);
  function logout() { fetch('/api/admin/session', { method: 'DELETE' }).finally(lost); }

  if (state === 'checking') return <section className="empty"><LoaderCircle size={20} className="spin" /> Comprobando sesión…</section>;
  if (state === 'unconfigured') return <section className="empty"><ShieldCheck size={32} strokeWidth={1.3} /><h3>Acceso al panel sin configurar en este despliegue.</h3><p>Faltan las variables de Supabase (URL, clave pública y service role) en el servidor.</p></section>;
  if (state === 'out' || !me) return <Login onLogin={m => { setMe(m); setState('in'); }} />;
  const tabs: Array<[Tab, string, React.ReactNode]> = [['review', 'Revisión', <Check key="r" size={15} />], ['sources', 'Fuentes y conexiones', <Activity key="s" size={15} />], ['users', 'Usuarios', <Users key="u" size={15} />]];
  return <>
    <nav className="source-actions" aria-label="Secciones del panel" style={{ marginBottom: 12, justifyContent: 'space-between' }}>
      <span>{tabs.map(([id, label, icon]) => <button key={id} className={tab === id ? 'primary' : ''} aria-pressed={tab === id} onClick={() => setTab(id)}>{icon} {label}</button>)}</span>
      <span><span className="muted">{me.email} · {me.role === 'owner' ? 'Propietario' : 'Administrador'}</span> <button onClick={logout}><LogOut size={15} /> Salir</button></span>
    </nav>
    {tab === 'review' && <CloudAdminPanel onSessionLost={lost} />}
    {tab === 'sources' && <SourcesTab onSessionLost={lost} />}
    {tab === 'users' && <UsersTab me={me} onSessionLost={lost} />}
  </>;
}
