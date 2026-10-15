'use client';
import { useEffect, useState } from 'react';
import { Check, ChevronRight, ExternalLink, Eye, LoaderCircle, RefreshCcw, Send, X } from 'lucide-react';

// Panel de administración contra el ENGINE CLOUD (port fase 4). El navegador solo
// habla con /api/admin/* y /api/admin/session (cookie HttpOnly del operador); el
// token X-Admin-Token del engine vive en el servidor y nunca cruza al cliente.
const EDITORIAL: Record<string, string> = { draft: 'Borrador', needs_review: 'A revisar', approved: 'Aprobada', published: 'Publicada', withdrawn: 'Retirada' };
const ACTIVITY: Record<string, string> = { active: 'Activa', verifying: 'Verificando', closed: 'Cerrada' };
const APPLICATION: Record<string, string> = { company_ats: 'ATS de la empresa', external_platform: 'Plataforma externa', marketplace: 'Marketplace', wdc_referral: 'Referida WDC', email: 'Email', contact_form: 'Formulario de contacto', community_contact: 'Contacto de comunidad', unknown: 'Sin determinar' };
const ROLES: Array<{ value: string; label: string }> = [
  { value: 'uncategorized', label: 'Sin clasificar (título original)' },
  { value: 'closer', label: 'Closer' },
  { value: 'setter', label: 'Setter' },
  { value: 'cold_caller', label: 'Cold Caller' },
  { value: 'account_executive', label: 'Ejecutivo comercial' },
  { value: 'sdr', label: 'SDR / BDR' },
];
const FILTERS = ['', 'draft', 'needs_review', 'approved', 'published', 'withdrawn'] as const;
type NextStep = { action?: string; label?: string; enabled: boolean; disabled_reason?: string };
// Payload de versión: puede llegar en forma de presentación (revisada) o raw-shape
// del collector (title/company/url sin headline). La UI mapea sin inventar.
type VersionPayload = {
  headline?: string; title?: string; role?: string; short_summary?: string;
  what_they_are_looking_for?: string[]; what_you_would_do?: string[]; why_it_may_be_interesting?: string[];
  compensation_summary?: string; location_summary?: string; experience_summary?: string;
  language_requirements?: string[]; application_type?: string; application_url?: string | null;
  next_step?: NextStep; [k: string]: unknown;
};
type Item = { id: string; job_id: string; original_title: string | null; company: string | null; source_url: string | null; source: string; editorial_status: string; opportunity_status: string; connection_type: string; created_at: string; updated_at: string };
// Veredicto espejo del POST /verify (fase 3): mismo shape que VerificationResult local.
type Verification = { result: 'open' | 'closed' | 'unknown'; method: string; checked_at: string; valid_until: string | null; reason_code: string; opportunity_status: string; next_step_enabled: boolean; status_reason: string | null };
const VERDICT: Record<string, string> = { open: 'Activa en el origen', closed: 'Cerrada en el origen', unknown: 'No verificable ahora' };
type Detail = Item & { version: number | null; version_payload: VersionPayload | null; job_snapshot: { title: string | null; company: string | null; location: string | null; salary: string | null; posted_at: string | null; source_url: string | null; source: string }; vigencia: { expires_at: string | null; activa: boolean }; verificacion: { last_verified_at: string | null; verified_until: string | null; status_reason: string | null } };
type Counts = Record<string, number>;
const date = (value?: string | null) => value ? new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short' }).format(new Date(value)) : '—';
const tag = (status: string) => ({ draft: 'source-tag', needs_review: 'review-tag', approved: 'source-tag ok', published: 'source-tag ok', withdrawn: 'source-tag' }[status] || 'source-tag');

async function admin<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/admin/${path}`, { headers: { 'Content-Type': 'application/json' }, ...init });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof (data as { detail?: string }).detail === 'string' ? (data as { detail: string }).detail : 'La operación contra el engine falló.');
  return data as T;
}

export default function CloudAdminPanel() {
  const [authState, setAuthState] = useState<'checking' | 'out' | 'in' | 'unconfigured'>('checking');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [loggingIn, setLoggingIn] = useState(false);

  const [items, setItems] = useState<Item[]>([]);
  const [counts, setCounts] = useState<Counts>({});
  const [total, setTotal] = useState(0);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('');
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [detail, setDetail] = useState<Detail | null>(null);
  const [draft, setDraft] = useState<VersionPayload | null>(null);
  const [saving, setSaving] = useState(false);
  const [verification, setVerification] = useState<Verification | null>(null);
  const [verifying, setVerifying] = useState(false);

  useEffect(() => {
    fetch('/api/admin/session').then(r => r.json()).then((s: { configured?: boolean; authenticated?: boolean }) => {
      setAuthState(s.authenticated ? 'in' : s.configured ? 'out' : 'unconfigured');
    }).catch(() => setAuthState('out'));
  }, []);
  useEffect(() => { if (!notice) return; const t = setTimeout(() => setNotice(''), 4000); return () => clearTimeout(t); }, [notice]);

  function login(e: React.FormEvent) {
    e.preventDefault();
    setLoggingIn(true); setLoginError('');
    fetch('/api/admin/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) })
      .then(r => { if (!r.ok) throw new Error('Contraseña incorrecta.'); return r.json(); })
      .then(() => { setAuthState('in'); setPassword(''); })
      .catch(err => setLoginError((err as Error).message))
      .finally(() => setLoggingIn(false));
  }

  function logout() {
    fetch('/api/admin/session', { method: 'DELETE' }).finally(() => { setAuthState('out'); setDetail(null); });
  }

  function refresh(status: (typeof FILTERS)[number] = filter) {
    setBusy(true);
    admin<{ items: Item[]; total: number; counts: Counts }>(`opportunities?limit=50${status ? `&status=${status}` : ''}`)
      .then(d => { setItems(d.items); setTotal(d.total); setCounts(d.counts ?? {}); setError(''); })
      .catch(err => { if ((err as Error).message.includes('Sesión')) setAuthState('out'); setError((err as Error).message); })
      .finally(() => setBusy(false));
  }
  useEffect(() => { if (authState === 'in') refresh(filter); /* eslint-disable-line react-hooks/exhaustive-deps */ }, [filter, authState]);

  // Fase 3: verificación REAL de vigencia contra el engine (un GET acotado con
  // corroboración de contenido). El veredicto llega con su vigencia y razón.
  async function verify() {
    if (!detail) return;
    setVerifying(true); setError('');
    try {
      const outcome = await admin<Verification>(`opportunities/${detail.id}/verify`, { method: 'POST', body: '{}' });
      setVerification(outcome);
      setDetail(old => old ? { ...old, opportunity_status: outcome.opportunity_status, verificacion: { last_verified_at: outcome.checked_at, verified_until: outcome.valid_until, status_reason: outcome.status_reason } } : old);
    } catch (err) { setError((err as Error).message); }
    finally { setVerifying(false); }
  }
  async function open(item: Item) {
    setError(''); setVerification(null);
    try {
      const d = await admin<Detail>(`opportunities/${item.id}`);
      setDetail(d);
      const p = d.version_payload ?? {};
      // Mapeo del payload real (raw-shape o presentación) al formulario de edición.
      setDraft({
        ...p,
        headline: p.headline ?? p.title ?? '',
        role: p.role ?? 'uncategorized',
        short_summary: p.short_summary ?? '',
        what_they_are_looking_for: p.what_they_are_looking_for ?? [],
        what_you_would_do: p.what_you_would_do ?? [],
        why_it_may_be_interesting: p.why_it_may_be_interesting ?? [],
        compensation_summary: p.compensation_summary ?? '',
        location_summary: p.location_summary ?? (d.job_snapshot.location ?? ''),
        experience_summary: p.experience_summary ?? '',
        language_requirements: p.language_requirements ?? [],
        application_type: p.application_type ?? 'unknown',
        application_url: p.application_url ?? d.job_snapshot.source_url ?? null,
      });
    } catch (err) { setError((err as Error).message); }
  }

  async function submit(status: string) {
    if (!detail || !draft) return;
    setSaving(true); setError('');
    try {
      const outcome = await admin<{ version: number }>(`opportunities/${detail.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ editorial_status: status, version_payload: draft, locale: 'es', reviewed_by: 'admin-web' }),
      });
      setNotice(`Guardado: ${EDITORIAL[status]} · versión ${outcome.version} creada.`);
      setDetail(null);
      refresh(filter);
    } catch (err) { setError((err as Error).message); }
    finally { setSaving(false); }
  }

  if (authState === 'checking') return <section className="empty"><LoaderCircle size={20} className="spin" /> Comprobando sesión…</section>;
  if (authState === 'unconfigured') return <section className="empty"><Eye size={32} strokeWidth={1.3} /><h3>Panel de administración no configurado en este despliegue.</h3><p>Falta la variable de sesión del operador (ADMIN_UI_PASSWORD) en el servidor. Configúralo antes de usar el panel.</p></section>;
  if (authState === 'out') return <section className="empty" style={{ maxWidth: 420, margin: '8vh auto' }}>
    <form onSubmit={login}>
      <h3>Panel de administración</h3>
      <p className="muted">Acceso del operador al catálogo del engine cloud. La credencial va en una cookie HttpOnly; el token del engine nunca llega al navegador.</p>
      <label style={{ display: 'block', marginTop: 12 }}>Contraseña
        <input type="password" value={password} onChange={e => setPassword(e.target.value)} autoFocus autoComplete="current-password" style={{ width: '100%', marginTop: 4 }} /></label>
      {loginError && <div className="alert error" role="alert" style={{ marginTop: 8 }}>{loginError}</div>}
      <button className="primary" disabled={!password || loggingIn} style={{ marginTop: 12, width: '100%' }}>
        {loggingIn ? <LoaderCircle size={15} className="spin" /> : <ChevronRight size={15} />} Entrar</button>
    </form>
  </section>;

  return <section aria-label="Revisión editorial del catálogo cloud">
    {error && <div className="alert error" role="alert">{error}</div>}
    {notice && <div className="toast" role="status"><Check size={16} />{notice}</div>}
    <div className="run-progress classification-summary">
      <strong>Revisión editorial <span className="muted">· catálogo del engine cloud · {date(Object.values(counts).length ? undefined : null) || ''} {total} en pantalla</span></strong>
      <span className="muted">Aprobar o publicar es siempre una decisión humana. Cada guardado crea una versión nueva e inmutable.</span>
      <div className="source-actions">
        {Object.entries(counts).map(([k, n]) => <span key={k} className="source-tag">{EDITORIAL[k] ?? k}: {n}</span>)}
        <label className="result-search" style={{ maxWidth: 200 }}><select aria-label="Filtrar por estado editorial" value={filter} onChange={e => setFilter(e.target.value as typeof filter)}>
          {FILTERS.map(f => <option key={f} value={f}>{f ? EDITORIAL[f] : 'Todos los estados'}</option>)}
        </select></label>
        <button disabled={busy} onClick={() => refresh()}><RefreshCcw size={15} /> Actualizar</button>
        <button onClick={logout}><X size={15} /> Salir</button>
      </div>
    </div>
    {busy && <p className="muted"><LoaderCircle size={14} className="spin" /> Cargando…</p>}
    {!busy && !items.length ? <div className="empty"><Eye size={32} strokeWidth={1.3} /><h3>Nada que revisar con este filtro.</h3><p>El catálogo del engine llega aquí como borrador literal; sin textos inventados.</p></div> :
      !busy && <div className="job-list">{items.map(item => <article className="job-row" key={item.id}>
        <div className="company-monogram" aria-hidden="true">{(item.company || '??').slice(0, 2).toUpperCase()}</div>
        <div className="job-info">
          <div className="job-company">{item.company} <span>· {item.source}</span></div>
          <button className="job-title" onClick={() => open(item)}>{item.original_title} <ChevronRight size={16} /></button>
          <div className="job-signals">
            <span className={tag(item.editorial_status)}>{EDITORIAL[item.editorial_status]}</span>
            <span className="source-tag">{ACTIVITY[item.opportunity_status]}</span>
            <span className="source-tag">{date(item.created_at)}</span>
          </div>
        </div>
      </article>)}</div>}
    <dialog open={!!detail} aria-label="Revisar oportunidad" style={{ width: 'min(920px, 94vw)' }}>
      {detail && draft && <div className="detail">
        <div className="detail-top"><span className="eyebrow">REVISIÓN EDITORIAL · catálogo cloud{detail.version ? ` · v${detail.version}` : ''}</span>
          <button className="icon-button" aria-label="Cerrar revisión" onClick={() => setDetail(null)}><X size={20} /></button></div>
        <p className="job-company">{detail.job_snapshot.company} · {ACTIVITY[detail.opportunity_status]} · vigencia: {detail.vigencia.activa ? `activa hasta ${date(detail.vigencia.expires_at)}` : 'sin vigencia activa'}
          {detail.verificacion?.last_verified_at && <span className="muted" style={{ fontSize: 12 }}> · verificado: {date(detail.verificacion.last_verified_at)}{detail.verificacion.verified_until ? ` · vigente hasta: ${date(detail.verificacion.verified_until)}` : ''}{detail.verificacion.status_reason ? ` · ${detail.verificacion.status_reason}` : ''}</span>}</p>
        {verification && <p className="muted" style={{ fontSize: 12 }} role="status">{VERDICT[verification.result]} · {verification.reason_code} · vigente hasta: {date(verification.valid_until)} → {ACTIVITY[verification.opportunity_status]}{verification.next_step_enabled ? ' · CTA habilitado' : ' · CTA deshabilitado'}</p>}
        <h2>{draft.headline}</h2>
        <label>Título (headline)<input maxLength={180} value={draft.headline} onChange={e => setDraft({ ...draft, headline: e.target.value })} /></label>
        <label>Rol<em className="muted" style={{ fontSize: 11 }}>Vocabulario canónico</em>
          <select value={ROLES.some(r => r.value === draft.role) ? draft.role : 'uncategorized'} onChange={e => setDraft({ ...draft, role: e.target.value })}>
            {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select></label>
        <label>Resumen corto<textarea rows={3} maxLength={500} value={draft.short_summary} onChange={e => setDraft({ ...draft, short_summary: e.target.value })} /></label>
        <div className="review-grid">
          <label>Compensación<textarea rows={2} maxLength={200} value={draft.compensation_summary} onChange={e => setDraft({ ...draft, compensation_summary: e.target.value })} /></label>
          <label>Ubicación<textarea rows={2} maxLength={200} value={draft.location_summary} onChange={e => setDraft({ ...draft, location_summary: e.target.value })} /></label>
        </div>
        <label>Por qué puede interesar (una línea por punto)<textarea rows={3} value={(draft.why_it_may_be_interesting ?? []).join('\n')} onChange={e => setDraft({ ...draft, why_it_may_be_interesting: e.target.value.split('\n').map(l => l.trimStart()).filter(Boolean) })} /></label>
        <div className="review-grid">
          <label>Modalidad de candidatura<em className="muted" style={{ fontSize: 11 }}>Publicar exige que no quede «sin determinar»</em>
            <select value={draft.application_type} onChange={e => setDraft({ ...draft, application_type: e.target.value })}>
              {Object.entries(APPLICATION).map(([v, label]) => <option key={v} value={v}>{label}</option>)}
            </select></label>
          <label>Enlace de candidatura<input value={draft.application_url ?? ''} onChange={e => setDraft({ ...draft, application_url: e.target.value || null })} /></label>
        </div>
        {detail.job_snapshot.source_url && <p className="muted" style={{ fontSize: 12 }}>Anuncio original: <a href={detail.job_snapshot.source_url} target="_blank" rel="noopener noreferrer">{detail.job_snapshot.source_url.slice(0, 70)}… <ExternalLink size={12} /></a></p>}
        <div className="detail-actions" style={{ flexWrap: 'wrap' }}>
          <button disabled={verifying} onClick={() => void verify()} title="Un GET acotado a la URL del anuncio: activa solo con contenido corroborante; guardado con evidencia y TTL por fuente"><RefreshCcw size={15} />{verifying ? 'Verificando…' : 'Verificar vigencia'}</button>
          <button disabled={saving} onClick={() => submit('needs_review')}><Send size={14} /> Guardar como a revisar</button>
          <button disabled={saving} onClick={() => submit('draft')}>Guardar borrador</button>
          <button className="primary" disabled={saving} onClick={() => submit('approved')}><Check size={15} /> Aprobar</button>
          <button disabled={saving} onClick={() => submit('published')}>Publicar</button>
          {detail.editorial_status === 'published' && <button disabled={saving} onClick={() => submit('withdrawn')}>Retirar</button>}
        </div>
        <p className="muted" style={{ fontSize: 12 }}>Caracteres por límite: los campos llegan tal cual al engine y sus guardas validan el vocabulario y la vigencia; errores visibles arriba.</p>
      </div>}
    </dialog>
  </section>;
}
