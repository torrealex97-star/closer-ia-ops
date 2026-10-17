import { enrich } from './offerScore';
import { callTimeout, timeLeft } from './cronBudget';
import { salaryFromText } from './salary';
import { serviceRest } from './supabaseAuth';

// Fuentes externas (APIs con clave y recolectores programados). Los candidatos llegan tal cual los da la fuente,
// sin datos de contacto de personas, y no son visibles para una alumna hasta que un operador los aprueba.
export const ORG = 'cloud-wdc';
export type Candidate = { external_id: string; title: string; company?: string | null; location?: string | null; url: string; salary?: string | null; description?: string | null; posted_at?: string | null; raw?: Record<string, unknown> };
export type ExternalOffer = { role?: string | null; spain?: boolean | null; score?: number; also_seen?: string[]; raw?: Record<string, unknown>; id: string; source: string; external_id: string; title: string; company: string | null; location: string | null; url: string; salary: string | null; description: string | null; posted_at: string | null; first_seen_at: string; last_seen_at: string; expires_at: string; editorial_status: string; verified_at: string | null; verified_result: string | null; ai_review?: Record<string, unknown> | null };
export const SOURCE_RE = /^[a-z0-9-]{2,40}$/;
export const MAX_CANDIDATES = 300;
const STATUSES = ['draft', 'needs_review', 'approved', 'published', 'withdrawn'];

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

// URL canónica: sin fragmento ni parámetros de seguimiento (utm_*, fbclid, gclid...), para no duplicar el mismo anuncio.
const TRACKING = /^(utm_.*|fbclid|gclid|msclkid|mc_[a-z]+|trk|trackingid|refid|ref|source)$/i;
export function normalizeUrl(raw: string): string {
  try {
    const u = new URL(raw); u.hash = '';
    for (const k of [...u.searchParams.keys()]) if (TRACKING.test(k)) u.searchParams.delete(k);
    u.searchParams.sort();
    return u.href.length <= 1000 ? u.href : raw;
  } catch { return raw; }
}

export type Rejection = 'no_objeto' | 'sin_id' | 'sin_titulo' | 'sin_url' | 'url_no_http';
export function classify(input: unknown): { candidate: Candidate } | { reason: Rejection } {
  if (!input || typeof input !== 'object') return { reason: 'no_objeto' };
  const c = input as Record<string, unknown>;
  const external_id = clip(c.external_id, 200), title = clip(c.title, 200), url0 = clip(c.url, 1000);
  if (!external_id) return { reason: 'sin_id' };
  if (!title) return { reason: 'sin_titulo' };
  if (!url0) return { reason: 'sin_url' };
  if (!/^https?:\/\/[^\s]+$/i.test(url0)) return { reason: 'url_no_http' };
  const url = normalizeUrl(url0);
  let posted_at: string | null = null;
  if (typeof c.posted_at === 'string' && c.posted_at) { const t = Date.parse(c.posted_at); if (Number.isFinite(t)) posted_at = new Date(t).toISOString(); }
  const description = typeof c.description === 'string' ? scrub(c.description).slice(0, 6000) || null : null;
  const rawIn = c.raw && typeof c.raw === 'object' ? c.raw as Record<string, unknown> : {};
  const raw = Object.fromEntries(Object.entries(rawIn).filter(([k, v]) => RAW_KEYS.includes(k) && ['string', 'number', 'boolean'].includes(typeof v)));
  // Sin salario estructurado, se rescata la frase literal del texto (solo con importe en € y periodo o bruto/neto).
  const salary = clip(c.salary, 200) ?? (typeof c.description === 'string' ? salaryFromText(c.description) : null);
  return { candidate: { external_id, title, company: clip(c.company, 200), location: clip(c.location, 200), url, salary, description, posted_at, raw } };
}
export const sanitize = (input: unknown): Candidate | null => { const r = classify(input); return 'candidate' in r ? r.candidate : null; };

// Guardado resistente: lotes de 100, 2 reintentos con espera ante 5xx/red y, si un lote sigue fallando, fila a fila para
// aislar la oferta mala. Nunca se pierde un lote entero por una fila ni se oculta lo que sí se guardó.
const CHUNK = 100;
async function upsertRows(source: string, rows: Array<Record<string, unknown>>, sleep: (ms: number) => Promise<void>): Promise<number> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await serviceRest('rpc/external_upsert', { method: 'POST', body: JSON.stringify({ p_org: ORG, p_source: source, p_rows: rows }) });
      if (response.ok) return Number(await response.json().catch(() => 0)) || 0;
      if (response.status < 500 && response.status !== 429) break; // error de datos: reintentar no ayuda
    } catch { /* red: se reintenta */ }
    if (attempt < 2) await sleep(300 * 2 ** attempt);
  }
  return -1;
}
export async function saveCandidates(source: string, rows: Array<Record<string, unknown>>, sleep: (ms: number) => Promise<void> = ms => new Promise(r => setTimeout(r, ms))): Promise<{ accepted: number; failed: number }> {
  let accepted = 0, failed = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const n = await upsertRows(source, chunk, sleep);
    if (n >= 0) { accepted += n; continue; }
    for (const row of chunk) { const one = await upsertRows(source, [row], sleep); if (one >= 0) accepted += one; else failed++; }
  }
  return { accepted, failed };
}

export async function pausedSources(): Promise<Set<string>> {
  const response = await serviceRest(`source_settings?org_id=eq.${ORG}&enabled=eq.false&select=source`);
  const rows = response.ok ? await response.json().catch(() => []) : [];
  return new Set(Array.isArray(rows) ? rows.map((r: { source: string }) => r.source) : []);
}

export async function setSourceEnabled(source: string, enabled: boolean, by: string): Promise<boolean> {
  if (!SOURCE_RE.test(source)) return false;
  const response = await serviceRest('source_settings?on_conflict=org_id,source', {
    method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ org_id: ORG, source, enabled, updated_by: by, updated_at: new Date().toISOString() }),
  });
  return response.ok;
}

export async function ingest(source: string, via: string, candidates: unknown[], note?: string): Promise<{ received: number; accepted: number; rejected: number; paused?: boolean }> {
  // Una fuente pausada no entra: se registra el intento para que se vea en el panel.
  if ((await pausedSources()).has(source)) {
    const received = Math.min(candidates.length, MAX_CANDIDATES);
    await serviceRest('external_ingest_runs', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ org_id: ORG, source, via, received, accepted: 0, rejected: received, note: 'Fuente pausada: no se guardó nada' }) });
    return { received, accepted: 0, rejected: received, paused: true };
  }
  const reasons: Record<string, number> = {};
  const clean: Candidate[] = [];
  for (const input of candidates.slice(0, MAX_CANDIDATES)) {
    const r = classify(input);
    if ('candidate' in r) clean.push(r.candidate); else reasons[r.reason] = (reasons[r.reason] ?? 0) + 1;
  }
  // Mismo anuncio dos veces en el lote (por id o por URL canónica): se queda el último.
  const byUrl = new Map(clean.map(c => [c.url, c]));
  const unique = [...new Map([...byUrl.values()].map(c => [c.external_id, c])).values()];
  let accepted = 0, failed = 0;
  if (unique.length) {
    // Perfil, España, puntuación y huella (para ordenar y deduplicar entre fuentes) se calculan al entrar.
    const rows = unique.map(c => ({ ...c, ...enrich(c) }));
    ({ accepted, failed } = await saveCandidates(source, rows));
    if (failed === rows.length) throw new Error('No se pudo guardar los candidatos.');
  }
  const received = Math.min(candidates.length, MAX_CANDIDATES);
  const discarded = Object.entries(reasons).map(([k, v]) => `${k}:${v}`).join(' ');
  const notes = [note, discarded && `descartadas ${discarded}`, failed && `${failed} fila(s) no se pudieron guardar`].filter(Boolean).join(' · ') || null;
  await serviceRest('external_ingest_runs', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ org_id: ORG, source, via, received, accepted, rejected: received - accepted, note: notes }) });
  return { received, accepted, rejected: received - accepted };
}

const COLS = 'role,spain,score,also_seen,raw,id,source,external_id,title,company,location,url,salary,description,posted_at,first_seen_at,last_seen_at,expires_at,editorial_status,verified_at,verified_result,ai_review';
export async function listOffers(opts: { status?: string; statuses?: string[]; source?: string; limit?: number; onlyLive?: boolean; byScore?: boolean }): Promise<ExternalOffer[] | null> {
  const q = [`org_id=eq.${ORG}`, `select=${COLS}`, opts.byScore ? 'order=score.desc,posted_at.desc.nullslast' : 'order=posted_at.desc.nullslast,first_seen_at.desc', `limit=${Math.min(opts.limit ?? 200, 1000)}`];
  if (opts.status) q.push(`editorial_status=eq.${encodeURIComponent(opts.status)}`);
  if (opts.statuses?.length) q.push(`editorial_status=in.(${opts.statuses.filter(x => STATUSES.includes(x)).join(',')})`);
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

export async function setStatus(ids: string[], status: string, by: string): Promise<number | null> {
  if (!STATUSES.includes(status) || !ids.length || ids.length > 200 || ids.some(i => !/^[0-9a-f-]{36}$/.test(i))) return null;
  const response = await serviceRest(`external_offers?org_id=eq.${ORG}&id=in.(${ids.join(',')})`, {
    method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ editorial_status: status, reviewed_by: by, reviewed_at: new Date().toISOString() }),
  });
  const rows = response.ok ? await response.json().catch(() => null) : null;
  return Array.isArray(rows) ? rows.length : null;
}

// Comprobación de vigencia: un GET acotado; solo «open» si responde 200 y el contenido nombra el título o la empresa.
export async function verifyOffer(id: string, timeoutMs = 10000): Promise<{ id: string; result: 'open' | 'closed' | 'unknown'; reason: string } | null> {
  const found = await listOffersById(id);
  if (!found) return null;
  let result: 'open' | 'closed' | 'unknown' = 'unknown'; let reason = 'network_unreachable';
  try {
    const response = await fetch(found.url, { redirect: 'manual', cache: 'no-store', signal: AbortSignal.timeout(timeoutMs), headers: { 'User-Agent': 'Mozilla/5.0 (compatible; WDC-verifier)' } });
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

// Vigencia automática: verifica las ofertas aprobadas que llevan más de 48 h sin comprobarse y retira las que el
// origen da por cerradas (404/410). Solo cierra; nunca aprueba nada. Se llama desde el cron diario.
export async function refreshVigencia(max = 20, deadline?: number): Promise<{ checked: number; withdrawn: number; truncated?: boolean }> {
  const stale = encodeURIComponent(new Date(Date.now() - 48 * 3600 * 1000).toISOString());
  const response = await serviceRest(`external_offers?org_id=eq.${ORG}&editorial_status=in.(approved,published)&or=(verified_at.is.null,verified_at.lt.${stale})&select=id&order=verified_at.asc.nullsfirst&limit=${max}`);
  const rows = response.ok ? await response.json().catch(() => []) as Array<{ id: string }> : [];
  const queue = Array.isArray(rows) ? rows.map(r => r.id) : [];
  const closed: string[] = []; let checked = 0, truncated = false;
  await Promise.all(Array.from({ length: Math.min(4, queue.length) }, async () => {
    for (let id = queue.shift(); id; id = queue.shift()) {
      // El reloj gobierna cada comprobación: sin tiempo no se empieza otra. Las más antiguas van primero, así que mañana se continúa.
      if (timeLeft(deadline) < 1500) { truncated = true; return; }
      const verdict = await verifyOffer(id, callTimeout(10000, deadline));
      if (verdict) { checked++; if (verdict.result === 'closed') closed.push(id); }
    }
  }));
  if (closed.length) await setStatus(closed, 'withdrawn', 'auto-vigencia');
  return { checked, withdrawn: closed.length, ...(truncated ? { truncated } : {}) };
}

// ---- Escala: filtros, orden y paginación en el servidor (miles de ofertas) ----
export type PageQuery = { status?: string; source?: string; role?: string; spain?: boolean; minScore?: number; ai?: 'human' | 'withdraw' | 'approve' | 'none'; q?: string; sort?: 'score' | 'recent'; limit?: number; offset?: number };

function pageFilters(p: PageQuery): string[] {
  const f = [`org_id=eq.${ORG}`, `expires_at=gt.${encodeURIComponent(new Date().toISOString())}`];
  if (p.status && STATUSES.includes(p.status)) f.push(`editorial_status=eq.${p.status}`);
  if (p.source && SOURCE_RE.test(p.source)) f.push(`source=eq.${p.source}`);
  if (p.role === 'none') f.push('role=is.null'); else if (p.role && /^[a-z_]{2,30}$/.test(p.role)) f.push(`role=eq.${p.role}`);
  if (p.spain) f.push('spain=is.true');
  if (p.minScore && p.minScore > 0) f.push(`score=gte.${Math.min(100, Math.floor(p.minScore))}`);
  // Filtro por lo que decidiría el revisor IA: «human» = cola humana (revisión pendiente de una persona).
  if (p.ai === 'none') f.push('ai_review=is.null'); else if (p.ai) f.push(`ai_review->>would_decide=eq.${p.ai}`);
  const q = (p.q ?? '').replace(/[^\p{L}\p{N} .-]/gu, ' ').trim().slice(0, 60);
  if (q) f.push(`or=(title.ilike.*${encodeURIComponent(q)}*,company.ilike.*${encodeURIComponent(q)}*)`);
  return f;
}

export async function listOffersPage(p: PageQuery): Promise<{ rows: ExternalOffer[]; total: number } | null> {
  const limit = Math.min(Math.max(p.limit ?? 50, 1), 200), offset = Math.max(p.offset ?? 0, 0);
  const order = p.sort === 'recent' ? 'posted_at.desc.nullslast,first_seen_at.desc' : 'score.desc,posted_at.desc.nullslast';
  const response = await serviceRest(`external_offers?${[...pageFilters(p), `select=${COLS}`, `order=${order}`, `limit=${limit}`, `offset=${offset}`].join('&')}`, { headers: { Prefer: 'count=exact' } });
  if (!response.ok) return null;
  const rows = await response.json().catch(() => null);
  if (!Array.isArray(rows)) return null;
  const total = Number((response.headers.get('content-range') ?? '').split('/')[1]);
  return { rows, total: Number.isFinite(total) ? total : rows.length };
}

export async function countsByStatus(): Promise<Record<string, number> | null> {
  const out: Record<string, number> = {};
  const results = await Promise.all(STATUSES.map(async st => {
    const r = await serviceRest(`external_offers?${[...pageFilters({ status: st }), 'select=id', 'limit=1'].join('&')}`, { headers: { Prefer: 'count=exact' } });
    return [st, r.ok ? Number((r.headers.get('content-range') ?? '').split('/')[1]) || 0 : null] as const;
  }));
  for (const [st, n] of results) { if (n === null) return null; if (n) out[st] = n; }
  return out;
}

// «Aprobar las N mejores»: toma los borradores que cumplen los filtros, por puntuación, y los aprueba. Reversible.
export async function approveTop(p: PageQuery & { n: number }, by: string): Promise<{ matched: number; approved: number } | null> {
  const n = Math.min(Math.max(Math.floor(p.n), 1), 500);
  const page = await listOffersPage({ ...p, status: 'draft', sort: 'score', limit: n, offset: 0 });
  if (!page) return null;
  const ids = page.rows.map(r => r.id);
  const changed = ids.length ? await setStatus(ids, 'approved', by) : 0;
  return changed === null ? null : { matched: page.total, approved: changed };
}
