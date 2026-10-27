'use client';
import { useCallback, useEffect, useState } from 'react';
import { Activity, BriefcaseBusiness, CloudCog, Globe2, ChevronRight, FileCheck2, LayoutDashboard, ListChecks, KeyRound, LoaderCircle, LogOut, Plug, RefreshCcw, Search, ShieldCheck, Trash2, UserPlus, Users, GraduationCap } from 'lucide-react';
import CloudAdminPanel from './CloudAdminPanel';
import EngineAlertBanner from './EngineAlertBanner';
import ApifyTab from './ApifyTab';
import ApisTab from './ApisTab';
import CatalogTab from './CatalogTab';
import ExternalTab from './ExternalTab';
import QuickReview from './QuickReview';
import StudentsTab from './StudentsTab';
import SummaryTab from './SummaryTab';
import sourceCatalog from '../lib/sourceCatalog.json';
import { catalogCodeFor, groupByFamily } from '../lib/sourceFamilies';

// Panel hospedado: mismo marco que el panel local (barra lateral, cabecera, título en serif), con acceso por
// email + contraseña de Supabase Auth (solo usuarios invitados) y las secciones de gestión de la app.
export type Me = { email: string; role: 'owner' | 'admin' };
type Tab = 'summary' | 'quick' | 'external' | 'apify' | 'review' | 'catalog' | 'sources' | 'apis' | 'students' | 'users';

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
  external?: { pending: number; sources: ExtSource[]; paused?: string[] };
};
const CONN: Record<string, string> = { ok: 'Conectado', error: 'Con fallo', not_configured: 'Sin configurar' };
// `deferred`: el motor aplazó la fuente porque se acabó el presupuesto de peticiones de esa
// ejecución (no es un fallo ni una fuente apagada); entra en la siguiente pasada.
const RUN: Record<string, string> = { completed: 'Completada', failed: 'Fallida', running: 'En curso', queued: 'En cola', skipped: 'Omitida', deferred: 'Aplazada' };
const statusClass = (s: string | null) => s === 'ok' || s === 'completed' ? 'status ok' : s === 'error' || s === 'failed' ? 'status bad' : 'status';

type ExtSource = { source: string; live: number; approved: number; last_seen: string | null };
type CatalogEntry = { code: string; name: string; category: string | null; website: string | null; acquisition_method: string | null; validation_status: string | null; requires: string | null; note: string | null };
const CATALOG = sourceCatalog as CatalogEntry[];
type CloudSource = Overview['sources'][number];
type Filter = 'all' | 'cloud' | 'failed' | 'local';

// Catálogo completo (todas las fuentes que conoce la app) cruzado con el estado real del motor cloud.
function SourceCatalog({ sources, external = [], paused = [], engineDown = false }: { sources: CloudSource[]; external?: ExtSource[]; paused?: string[]; engineDown?: boolean }) {
  const [filter, setFilter] = useState<Filter>('all');
  const [category, setCategory] = useState('');
  const [text, setText] = useState('');
  const [limit, setLimit] = useState(25); // por tandas: el catálogo tiene decenas de filas y en móvil medía ~11.000 px
  useEffect(() => setLimit(25), [filter, category, text]);
  const ext = new Map(external.map(e => [e.source, e]));
  // Los conectores del motor se agrupan por portal (himalayas-closer + himalayas → himalayas): antes,
  // un portal recogido por un conector con otro nombre se leía como «Fuera del cloud».
  const cloud = groupByFamily(sources);
  const known = new Set(CATALOG.map(c => c.code));
  const rows = [
    ...CATALOG.map(c => ({ ...c, cloud: cloud.get(c.code) ?? null, ext: ext.get(c.code) ?? null })),
    ...sources.filter(s => !known.has(catalogCodeFor(s.code))).map(s => ({ code: s.code, name: s.name, category: 'Motor cloud', website: null, acquisition_method: 'Recogida del motor cloud', validation_status: null, requires: 'none', note: null, cloud: cloud.get(catalogCodeFor(s.code)) ?? null, ext: null })),
    ...external.filter(e => !known.has(e.source) && !cloud.has(e.source)).map(e => ({ code: e.source, name: e.source, category: 'Fuentes externas', website: null, acquisition_method: 'API o recolector externo', validation_status: null, requires: 'none', note: null, cloud: null, ext: e })),
  ];
  const failed = (r: (typeof rows)[number]) => r.cloud?.run_status === 'failed';
  const categories = [...new Set(rows.map(r => r.category ?? 'Otras'))].sort();
  const q = text.trim().toLowerCase();
  const shown = rows.filter(r => (filter === 'all' || (filter === 'cloud' && (r.cloud || r.ext)) || (filter === 'failed' && failed(r)) || (filter === 'local' && !r.cloud && !r.ext))
    && (!category || (r.category ?? 'Otras') === category) && (!q || `${r.name} ${r.code} ${r.note ?? ''}`.toLowerCase().includes(q)));
  const inCloud = rows.filter(r => r.cloud || r.ext).length;
  // Con el motor sin datos, una fila que no está en el motor NO está «fuera del cloud»: no se sabe. La
  // diferencia importa: «fuera del cloud» se lee como una configuración pendiente y no como un fallo.
  const cell = (r: (typeof rows)[number]) => paused.includes(r.code) ? <span className="status bad">Pausada</span> : r.ext && !r.cloud ? <span className="status ok">Externa · {r.ext.live} activas</span> : r.cloud
    ? <span className={statusClass(r.cloud.run_status)}>{r.cloud.run_status ? RUN[r.cloud.run_status] ?? r.cloud.run_status : 'Sin recogida'}{r.cloud.connectors > 1 && <span className="sub">{r.cloud.connectors} conectores</span>}</span>
    : engineDown ? <span className="status">Sin datos del motor</span>
    : <span className="status">{r.requires === 'input' ? 'Requiere configurar' : 'Fuera del cloud'}</span>;
  return <>
    <h2 className="section-title">Fuentes de datos</h2>
    {engineDown && <p className="card-meta" style={{ marginBottom: 12 }}>Sin datos del motor cloud en esta consulta: el estado de las fuentes que no son externas no se puede comprobar ahora mismo.</p>}
    <div className="stat-strip"><span><strong>{rows.length}</strong>fuentes catalogadas</span><span><strong>{inCloud}</strong>recogidas (motor cloud o externas)</span><span><strong>{engineDown ? '—' : rows.filter(failed).length}</strong>con fallo</span><span><strong>{engineDown ? '—' : rows.length - inCloud}</strong>fuera del cloud (app local o con configuración)</span></div>
    <div className="search-panel admin-toolbar">
      <label className="grow" htmlFor="src-q">Buscar<input id="src-q" placeholder="Nombre o código" value={text} onChange={e => setText(e.target.value)} /></label>
      <label htmlFor="src-filter">Mostrar<select id="src-filter" value={filter} onChange={e => setFilter(e.target.value as Filter)}><option value="all">Todas</option><option value="cloud">En el motor cloud</option><option value="failed">Con fallo</option><option value="local">Fuera del cloud</option></select></label>
      <label htmlFor="src-cat">Categoría<select id="src-cat" value={category} onChange={e => setCategory(e.target.value)}><option value="">Todas</option>{categories.map(c => <option key={c} value={c}>{c}</option>)}</select></label>
    </div>
    {!shown.length ? <div className="empty"><h3>Ninguna fuente con estos filtros.</h3></div> : <div className="table-wrap"><table className="data-table">
      <thead><tr><th>Fuente</th><th>Categoría</th><th>Método</th><th>Estado</th><th className="num">Leídas</th><th className="num">Catálogo</th><th className="num">Elegibles</th></tr></thead>
      <tbody>{shown.slice(0, limit).map(r => <tr key={r.code}>
        <td className="primary-cell"><strong>{r.website ? <a href={r.website} target="_blank" rel="noopener noreferrer">{r.name}</a> : r.name}</strong><span>{r.code}</span>
          {r.cloud?.warning && <span style={{ color: 'var(--warning)' }}>{r.cloud.warning}</span>}{!r.cloud && r.note && <span>{r.note}</span>}</td>
        <td>{r.category ?? '—'}</td><td>{r.acquisition_method ?? '—'}{r.validation_status && <span className="sub">{r.validation_status}</span>}</td>
        <td>{cell(r)}</td><td className="num">{r.cloud?.fetched ?? '—'}</td><td className="num">{r.cloud?.catalog ?? '—'}</td><td className="num">{r.cloud?.eligible ?? '—'}</td></tr>)}</tbody></table></div>}
    {shown.length > limit && <p className="card-meta" style={{ marginTop: 12 }}><button onClick={() => setLimit(n => n + 25)}>Mostrar {Math.min(25, shown.length - limit)} más</button> <span aria-live="polite">Mostrando {limit} de {shown.length}</span></p>}
  </>;
}

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
      <SourceCatalog sources={data.sources} external={data.external?.sources} paused={data.external?.paused} engineDown={data.engine === null} />
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
  { id: 'summary', label: 'Resumen', icon: <LayoutDashboard size={18} />, eyebrow: 'TU OBJETIVO', title: 'Cómo vamos.', lead: 'Cuántas ofertas de closer en España ven ya las alumnas y qué toca hacer para llegar a 20.' },
  { id: 'quick', label: 'Revisión rápida', icon: <ListChecks size={18} />, eyebrow: 'MUCHAS OFERTAS, POCOS CLICS', title: 'Revisa en bloque.', lead: 'Filtra por perfil, verifica la vigencia y aprueba varias a la vez. Todo se puede deshacer.' },
  { id: 'external', label: 'Fuentes externas', icon: <Globe2 size={18} />, eyebrow: 'APIS OFICIALES, JOBSPY Y GOOGLE JOBS', title: 'Ofertas de España y del mercado en dólares.', lead: 'Lo que cumple las reglas (perfil, mercado, español, puntuación y enlace vivo) se aprueba solo, hasta 100 al día. Lo que no, queda aquí: esta es tu cola de excepciones.' },
  { id: 'apify', label: 'Búsqueda automática', icon: <CloudCog size={18} />, eyebrow: 'MÁS OFERTAS SIN TRABAJO MANUAL', title: 'Buscar ofertas.', lead: 'Elige en qué portales de empleo buscar. Si un buscador falla, la app prueba otro sola; lo encontrado entra como borrador para que lo apruebes.' },
  { id: 'review', label: 'Revisión una a una', icon: <FileCheck2 size={18} />, eyebrow: 'DE LA OFERTA BRUTA A LA OPORTUNIDAD', title: 'Revisar a fondo lo que lo merece.', lead: 'Las ofertas claras ya entran solas por reglas; aquí publicas o retiras las que necesitan criterio, y cada guardado crea una versión nueva e inmutable.' },
  { id: 'catalog', label: 'Probar ofertas', icon: <Search size={18} />, eyebrow: 'LO QUE RECOGE EL MOTOR', title: 'Prueba las ofertas.', lead: 'Mira todo el catálogo o lo que vería una alumna ahora mismo con los mismos filtros.' },
  { id: 'sources', label: 'Fuentes', icon: <Activity size={18} />, eyebrow: 'TU MESA DE TRABAJO', title: 'Fuentes de datos.', lead: 'Estado real de cada fuente y de las conexiones del sistema.' },
  { id: 'apis', label: 'APIs', icon: <Plug size={18} />, eyebrow: 'CLAVES Y PROVEEDORES', title: 'APIs y conexiones.', lead: 'Guarda las claves de los proveedores y comprueba que funcionan.' },
  { id: 'students', label: 'Alumnas', icon: <GraduationCap size={18} />, eyebrow: 'QUIÉN ENTRA A SU ESPACIO', title: 'Alumnas con acceso.', lead: 'Invita, pausa o da de baja a las alumnas. Solo ellas ven su propio perfil.' },
  { id: 'users', label: 'Usuarios', icon: <Users size={18} />, eyebrow: 'QUIÉN ENTRA', title: 'Equipo con acceso.', lead: 'Solo las personas de esta lista pueden entrar al panel.' },
];

export default function AdminShell() {
  const [state, setState] = useState<'checking' | 'out' | 'in' | 'unconfigured'>('checking');
  const [me, setMe] = useState<Me | null>(null);
  const [tab, setTab] = useState<Tab>('summary');
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
        {/* El aviso del motor vive aquí, no dentro de una pestaña: si el motor se pausa o deja de responder,
            el operador lo ve en cualquiera de ellas sin ir a buscarlo a «Fuentes». */}
        <EngineAlertBanner go={() => setTab('sources')} />
        {tab === 'summary' && <SummaryTab go={setTab} onSessionLost={lost} />}
        {tab === 'quick' && <QuickReview onSessionLost={lost} />}
        {tab === 'external' && <ExternalTab owner={me.role === 'owner'} onSessionLost={lost} />}
        {tab === 'apify' && <ApifyTab owner={me.role === 'owner'} onSessionLost={lost} goApis={() => setTab('apis')} />}
        {tab === 'review' && <CloudAdminPanel onSessionLost={lost} />}
        {tab === 'catalog' && <CatalogTab onSessionLost={lost} />}
        {tab === 'sources' && <SourcesTab onSessionLost={lost} />}
        {tab === 'apis' && <ApisTab owner={me.role === 'owner'} onSessionLost={lost} />}
        {tab === 'students' && <StudentsTab owner={me.role === 'owner'} onSessionLost={lost} />}
        {tab === 'users' && <UsersTab me={me} onSessionLost={lost} />}
      </main>
    </div>
  </div>;
}
