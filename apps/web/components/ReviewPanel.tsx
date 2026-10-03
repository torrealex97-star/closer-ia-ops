'use client';
import { useEffect, useMemo, useState } from 'react';
import { Check, ChevronRight, ExternalLink, Eye, FileWarning, LoaderCircle, RefreshCcw, Send, ShieldCheck, X } from 'lucide-react';
import { request } from './client';

// Estados y vocabulario espejo de career/domain.py: nunca se inventa un estado.
const EDITORIAL: Record<string, string> = { draft: 'Borrador', needs_review: 'A revisar', approved: 'Aprobada', published: 'Publicada', withdrawn: 'Retirada' };
const ACTIVITY: Record<string, string> = { active: 'Activa', verifying: 'Verificando', closed: 'Cerrada' };
const CONNECTION: Record<string, string> = { direct_partner: 'Socio directo', direct_recruiter: 'Reclutador directo', direct_company: 'Empresa directa', external_application: 'Candidatura externa', marketplace_application: 'Marketplace', community_opportunity: 'Comunidad' };
const APPLICATION: Record<string, string> = { company_ats: 'ATS de la empresa', external_platform: 'Plataforma externa', marketplace: 'Marketplace', wdc_referral: 'Referida WDC', email: 'Email', contact_form: 'Formulario de contacto', community_contact: 'Contacto de comunidad', unknown: 'Sin determinar' };
const ROLES = ['closer', 'setter', 'cold_caller', 'account_executive', 'sdr'];
const ROLE_LABEL: Record<string, string> = { closer: 'Closer', setter: 'Setter', cold_caller: 'Cold Caller', account_executive: 'Ejecutivo comercial', sdr: 'SDR / BDR' };
const UNSPECIFIED = 'No especificado';
const FILTERS = ['', 'draft', 'needs_review', 'approved', 'published', 'withdrawn'] as const;

type NextStep = { action: string; label: string; destination_label?: string; destination_domain?: string | null; requires_account?: boolean | null; enabled: boolean; disabled_reason?: string };
type Payload = {
  headline: string; role: string; short_summary: string;
  what_they_are_looking_for: string[]; what_you_would_do: string[]; why_it_may_be_interesting: string[];
  compensation_summary: string; location_summary: string; experience_summary: string;
  language_requirements: string[]; application_type: string; application_url: string | null;
  next_step: NextStep; field_provenance?: Record<string, string>;
  selection_method?: 'human' | 'deterministic_rule'; selection_policy_version?: string;
};
type Item = {
  id: string; job_id: string; version: number | null;
  editorial_status: keyof typeof EDITORIAL; opportunity_status: keyof typeof ACTIVITY;
  status_reason: string | null; connection_type: keyof typeof CONNECTION; locale: string;
  last_verified_at: string | null; verified_until: string | null;
  version_payload: Payload; eligibility: { employer_country: string | null; customer_markets: string[]; allowed_worker_countries: string[]; excluded_worker_countries: string[]; residency_required: boolean | null; work_authorization_requirements: string | null; timezone_overlap: string | null; backfilled: boolean };
  job_snapshot: { title?: string | null; company?: string | null; description?: string | null; source_url?: string | null; locations?: string[]; published_at?: string | null; source?: string | null };
};
type Detail = Item & { job_snapshot: Item['job_snapshot'] & { description: string } };
// Veredicto de verificación espejo de career/domain.py (result de verification_events).
type Verification = { result: 'open' | 'closed' | 'unknown'; method: string; checked_at: string; valid_until: string | null; reason_code: string; evidence_raw_id: string | null; opportunity_status: string; next_step_enabled: boolean; status_reason: string | null };
const VERDICT: Record<string, string> = { open: 'Activa en el origen', closed: 'Cerrada en el origen', unknown: 'No verificable ahora' };

const date = (value?: string | null) => value ? new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short' }).format(new Date(value)) : '—';
const tag = (status: string) => ({ draft: 'source-tag', needs_review: 'review-tag', approved: 'source-tag ok', published: 'source-tag ok', withdrawn: 'source-tag' }[status] || 'source-tag');

export default function ReviewPanel() {
  const [items, setItems] = useState<Item[]>([]);
  const [total, setTotal] = useState(0);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('');
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [detail, setDetail] = useState<Detail | null>(null);
  const [saving, setSaving] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [verification, setVerification] = useState<Verification | null>(null);

  function refresh(status: (typeof FILTERS)[number] = filter) {
    setBusy(true);
    fetch(`/api/backend/wdc/opportunities${status ? `?editorial_status=${status}` : ''}`)
      .then(r => { if (!r.ok) throw new Error('No se pudo cargar el listado'); return r.json(); })
      .then((d: { items: Item[]; total: number }) => { setItems(d.items); setTotal(d.total); setError(''); })
      .catch(e => setError((e as Error).message))
      .finally(() => setBusy(false));
  }
  useEffect(() => { refresh(filter); /* eslint-disable-line react-hooks/exhaustive-deps */ }, [filter]);
  useEffect(() => { if (!notice) return; const t = setTimeout(() => setNotice(''), 4000); return () => clearTimeout(t); }, [notice]);

  async function open(item: Item) {
    setError('');
    setVerification(null);
    try { setDetail(await request<Detail>(`wdc/opportunities/${item.id}`, undefined, 'GET')); }
    catch (e) { setError((e as Error).message); }
  }

  async function verify() {
    if (!detail) return;
    setVerifying(true); setError('');
    try {
      const outcome = await request<Verification>(`wdc/opportunities/${detail.id}/verify`, {});
      setVerification(outcome);
      // El estado de vigencia vive en la fila opportunities: reflejarlo sin recargar todo.
      setDetail(await request<Detail>(`wdc/opportunities/${detail.id}`, undefined, 'GET'));
      refresh(filter);
    } catch (e) { setError((e as Error).message); }
    finally { setVerifying(false); }
  }

  async function submit(status: Item['editorial_status']) {
    if (!detail) return;
    setSaving(true); setError('');
    try {
      await request(`wdc/opportunities/${detail.id}/review`, {
        editorial_status: status, locale: detail.locale, reviewed_by: 'admin-local',
        version_payload: detail.version_payload,
      });
      setNotice(status === 'withdrawn' ? 'Oportunidad retirada.' : status === 'needs_review' ? 'Guardada como a revisar.' : status === 'approved' ? 'Oportunidad aprobada.' : 'Revisión guardada.');
      setDetail(null);
      refresh(filter);
    } catch (e) { setError((e as Error).message); }
    finally { setSaving(false); }
  }

  return <section aria-label="Revisión editorial">
    {error && <div className="alert error" role="alert">{error}</div>}
    {notice && <div className="toast" role="status"><Check size={16} />{notice}</div>}
    <div className="run-progress classification-summary">
      <strong>Revisión editorial <span className="muted">· {total} oportunidades totales</span></strong>
      <span className="muted">Aprobar o publicar es siempre una decisión humana; el borrador nunca se publica solo.</span>
      <div className="source-actions">
        <label className="result-search" style={{ maxWidth: 200 }}><select aria-label="Filtrar por estado editorial" value={filter} onChange={e => setFilter(e.target.value as typeof filter)}>
          {FILTERS.map(f => <option key={f} value={f}>{f ? EDITORIAL[f] : 'Todos los estados'}</option>)}
        </select></label>
        <button disabled={busy} onClick={() => refresh()}><RefreshCcw size={15} /> Actualizar</button>
      </div>
    </div>
    {busy && <p className="muted"><LoaderCircle size={14} className="spin" /> Cargando…</p>}
    {!busy && !items.length ? <div className="empty"><Eye size={32} strokeWidth={1.3} /><h3>Nada que revisar con este filtro.</h3><p>Cada oferta importada llega aquí como borrador literal del anuncio original, sin textos inventados.</p></div> :
      !busy && <div className="job-list">{items.map(item => <article className="job-row" key={item.id}>
        <div className="company-monogram" aria-hidden="true">{(item.job_snapshot.company || '??').slice(0, 2).toUpperCase()}</div>
        <div className="job-info">
          <div className="job-company">{item.job_snapshot.company} <span>· v{item.version} · {item.job_snapshot.source}</span></div>
          <button className="job-title" onClick={() => open(item)}>{item.version_payload.headline}<ChevronRight size={16} /></button>
          <div className="job-signals">
            <span className={tag(item.editorial_status)}>{EDITORIAL[item.editorial_status]}</span>
            <span className="source-tag">{ACTIVITY[item.opportunity_status]}</span>
            <span className="source-tag">{CONNECTION[item.connection_type]}</span>
            {item.version_payload.short_summary && <span className="source-tag family">Resumen editado</span>}
          </div>
        </div>
      </article>)}</div>}
    <dialog open={!!detail} aria-label="Revisar oportunidad" style={{ width: 'min(920px, 94vw)' }}>
      {detail && <div className="detail">
        <div className="detail-top"><span className="eyebrow">REVISIÓN EDITORIAL · v{detail.version}</span>
          <button className="icon-button" aria-label="Cerrar revisión" onClick={() => setDetail(null)}><X size={20} /></button></div>
        <p className="job-company">{detail.job_snapshot.company} · {ACTIVITY[detail.opportunity_status]} · {CONNECTION[detail.connection_type]}</p>
        <h2>{detail.version_payload.headline}</h2>
        <div className="detail-signals">
          <h3><FileWarning size={16} /> Trazabilidad del borrador</h3>
          <p className="muted" style={{ fontSize: 12 }}>Título y resumen heredan el anuncio original; la elegibilidad está rellenada con señales literales (bandera backfilled). Verificado: {date(detail.last_verified_at)} · vigente hasta: {date(detail.verified_until)}{detail.status_reason ? ` · ${detail.status_reason}` : ''}</p>
          <p style={{ fontSize: 13 }}><strong>Elegibilidad (hechos, no suposiciones):</strong> país del empleador: {detail.eligibility.employer_country || 'desconocido'} · residencia exigida: {detail.eligibility.residency_required === null ? 'desconocida' : detail.eligibility.residency_required ? 'sí' : 'no'} · autorización de trabajo: {detail.eligibility.work_authorization_requirements || 'desconocida'}</p>
        </div>
        <label>Título (headline)<input maxLength={180} value={detail.version_payload.headline} onChange={e => setDetail({ ...detail, version_payload: { ...detail.version_payload, headline: e.target.value } })} /></label>
        <label>Rol<em className="muted" style={{ fontSize: 11 }}>Solo el vocabulario canónico pasa las guardas del backend</em>
          <select value={ROLES.includes(detail.version_payload.role) ? detail.version_payload.role : ''} onChange={e => setDetail({ ...detail, version_payload: { ...detail.version_payload, role: e.target.value || detail.version_payload.role } })}>
            <option value="">Título original ({detail.version_payload.role})</option>
            {ROLES.map(r => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
          </select></label>
        <label>Resumen corto<textarea rows={3} maxLength={500} placeholder={`Ahora: ${detail.version_payload.short_summary || 'vacío (título literal)'}`} value={detail.version_payload.short_summary} onChange={e => setDetail({ ...detail, version_payload: { ...detail.version_payload, short_summary: e.target.value } })} /></label>
        <div className="review-grid">
          <label>Compensación<textarea rows={2} maxLength={200} value={detail.version_payload.compensation_summary} onChange={e => setDetail({ ...detail, version_payload: { ...detail.version_payload, compensation_summary: e.target.value } })} /></label>
          <label>Ubicación<textarea rows={2} maxLength={200} value={detail.version_payload.location_summary} onChange={e => setDetail({ ...detail, version_payload: { ...detail.version_payload, location_summary: e.target.value } })} /></label>
        </div>
        <label>Por qué puede interesar (una línea por punto)<textarea rows={3} value={detail.version_payload.why_it_may_be_interesting.join('\n')} onChange={e => setDetail({ ...detail, version_payload: { ...detail.version_payload, why_it_may_be_interesting: e.target.value.split('\n').map(l => l.trimStart()).filter(Boolean) } })} /></label>
        <div className="review-grid">
          <label>Modalidad de candidatura<em className="muted" style={{ fontSize: 11 }}>Publicar exige que no quede «sin determinar»</em>
            <select value={detail.version_payload.application_type} onChange={e => setDetail({ ...detail, version_payload: { ...detail.version_payload, application_type: e.target.value } })}>
              {Object.entries(APPLICATION).map(([v, label]) => <option key={v} value={v}>{label}</option>)}
            </select></label>
          <label>Enlace de candidatura<input value={detail.version_payload.application_url || ''} onChange={e => setDetail({ ...detail, version_payload: { ...detail.version_payload, application_url: e.target.value || null } })} /></label>
        </div>
        {detail.job_snapshot.source_url && <p className="muted" style={{ fontSize: 12 }}>Anuncio original: <a href={detail.job_snapshot.source_url} target="_blank" rel="noopener noreferrer">{detail.job_snapshot.source_url.slice(0, 70)}… <ExternalLink size={12} /></a></p>}
        <div className="detail-actions" style={{ flexWrap: 'wrap', alignItems: 'center' }}>
          <button disabled={verifying} onClick={verify} title="Comprueba la URL del anuncio y guarda evidencia con vigencia por fuente">
            {verifying ? <LoaderCircle size={14} className="spin" /> : <ShieldCheck size={14} />} Verificar vigencia
          </button>
          {verification && <span className="source-tag" data-verification={verification.result}>
            {VERDICT[verification.result]} · {verification.reason_code}
            {verification.result === 'open' && verification.valid_until ? ` · vigente hasta ${date(verification.valid_until)}` : ''}
          </span>}
        </div>
        <p className="muted" style={{ fontSize: 12 }}>Vista previa de alumna: <strong>{detail.editorial_status === 'approved' || detail.editorial_status === 'published' ? 'disponible' : 'no disponible hasta aprobar'}</strong> (el backend la sirve solo para aprobadas/publicadas).</p>
        <div className="detail-actions" style={{ flexWrap: 'wrap' }}>
          <button disabled={saving} onClick={() => submit('needs_review')}><Send size={14} /> Guardar como a revisar</button>
          <button disabled={saving} onClick={() => submit('draft')}>Guardar borrador</button>
          <button className="primary" disabled={saving} onClick={() => submit('approved')}><Check size={15} /> Aprobar</button>
          <button disabled={saving} onClick={() => submit('published')}>Publicar</button>
          {detail.editorial_status === 'published' && <button disabled={saving} onClick={() => submit('withdrawn')}>Retirar</button>}
        </div>
      </div>}
    </dialog>
  </section>;
}
