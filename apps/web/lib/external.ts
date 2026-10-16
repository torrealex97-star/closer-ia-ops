import { serviceRest } from './supabaseAuth';

// Fuentes externas (APIs con clave y recolectores programados). Los candidatos llegan tal cual los da la fuente,
// sin datos de contacto de personas, y no son visibles para una alumna hasta que un operador los aprueba.
export const ORG = 'cloud-wdc';
export type Candidate = { external_id: string; title: string; company?: string | null; location?: string | null; url: string; salary?: string | null; description?: string | null; posted_at?: string | null; raw?: Record<string, unknown> };
export type ExternalOffer = { id: string; source: string; external_id: string; title: string; company: string | null; location: string | null; url: string; salary: string | null; description: string | null; posted_at: string | null; first_seen_at: string; last_seen_at: string; expires_at: string; editorial_status: string; verified_at: string | null; verified_result: string | null };
export const SOURCE_RE = /^[a-z0-9-]{2,40}$/;
const MAX_CANDIDATES = 300;

const clip = (v: unknown, max: number): string | null => {
  if (typeof v !== 'string' && typeof v !== 'number') return null;
  const t = String(v).replace(/\s+/g, ' ').trim();
  return t ? t.slice(0, max) : null;
};
// Sin datos personales: se eliminan correos y teléfonos del texto y las etiquetas HTML.
export const scrub = (text: string) => text
  .replace(/<[^>]+>/g, ' ')
  .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[correo omitido]')
  .replace(/(?<![\w/])(?:\+?\d[\d\s().-]{7,}\d)(?![\w/])/g, '[teléfono omitido]')
  .replace(/\s+/g, ' ').trim();
const RAW_KEYS = ['site', 'job_type', 'is_remote', 'job_level', 'listing_type', 'provider', 'category'];

export function sanitize(input: unknown): Candidate | null {
  if (!input || typeof input !== 'object') return null;
  const c = input as Record<string, unknown>;
  const external_id = clip(c.external_id, 200), title = clip(c.title, 200), url = clip(c.url, 1000);
  if (!external_id || !title || !url || !/^https?:\/\/[^\s]+$/i.test(url)) return null;
  let posted_at: string | null = null;
  if (typeof c.posted_at === 'string' && c.posted_at) { const t = Date.parse(c.posted_at); if (Number.isFinite(t)) posted_at = new Date(t).toISOString(); }
  const description = typeof c.description === 'string' ? scrub(c.description).slice(0, 6000) || null : null;
  const rawIn = c.raw && typeof c.raw === 'object' ? c.raw as Record<string, unknown> : {};
  const raw = Object.fromEntries(Object.entries(rawIn).filter(([k, v]) => RAW_KEYS.includes(k) && ['string', 'number', 'boolean'].includes(typeof v)));
  return { external_id, title, company: clip(c.company, 200), location: clip(c.location, 200), url, salary: clip(c.salary, 200), description, posted_at, raw };
}

export async function ingest(source: string, via: string, candidates: unknown[], note?: string): Promise<{ received: number; accepted: number; rejected: number }> {
  const clean = candidates.slice(0, MAX_CANDIDATES).map(sanitize).filter((c): c is Candidate => c !== null);
  // Mismo anuncio dos veces en el lote: se queda el último.
  const unique = [...new Map(clean.map(c => [c.external_id, c])).values()];
  let accepted = 0;
  if (unique.length) {
    const response = await serviceRest('rpc/external_upsert', { method: 'POST', body: JSON.stringify({ p_org: ORG, p_source: source, p_rows: unique }) });
    if (!response.ok) throw new Error('No se pudo guardar los candidatos.');
    accepted = Number(await response.json().catch(() => 0)) || 0;
  }
  const received = Math.min(candidates.length, MAX_CANDIDATES);
  await serviceRest('external_ingest_runs', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ org_id: ORG, source, via, received, accepted, rejected: received - accepted, note: note ?? null }) });
  return { received, accepted, rejected: received - accepted };
}

const COLS = 'id,source,external_id,title,company,location,url,salary,description,posted_at,first_seen_at,last_seen_at,expires_at,editorial_status,verified_at,verified_result';
export async function listOffers(opts: { status?: string; source?: string; limit?: number; onlyLive?: boolean }): Promise<ExternalOffer[] | null> {
  const q = [`org_id=eq.${ORG}`, `select=${COLS}`, 'order=posted_at.desc.nullslast,first_seen_at.desc', `limit=${Math.min(opts.limit ?? 200, 500)}`];
  if (opts.status) q.push(`editorial_status=eq.${encodeURIComponent(opts.status)}`);
  if (opts.source) q.push(`source=eq.${encodeURIComponent(opts.source)}`);
  if (opts.onlyLive) q.push(`expires_at=gt.${encodeURIComponent(new Date().toISOString())}`);
  const response = await serviceRest(`external_offers?${q.join('&')}`);
  const rows = response.ok ? await response.json().catch(() => null) : null;
  return Array.isArray(rows) ? rows : null;
}

export async function statsBySource(): Promise<Array<{ source: string; total: number; live: number; approved: number; last_seen: string | null }> | null> {
  const response = await serviceRest(`external_offers?org_id=eq.${ORG}&select=source,editorial_status,expires_at,last_seen_at&limit=5000`);
  const rows = response.ok ? await response.json().catch(() => null) as Array<{ source: string; editorial_status: string; expires_at: string; last_seen_at: string }> | null : null;
  if (!Array.isArray(rows)) return null;
  const now = Date.now(); const map = new Map<string, { source: string; total: number; live: number; approved: number; last_seen: string | null }>();
  for (const r of rows) {
    const s = map.get(r.source) ?? { source: r.source, total: 0, live: 0, approved: 0, last_seen: null };
    s.total++; if (Date.parse(r.expires_at) > now) s.live++;
    if (r.editorial_status === 'approved' || r.editorial_status === 'published') s.approved++;
    if (!s.last_seen || r.last_seen_at > s.last_seen) s.last_seen = r.last_seen_at;
    map.set(r.source, s);
  }
  return [...map.values()].sort((a, b) => a.source.localeCompare(b.source));
}

export async function recentRuns(limit = 8): Promise<Array<{ source: string; via: string; received: number; accepted: number; note: string | null; created_at: string }> | null> {
  const response = await serviceRest(`external_ingest_runs?org_id=eq.${ORG}&select=source,via,received,accepted,note,created_at&order=created_at.desc&limit=${limit}`);
  const rows = response.ok ? await response.json().catch(() => null) : null;
  return Array.isArray(rows) ? rows : null;
}

const STATUSES = ['draft', 'needs_review', 'approved', 'published', 'withdrawn'];
export async function setStatus(ids: string[], status: string, by: string): Promise<number | null> {
  if (!STATUSES.includes(status) || !ids.length || ids.length > 200 || ids.some(i => !/^[0-9a-f-]{36}$/.test(i))) return null;
  const response = await serviceRest(`external_offers?org_id=eq.${ORG}&id=in.(${ids.join(',')})`, {
    method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ editorial_status: status, reviewed_by: by, reviewed_at: new Date().toISOString() }),
  });
  const rows = response.ok ? await response.json().catch(() => null) : null;
  return Array.isArray(rows) ? rows.length : null;
}

// Comprobación de vigencia: un GET acotado; solo «open» si responde 200 y el contenido nombra el título o la empresa.
export async function verifyOffer(id: string): Promise<{ id: string; result: 'open' | 'closed' | 'unknown'; reason: string } | null> {
  const found = await listOffersById(id);
  if (!found) return null;
  let result: 'open' | 'closed' | 'unknown' = 'unknown'; let reason = 'network_unreachable';
  try {
    const response = await fetch(found.url, { redirect: 'manual', cache: 'no-store', signal: AbortSignal.timeout(10000), headers: { 'User-Agent': 'Mozilla/5.0 (compatible; WDC-verifier)' } });
    if (response.status === 404 || response.status === 410) { result = 'closed'; reason = 'job_not_found'; }
    else if (response.status === 403 || response.status === 429) reason = 'source_blocked';
    else if (response.status >= 300 && response.status < 400) reason = 'redirect_without_verification';
    else if (response.ok) {
      const body = (await response.text()).slice(0, 200000).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
      const fold = (t: string | null) => (t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
      const hit = (fold(found.title).length >= 5 && body.includes(fold(found.title))) || (fold(found.company).length >= 3 && body.includes(fold(found.company)));
      if (hit) { result = 'open'; reason = 'content_matches'; } else reason = 'content_not_corroborated';
    } else reason = `http_${response.status}`;
  } catch { /* red caída: unknown */ }
  await serviceRest(`external_offers?org_id=eq.${ORG}&id=eq.${id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ verified_at: new Date().toISOString(), verified_result: result }) });
  return { id, result, reason };
}
async function listOffersById(id: string): Promise<ExternalOffer | null> {
  if (!/^[0-9a-f-]{36}$/.test(id)) return null;
  const response = await serviceRest(`external_offers?org_id=eq.${ORG}&id=eq.${id}&select=${COLS}&limit=1`);
  const rows = response.ok ? await response.json().catch(() => []) : [];
  return Array.isArray(rows) && rows[0] ? rows[0] : null;
}
