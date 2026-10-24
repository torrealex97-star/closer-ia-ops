import { spanishWords } from './offerScore';
import { listOffers, pausedSourcesStrict, type ExternalOffer } from './external';
import { spainSignal } from './esPlaces';
import { fold, roleFromTitle, ROLE_LABELS, type RoleFamily } from './vocabulary';

// Ofertas externas aprobadas, con el contrato Opportunity de la vista de alumna. Nada se inventa: lo que la
// fuente no dice sale como «no indicado». Mismas puertas básicas que el motor: perfil por título, España por
// señal explícita, antigüedad y español (salvo que la alumna pida bilingüe).
type Query = { role: string | null; market: string; days: number; include_bilingual: boolean; starred_only: boolean };

const PORTUGUESE = /\b(?:vendas|voce|comissoes|portugues|brasil)\b/;
const isGoogleUrl = (u: string) => /^https?:\/\/(www\.)?google\./i.test(u);

// El mismo anuncio se republica en varios portales (Google Jobs indexa Trabajo.org, JobLeads,
// BeBee…). Sin agrupar, la alumna ve tres veces el puesto de Fastrack con el mismo texto.
// Se agrupa por empresa y **texto casi idéntico**, no por título: los portales lo retocan
// («High-Ticket Sales Closer» / «… (Hospitality Sector)»). Medido sobre el lote real, el mismo
// anuncio da 0,95–0,995 de solapamiento y dos anuncios distintos de la misma empresa, 0,13.
const SAME_POSTING = 0.8;
const wordsOf = (text?: string | null) => new Set(fold(text ?? '').split(/[^a-z0-9]+/).filter(w => w.length > 3));
const overlap = (a: Set<string>, b: Set<string>) => {
  if (!a.size || !b.size) return 0;
  let shared = 0; for (const w of a) if (b.has(w)) shared++;
  return shared / (a.size + b.size - shared);
};
const companyKey = (c?: string | null) => fold(c ?? '').replace(/[^a-z0-9]+/g, ' ').trim();

/** Quita republicaciones del mismo anuncio conservando el orden recibido (ya viene por puntuación). */
export function dedupeReposted<T extends { company?: string | null; description?: string | null; url: string }>(rows: T[]): T[] {
  const out: T[] = [];
  const byCompany = new Map<string, Array<{ tokens: Set<string>; at: number }>>();
  for (const row of rows) {
    const company = companyKey(row.company);
    const tokens = wordsOf(row.description);
    const bucket = company ? byCompany.get(company) ?? [] : [];
    if (company) byCompany.set(company, bucket);
    const twin = bucket.find(g => overlap(g.tokens, tokens) >= SAME_POSTING);
    if (twin) {
      // Si el duplicado trae el enlace del portal y el conservado solo la ficha de Google, se cambia.
      if (isGoogleUrl(out[twin.at].url) && !isGoogleUrl(row.url)) out[twin.at] = row;
      continue;
    }
    bucket.push({ tokens, at: out.length });
    out.push(row);
  }
  return out;
}

// Lo que la fuente declara (JobSpy: is_remote, job_type). Si no lo dice, se queda «no indicado».
const JOB_TYPES: Record<string, ['schedule' | 'contract', string]> = {
  fulltime: ['schedule', 'Jornada completa'], parttime: ['schedule', 'Media jornada'],
  permanent: ['contract', 'Indefinido'], contract: ['contract', 'Por contrato'], temporary: ['contract', 'Temporal'], internship: ['contract', 'Prácticas'],
};
function declared(raw: Record<string, unknown> | undefined) {
  const out: { modality?: string; schedule?: string; contract?: string } = {};
  if (raw?.is_remote === true) out.modality = 'Remoto';
  for (const part of String(raw?.job_type ?? '').toLowerCase().split(/[,\s]+/)) { const hit = JOB_TYPES[part]; if (hit && !out[hit[0]]) out[hit[0]] = hit[1]; }
  return out;
}

export function toOpportunity(o: ExternalOffer, role: RoleFamily) {
  let host = 'fuente externa';
  try { host = new URL(o.url).hostname.replace(/^www\./, ''); } catch { /* url ya validada al guardar */ }
  // Google Jobs entrega su propia ficha y no el portal cuando el anuncio no publica
  // enlace de candidatura. Decir «publicado en google.com» sería falso: se nombra el
  // portal que Google atribuye (`via`, guardado en raw.site) y se declara el salto.
  const via = typeof o.raw?.site === 'string' ? o.raw.site.trim() : '';
  const sourceName = via && /(^|\.)google\./i.test(host) ? `${via} · vía Google Jobs` : host;
  return {
    id: `ext-${o.id}`, role, role_label: ROLE_LABELS[role], original_title: o.title, company: o.company || 'Empresa no indicada',
    compensation: o.salary || 'Importe no publicado', compensation_note: o.salary ? 'Tal como figura en el anuncio original.' : 'Pregunta por el fijo y las comisiones antes de avanzar.',
    modality: declared(o.raw).modality ?? 'Modalidad no indicada', location: o.location || 'Ubicación no indicada', language: 'Anuncio en español', experience: 'Experiencia no indicada', schedule: declared(o.raw).schedule ?? 'Jornada no indicada', contract: declared(o.raw).contract ?? 'Contrato no indicado',
    description: o.description || 'Consulta el anuncio original para ver las condiciones completas.',
    published_at: o.posted_at, expires_at: o.expires_at, source_name: sourceName, source_url: o.url, starred: false, excellence_rank: null, is_selected: false,
  };
}

export async function externalForStudent(q: Query) {
  if (q.starred_only || !['any', 'ES'].includes(q.market)) return [];
  // Solo aprobadas, ya ordenadas por puntuación en el servidor (con miles de borradores no se pierde ninguna aprobada).
  const [all, paused] = await Promise.all([listOffers({ statuses: ['approved', 'published'], byScore: true, limit: 600, onlyLive: true }), pausedSourcesStrict()]);
  if (!paused) return []; // no se sabe qué fuentes están pausadas: ante la duda no se muestra nada
  const rows = dedupeReposted((all ?? []).filter(o => !paused.has(o.source)));
  const cutoff = Date.now() - q.days * 86400000;
  const out = [];
  for (const o of rows) {
    if (o.editorial_status !== 'approved' && o.editorial_status !== 'published') continue;
    const role = roleFromTitle(o.title);
    if (!role || (q.role && role !== q.role)) continue;
    if (q.market === 'ES' && spainSignal(o.title, o.location) !== true) continue;
    if (o.posted_at && Date.parse(o.posted_at) < cutoff) continue;
    const text = fold(`${o.title} ${o.description ?? ''}`);
    if (PORTUGUESE.test(text)) continue;
    // Con descripción, hacen falta 3 palabras españolas; sin ella (p. ej. LinkedIn sin detalle), basta una en el
    // título más ubicación en España explícita: el idioma se asume solo cuando el resto de señales cuadra.
    const words = spanishWords(text);
    const enough = o.description ? words >= 3 : words >= 1 && spainSignal(o.title, o.location) === true;
    if (!q.include_bilingual && !enough) continue;
    out.push(toOpportunity(o, role));
  }
  return out;
}
