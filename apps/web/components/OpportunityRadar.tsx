'use client';

import type { components } from '../../../packages/contracts/api';
import { hasPay } from './offerFacts';

type Offer = components['schemas']['Opportunity'];
type Role = NonNullable<components['schemas']['OpportunityQuery']['role']>;

// Un punto por oferta; se recortan para que el radar siga siendo legible.
const MAX_BLIPS = 18;
const UNKNOWN_COMPANY = /no especificad/i;

// Posición estable por id: recargar no mueve los puntos de sitio.
function hash(value: string) {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) { h ^= value.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

// Radar de oportunidades: muestra el catálogo real que hay detrás de la búsqueda.
// Mientras el motor responde barre; al llegar, cada punto es una oferta existente.
export default function OpportunityRadar({ offers, busy, role, onRole }: {
  offers: Offer[];
  busy: boolean;
  role: Role | null;
  onRole: (role: Role | null) => void;
}) {
  const companies = new Set(offers.map(offer => offer.company.trim().toLowerCase()).filter(name => name && !UNKNOWN_COMPANY.test(name))).size;
  const withPay = offers.filter(hasPay).length;
  const recent = offers.filter(offer => offer.published_at && Date.now() - new Date(offer.published_at).getTime() < 3 * 86400000).length;
  const byRole = new Map<Role, { label: string; count: number }>();
  for (const offer of offers) {
    const key = offer.role as Role;
    const entry = byRole.get(key) ?? { label: offer.role_label, count: 0 };
    entry.count += 1;
    byRole.set(key, entry);
  }
  const blips = offers.slice(0, MAX_BLIPS).map(offer => {
    const value = hash(offer.id);
    const angle = (value % 360) * Math.PI / 180;
    const radius = 24 + ((value >>> 9) % 22);
    return {
      id: offer.id,
      role: offer.role as Role,
      left: 50 + Math.cos(angle) * radius,
      top: 50 + Math.sin(angle) * radius,
      title: [offer.company, offer.original_title].filter(Boolean).join(' · '),
    };
  });
  return <section className="student-radar" aria-labelledby="radar-title">
    <div className="radar-disc" data-scanning={busy} aria-hidden="true">
      <svg viewBox="0 0 200 200" focusable="false">
        <circle cx="100" cy="100" r="96" /><circle cx="100" cy="100" r="64" /><circle cx="100" cy="100" r="32" />
        <line x1="100" y1="4" x2="100" y2="196" /><line x1="4" y1="100" x2="196" y2="100" />
      </svg>
      <span className="radar-sweep" />
      {blips.map((blip, index) => <span
        key={blip.id}
        className="radar-blip"
        data-role={blip.role}
        title={blip.title}
        style={{ left: `${blip.left}%`, top: `${blip.top}%`, animationDelay: `${index * 45}ms` }}
      />)}
      <span className="radar-center">
        <b>{busy ? '···' : offers.length}</b>
        <small>{busy ? 'buscando' : offers.length === 1 ? 'oferta' : 'ofertas'}</small>
      </span>
    </div>
    <div className="radar-readout">
      <p className="sr-only" role="status">{busy ? 'Buscando oportunidades en el catálogo.' : `${plural(offers.length, 'oportunidad', 'oportunidades')} en ${plural(companies, 'empresa', 'empresas')}.`}</p>
      <span className="eyebrow">RADAR DE OPORTUNIDADES</span>
      <h2 id="radar-title">{busy
        ? 'Rastreando el catálogo'
        : `${plural(offers.length, 'oportunidad', 'oportunidades')} · ${plural(companies, 'empresa', 'empresas')}`}</h2>
      <p>{busy
        ? 'Consultando las oportunidades revisadas de WDC. Cada punto aparecerá al llegar.'
        : 'Cada punto es una oferta que ya pasó la revisión de WDC. Elige un perfil para afinar el radar.'}</p>
      {byRole.size > 0 && <div className="radar-legend" role="group" aria-label="Filtrar por perfil">
        {[...byRole.entries()].map(([key, entry]) => <button
          key={key}
          type="button"
          data-role={key}
          aria-pressed={role === key}
          onClick={() => onRole(role === key ? null : key)}
        ><i aria-hidden="true" />{entry.label}<span>{entry.count}</span></button>)}
      </div>}
      <div className="radar-stats">
        <div><b>{busy ? '—' : withPay}</b><span>Con importe publicado</span></div>
        <div><b>{busy ? '—' : recent}</b><span>Publicadas en 3 días</span></div>
        <div><b>{busy ? '—' : byRole.size}</b><span>Perfiles distintos</span></div>
      </div>
    </div>
  </section>;
}
