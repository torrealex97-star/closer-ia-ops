'use client';
import { useCallback, useEffect, useState } from 'react';
import { Activity, BriefcaseBusiness, ChevronRight, FileCheck2, KeyRound, LoaderCircle, LogOut, Plug, RefreshCcw, Search, ShieldCheck, Trash2, UserPlus, Users } from 'lucide-react';
import CloudAdminPanel from './CloudAdminPanel';
import ApisTab from './ApisTab';
import CatalogTab from './CatalogTab';

// Panel hospedado: mismo marco que el panel local (barra lateral, cabecera, título en serif), con acceso por
// email + contraseña de Supabase Auth (solo usuarios invitados) y las secciones de gestión de la app.
export type Me = { email: string; role: 'owner' | 'admin' };
type Tab = 'review' | 'catalog' | 'sources' | 'apis' | 'users';

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/admin/${path}`, { headers: { 'Content-Type': 'application/json' }, ...init });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof (data as { detail?: string }).detail === 'string' ? (data as { detail: string }).detail : 'La operación falló.');
  return data as T;
}

const Brand = () => <a className="brand" href="/admin" aria-label="Closer IA OPs · panel"><span className="brand-mark">w.</span><span>Women Digital<br /><strong>Closer</strong></span></a>;

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
      if (mode === 'login') onLogin(await api<Me>('session', { method: 'POST', body: JSON.stringify({ email, password }) }));
      else setNotice((await api<{ message: string }>('auth/recover', { method: 'POST', body: JSON.stringify({ email }) })).message);
    } catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  }
  return <div className="auth-wrap"><div className="auth-card">
    <Brand />
    <div><span className="eyebrow">{mode === 'login' ? 'ACCESO DEL EQUIPO' : 'RECUPERAR ACCESO'}</span>
      <h1>{mode === 'login' ? 'Panel de administración' : 'Crea una contraseña nueva'}</h1>
      <p>{mode === 'login' ? 'Solo pueden entrar las personas invitadas por el propietario.' : 'Escribe tu email y te enviamos un enlace para elegir una contraseña nueva.'}</p></div>
    <form onSubmit={submit}>
      <label htmlFor="admin-email">Email<input id="admin-email" type="email" value={email} onChange={e => setEmail(e.target.value)} autoFocus autoComplete="username" required /></label>
      {mode === 'login' && <label htmlFor="admin-password">Contraseña<input id="admin-password" type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" required /></label>}
      {error && <div className="alert error" role="alert"><span>{error}</span></div>}
      {notice && <div className="auth-note" role="status">{notice}</div>}
      <button className="primary" disabled={busy || !email || (mode === 'login' && !password)}>
        {busy ? <LoaderCircle size={16} className="spin" /> : mode === 'login' ? <ShieldCheck size={16} /> : <KeyRound size={16} />}{mode === 'login' ? 'Entrar' : 'Enviar enlace'}</button>
    </form>
    <button type="button" className="link-button" onClick={() => { setMode(mode === 'login' ? 'forgot' : 'login'); setError(''); setNotice(''); }}>
      {mode === 'login' ? '¿Has olvidado tu contraseña?' : 'Volver a entrar'}</button>
  </div></div>;
}

type Overview = {
  engine: { catalog_active: number; raw_items: number; last_run: { day: string; status: string; completed_at: string | null } | null } | null;
  sources: Array<{ code: string; name: string; run_status: string | null; fetched: number | null; catalog: number; eligible: number; selected: number; warning: string | null }>;
  audit: { day: string; slugs: Array<{ source: string; slug: string; status: string; http_status: number | null; canonical_url: string | null }> } | null;
  connections: Array<{ id: string; name: string; status: 'ok' | 'error' | 'not_configured'; detail: string; ms?: number }>;
  paid: Array<{ id: string; name: string; status: 'ok' | 'error' | 'not_configured'; detail: string; ms?: number }>;
};
const CONN: Record<string, string> = { ok: 'Conectado', error: 'Con fallo', not_configured: 'Sin configurar' };
const RUN: Record<string, string> = { completed: 'Completada', failed: 'Fallida', running: 'En curso', queued: 'En cola', skipped: 'Omitida' };
const statusClass = (s: string | null) => s === 'ok' || s === 'completed' ? 'status ok' : s === 'error' || s === 'failed' ? 'status bad' : 'status';

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
    {error && <div className="alert error" role="alert"><span>{error}</span></div>}
    <div className="admin-toolbar" style={{ justifyContent: 'space-between' }}>
      {data?.engine ? <div className="stat-strip" style={{ margin: 0 }}><span><strong>{data.engine.catalog_active}</strong>ofertas activas</span><span><strong>{data.engine.raw_items}</strong>registros recogidos</span>
        {data.engine.last_run && <span>Última recogida <strong>{data.engine.last_run.day}</strong>{RUN[data.engine.last_run.status] ?? data.engine.last_run.status}</span>}</div> : <span />}
      <button disabled={busy} onClick={load}>{busy ? <LoaderCircle size={15} className="spin" /> : <RefreshCcw size={15} />} Actualizar</button>
    </div>
    {busy && !data ? <p className="muted"><LoaderCircle size={14} className="spin" /> Comprobando…</p> : data && <>
      <h2 className="section-title">Conexiones</h2>
      <div className="card-grid">{[...data.connections, ...data.paid].map(c => <article className="source-card" key={c.id}>
        <div className="card-head"><h3>{c.name}</h3><span className={statusClass(c.status)}>{CONN[c.status]}</span></div>
        <p className="card-meta">{c.detail}{c.ms ? ` · ${c.ms} ms` : ''}</p></article>)}</div>
      <h2 className="section-title">Fuentes de datos</h2>
      {!data.sources.length ? <div className="empty"><h3>El motor no devolvió fuentes.</h3></div> : <div className="table-wrap"><table className="data-table">
        <thead><tr><th>Fuente</th><th>Última recogida</th><th className="num">Leídas</th><th className="num">Catálogo</th><th className="num">Elegibles</th><th className="num">Seleccionadas</th></tr></thead>
        <tbody>{data.sources.map(s => <tr key={s.code}>
          <td className="primary-cell"><strong>{s.name}</strong><span>{s.code}</span>{s.warning && <span style={{ color: 'var(--warning)' }}>{s.warning}</span>}</td>
          <td><span className={statusClass(s.run_status)}>{s.run_status ? RUN[s.run_status] ?? s.run_status : 'Sin recogida'}</span></td>
          <td className="num">{s.fetched ?? '—'}</td><td className="num">{s.catalog}</td><td className="num">{s.eligible}</td><td className="num">{s.selected}</td></tr>)}</tbody></table></div>}
      <h2 className="section-title">Auditoría de enlaces JobToday{data.audit ? ` · ${data.audit.day}` : ''}</h2>
      {!data.audit ? <p className="muted">Sin auditoría disponible hoy.</p> : <div className="table-wrap"><table className="data-table">
        <thead><tr><th>Fuente</th><th>Enlace</th><th>Estado</th><th className="num">HTTP</th></tr></thead>
        <tbody>{data.audit.slugs.map(a => <tr key={a.source}><td className="primary-cell"><strong>{a.source}</strong></td><td>{a.slug}{a.canonical_url && <span className="sub">→ {a.canonical_url}</span>}</td>
          <td><span className={a.status === 'ok' ? 'status ok' : 'status bad'}>{a.status}</span></td><td className="num">{a.http_status ?? '—'}</td></tr>)}</tbody></table></div>}
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
  const owner = me.role === 'owner';
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
  return <section aria-label="Usuarios del panel">
    {error && <div className="alert error" role="alert"><span>{error}</span></div>}
    {notice && <div className="auth-note" role="status" style={{ marginBottom: 20 }}>{notice}</div>}
    {owner ? <form className="search-panel admin-toolbar" onSubmit={invite} style={{ marginBottom: 28 }}>
      <label className="grow" htmlFor="invite-email">Invitar a una persona<input id="invite-email" type="email" required placeholder="nombre@empresa.com" value={email} onChange={e => setEmail(e.target.value)} /></label>
      <label htmlFor="invite-role">Rol<select id="invite-role" value={role} onChange={e => setRole(e.target.value as 'admin' | 'owner')}><option value="admin">Administrador</option><option value="owner">Propietario</option></select></label>
      <button className="primary" disabled={!email}><UserPlus size={16} /> Enviar invitación</button></form>
      : <p className="muted" style={{ marginBottom: 20 }}>Solo el propietario puede invitar o quitar personas.</p>}
    {busy ? <p className="muted"><LoaderCircle size={14} className="spin" /> Cargando…</p> : <div className="table-wrap"><table className="data-table">
      <thead><tr><th>Persona</th><th>Rol</th><th>Alta</th><th /></tr></thead>
      <tbody>{users.map(u => <tr key={u.email}>
        <td className="primary-cell"><strong>{u.email}{u.email === me.email && <span className="source-tag" style={{ marginLeft: 8 }}>tú</span>}</strong>{u.invited_by && u.invited_by !== 'bootstrap' && <span>invitado por {u.invited_by}</span>}</td>
        <td><span className={u.role === 'owner' ? 'status ok' : 'status'}>{u.role === 'owner' ? 'Propietario' : 'Administrador'}</span></td>
        <td>{new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(u.created_at))}</td>
        <td style={{ textAlign: 'right' }}>{owner && u.email !== me.email && <button onClick={() => void remove(u.email)} aria-label={`Quitar acceso a ${u.email}`}><Trash2 size={14} /> Quitar</button>}</td></tr>)}</tbody></table></div>}
  </section>;
}

const TABS: Array<{ id: Tab; label: string; icon: React.ReactNode; eyebrow: string; title: string; lead: string }> = [
  { id: 'review', label: 'Revisión', icon: <FileCheck2 size={18} />, eyebrow: 'DE LA OFERTA BRUTA A LA OPORTUNIDAD', title: 'Revisar antes de ofrecer.', lead: 'Aprobar o publicar es siempre una decisión humana. Cada guardado crea una versión nueva e inmutable.' },
  { id: 'catalog', label: 'Probar ofertas', icon: <Search size={18} />, eyebrow: 'LO QUE RECOGE EL MOTOR', title: 'Prueba las ofertas.', lead: 'Mira todo el catálogo o lo que vería una alumna ahora mismo con los mismos filtros.' },
  { id: 'sources', label: 'Fuentes', icon: <Activity size={18} />, eyebrow: 'TU MESA DE TRABAJO', title: 'Fuentes de datos.', lead: 'Estado real de cada fuente y de las conexiones del sistema.' },
  { id: 'apis', label: 'APIs', icon: <Plug size={18} />, eyebrow: 'CLAVES Y PROVEEDORES', title: 'APIs y conexiones.', lead: 'Guarda las claves de los proveedores y comprueba que funcionan.' },
  { id: 'users', label: 'Usuarios', icon: <Users size={18} />, eyebrow: 'QUIÉN ENTRA', title: 'Equipo con acceso.', lead: 'Solo las personas de esta lista pueden entrar al panel.' },
];

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

  if (state === 'checking') return <div className="auth-wrap"><p className="muted"><LoaderCircle size={18} className="spin" /> Comprobando sesión…</p></div>;
  if (state === 'unconfigured') return <div className="auth-wrap"><div className="auth-card"><Brand /><h1>Acceso sin configurar</h1><p>Faltan las variables de Supabase (URL, clave pública y service role) en el servidor de este despliegue.</p></div></div>;
  if (state === 'out' || !me) return <Login onLogin={m => { setMe(m); setState('in'); }} />;
  const current = TABS.find(t => t.id === tab)!;
  return <div className="shell">
    <aside className="sidebar">
      <Brand />
      <div className="workspace-label">PANEL DE ADMINISTRACIÓN</div>
      <nav aria-label="Secciones del panel">{TABS.map(t => <button key={t.id} className={t.id === tab ? 'nav active' : 'nav'} aria-current={t.id === tab ? 'page' : undefined} onClick={() => setTab(t.id)}>{t.icon} {t.label}</button>)}</nav>
      <div className="sidebar-note"><span className="eyebrow">DE LA PREPARACIÓN<br />A LA OPORTUNIDAD</span><p>El siguiente paso profesional empieza con una buena selección.</p></div>
      <div className="local-user"><span className="avatar-sm" aria-hidden="true">{me.email.slice(0, 2).toUpperCase()}</span><div><strong>{me.email}</strong><small>{me.role === 'owner' ? 'Propietario' : 'Administrador'}</small></div>
        <button onClick={logout}><LogOut size={14} /> Salir</button></div>
    </aside>
    <div className="main-shell">
      <header className="topbar"><div>Women Digital Closer <ChevronRight size={14} /> <strong>{current.label}</strong></div>
        <a className="local-badge" href="/" target="_blank" rel="noopener noreferrer"><BriefcaseBusiness size={14} /> Ver la app de alumnas</a></header>
      <main>
        <div className="page-heading"><div><span className="eyebrow">{current.eyebrow}</span><h1>{current.title}</h1><p>{current.lead}</p></div></div>
        {tab === 'review' && <CloudAdminPanel onSessionLost={lost} />}
        {tab === 'catalog' && <CatalogTab onSessionLost={lost} />}
        {tab === 'sources' && <SourcesTab onSessionLost={lost} />}
        {tab === 'apis' && <ApisTab owner={me.role === 'owner'} onSessionLost={lost} />}
        {tab === 'users' && <UsersTab me={me} onSessionLost={lost} />}
      </main>
    </div>
  </div>;
}
