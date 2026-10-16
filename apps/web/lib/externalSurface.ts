import { listOffers, type ExternalOffer } from './external';
import { fold, roleFromTitle, ROLE_LABELS, spainSignal, type RoleFamily } from './vocabulary';

// Ofertas externas aprobadas, con el contrato Opportunity de la vista de alumna. Nada se inventa: lo que la
// fuente no dice sale como «no indicado». Mismas puertas básicas que el motor: perfil por título, España por
// señal explícita, antigüedad y español (salvo que la alumna pida bilingüe).
type Query = { role: string | null; market: string; days: number; include_bilingual: boolean; starred_only: boolean };
const SPANISH = /\b(?:de|la|el|los|las|para|con|en|y|que|una|un|experiencia|ventas|empresa|buscamos|incorporar|comercial|trabajo|oferta|requisitos|funciones|salario|jornada)\b/g;
const PORTUGUESE = /\b(?:vendas|voce|comissoes|portugues|brasil)\b/;

export function toOpportunity(o: ExternalOffer, role: RoleFamily) {
  let host = 'fuente externa';
  try { host = new URL(o.url).hostname.replace(/^www\./, ''); } catch { /* url ya validada al guardar */ }
  return {
    id: `ext-${o.id}`, role, role_label: ROLE_LABELS[role], original_title: o.title, company: o.company || 'Empresa no indicada',
    compensation: o.salary || 'Importe no publicado', compensation_note: o.salary ? 'Tal como figura en el anuncio original.' : 'Pregunta por el fijo y las comisiones antes de avanzar.',
    modality: 'Modalidad no indicada', location: o.location || 'Ubicación no indicada', language: 'Anuncio en español', experience: 'Experiencia no indicada', schedule: 'Jornada no indicada', contract: 'Contrato no indicado',
    description: o.description || 'Consulta el anuncio original para ver las condiciones completas.',
    published_at: o.posted_at, expires_at: o.expires_at, source_name: host, source_url: o.url, starred: false, excellence_rank: null, is_selected: false,
  };
}

export async function externalForStudent(q: Query) {
  if (q.starred_only || !['any', 'ES'].includes(q.market)) return [];
  const rows = await listOffers({ limit: 300, onlyLive: true }) ?? [];
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
    if (!q.include_bilingual && (text.match(SPANISH) ?? []).length < 3) continue;
    out.push(toOpportunity(o, role));
  }
  return out;
}
