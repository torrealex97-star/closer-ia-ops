'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Bookmark, BriefcaseBusiness, ChevronRight, Compass, Globe2, HeartHandshake, LoaderCircle, Search, X } from 'lucide-react';
import { request } from './client';
import type { components } from '../../../packages/contracts/api';

type Offer = components['schemas']['Opportunity'];
type Query = components['schemas']['OpportunityQuery'];
type Results = components['schemas']['OpportunityList'];
const defaults: Query = { role: null, market: 'any', days: 10, include_bilingual: false, starred_only: false };
const date = (value: string | null) => value ? new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short' }).format(new Date(value)) : 'Fecha no indicada';

// WDC student: compare companies and conditions, then choose her next step.
// Existing paper/terracotta tokens, quiet borders, 24px cards; pay is the focal fact.
export default function StudentOpportunities() {
  const [query, setQuery] = useState<Query>(defaults);
  const [applied, setApplied] = useState<Query>(defaults);
  const [items, setItems] = useState<Offer[]>([]);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [detail, setDetail] = useState<Offer | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const sequence = useRef(0);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    let stopped = false;
    const id = ++sequence.current;
    setBusy(true); setError('');
    request<Results>('opportunities/search', saved ? { role: null, market: 'any', days: 10, include_bilingual: true, starred_only: true } : applied)
      .then(result => { if (!stopped && sequence.current === id) setItems(result.items); })
      .catch(e => { if (!stopped) setError(e.message); })
      .finally(() => { if (!stopped) setBusy(false); });
    return () => { stopped = true; };
  }, [applied, saved]);
  useEffect(() => {
    if (detail && dialog.current && !dialog.current.open) dialog.current.showModal();
  }, [detail]);
  async function star(offer: Offer) {
    setSaving(offer.id); setError('');
    try {
      await request(`jobs/${offer.id}/star`, { starred: !offer.starred }, 'PATCH');
      setItems(old => old.map(item => item.id === offer.id ? { ...item, starred: !item.starred } : item).filter(item => !saved || item.starred));
      setDetail(old => old?.id === offer.id ? { ...old, starred: !old.starred } : old);
    } catch (e) { setError((e as Error).message); }
    finally { setSaving(null); }
  }
  return <div className="shell student-shell">
    <aside className="sidebar">
      <a className="brand" href="/" aria-label="WDC · Inicio"><span className="brand-mark">w.</span><span>Women Digital<br /><strong>Closer</strong></span></a>
      <div className="workspace-label">TU SIGUIENTE PASO</div>
      <nav aria-label="Navegación principal"><button className={`nav ${!saved ? 'active' : ''}`} onClick={() => setSaved(false)}><Compass size={18} />Oportunidades</button><button className={`nav ${saved ? 'active' : ''}`} onClick={() => setSaved(true)}><Bookmark size={18} />Guardadas</button></nav>
      <div className="sidebar-note"><span className="eyebrow">TU TALENTO.<br />TU PRÓXIMA EMPRESA.</span><p>Has trabajado para llegar hasta aquí. Ahora elige dónde quieres dar tu siguiente paso.</p></div>
      <div className="local-user"><HeartHandshake size={22} /><div><strong>Comunidad WDC</strong><small>Te acompañamos en el camino</small></div></div>
    </aside>
    <div className="main-shell">
      <header className="topbar"><div>Women Digital Closer <ChevronRight size={14} /><strong>{saved ? 'Tus guardadas' : 'Oportunidades'}</strong></div><span className="student-tag">De la formación a tu próximo trabajo</span></header>
      <main>
        <div className="page-heading"><div><span className="eyebrow">EMPRESAS QUE BUSCAN TALENTO COMERCIAL</span><h1>{saved ? 'Las que te interesan.' : 'Elige tu próxima oportunidad.'}</h1><p>{saved ? 'Vuelve a comparar sus condiciones y decide tu siguiente paso.' : 'WDC reúne oportunidades en español para que encuentres dónde quieres crecer.'}</p></div><span className="heading-icon"><Compass size={30} strokeWidth={1.2} /></span></div>
        {!saved && <form className="search-panel student-search" onSubmit={e => { e.preventDefault(); setApplied({ ...query }); }}>
          <div className="search-grid"><label>Perfil profesional<select value={query.role || ''} onChange={e => setQuery({ ...query, role: (e.target.value || null) as Query['role'] })}><option value="">Todos los perfiles</option><option value="closer">Closer</option><option value="setter">Setter</option><option value="cold_caller">Cold Caller</option></select></label><label>Desde dónde quieres trabajar<select value={query.market} onChange={e => setQuery({ ...query, market: e.target.value as Query['market'] })}><option value="any">Todos los mercados</option><option value="ES">España</option><option value="EU">Europa</option><option value="LATAM">Latinoamérica</option><option value="US">Estados Unidos</option></select></label><label>Publicación<select value={query.days} onChange={e => setQuery({ ...query, days: Number(e.target.value) })}><option value={1}>Últimas 24 horas</option><option value={3}>Últimos 3 días</option><option value={7}>Últimos 7 días</option><option value={10}>Últimos 10 días</option></select></label><button className="primary" disabled={busy}>{busy ? <LoaderCircle className="spin" size={17} /> : <Search size={17} />}Ver oportunidades</button></div>
          <div className="student-preferences"><span>En español · remoto o híbrido</span><label className="check-label"><input type="checkbox" checked={query.include_bilingual} onChange={e => setQuery({ ...query, include_bilingual: e.target.checked })} />También oportunidades bilingües español / inglés</label></div>
        </form>}
        {error && <p className="alert error" role="alert">{error}</p>}
        <section className="student-results" aria-busy={busy}><div className="results-heading"><h2>{saved ? 'Tus oportunidades guardadas' : 'Oportunidades para explorar'} <span>{busy ? '…' : items.length}</span></h2><span className="student-freshness">Actualización diaria</span></div>
          {busy ? <div className="empty"><LoaderCircle className="spin" size={24} /><p>Buscando oportunidades…</p></div> : !items.length ? <div className="empty"><Compass size={32} strokeWidth={1.3} /><h3>{saved ? 'Guarda las que te hagan dar el siguiente paso.' : 'Aún no hay oportunidades con estos criterios.'}</h3><p>{saved ? 'Pulsa el marcador de una oferta para volver a verla aquí.' : 'Puedes elegir otro perfil o mercado. Seguimos buscando nuevas oportunidades en español.'}</p></div> : <div className="opportunity-grid">{items.map(offer => <article className="opportunity-card" key={offer.id}>
            <div className="opportunity-company"><div className="company-monogram" aria-hidden="true">{offer.company.slice(0, 2).toUpperCase()}</div><div><p>{offer.company}</p><span>{offer.role_label}</span></div><button className={`icon-button ${offer.starred ? 'is-starred' : ''}`} disabled={saving === offer.id} aria-label={`${offer.starred ? 'Quitar de guardadas' : 'Guardar'} ${offer.role_label} · ${offer.company}`} onClick={() => void star(offer)}><Bookmark size={19} fill={offer.starred ? 'currentColor' : 'none'} /></button></div>
            <div className="opportunity-pay"><span>COMPENSACIÓN PUBLICADA</span><h3>{offer.compensation}</h3><p>{offer.compensation_note}</p></div>
            <dl className="opportunity-facts"><div><dt>Modalidad y ubicación</dt><dd><Globe2 size={14} />{offer.modality} · {offer.location}</dd></div><div><dt>Idioma</dt><dd>{offer.language}</dd></div><div><dt>Jornada</dt><dd>{offer.schedule}</dd></div><div><dt>Experiencia</dt><dd>{offer.experience}</dd></div><div><dt>Contrato</dt><dd>{offer.contract}</dd></div></dl>
            <div className="opportunity-footer"><div><small>Publicada: {date(offer.published_at)}</small><a href={offer.source_url} target="_blank" rel="noopener noreferrer">Publicado en {offer.source_name}</a></div><button className="primary" onClick={() => setDetail(offer)}>Ver oportunidad<ArrowUpRight size={16} /></button></div>
          </article>)}</div>}
        </section>
        <p className="footnote"><BriefcaseBusiness size={14} />Tú eliges dónde avanzar. Revisa las condiciones y presenta tu candidatura en el proceso de la empresa.</p>
      </main>
    </div>
    <dialog ref={dialog} onClose={() => setDetail(null)} onClick={e => { if (e.target === dialog.current) dialog.current.close(); }}>{detail && <div className="detail"><div className="detail-top"><span className="eyebrow">TU SIGUIENTE PASO</span><button className="icon-button" aria-label="Cerrar oportunidad" onClick={() => dialog.current?.close()}><X size={20} /></button></div><p className="job-company">{detail.company}</p><h2>{detail.role_label}</h2><p>{detail.original_title}</p><div className="opportunity-pay"><span>COMPENSACIÓN PUBLICADA</span><h3>{detail.compensation}</h3><p>{detail.compensation_note}</p></div><p>{detail.modality} · {detail.location} · {detail.language}</p><h3>Lo que cuenta la empresa</h3><div className="description">{detail.description}</div><div className="provenance"><span>Publicada: {date(detail.published_at)}</span><span>Publicación de {detail.source_name}. Confirma que el proceso siga abierto antes de enviar tu candidatura.</span></div><div className="detail-actions"><a className="primary" href={detail.source_url} target="_blank" rel="noopener noreferrer">Ver proceso de candidatura<ArrowUpRight size={16} /></a><button disabled={saving === detail.id} onClick={() => void star(detail)}><Bookmark size={16} />{detail.starred ? 'Quitar de guardadas' : 'Guardar oportunidad'}</button></div><p className="inline-hint">Continuarás en la publicación original. Abrir el enlace no envía tu candidatura.</p></div>}</dialog>
  </div>;
}
