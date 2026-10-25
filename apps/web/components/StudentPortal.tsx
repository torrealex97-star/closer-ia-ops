'use client';
import { useCallback, useEffect, useState } from 'react';
import { KeyRound, LoaderCircle, LogOut, Save, ShieldCheck, Trash2 } from 'lucide-react';
import { ROLE_LABELS } from '../lib/vocabulary';
import { ApplicationForm, Applications } from './StudentApplications';
import StudentProgress from './StudentProgress';

// Portal de alumnas: acceso por invitación (email + contraseña de Supabase Auth) y perfil propio. Los vídeos NO se suben
// aquí: cada alumna los guarda en su propio Drive y solo pega el enlace (por si algún formulario futuro lo pide).
type Profile = { full_name: string | null; city: string | null; target_roles: string[]; languages: string[]; availability: string | null; video_url: string | null; consent_at: string | null };
const LANGS: Array<[string, string]> = [['es', 'Español'], ['en', 'Inglés'], ['pt', 'Portugués'], ['fr', 'Francés'], ['de', 'Alemán'], ['it', 'Italiano'], ['ca', 'Catalán']];

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/student/${path}`, { headers: { 'Content-Type': 'application/json' }, ...init });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(typeof (data as { detail?: string }).detail === 'string' ? (data as { detail: string }).detail : 'La operación falló.'), { status: response.status });
  return data as T;
}
const Brand = () => <a className="brand" href="/alumna" aria-label="Women Digital Closer"><span className="brand-mark">w.</span><span>Women Digital<br /><strong>Closer</strong></span></a>;

function Login({ onLogin }: { onLogin: () => void }) {
  const [mode, setMode] = useState<'login' | 'forgot'>('login');
  const [email, setEmail] = useState(''); const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError(''); setNotice('');
    try {
      if (mode === 'login') { await api('session', { method: 'POST', body: JSON.stringify({ email, password }) }); onLogin(); }
      else setNotice((await api<{ message: string }>('auth/recover', { method: 'POST', body: JSON.stringify({ email }) })).message);
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }
  return <div className="auth-wrap"><div className="auth-card"><Brand />
    <div><span className="eyebrow">{mode === 'login' ? 'ACCESO DE ALUMNAS' : 'RECUPERAR ACCESO'}</span>
      <h1>{mode === 'login' ? 'Tu espacio' : 'Crea una contraseña nueva'}</h1>
      <p>{mode === 'login' ? 'Entra con el email con el que te invitamos.' : 'Escribe tu email y te enviamos un enlace para elegir una contraseña.'}</p></div>
    <form onSubmit={submit}>
      <label htmlFor="student-email">Email<input id="student-email" type="email" value={email} onChange={e => setEmail(e.target.value)} autoFocus autoComplete="username" required /></label>
      {mode === 'login' && <label htmlFor="student-password">Contraseña<input id="student-password" type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" required /></label>}
      {error && <div className="alert error" role="alert"><span>{error}</span></div>}
      {notice && <div className="auth-note" role="status">{notice}</div>}
      <button className="primary" disabled={busy || !email || (mode === 'login' && !password)}>{busy ? <LoaderCircle size={16} className="spin" /> : mode === 'login' ? <ShieldCheck size={16} /> : <KeyRound size={16} />}{mode === 'login' ? 'Entrar' : 'Enviar enlace'}</button>
    </form>
    <button type="button" className="link-button" onClick={() => { setMode(mode === 'login' ? 'forgot' : 'login'); setError(''); setNotice(''); }}>{mode === 'login' ? '¿Has olvidado tu contraseña?' : 'Volver a entrar'}</button>
  </div></div>;
}

type Match = { opportunity: { id: string; original_title: string; company: string; location: string; modality: string; compensation: string; source_url: string }; score: number; reasons: string[]; unknowns: string[] };
// Ofertas aprobadas por el equipo que encajan con su perfil. Solo recomienda: el envío lo hace ella en la web de la oferta.
function Matches({ refreshKey, onPrepared, onLost }: { refreshKey: number; onPrepared: () => void; onLost: () => void }) {
  const [msg, setMsg] = useState(''); const [busyId, setBusyId] = useState('');
  async function prepare(id: string) { setBusyId(id); setMsg(''); try { const r = await api<{ created: boolean }>('applications', { method: 'POST', body: JSON.stringify({ offer_id: id }) }); setMsg(r.created ? 'Candidatura preparada: la tienes abajo, en «Mis candidaturas».' : 'Ya tenías esta candidatura preparada: está abajo.'); onPrepared(); } catch (e) { const err = e as Error & { status?: number }; if (err.status === 401 || err.status === 403) onLost(); setMsg(err.message); } finally { setBusyId(''); } }
  const [data, setData] = useState<{ ready: boolean; hint?: string; matches: Match[] } | null>(null);
  useEffect(() => { api<{ ready: boolean; hint?: string; matches: Match[] }>('matches').then(setData).catch(() => setData({ ready: false, hint: 'No se pudieron cargar tus ofertas ahora mismo.', matches: [] })); }, [refreshKey]);
  if (!data) return <p className="muted"><LoaderCircle size={14} className="spin" /> Buscando ofertas para ti…</p>;
  return <section aria-label="Ofertas para ti" data-testid="matches"><span className="eyebrow">OFERTAS PARA TI</span>
    {!data.ready ? <p className="card-meta">{data.hint}</p> : !data.matches.length ? <p className="card-meta">Hoy no hay ofertas aprobadas que encajen con tu perfil. Vuelve mañana o amplía tus perfiles de interés.</p>
      : <ol style={{ listStyle: 'none', padding: 0, display: 'grid', gap: 12 }}>{data.matches.map(m => <li key={m.opportunity.id} className="search-panel">
        <strong>{m.opportunity.original_title}</strong> · {m.opportunity.company} <span className="status ok" style={{ marginLeft: 6 }}>{m.score}% encaje</span>
        <div className="card-meta">{m.opportunity.location} · {m.opportunity.modality} · {m.opportunity.compensation}</div>
        {!!m.reasons.length && <div className="card-meta">Por qué: {m.reasons.join(' · ')}</div>}
        {!!m.unknowns.length && <div className="card-meta muted">No sabemos: {m.unknowns.join(' · ')}</div>}
        <a href={m.opportunity.source_url} target="_blank" rel="noopener noreferrer">Ver el anuncio original</a> <button onClick={() => void prepare(m.opportunity.id)} disabled={busyId !== ''}>{busyId === m.opportunity.id ? <LoaderCircle size={14} className="spin" /> : null} Preparar candidatura</button></li>)}</ol>}
    {msg && <div className="auth-note" role="status">{msg}</div>}
  </section>;
}

function ProfileForm({ email, onLogout, onLost }: { email: string; onLogout: () => void; onLost: () => void }) {
  const [p, setP] = useState<Profile>({ full_name: '', city: '', target_roles: [], languages: ['es'], availability: '', video_url: '', consent_at: null });
  const [consent, setConsent] = useState(false);
  const [saves, setSaves] = useState(0);
  const [apps, setApps] = useState(0);
  const [busy, setBusy] = useState(true); const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const fail = useCallback((err: Error & { status?: number }) => { if (err.status === 401 || err.status === 403) onLost(); setError(err.message); }, [onLost]);
  useEffect(() => { api<{ profile: Profile | null }>('profile').then(d => { if (d.profile) { setP({ ...d.profile, full_name: d.profile.full_name ?? '', city: d.profile.city ?? '', availability: d.profile.availability ?? '', video_url: d.profile.video_url ?? '' }); setConsent(Boolean(d.profile.consent_at)); } }).catch(fail).finally(() => setBusy(false)); }, [fail]);
  const toggle = (key: 'target_roles' | 'languages', v: string) => setP(old => ({ ...old, [key]: old[key].includes(v) ? old[key].filter(x => x !== v) : [...old[key], v] }));
  async function save(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError(''); setNotice('');
    try { await api('profile', { method: 'PUT', body: JSON.stringify({ ...p, consent }) }); setNotice('Perfil guardado.'); setP(old => ({ ...old, consent_at: old.consent_at ?? new Date().toISOString() })); setSaves(n => n + 1); } catch (err) { fail(err as Error); } finally { setBusy(false); }
  }
  async function erase() {
    if (!window.confirm('¿Borrar tu perfil y el enlace a tu vídeo? No se puede deshacer.')) return;
    setBusy(true); setError(''); setNotice('');
    try { await api('profile', { method: 'DELETE' }); setP({ full_name: '', city: '', target_roles: [], languages: ['es'], availability: '', video_url: '', consent_at: null }); setConsent(false); setNotice('Tu perfil, tu formulario y tus candidaturas se han borrado.'); setSaves(n => n + 1); setApps(n => n + 1); } catch (err) { fail(err as Error); } finally { setBusy(false); }
  }
  return <div className="auth-wrap"><div className="auth-card" style={{ width: 'min(760px, 100%)' }}><Brand />
    <div><span className="eyebrow">TU PERFIL</span><h1>Hola, {p.full_name || email}</h1><p>Esta información nos ayuda a elegir ofertas para ti. Puedes cambiarla o borrarla cuando quieras.</p></div>
    {/* Para quien acaba de entrar, el perfil va primero: de él salen las ofertas.
        El progreso solo abre la página cuando ya hay historial que enseñar. */}
    {p.consent_at && <StudentProgress />}
    <p className="card-meta">Sigue practicando: <a href="/?tab=formacion">formación</a> · <a href="/?tab=practica">sala de práctica</a>.</p>
    <form onSubmit={save}>
      <label htmlFor="sp-name">Nombre<input id="sp-name" maxLength={120} value={p.full_name ?? ''} onChange={e => setP({ ...p, full_name: e.target.value })} autoComplete="name" /></label>
      <label htmlFor="sp-city">Ciudad<input id="sp-city" maxLength={80} value={p.city ?? ''} onChange={e => setP({ ...p, city: e.target.value })} /></label>
      <fieldset><legend>Perfiles que te interesan</legend>{Object.entries(ROLE_LABELS).map(([k, l]) => <label key={k} className="check-label" style={{ flexDirection: 'row', alignItems: 'center' }}><input type="checkbox" checked={p.target_roles.includes(k)} onChange={() => toggle('target_roles', k)} /> {l}</label>)}</fieldset>
      <fieldset><legend>Idiomas</legend>{LANGS.map(([k, l]) => <label key={k} className="check-label" style={{ flexDirection: 'row', alignItems: 'center' }}><input type="checkbox" checked={p.languages.includes(k)} onChange={() => toggle('languages', k)} /> {l}</label>)}</fieldset>
      <label htmlFor="sp-av">Disponibilidad<input id="sp-av" maxLength={200} placeholder="Ej.: tardes, jornada completa desde enero" value={p.availability ?? ''} onChange={e => setP({ ...p, availability: e.target.value })} /></label>
      <label htmlFor="sp-video">Enlace a tu vídeo de presentación (en tu propio Drive)<input id="sp-video" type="url" maxLength={1000} placeholder="https://drive.google.com/…" value={p.video_url ?? ''} onChange={e => setP({ ...p, video_url: e.target.value })} /></label>
      <p className="card-meta">No subimos ni guardamos tu vídeo: solo este enlace, por si una oferta pide un vídeo en su formulario. Comprueba que el enlace se puede abrir con «cualquiera con el enlace».</p>
      <label className="check-label" style={{ flexDirection: 'row', alignItems: 'flex-start' }}><input type="checkbox" checked={consent} disabled={Boolean(p.consent_at)} onChange={e => setConsent(e.target.checked)} /> <span>Acepto que Women Digital Closer guarde estos datos para recomendarme ofertas y ayudarme a preparar candidaturas. No se envían a ninguna empresa ni a sistemas de inteligencia artificial; puedo corregirlos o borrarlos aquí cuando quiera y retirar este permiso. Más información en la <a href="/privacidad" target="_blank" rel="noopener noreferrer">política de privacidad</a>. <em>(Texto provisional, pendiente de revisión legal.)</em></span></label>
      {error && <div className="alert error" role="alert"><span>{error}</span></div>}
      {notice && <div className="auth-note" role="status">{notice}</div>}
      <button className="primary" disabled={busy || (!p.consent_at && !consent)}>{busy ? <LoaderCircle size={16} className="spin" /> : <Save size={16} />} Guardar perfil</button>
    </form>
    {!p.consent_at && <StudentProgress />}
    <ApplicationForm onLost={onLost} onSaved={() => setApps(n => n + 1)} />
    <Matches refreshKey={saves} onPrepared={() => setApps(n => n + 1)} onLost={onLost} />
    <Applications refreshKey={apps} onLost={onLost} />
    <div className="admin-toolbar" style={{ justifyContent: 'space-between' }}>
      <a href="/">Ver oportunidades</a> · <a href="/privacidad">Privacidad</a>
      <span><button type="button" onClick={() => void erase()} disabled={busy}><Trash2 size={14} /> Borrar mi perfil</button> <button type="button" onClick={onLogout}><LogOut size={14} /> Salir</button></span>
    </div>
  </div></div>;
}

export default function StudentPortal() {
  const [state, setState] = useState<{ loading: boolean; email: string | null }>({ loading: true, email: null });
  const refresh = useCallback(() => { api<{ authenticated: boolean; email?: string }>('session').then(d => setState({ loading: false, email: d.authenticated ? d.email ?? null : null })).catch(() => setState({ loading: false, email: null })); }, []);
  useEffect(refresh, [refresh]);
  if (state.loading) return <div className="auth-wrap"><p className="muted"><LoaderCircle className="spin" size={18} /> Cargando…</p></div>;
  if (!state.email) return <Login onLogin={refresh} />;
  return <ProfileForm email={state.email} onLogout={() => { void api('session', { method: 'DELETE' }).finally(() => setState({ loading: false, email: null })); }} onLost={() => setState({ loading: false, email: null })} />;
}
