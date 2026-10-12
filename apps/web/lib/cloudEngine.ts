// Adaptador del motor cloud (Worker + D1) al DTO de alumna. El Worker solo conoce título, empresa,
// ubicación, enlace, salario y fecha: todo lo demás se muestra como «No indicado», nunca se infiere.
const ROLE_LABELS: Record<string, string> = {
  closer: 'Closer', setter: 'Setter', cold_caller: 'Cold Caller', account_executive: 'Ejecutivo comercial', sdr: 'SDR / BDR',
};
const ROLES = new Set(Object.keys(ROLE_LABELS));
const DAY_MS = 86400000;

export type CloudQuery = { role: string | null; market: string; days: number };
type CloudOffer = {
  job_id: string; role?: string | null; title: string; company?: string | null; location?: string | null;
  url: string; salary?: string | null; posted_at?: string | null; source_first_seen_at: string;
};

export function parseQuery(body: unknown): CloudQuery {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const days = Number(b.days);
  return {
    role: typeof b.role === 'string' && ROLES.has(b.role) ? b.role : null,
    market: ['any', 'ES', 'EU', 'LATAM', 'US'].includes(b.market as string) ? b.market as string : 'any',
    days: [1, 3, 7, 10].includes(days) ? days : 10,
  };
}

// El motor cloud solo recoge fuentes con señal de España: no se presenta otro mercado como si lo cubriera.
export const supportsMarket = (market: string) => market === 'any' || market === 'ES';

export function engineUrl(query: CloudQuery): string {
  const params = new URLSearchParams({ market: query.market === 'ES' ? 'ES' : 'any', days: String(query.days) });
  if (query.role) params.set('role', query.role);
  return `/api/offers?${params}`;
}

function safeSource(url: string): { href: string; name: string } | null {
  try {
    const parsed = new URL(url);
    // Solo http(s): el enlace viene de una fuente externa y acaba en un href.
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
    return { href: parsed.href, name: parsed.hostname.replace(/^www\./, '') };
  } catch { return null; }
}

export function toStudentList(payload: { offers?: CloudOffer[] }) {
  const items = (payload.offers ?? []).flatMap(offer => {
    const source = safeSource(offer.url);
    if (!source || !offer.title) return [];
    const seen = Date.parse(offer.source_first_seen_at);
    const role = offer.role && ROLES.has(offer.role) ? offer.role : null;
    return [{
      id: offer.job_id, role, role_label: role ? ROLE_LABELS[role] : 'Comercial (perfil por revisar)',
      original_title: offer.title, company: offer.company || 'Empresa no indicada',
      compensation: offer.salary || 'Compensación no publicada',
      compensation_note: offer.salary ? 'Tal como figura en el anuncio original.' : 'La empresa no indica la compensación en el anuncio.',
      modality: 'Modalidad no indicada', location: offer.location || 'Ubicación no indicada',
      language: 'Idioma no indicado', experience: 'Experiencia no indicada', schedule: 'Jornada no indicada', contract: 'Contrato no indicado',
      description: 'La versión online no incluye el resumen. Consulta el anuncio original para ver las condiciones completas.',
      published_at: offer.posted_at ?? null,
      expires_at: new Date((Number.isFinite(seen) ? seen : Date.now()) + 10 * DAY_MS).toISOString(),
      source_name: source.name, source_url: source.href,
      starred: false, excellence_rank: null, is_selected: false,
    }];
  });
  return { items, total: items.length, selection_total: 0 };
}
