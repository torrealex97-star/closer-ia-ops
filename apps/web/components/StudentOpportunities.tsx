'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowUpRight, Bookmark, BriefcaseBusiness, ChevronRight, Compass, Globe2, GraduationCap, HeartHandshake, LoaderCircle, MessageSquare, Search, TrendingUp, X } from 'lucide-react';
import OpportunityRadar from './OpportunityRadar';
import StudentPractice from './StudentPractice';
import StudentProgress from './StudentProgress';
import StudentTraining from './StudentTraining';
import { hasPay } from './offerFacts';
import { parsePhrase } from './queryFromPhrase';
import { request } from './client';
import type { components } from '../../../packages/contracts/api';

type Offer = components['schemas']['Opportunity'];
type Query = components['schemas']['OpportunityQuery'];
// `degraded` solo lo añade el proxy web cuando el motor no responde y sirve las
// externas aprobadas a solas: no forma parte del contrato del motor.
type Results = components['schemas']['OpportunityList'] & { degraded?: 'motor' };
const defaults: Query = { role: null, market: 'any', days: 10, include_bilingual: false, starred_only: false, include_extra_roles: false };
const ROLES = ['closer', 'setter', 'cold_caller', 'account_executive', 'sdr'] as const;
const ROLE_LABELS: Record<NonNullable<Query['role']>, string> = { closer: 'las del perfil Closer', setter: 'las del perfil Setter', cold_caller: 'las del perfil Cold Caller', account_executive: 'las de Ejecutivo comercial', sdr: 'las de SDR / BDR' };
function label(role: NonNullable<Query['role']>): string { return ROLE_LABELS[role]; }
const MARKETS = ['any', 'ES', 'EU', 'LATAM', 'US'] as const;
// La alumna conserva su contexto: los filtros aplicados viven en la URL (compartible/recargable),
// validados contra las opciones reales del desplegable para no inventar estados.
function queryFromUrl(): Query | null {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  if (![...params.keys()].length) return null;
  const role = params.get('role') ?? '';
  const market = params.get('market') ?? 'any';
  const days = Number(params.get('days'));
  return {
    role: ROLES.includes(role as typeof ROLES[number]) ? role as Query['role'] : null,
    market: MARKETS.includes(market as typeof MARKETS[number]) ? market as Query['market'] : 'any',
    days: [1, 3, 7, 10].includes(days) ? days : 10,
    include_bilingual: params.get('bilingual') === '1',
    starred_only: false,
    include_extra_roles: true,
  };
}
function urlFromQuery(query: Query): string {
  const params = new URLSearchParams();
  if (query.role) params.set('role', query.role);
  if (query.market !== 'any') params.set('market', query.market);
  if (query.days !== 10) params.set('days', String(query.days));
  if (query.include_bilingual) params.set('bilingual', '1');
  const qs = params.toString();
  return qs ? `?${qs}` : window.location.pathname;
}

const date = (value: string | null) => value ? new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short' }).format(new Date(value)) : 'Fecha no indicada';
const rank = (offer: Offer) => offer.is_selected && offer.excellence_rank && offer.excellence_rank <= 3 ? String(offer.excellence_rank) : '';
// El titular de la tarjeta es el PUESTO que anuncia la empresa, no la familia de rol:
// 'Teleoperador comercial (H/M/X)' dice qué buscan; 'Setter' solo dice cómo lo clasificamos.
const jobTitle = (offer: Offer) => (offer.original_title ?? '').trim() || 'Puesto no especificado en el anuncio';
const initials = (company: string) => company.slice(0, 2).toUpperCase();
// Dominio que se enseña junto al botón de aplicar: dice a dónde va antes de pulsar.
const hostOf = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return 'el anuncio'; } };
const applyTo = (offer: Offer) => offer.apply_url || offer.source_url;
function PayBlock({ offer }: { offer: Offer }) {
  return <div className={`opportunity-pay ${hasPay(offer) ? '' : 'is-unpublished'}`}>
    <span>{hasPay(offer) ? 'COMPENSACIÓN PUBLICADA' : 'COMPENSACIÓN'}</span>
    <p className="pay-value">{hasPay(offer) ? offer.compensation : 'La empresa no publica importe'}</p>
    <p>{offer.compensation_note}</p>
  </div>;
}

// WDC student: compare companies and conditions, then choose her next step.
// Existing paper/terracotta tokens, quiet borders, 24px cards; pay is the focal fact.
export default function StudentOpportunities({ hosted = false }: { hosted?: boolean }) {
  const [query, setQuery] = useState<Query>(defaults);
  const [applied, setApplied] = useState<Query>(defaults);
  const [items, setItems] = useState<Offer[]>([]);
  const [wider, setWider] = useState<Offer[] | null>(null); // hueco ampliado cuando el filtro estrecho devuelve <10
  const [selectionTotal, setSelectionTotal] = useState(0);
  const [saved, setSaved] = useState(false);
  const [practice, setPractice] = useState(false);
  const [training, setTraining] = useState(false);
  const [progress, setProgress] = useState(false);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [degraded, setDegraded] = useState(false);
  const [detail, setDetail] = useState<Offer | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [phrase, setPhrase] = useState('');
  const [phraseNote, setPhraseNote] = useState('');
  // Modo hospedado: guardar es un marcador de ESTE navegador (fix audit run-1
  // finding 2 — sin credencial individual todavía, la vista alumna no muta el
  // catálogo compartido del operador). El motor admin mantiene su marcador propio.
  const [localSaves, setLocalSaves] = useState<string[]>([]);
  const sequence = useRef(0);
  const dialog = useRef<HTMLDialogElement>(null);
  // Tras el montaje (nunca durante la hidratación): la URL restaura el contexto de la alumna.
  useEffect(() => {
    const fromUrl = queryFromUrl();
    if (fromUrl) { setQuery(fromUrl); setApplied(fromUrl); }
    // Enlaces directos del panel de la alumna: /?tab=formacion y /?tab=practica.
    const tab = new URLSearchParams(window.location.search).get('tab');
    if (tab === 'formacion') setTraining(true);
    else if (tab === 'practica') setPractice(true);
  }, []);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const stored = JSON.parse(window.localStorage.getItem('wdc_saved_offers') ?? '[]');
      if (Array.isArray(stored)) setLocalSaves(stored.filter((id): id is string => typeof id === 'string'));
    } catch { /* marcador corrupto: sin guardadas, nunca se rompe la vista */ }
  }, []);
  useEffect(() => {
    let stopped = false;
    const id = ++sequence.current;
    setBusy(true); setError(''); setWider(null); setDegraded(false);
    // Hosted: Guardadas son las marcadas en Este navegador (filtrado en cliente);
    // el marcador starred_only del engine queda como curación del operador.
    request<Results>('opportunities/search', saved ? (hosted ? { role: null, market: 'any', days: 10, include_bilingual: true, starred_only: false, include_extra_roles: true } : { role: null, market: 'any', days: 10, include_bilingual: true, starred_only: true, include_extra_roles: true }) : applied)
      .then(result => {
        if (!stopped && sequence.current === id) { setItems(result.items); setSelectionTotal(result.selection_total ?? 0); setDegraded(result.degraded === 'motor'); }
        // Filtro estrecho con pocas ofertas: presentamos también el hueco más amplio
        // (mismo mercado y días, sin filtro de rol) rotulado como tal, con los mismos
        // datos reales del motor — la alumna compara sin creer que el catálogo se vació.
        if (!stopped && !saved && result.items.length < 10 && (applied.role || applied.market !== 'any')) {
          return new Promise<Results>((resolve, reject) => {
            request<Results>('opportunities/search', { ...applied, role: null, starred_only: false, include_bilingual: true })
              .then(resolve, reject);
          }).then(widerResult => {
            if (stopped || sequence.current !== id) return null;
            const seen = new Set(result.items.map(item => item.id));
            setWider(widerResult.items.filter(item => !seen.has(item.id)).slice(0, Math.max(0, 20 - result.items.length)));
            return null;
          });
        }
        return null;
      })
      .catch(e => { if (!stopped) setError(e.message); })
      .finally(() => { if (!stopped) setBusy(false); });
    return () => { stopped = true; };
  }, [applied, saved, hosted]);
  useEffect(() => {
    if (detail && dialog.current && !dialog.current.open) dialog.current.showModal();
  }, [detail]);
  // Una sola puerta de aplicación: formulario, frase y radar escriben el mismo estado real.
  function applyQuery(next: Query) {
    setQuery(next); setApplied(next);
    history.replaceState(null, '', urlFromQuery(next));
  }
  // Traducción determinista de la frase a filtros del catálogo: si no entiende, lo dice.
  function applyPhrase(event: FormEvent) {
    event.preventDefault();
    const result = parsePhrase(phrase, query);
    if (result.saved) { setPhrase(''); setPhraseNote('He abierto tus guardadas.'); setSaved(true); return; }
    if (!result.matched.length) {
      setPhraseNote(result.unsupported.length
        ? `No puedo filtrar por ${result.unsupported.join(' ni por ')}.`
        : 'No he reconocido ningún filtro. Prueba: «closer en España», «setter esta semana», «SDR en LATAM», «bilingüe», «guardadas».');
      return;
    }
    applyQuery(result.query);
    setPhraseNote(`He aplicado ${result.matched.join(' · ')}.` + (result.unsupported.length ? ` No filtro por ${result.unsupported.join(' ni por ')}.` : ''));
  }
  const isStarred = (offer: Offer) => hosted ? localSaves.includes(offer.id) : offer.starred;
  async function star(offer: Offer) {
    setSaving(offer.id); setError('');
    try {
      if (hosted) {
        // Marcador local de la alumna: persiste en SU navegador y nunca toca el engine.
        const next = localSaves.includes(offer.id) ? localSaves.filter(id => id !== offer.id) : [...localSaves, offer.id];
        localStorage.setItem('wdc_saved_offers', JSON.stringify(next));
        setLocalSaves(next);
        const after = (item: Offer): Offer => ({ ...item, starred: next.includes(item.id) });
        setItems(old => old.map(after).filter(item => !saved || next.includes(item.id)));
        setDetail(old => old ? { ...old, starred: next.includes(old.id) } : old);
      } else {
        await request(`jobs/${offer.id}/star`, { starred: !offer.starred }, 'PATCH');
        setItems(old => old.map(item => item.id === offer.id ? { ...item, starred: !item.starred } : item).filter(item => !saved || item.starred));
        setDetail(old => old?.id === offer.id ? { ...old, starred: !old.starred } : old);
      }
    } catch (e) { setError((e as Error).message); }
    finally { setSaving(null); }
  }
  // Guardadas en modo hospedado: el marcador vive en este navegador.
  const visible = saved && hosted ? items.filter(isStarred) : items;
  return <div className="shell student-shell">
    <aside className="sidebar">
      <a className="brand" href="/" aria-label="WDC · Inicio"><span className="brand-mark">w.</span><span>Women Digital<br /><strong>Closer</strong></span></a>
      <div className="workspace-label">TU SIGUIENTE PASO</div>
      <nav aria-label="Navegación principal"><button className={`nav ${!saved && !practice && !training && !progress ? 'active' : ''}`} onClick={() => { setSaved(false); setPractice(false); setTraining(false); setProgress(false); }}><Compass size={18} />Oportunidades</button><button className={`nav ${saved && !practice && !training ? 'active' : ''}`} onClick={() => { setSaved(true); setPractice(false); setTraining(false); setProgress(false); }}><Bookmark size={18} />Guardadas</button><button className={`nav ${practice ? 'active' : ''}`} onClick={() => { setPractice(true); setSaved(false); setTraining(false); setProgress(false); }}><MessageSquare size={18} />Sala de práctica</button><button className={`nav ${training ? 'active' : ''}`} onClick={() => { setTraining(true); setSaved(false); setPractice(false); setProgress(false); }}><GraduationCap size={18} />Formación</button><button className={`nav ${progress ? 'active' : ''}`} onClick={() => { setProgress(true); setSaved(false); setPractice(false); setTraining(false); }}><TrendingUp size={18} />Mi progreso</button></nav>
      <div className="sidebar-note"><span className="eyebrow">TU TALENTO.<br />TU PRÓXIMA EMPRESA.</span><p>Has trabajado para llegar hasta aquí. Ahora elige dónde quieres dar tu siguiente paso.</p></div>
      <div className="local-user"><HeartHandshake size={22} /><div><strong>Comunidad WDC</strong><small>Te acompañamos en el camino</small></div></div>
    </aside>
    <div className="main-shell">
      <header className="topbar"><div>Women Digital Closer <ChevronRight size={14} /><strong>{saved ? 'Tus guardadas' : practice ? 'Sala de práctica' : training ? 'Formación' : progress ? 'Tu progreso' : 'Oportunidades'}</strong></div><span className="student-tag">De la formación a tu próximo trabajo</span></header>
      <main>
        {progress ? <StudentProgress /> : training ? <StudentTraining /> : practice ? <StudentPractice /> : <>
        <div className="page-heading"><div><span className="eyebrow">EMPRESAS QUE BUSCAN TALENTO COMERCIAL</span><h1>{saved ? 'Las que te interesan.' : 'Elige tu próxima oportunidad.'}</h1><p>{saved ? 'Vuelve a comparar sus condiciones y decide tu siguiente paso.' : 'WDC reúne oportunidades en español para que encuentres dónde quieres crecer.'}</p></div><span className="heading-icon"><Compass size={30} strokeWidth={1.2} /></span></div>
        {!saved && <div className="search-panel student-search">
          <form className="phrase-search" onSubmit={applyPhrase}>
            <label htmlFor="student-phrase">Pídelo en una frase<input id="student-phrase" value={phrase} onChange={e => { setPhrase(e.target.value); setPhraseNote(''); }} placeholder="closer en España de esta semana" autoComplete="off" /></label>
            <button type="submit" className="primary">Buscar</button>
          </form>
          {phraseNote && <p className="phrase-note" role="status">{phraseNote}</p>}
          <form onSubmit={e => { e.preventDefault(); setApplied({ ...query }); history.replaceState(null, '', urlFromQuery(query)); setPhraseNote(''); }}>
          <div className="search-grid"><label>Perfil profesional<select value={query.role || ''} onChange={e => setQuery({ ...query, role: (e.target.value || null) as Query['role'] })}><option value="">Todos los perfiles</option><option value="closer">Closer</option><option value="setter">Setter</option><option value="cold_caller">Cold Caller</option><option value="account_executive">Ejecutivo comercial</option><option value="sdr">SDR / BDR</option></select></label><label>Desde dónde quieres trabajar<select value={query.market} onChange={e => setQuery({ ...query, market: e.target.value as Query['market'] })}><option value="any">Todos los mercados</option><option value="ES">España</option><option value="EU">Europa</option><option value="LATAM">Latinoamérica</option><option value="US">Estados Unidos</option></select></label><label>Publicación<select value={query.days} onChange={e => setQuery({ ...query, days: Number(e.target.value) })}><option value={1}>Últimas 24 horas</option><option value={3}>Últimos 3 días</option><option value={7}>Últimos 7 días</option><option value={10}>Últimos 10 días</option></select></label><button className="primary" disabled={busy}>{busy ? <LoaderCircle className="spin" size={17} /> : <Search size={17} />}Ver oportunidades</button></div>
          <div className="student-preferences"><span>En español · remoto o híbrido</span><label className="check-label"><input type="checkbox" checked={query.include_bilingual} onChange={e => setQuery({ ...query, include_bilingual: e.target.checked })} />También oportunidades bilingües español / inglés</label></div>
          </form>
        </div>}
        {error && <p className="alert error" role="alert">{error}</p>}
        {degraded && !busy && <p className="selection-note" role="status">El catálogo general no responde ahora mismo. Estas son las ofertas externas ya revisadas y aprobadas; el resto volverá cuando el buscador se recupere.</p>}
        {!saved && <OpportunityRadar offers={[...visible, ...(wider ?? [])]} busy={busy} role={applied.role ?? null} onRole={next => applyQuery({ ...applied, role: next })} />}
        <section className="student-results" aria-busy={busy}><div className="results-heading"><h2>{saved ? 'Tus oportunidades guardadas' : 'Oportunidades para explorar'} <span>{busy ? '…' : visible.length + (wider?.length ?? 0)}</span></h2><span className="student-freshness">Actualización diaria</span></div>
          {!saved && !busy && selectionTotal > 0 && <p className="selection-note">Selección del día: las {selectionTotal} que mejor cumplen los requisitos van primero. Puedes explorar el resto del catálogo debajo.</p>}
          {busy ? <div className="opportunity-grid" aria-hidden="true"><div className="opportunity-card is-skeleton"><span className="shimmer-line wide" /><span className="shimmer-line" /><span className="shimmer-line" /><span className="shimmer-line short" /></div><div className="opportunity-card is-skeleton is-late"><span className="shimmer-line wide" /><span className="shimmer-line" /><span className="shimmer-line" /><span className="shimmer-line short" /></div></div> : !visible.length ? <div className="empty"><Compass size={32} strokeWidth={1.3} /><h3>{saved ? 'Guarda las que te hagan dar el siguiente paso.' : 'Aún no hay oportunidades con estos criterios.'}</h3><p>{saved ? 'Pulsa el marcador de una oferta para volver a verla aquí.' : 'Puedes elegir otro perfil o mercado. Seguimos buscando nuevas oportunidades en español.'}</p></div> :          <div className="opportunity-grid">{visible.map((offer, index) => <article className="opportunity-card" key={offer.id} style={{ animationDelay: `${Math.min(index, 10) * 30}ms` }}>
            <div className="opportunity-company"><div className="company-monogram" aria-hidden="true">{initials(offer.company)}</div><div><p>{offer.company}</p><span className="role-chip">{offer.role_label}</span>{offer.is_selected && <em className="pick-badge">Selección del día{rank(offer) ? ` · Nº ${rank(offer)}` : ''}</em>}</div><button className={`icon-button ${isStarred(offer) ? 'is-starred' : ''}`} disabled={saving === offer.id} aria-label={`${isStarred(offer) ? 'Quitar de guardadas' : 'Guardar'} ${jobTitle(offer)} · ${offer.company}`} onClick={() => void star(offer)}><Bookmark size={19} fill={isStarred(offer) ? 'currentColor' : 'none'} /></button></div>
            <h3 className="opportunity-title">{jobTitle(offer)}</h3>
            <PayBlock offer={offer} />
            <dl className="opportunity-facts"><div><dt>Modalidad y ubicación</dt><dd><Globe2 size={14} />{offer.modality} · {offer.location}</dd></div><div><dt>Idioma</dt><dd>{offer.language}</dd></div><div><dt>Jornada</dt><dd>{offer.schedule}</dd></div><div><dt>Experiencia</dt><dd>{offer.experience}</dd></div><div><dt>Contrato</dt><dd>{offer.contract}</dd></div></dl>
            <div className="opportunity-footer"><div><small>Publicada: {date(offer.published_at)}</small><a href={offer.source_url} target="_blank" rel="noopener noreferrer">Publicado en {offer.source_name}</a><a className="link-button" style={{ padding: 0, marginTop: 4 }} href={applyTo(offer)} target="_blank" rel="noopener noreferrer">Aplicar en {hostOf(applyTo(offer))}<ArrowUpRight size={12} /></a></div><button className="primary" onClick={() => setDetail(offer)}>Ver oportunidad<ArrowUpRight size={16} /></button></div>
          </article>)}</div>}
          {!saved && !busy && wider?.length ? <div className="wider-bucket">
            <h3>{items.length} con tu filtro · {wider.length} más del catálogo {applied.market !== 'any' ? 'con tu mercado' : 'comercial en español'}</h3>
            <p>Con tu filtro de perfil no aparecían suficientes {applied.role ? `ofertas de ${label(applied.role)}` : 'ofertas en tu mercado'}; estas vienen del mismo catálogo real con el filtro ampliado.</p>
            <div className="opportunity-grid">{wider.map(offer => <article className="opportunity-card" key={offer.id}>
              <div className="opportunity-company"><div className="company-monogram" aria-hidden="true">{initials(offer.company)}</div><div><p>{offer.company}</p><span className="role-chip">{offer.role_label}</span></div><button className={`icon-button ${isStarred(offer) ? 'is-starred' : ''}`} disabled={saving === offer.id} aria-label={`${isStarred(offer) ? 'Quitar de guardadas' : 'Guardar'} ${jobTitle(offer)} · ${offer.company}`} onClick={() => void star(offer)}><Bookmark size={19} fill={isStarred(offer) ? 'currentColor' : 'none'} /></button></div>
              <h3 className="opportunity-title is-compact">{jobTitle(offer)}</h3>
              <p className="opportunity-place"><Globe2 size={13} />{offer.modality} · {offer.location} · {offer.language}</p>
              <PayBlock offer={offer} />
              <div className="opportunity-footer"><button className="primary" onClick={() => setDetail(offer)}>Ver oportunidad<ArrowUpRight size={16} /></button></div>
            </article>)}</div>
          </div> : null}
        </section>
        <p className="footnote"><BriefcaseBusiness size={14} />Tú eliges dónde avanzar. Revisa las condiciones y presenta tu candidatura en el proceso de la empresa.</p>
        </>}
      </main>
    </div>
    <dialog ref={dialog} onClose={() => setDetail(null)} onClick={e => { if (e.target === dialog.current) dialog.current.close(); }}>{detail && <div className="detail"><div className="detail-top"><span className="eyebrow">TU SIGUIENTE PASO</span><button className="icon-button" aria-label="Cerrar oportunidad" onClick={() => dialog.current?.close()}><X size={20} /></button></div><p className="job-company">{detail.company}</p><h2>{jobTitle(detail)}</h2><p className="role-chip detail-role">{detail.role_label}</p><PayBlock offer={detail} /><p>{detail.modality} · {detail.location} · {detail.language}</p><h3>Lo que cuenta la empresa</h3><div className="description">{detail.description}</div><div className="provenance"><span>Publicada: {date(detail.published_at)}</span><span>Publicación de {detail.source_name}. Confirma que el proceso siga abierto antes de enviar tu candidatura.</span></div><div className="detail-actions"><a className="primary" href={applyTo(detail)} target="_blank" rel="noopener noreferrer">Aplicar en {hostOf(applyTo(detail))}<ArrowUpRight size={16} /></a>{detail.company_url && <a className="link-button" href={detail.company_url} target="_blank" rel="noopener noreferrer">Web publicada en el anuncio ({hostOf(detail.company_url)})<ArrowUpRight size={14} /></a>}<button disabled={saving === detail.id} onClick={() => void star(detail)}><Bookmark size={16} />{isStarred(detail) ? 'Quitar de guardadas' : 'Guardar oportunidad'}</button></div>{(detail.contact?.emails?.length || detail.contact?.phones?.length) ? <div className="contact-published"><h3>Contacto publicado en el anuncio</h3>{!!detail.contact?.emails?.length && <p>Email: {detail.contact.emails.join(' · ')}</p>}{!!detail.contact?.phones?.length && <p>Teléfono: {detail.contact.phones.join(' · ')}</p>}<p className="inline-hint">Tal como lo publica la empresa en el anuncio. WDC no lo completa ni lo verifica.</p></div> : null}<p className="inline-hint">Abrir el enlace no envía tu candidatura: se envía en el portal o en la web de la empresa.</p></div>}</dialog>
  </div>;
}
