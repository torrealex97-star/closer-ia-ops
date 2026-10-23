// closer-ia-ops — motor de recogida en la nube (Cloudflare Worker + D1).
// Principios del repo: evidencia raw inmutable (append-only), separada del procesado;
// org-scoped; nunca inventar fuentes (solo canales verificados); fallo de una fuente
// no oculta las demás; exposición honesta de lo desconocido (application_type: unknown).

const ORG = 'cloud-wdc';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36';
const COLLECTION_INTERVAL_MS = 6 * 60 * 60 * 1000; // refresco si la última recogida > 6 h
const MAX_ITEMS_PER_SOURCE = 300;
// Vigencia del catálogo: ventana de 10 días; el refresco (escrita D1) solo se
// paga cuando la ventana queda a punto de vencer (< REFRESH_AHEAD_MS de vida).
// Con tick cada 6 h, una oferta conocida pasa de ~40 escritas de vigencia en su
// vida útil a ~1-2: el componente que aún escalaba con el catálogo cae ~10×.
const CATALOG_WINDOW_MS = 10 * 86400000;
const REFRESH_AHEAD_MS = 2 * 86400000;

// Fuentes públicas de España verificadas (JobToday slugs canónicos verificados 2026-10-09;
// ATS de la watchlist WDC; sin claves ni scraping autenticado).
const SOURCES = [
  { code: 'jobtoday', name: 'JobToday España', kind: 'jobtoday', slug: 'closer-de-ventas' },
  // Retirados 2026-10-22 (telemarketing, ventas-remoto, ventas, comercial): 0 elegibles
  // en la ventana y 4 subrequests que necesitaba el barrido por ciudad. La cobertura
  // nacional que sí rinde se queda (agente-comercial, vendedor, asesor-de-ventas,
  // ventas-presencial): entre los cuatro aportan los únicos elegibles de JobToday.
  // Slugs verificados hoy 2026-10-13 (200 + __NEXT_DATA__, 48–68 ofertas cada uno):
  // cobertura comercial amplia en español. Bajado a 7 slugs (2026-10-14): el budget
  // de subrequests por invocación se agotaba y FreeHire LATAM quedaba fuera; los
  // anuncios de JobToday se replican entre slugs y el dedup por URL los colapsa,
  // así que conservar los slugs de mayor rendimiento (vendedor 15, agente
  // comercial/comercial 2-2, closer/núcleo) mantiene casi toda la cobertura única.
  { code: 'jobtoday-agente-comercial', name: 'JobToday Agente comercial', kind: 'jobtoday', slug: 'agente-comercial' },
  { code: 'jobtoday-vendedor', name: 'JobToday Vendedor', kind: 'jobtoday', slug: 'vendedor' },
  // Añadido tras medir ROI 2026-10-14 (sesión 16): 48 ítems, 48 URLs únicas,
  // 23 NUEVAS vs catálogo real — la mejor ampliación por subrequest medida.
  { code: 'jobtoday-asesor-de-ventas', name: 'JobToday Asesor de ventas', kind: 'jobtoday', slug: 'asesor-de-ventas' },
  // Familia closer (re-medida 2026-10-20 contra el sitio real): el slug 'closers'
  // responde **410 Gone** en TODOS los runs (fallaba un subrequest cada recogida y
  // aportaba 0), así que se retira. El inventario real de closer en JobToday está
  // agotado: 'closer-de-ventas' devuelve 11 anuncios con hasNext=false (una sola
  // página, sin paginación) y 'closer-remoto' 3; entre los 10 slugs sólo hay UN
  // anuncio de closer único con URL que pase los gates. Los slugs con inventario
  // vivo que añaden algo son 'closer-comercial' (2 ítems: 1 closer) y
  // 'ventas-presencial' (48 ítems: 1 closer + 2 setter elegibles). Ojo: 'high-ticket',
  // 'setter', 'appointment-setter', 'cerrador', 'cerrador-de-ventas',
  // 'closer-high-ticket' y 'comercial-closer' (medido: mismo inventario que
  // 'closer-comercial', se descarta por coste) no aportan fuentes nuevas.
  { code: 'jobtoday-closer-comercial', name: 'JobToday Closer comercial', kind: 'jobtoday', slug: 'closer-comercial' },
  { code: 'jobtoday-closer-remoto', name: 'JobToday Closer remoto', kind: 'jobtoday', slug: 'closer-remoto' },
  { code: 'jobtoday-ventas-presencial', name: 'JobToday Ventas presencial', kind: 'jobtoday', slug: 'ventas-presencial' },
  // Barrido por ciudad (medido 2026-10-22 contra el sitio real): las páginas de
  // ciudad de JobToday NO son la nacional filtrada — devuelven inventario distinto.
  // 'closer-de-ventas' nacional: 8 anuncios; Barcelona 6, Sevilla 1 y Málaga 1 que la
  // nacional no trae. El dedupe por URL colapsa los repetidos; una ciudad que responde
  // 410 (Valencia, Bilbao, Zaragoza, Murcia, Alicante para los términos closer) se
  // omite sin ocultar al resto. Presupuesto: 3 fetches medidos, no 8.
  { code: 'jobtoday-closer-ciudades', name: 'JobToday Closer · ciudades', kind: 'jobtoday-cities',
    paths: ['closer-de-ventas/barcelona', 'closer-de-ventas/sevilla', 'closer-de-ventas/malaga'] },
  // 'ventas-presencial' por ciudad sí tiene inventario en todas (48/25/17 filas frente
  // a las 48 de la nacional): aporta sobre todo AE/setter. 3 fetches, no 8: con 8 el
  // run agotó el presupuesto de subrequests y FreeHire/GetOnBoard/ATS quedaron fuera.
  { code: 'jobtoday-presencial-ciudades', name: 'JobToday Ventas · ciudades', kind: 'jobtoday-cities',
    paths: ['ventas-presencial/barcelona', 'ventas-presencial/valencia', 'ventas-presencial/alicante'] },
  // Himalayas y We Work Remotely se retiran (2026-10-22): 0 elegibles en la ventana,
  // 104 revisadas y todo en inglés; gastaban 2 fetches del presupuesto de subrequests
  // que ahora financia el barrido por ciudad (el rol remoto lo cubren GetOnBoard y
  // FreeHire con inventario español).
  // Añadidas 2026-10-13 con posibilidad de verificación real hoy:
  // GetOnBoard API pública (verificada 2026-10-13: 200, categorías ventas LATAM, 21 páginas);
  // FreeHire ES (200, 2941 totales, reality.class filtrable) y FreeHire LATAM.
  // RemotoJOB RSS 404 hoy — se queda fuera (fallo visible y tradicional en otros modos).
  { code: 'getonbrd', name: 'Get on Board · ventas', kind: 'getonbrd' },
  { code: 'freehire', name: 'FreeHire España', kind: 'freehire', region: 'es' },
  { code: 'freehire-latam', name: 'FreeHire LATAM', kind: 'freehire', region: 'latam' },
  // ATS al final: el budget de subrequests por invocación (~20 fetches medidos
  // 2026-10-15) se agotaba antes de terminar. Recorte por ROI 2026-10-14 (sesión
  // 16): fuera greenhouse ×3 y recruitee. Hoy 2026-10-15: fuera también
  // ashby-pennylane — 401 del proveedor TODOS los días (evidencia en funnels 14→15)
  // = 1 subrequest garantido en 0; si WDC reabre su board, se re-añade con el
  // hallazgo ya documentado aquí. Queda monestcapital (única ATS con closers reales).
  { code: 'ats-teamtailor-monestcapital', name: 'Monest Capital · Teamtailor', kind: 'teamtailor', slug: 'monestcapital' },
  // La entrada estaba DUPLICADA (2026-10-20): el run recorría el mismo board dos veces,
  // la segunda instancia quedaba 'queued' para siempre en /api/status y gastaba un
  // subrequest que necesita la cola ATS.
];

// ------ utilidades ------
const now = () => new Date().toISOString().replace('Z', '+00:00');
const dayKey = () => new Date().toISOString().slice(0, 10);

async function sha256(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function stableId(prefix, text) {
  // id determinista: la misma oferta externa mapea siempre al mismo job (sin reescribir evidencia)
  return `${prefix}-` + text.split('').reduce((a, c) => (Math.imul(31, a) + c.charCodeAt(0)) | 0, 7).toString(36).replace('-', '0');
}

async function fetchText(url, timeoutMs = 15000) {
  const response = await fetch(url, { headers: { 'User-Agent': UA, 'Accept': '*/*' }, signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

const pick = (obj, ...keys) => { for (const k of keys) { const v = obj?.[k]; if (v !== undefined && v !== null && v !== '') return v; } return null; };

// ------ extractores por tipo de fuente → candidatos { external_id, payload } ------
// Modelo real de JobToday (verificado contra payloads 2026-10-14):
// título del puesto en row.role, entidad contratante en companyName,
// dirección legible en row.address, cuerpo completo en row.description,
// fecha como createDate (epoch ms) o postedSecondsAgo (edad). Si el
// extractor usa claves que no existen (title, workplaceAddress) el
// ingestBatch descarta silenciosamente cada candidato: no hay ofertas.
function jobTodayCandidate(row) {
  const external = String(row.key || row.canonicalUrl || '');
  if (!external) return null;
  const postedAt = row.createDate ? new Date(Number(row.createDate)).toISOString()
    : (row.postedSecondsAgo != null ? new Date(Date.now() - Number(row.postedSecondsAgo) * 1000).toISOString() : null);
  return { external_id: external, payload: {
    title: pick(row, 'title', 'positionName', 'role', 'companyName'),
    company: row.companyName ?? row.company?.name ?? null,
    location: pick(row, 'address', 'workplaceAddress', 'location', 'city'),
    url: row.canonicalUrl ? (row.canonicalUrl.startsWith('http') ? row.canonicalUrl : `https://jobtoday.com${row.canonicalUrl}`) : null,
    salary: pick(row, 'salary'),
    posted_at: postedAt, raw: row,
  } };
}

function jobTodayRows(html) {
  const match = html.match(/<script id="__NEXT_DATA__"[^>]*>(.*?)<\/script>/s);
  if (!match) throw new Error('JobToday no incluye su listado embebido; formato cambiado');
  let data;
  try { data = JSON.parse(match[1]); } catch { throw new Error('NEXT_DATA no parseable'); }
  const sections = data?.props?.pageProps?.feed?.sections;
  if (!Array.isArray(sections)) throw new Error('La estructura embebida de JobToday ha cambiado');
  return sections.flatMap(s => (s.items || [])).filter(it => it && typeof it.payload === 'object').map(it => it.payload);
}

async function sourceJobToday(source) {
  const rows = jobTodayRows(await fetchText(`https://jobtoday.com/es/trabajos-${source.slug}`));
  return rows.slice(0, MAX_ITEMS_PER_SOURCE).map(jobTodayCandidate).filter(Boolean);
}

// Barrido por ciudad: una ruta caída (410/404/red) no invalida las demás, y el
// resultado se dedupe por external_id dentro de la propia fuente. La nacional no
// se repite aquí: las ciudades que devuelven lo mismo las colapsa el dedupe por URL.
async function sourceJobTodayCities(source) {
  const out = [];
  const seen = new Set();
  for (const path of source.paths ?? []) {
    try {
      for (const row of jobTodayRows(await fetchText(`https://jobtoday.com/es/trabajos-${path}`))) {
        const candidate = jobTodayCandidate(row);
        if (!candidate || seen.has(candidate.external_id)) continue;
        seen.add(candidate.external_id);
        out.push(candidate);
      }
    } catch { /* ciudad sin listado: se omite, no oculta al resto */ }
  }
  return out.slice(0, MAX_ITEMS_PER_SOURCE);
}

async function sourceGreenhouse(source) {
  const data = JSON.parse(await fetchText(`https://boards-api.greenhouse.io/v1/boards/${source.slug}/jobs`));
  return (data.jobs || []).slice(0, MAX_ITEMS_PER_SOURCE).map(j => ({ external_id: String(j.id), payload: {
    title: j.title, company: source.name.split(' · ')[0], location: pick(j.location, 'name'),
    url: j.absolute_url, posted_at: j.updated_at ? new Date(j.updated_at).toISOString() : null, raw: j,
  } }));
}

async function sourceAshby(source) {
  const data = JSON.parse(await fetchText(`https://api.ashbyhq.com/posting-api/job-board/${source.slug}`));
  return (data.jobs || []).slice(0, MAX_ITEMS_PER_SOURCE).map(j => ({ external_id: String(j.id || j.jobUrl), payload: {
    title: j.title, company: source.name.split(' · ')[0], location: pick(j, 'location', 'secondaryAddressesText'),
    url: j.jobUrl, posted_at: j.publishedAt ? new Date(j.publishedAt).toISOString() : null, raw: j,
  } }));
}

async function sourceRecruitee(source) {
  const data = JSON.parse(await fetchText(`https://${source.slug}.recruitee.com/api/offers/`));
  return (data.offers || []).slice(0, MAX_ITEMS_PER_SOURCE).map(j => ({ external_id: String(j.id), payload: {
    title: j.title, company: j.company_name || source.name.split(' · ')[0], location: j.location,
    url: j.careers_url || j.careers_apply_url, posted_at: j.published_at ? new Date(j.published_at).toISOString() : null, raw: j,
  } }));
}

async function sourceTeamtailorRss(source) {
  const xml = await fetchText(`https://careers.${source.slug}.com/jobs.rss`);
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, MAX_ITEMS_PER_SOURCE).map(m => {
    const item = m[1];
    const field = tag => (item.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`)) || [])[1]?.trim() || '';
    const title = field('title').replace(/<!\[CDATA\[|\]\]>/g, '');
    const link = field('link');
    return { external_id: link || stableId('tt', title), payload: {
      title, company: source.name.split(' · ')[0], location: field('location') || null,
      url: link, posted_at: field('pubDate') ? new Date(field('pubDate')).toISOString() : null, raw: { title, link, description: field('description').slice(0, 4000) },
    } };
  });
}

async function sourceHimalayas() {
  // Términos del vocabulario comercial (no inventados; un término = una búsqueda pública).
  const terms = ['closer']; // 1 fetch (budget de subrequests 2026-10-15; ver comentario en SOURCES)
  const all = [];
  for (const term of terms) {
    const data = JSON.parse(await fetchText(`https://himalayas.app/jobs/api/search?q=${encodeURIComponent(term)}&sort=recent&page=1`));
    for (const j of (data.jobs || data || []).slice(0, 40)) {
      const external = String(pick(j, 'id', 'jobId', 'slug') || j.title || '');
      if (!external) continue;
      all.push({ external_id: external, payload: {
        title: pick(j, 'title', 'jobTitle'), company: pick(j, 'companyName', 'company'),
        location: pick(j, 'locationRestrictions', 'location'), url: pick(j, 'applicationLink', 'jobUrl', 'guid'),
        posted_at: pick(j, 'publishedDate', 'pubDate'), raw: j,
      } });
    }
  }
  return all;
}

async function sourceRss(source) {
  const xml = await fetchText(source.slug);
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, 100).map(m => {
    const item = m[1];
    const field = tag => (item.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`)) || [])[1]?.replace(/<!\[CDATA\[|\]\]>/g, '').trim() || '';
    const title = field('title'); const link = field('link');
    return { external_id: link || stableId('rss', title), payload: {
      title, company: null, location: null, url: link,
      posted_at: field('pubDate') ? new Date(field('pubDate')).toISOString() : null, raw: { title, link, description: field('description').slice(0, 2000) },
    } };
  });
}

async function sourceGetOnBoard() {
  // API pública v0 de getonbrd.com, categoría 'sales' (verificada 2026-10-13, 21 páginas).
  // Tope 2 páginas: en Cloudflare los fetch del Worker cuentan subrequests (límites del plan);
  // 13 fuentes × varias páginas en la misma invocación agotó la cuota el primer run real.
  const all = [];
  for (let page = 1; page <= 2; page++) {
    const data = JSON.parse(await fetchText(`https://www.getonbrd.com/api/v0/categories/sales/jobs?per_page=50&page=${page}`));
    const rows = data.data || [];
    for (const row of rows) {
      const a = row.attributes ?? {};
      const external = String(row.id ?? '');
      if (!external || !a.title) continue;
      // La empresa y la modalidad llegan como relación {data:{id}}; sin incluir el nombre
      // viene en el listado publico: queda 'Empresa no indicada' honesto a nivel de lista.
      all.push({ external_id: external, payload: {
        title: a.title, company: typeof a.company === 'string' ? a.company : null, location: Array.isArray(a.countries) ? a.countries.join(', ') : a.countries,
        url: (row.links && row.links.public_url) || null,
        posted_at: a.published_at != null ? new Date(Number(a.published_at) < 2e10 ? Number(a.published_at) * 1000 : Number(a.published_at)).toISOString() : null, raw: row,
      } });
    }
    const totalPages = data.meta?.total_pages;
    if (!totalPages || page >= totalPages) break;
  }
  return all.slice(0, MAX_ITEMS_PER_SOURCE);
}

async function sourceFreehire(source) {
  // API pública v1 de freehire.me (agregador de 92 ATS, verificada 2026-10-13:
  // 2941 ofertas); igual que el conector local, solo 'fresh'/sin señal cuentan:
  // 'stale' y 'likely-evergreen' son fichas repintadas, no novedades.
  const params = new URLSearchParams({ category: 'sales', limit: '100', sort: 'posted_at', order: 'desc' });
  if (source.region === 'es') params.set('countries', 'ES');
  if (source.region === 'latam') params.set('regions', 'latam');
  // LATAM es el pool más grande y el último en la secuencia de subrequests del run;
  // a 2 páginas siguió agotando la cuota del plan: queda a 1 página (100 más recientes).
  // ES a 3 páginas (2026-10-14): la página 3 (offset 200) midió 14 elegibles
  // ES por 100 revisadas, la mejor de las tres: p1 4, p2 9 — la p1 está llena de
  // fichas repintadas que el filtro reality descarta). Coste: +1 subrequest que
  // absorbe la cola ATS.
  const maxPages = source.region === 'latam' ? 1 : 3;
  const all = [];
  for (let page = 0; page < maxPages; page++) {
    const offset = page * 100;
    const data = JSON.parse(await fetchText(`https://freehire.me/api/v1/jobs/search?${params}&offset=${offset}`));
    const rows = data.data || [];
    for (const row of rows) {
      const reality = row.reality && typeof row.reality === 'object' ? row.reality : {};
      if (reality.class && !['fresh', null, undefined].includes(reality.class)) continue;
      const external = String(row.public_slug || row.url || '');
      if (!external || !row.url) continue;
      all.push({ external_id: external.slice(-120), payload: {
        title: row.title, company: row.company ?? row.company_name ?? null, location: Array.isArray(row.countries) ? row.countries.join(', ') : (row.location || null),
        url: row.url, posted_at: row.posted_at ?? null, raw: row,
      } });
    }
    const total = data.meta?.total; const pageLen = rows.length;
    if (!Number.isFinite(total) || offset + 100 >= total || pageLen < 100) break;
  }
  return all.slice(0, MAX_ITEMS_PER_SOURCE);
}

const EXTRACTORS = {
  jobtoday: sourceJobToday, 'jobtoday-cities': sourceJobTodayCities, greenhouse: sourceGreenhouse, ashby: sourceAshby,
  recruitee: sourceRecruitee, teamtailor: sourceTeamtailorRss, himalayas: sourceHimalayas, rss: sourceRss,
  getonbrd: sourceGetOnBoard, freehire: sourceFreehire,
};

// ------ esquema D1 (additiva, versionada; equivalente del núcleo local) ------
async function ensureSchema(db) {
  await db.batch([
    db.prepare('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY)'),
    db.prepare('INSERT OR IGNORE INTO schema_version VALUES (1)'),
    db.prepare(`CREATE TABLE IF NOT EXISTS raw_items (
      id TEXT PRIMARY KEY, org_id TEXT NOT NULL, source TEXT NOT NULL, provider TEXT NOT NULL,
      external_id TEXT NOT NULL, content_hash TEXT NOT NULL, payload TEXT NOT NULL, captured_at TEXT NOT NULL,
      UNIQUE(org_id, source, external_id, content_hash))`),
    db.prepare(`CREATE TABLE IF NOT EXISTS job_postings (
      id TEXT PRIMARY KEY, org_id TEXT NOT NULL, raw_id TEXT NOT NULL, source TEXT NOT NULL,
      external_id TEXT NOT NULL, payload TEXT NOT NULL, UNIQUE(org_id, source, external_id))`),
    db.prepare('CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, org_id TEXT NOT NULL, posting_id TEXT NOT NULL, starred INTEGER NOT NULL DEFAULT 0, UNIQUE(org_id, posting_id))'),
    db.prepare(`CREATE TABLE IF NOT EXISTS catalog_entries (
      org_id TEXT NOT NULL, job_id TEXT NOT NULL, first_seen_at TEXT NOT NULL, expires_at TEXT NOT NULL,
      PRIMARY KEY(org_id, job_id))`),
    db.prepare(`CREATE TABLE IF NOT EXISTS collection_runs (
      id TEXT PRIMARY KEY, org_id TEXT NOT NULL, day TEXT NOT NULL, status TEXT NOT NULL,
      sources TEXT NOT NULL, created_at TEXT NOT NULL, completed_at TEXT)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS opportunities (
      id TEXT PRIMARY KEY, org_id TEXT NOT NULL, job_id TEXT NOT NULL, current_version_id TEXT,
      editorial_status TEXT NOT NULL DEFAULT 'draft', opportunity_status TEXT NOT NULL DEFAULT 'verifying',
      connection_type TEXT NOT NULL DEFAULT 'external_application',
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(org_id, job_id))`),
    db.prepare(`CREATE TABLE IF NOT EXISTS opportunity_versions (
      id TEXT PRIMARY KEY, org_id TEXT NOT NULL, opportunity_id TEXT NOT NULL, version INTEGER NOT NULL,
      locale TEXT NOT NULL DEFAULT 'es', payload TEXT NOT NULL, created_by TEXT NOT NULL, created_at TEXT NOT NULL,
      UNIQUE(org_id, opportunity_id, version))`),
    // Evidencia de verificación de vigencia (port fase 3, espejo migrate v12 local):
    // append-only, una fila por comprobación con su TTL y razón; apunta al raw.
    db.prepare(`CREATE TABLE IF NOT EXISTS verification_events (
      id TEXT PRIMARY KEY, org_id TEXT NOT NULL, job_id TEXT NOT NULL,
      posting_id TEXT, checked_at TEXT NOT NULL, result TEXT NOT NULL,
      method TEXT NOT NULL, evidence_raw_id TEXT, valid_until TEXT,
      reason_code TEXT, verifier_version TEXT NOT NULL DEFAULT '1')`),
    db.prepare('CREATE INDEX IF NOT EXISTS verification_job ON verification_events(org_id, job_id, checked_at)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_catalog_expiry ON catalog_entries(org_id, expires_at)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_runs_created ON collection_runs(org_id, created_at)'),
    // Evidencia del audit periódico de slugs JobToday (append-only, como raw_items):
    // una fila por (slug, día) con el destino real; nunca reescribe el slug de la fuente.
    db.prepare(`CREATE TABLE IF NOT EXISTS slug_audit (
      id TEXT PRIMARY KEY, org_id TEXT NOT NULL, source TEXT NOT NULL, slug TEXT NOT NULL,
      checked_at TEXT NOT NULL, day TEXT NOT NULL, status TEXT NOT NULL,
      http_status INTEGER, requested_url TEXT NOT NULL, canonical_url TEXT, renamed_from TEXT,
      UNIQUE(org_id, source, day))`),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_slug_audit_day ON slug_audit(org_id, day)'),
  ]);
  // Columnas de vigencia derivadas de verify (port fase 3): ALTER tolerante — en una
  // base ya existente la columna está y D1 lo reclama, que es el estado correcto.
  for (const col of ['last_verified_at', 'verified_until', 'status_reason']) {
    try { await db.prepare(`ALTER TABLE opportunities ADD COLUMN ${col} TEXT`).run(); } catch { /* ya existe */ }
  }
  // Procedencia del revisor (espejo de opportunity_versions del núcleo local, sesión 38):
  // el contrato aceptaba `reviewed_by` y lo descartaba, así que la identidad del
  // operador que aprobó/públicó no quedaba registrada en el cloud. ALTER tolerante.
  for (const col of ['reviewed_by', 'reviewed_at']) {
    try { await db.prepare(`ALTER TABLE opportunity_versions ADD COLUMN ${col} TEXT`).run(); } catch { /* ya existe */ }
  }
}

// ------ audit periódico de slugs JobToday ------
// Equivalente en la nube de audit_jobtoday_slugs de scripts/audit_sources.py:
// comprueba el destino real de cada ruta (200 aquí, 301/302/303/307/308 renombrado,
// 410 gone) ANTES de que falle la recogida; registra evidencia en D1 sin tocar slugs.
const REDIRECT_HINT = new Set([301, 302, 303, 307, 308]);

function jobTodaySources() {
  return SOURCES.filter(s => s.kind === 'jobtoday');
}

async function auditSlug(source) {
  const url = `https://jobtoday.com/es/trabajos-${source.slug}`;
  const record = { checked_at: now(), url, status: 'ok', canonical_url: url, http_status: null };
  try {
    const response = await fetch(url, { headers: { 'User-Agent': UA, 'Accept': '*/*' },
      redirect: 'manual', signal: AbortSignal.timeout(15000) });
    record.http_status = response.status;
    if (REDIRECT_HINT.has(response.status)) {
      const location = response.headers.get('location')?.trim() || '';
      record.status = 'renamed';
      record.renamed_from = url;
      if (location) record.canonical_url = new URL(location, url).toString();
    } else if (response.status === 410) {
      record.status = 'gone';
    } else if (response.status !== 200) {
      record.status = 'unavailable';
    }
  } catch (error) {
    record.status = 'unreachable';
    record.warning = String(error.message || error).slice(0, 200);
  }
  return record;
}

async function runSlugAudit(env) {
  const db = env.DB;
  const day = dayKey();
  const results = await Promise.all(jobTodaySources().map(async source => {
    const record = await auditSlug(source);
    record.slug = source.slug; record.source = source.code; record.day = day;
    return record;
  }));
  const statements = results.map(record => db.prepare(`INSERT INTO slug_audit
    (id,org_id,source,slug,checked_at,day,status,http_status,requested_url,canonical_url,renamed_from)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(org_id, source, day) DO NOTHING`)
    .bind('slug-' + stableId('a', `${ORG}|${record.source}|${record.day}`), ORG, record.source,
      record.slug, record.checked_at, record.day, record.status, record.http_status,
      record.url, record.canonical_url, record.renamed_from ?? null));
  await db.batch(statements);
  return { day, slugs: results.map(({ source, slug, status, http_status, canonical_url, renamed_from }) =>
    ({ source, slug, status, http_status: http_status ?? null, canonical_url, renamed_from: renamed_from ?? null })) };
}

// El audit diario vive aquí y lo consume el principio de runCollection: corre UNA
// vez por día (sus filas en slug_audit hacen de cache con ON CONFLICT DO NOTHING)
// y siempre ANTES del ingest, con el presupuesto de ~50 subrequests de producción
// fresco (la versión de cola agotaba el presupuesto: 8/8 unreachable instantáneo,
// evidencia 2026-10-15 con el mismo checked_at al ms y sin http_status).
async function ensureDaySlugAudit(env) {
  const db = env.DB;
  const day = dayKey();
  const existing = await db.prepare('SELECT status,http_status FROM slug_audit WHERE org_id=? AND day=?')
    .bind(ORG, day).all();
  if (existing.results.length >= jobTodaySources().length) return { day, cached: true, slugs: existing.results };
  return runSlugAudit(env);
}

async function handleAudit(request, env) {
  const db = env.DB;
  await ensureSchema(db);
  const day = dayKey();
  // ?force=1: rerun en vivo del audit (8 fetches HTTP en su propia petición, con
  // el presupuesto de subrequests entero). Útil cuando el audit diario se escribió
  // desde un run con el presupuesto ya tapado; la fila del día mane igual (DO NOTHING).
  // Audit run-1 finding 3: force quema subrequests/escrituras de SU cuota → solo
  // con credencial admin. La lectura cacheada del día sigue pública (solo lectura).
  const force = new URL(request.url).searchParams.get('force') === '1';
  if (force) {
    const adminCheck = requireAdmin(request, env);
    if (adminCheck) return adminCheck;
  }
  if (!force) {
    const existing = await db.prepare(
      'SELECT source,slug,status,http_status,canonical_url,renamed_from,checked_at FROM slug_audit WHERE org_id=? AND day=? ORDER BY source')
      .bind(ORG, day).all();
    if (existing.results.length >= jobTodaySources().length) {
      return Response.json({ day, cached: true, slugs: existing.results }, { headers: corsHeaders(request) });
    }
  }
  const result = await runSlugAudit(env);
  return Response.json({ ...result, cached: false, forced: force }, { headers: corsHeaders(request) });
}

// ------ admin (lector del panel cloud, sesión 27) ------
// El panel admin de la app vive por turnos en el Mac (FastAPI/SQLite). Este port a
// internet va por fases; fase 1 = lectura del catálogo cloud. GATE: la cabecera
// X-Admin-Token debe coincidir con el secreto ADMIN_TOKEN; si no existe, 401
// (seguro por defecto: sin token desplegado, la superficie admin está cerrada).
// Comparación en tiempo constante: un `!==` sobre el token filtra su longitud y
// prefijo por temporización. WORKERS no expone timingSafeEqual, así que se recorre
// la cadena completa sin cortocircuito.
function tokenMatches(received, expected) {
  const a = String(received ?? '');
  const b = String(expected ?? '');
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}
function requireAdmin(request, env) {
  if (!env.ADMIN_TOKEN) return Response.json({ detail: 'Admin no configurado en el engine' }, { status: 403 });
  if (!tokenMatches(request.headers.get('X-Admin-Token'), env.ADMIN_TOKEN)) return Response.json({ detail: 'No autorizado' }, { status: 401 });
  return null;
}

// ------ admin (port fase 2: revisión editorial, sesión 28) ------
// MISMO CONTRATO que POST /opportunities/{id}/review del núcleo local (domain.py):
// la revisión crea una versión NUEVA e inmutable y mueve el puntero; el raw y las
// versiones previas no cambian. El payload es reemplazo completo con extra=forbid
// (un campo desconocido del formulario se NOMBRA en el 422; no se descarta en silencio).
// Reglas de publicación espejadas: sin modalidad determinada no se publica;
// no se publica cerrada; el siguiente paso solo con vigencia activa verificada;
// con vigencia activa el CTA se habilita solo (aquí la vigencia es catalog_entries).
const EDITORIAL_STATUSES = ['draft', 'needs_review', 'approved', 'published', 'withdrawn'];
const APPLICATION_TYPES = ['company_ats', 'external_platform', 'marketplace', 'wdc_referral', 'email', 'contact_form', 'community_contact', 'unknown'];
const LIST_FIELDS = ['what_they_are_looking_for', 'what_you_would_do', 'language_requirements', 'why_it_may_be_interesting'];
const STR_FIELDS = ['headline', 'role', 'short_summary', 'compensation_summary', 'location_summary', 'experience_summary'];
const NEXT_STEP_FIELDS = ['action', 'label', 'destination_label', 'destination_domain', 'requires_account', 'enabled', 'disabled_reason'];

function versionPayloadError(payload) {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return 'version_payload debe ser un objeto';
  const unknown = Object.keys(payload).filter(k => !STR_FIELDS.includes(k) && !LIST_FIELDS.includes(k)
    && !['application_type', 'application_url', 'next_step'].includes(k));
  if (unknown.length) return 'Campos no permitidos en version_payload: ' + unknown.sort().join(', ');
  for (const f of ['headline', 'role']) {
    if (typeof payload[f] !== 'string' || !payload[f].trim()) return `${f}: Field required (cadena no vacía)`;
  }
  for (const f of STR_FIELDS) {
    if (payload[f] !== undefined && typeof payload[f] !== 'string') return `${f}: debe ser cadena`;
  }
  for (const f of LIST_FIELDS) {
    if (payload[f] !== undefined && (!Array.isArray(payload[f]) || payload[f].some(x => typeof x !== 'string')))
      return `${f}: debe ser lista de cadenas`;
  }
  if (payload.application_type !== undefined && !APPLICATION_TYPES.includes(payload.application_type))
    return 'application_type: valor fuera del vocabulario canónico';
  if (payload.application_url !== undefined && payload.application_url !== null
      && !/^https:\/\//.test(payload.application_url))
    return 'application_url: debe ser https pública (no se permiten direcciones locales)';
  if (payload.next_step !== undefined) {
    const ns = payload.next_step;
    if (typeof ns !== 'object' || ns === null || Array.isArray(ns)) return 'next_step: debe ser objeto';
    const extra = Object.keys(ns).filter(k => !NEXT_STEP_FIELDS.includes(k));
    if (extra.length) return 'Campos no permitidos en next_step: ' + extra.sort().join(', ');
    if ('enabled' in ns && typeof ns.enabled !== 'boolean') return 'next_step.enabled: debe ser booleano';
    if ('action' in ns && typeof ns.action !== 'string') return 'next_step.action: debe ser cadena';
    if ('label' in ns && typeof ns.label !== 'string') return 'next_step.label: debe ser cadena';
  }
  return null;
}

async function handleAdminDetail(request, env, opportunityId) {
  // Detalle para la UI del panel web (port fase 4): snapshot del anuncio original
  // (raw, inmutado), payload real de la versión actual (sea raw-shape del collector
  // o presentación de una revisión) y vigencia. La UI mapea ambas formas de payload;
  // nunca inventa campos que el payload no trae.
  const db = env.DB;
  await ensureSchema(db);
  const row = await db.prepare(
    `SELECT o.id AS opportunity_id, o.current_version_id, o.editorial_status, o.opportunity_status, o.connection_type, o.created_at, o.updated_at,
            o.last_verified_at, o.verified_until, o.status_reason,
            j.id AS job_id, p.source, p.payload AS posting_payload, p.external_id
       FROM opportunities o
       JOIN jobs j ON j.org_id=o.org_id AND j.id=o.job_id
       JOIN job_postings p ON p.org_id=j.org_id AND p.id=j.posting_id
      WHERE o.org_id=? AND o.id=?`).bind(ORG, opportunityId).first();
  if (!row) return Response.json({ detail: 'Oportunidad no encontrada' }, { status: 404 });
  // OJO: el alias del id es opportunity_id (row.id no existe en este SELECT):
  // bindear una columna inexistente llegó a D1 como undefined (500 en workerd).
  const version = row.current_version_id
    ? await db.prepare('SELECT version, locale, payload FROM opportunity_versions WHERE org_id=? AND opportunity_id=? AND id=?').bind(ORG, row.opportunity_id, row.current_version_id).first()
    : await db.prepare('SELECT version, locale, payload FROM opportunity_versions WHERE org_id=? AND opportunity_id=? ORDER BY version DESC LIMIT 1').bind(ORG, row.opportunity_id).first();
  const vig = await db.prepare('SELECT expires_at FROM catalog_entries WHERE org_id=? AND job_id=?').bind(ORG, row.job_id).first();
  const expiresMs = vig?.expires_at ? Date.parse(vig.expires_at) : NaN;
  const posting = JSON.parse(row.posting_payload);
  return Response.json({
    id: row.opportunity_id, job_id: row.job_id, source: row.source, external_id: row.external_id,
    editorial_status: row.editorial_status, opportunity_status: row.opportunity_status,
    connection_type: row.connection_type, created_at: row.created_at, updated_at: row.updated_at,
    version: version?.version ?? null, version_locale: version?.locale ?? null,
    version_payload: version ? JSON.parse(version.payload) : null,
    job_snapshot: { title: posting.title ?? null, company: posting.company ?? null, location: posting.location ?? null,
      salary: posting.salary ?? null, posted_at: posting.posted_at ?? null, source_url: posting.url ?? null, source: row.source },
    vigencia: { expires_at: vig?.expires_at ?? null, activa: Number.isFinite(expiresMs) && Date.now() < expiresMs },
    verificacion: { last_verified_at: row.last_verified_at ?? null, verified_until: row.verified_until ?? null, status_reason: row.status_reason ?? null },
  }, { headers: corsHeaders(request) });
}

// ------ admin (port fase 3: verificación de vigencia, sesión 32) ------
// MISMO CONTRATO que POST /opportunities/{id}/verify del núcleo local (domain.py):
// un GET acotado (1 petición, timeout 10 s, sin reintentos, redirect manual = una
// redirección NO verifica) clasificado por CONTENIDO: HTTP 200 solo nunca basta,
// el cuerpo debe mencionar el título (≥5 chars plegado) o la empresa del anuncio.
// Escribe evidencia raw inmutable (source 'verification') + verification_events con
// TTL por tipo de fuente y actualiza la vigencia derivada de opportunities.
// El CTA de la versión vigente se deriva de la vigencia: enabled solo con active.
const TTL_HOURS_BY_KIND = { ats: 72, serpapi: 24, aggregator: 48 };
const DEFAULT_TTL_HOURS = 24;
const AGGREGATOR_SOURCES = new Set(['himalayas', 'weworkremotely', 'jobicy', 'remotive', 'remoteok', 'arbeitnow',
  'workingnomads', 'virtualvocations', 'remotejobs', 'remotefirstjobs',
  'jobspresso', 'remotojob', 'getonbrd-public', 'freehire']);
function ttlHoursForSource(source) {
  const kind = source.startsWith('ats-') ? 'ats' : source.startsWith('google') ? 'serpapi'
    : (AGGREGATOR_SOURCES.has(source) || source.startsWith('jobtoday')) ? 'aggregator' : 'unknown';
  return TTL_HOURS_BY_KIND[kind] ?? DEFAULT_TTL_HOURS;
}
function classifyVerification(status, titleFound, companyFound) {
  if (status === 404 || status === 410) return ['closed', 'job_not_found'];
  if (status === 200) {
    if (titleFound || companyFound) return ['open', 'content_matches'];
    return ['unknown', 'content_not_corroborated'];
  }
  if (status === 403 || status === 429) return ['unknown', 'source_blocked'];
  return ['unknown', 'http_' + String(status)];
}
async function sha256Hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}
async function checkTarget(url, title, company) {
  let status = null, body = null;
  try {
    const response = await fetch(url, { headers: { 'User-Agent': UA, 'Accept': '*/*' },
      redirect: 'manual', signal: AbortSignal.timeout(10000) });
    status = response.status;
    const text = response.status === 200 ? (await response.text()).slice(0, 200_000) : '';
    body = text;
  } catch { return ['unknown', 'network_unreachable', { http_status: null }]; }
  if ([301, 302, 303, 307, 308].includes(status))
    return ['unknown', 'redirect_without_verification', { http_status: status }];
  const titleFolded = fold(title || '');
  const bodyFolded = fold(body || '');
  const titleFound = Boolean(titleFolded) && titleFolded.length >= 5 && bodyFolded.includes(titleFolded);
  const companyFound = Boolean(company) && bodyFolded.includes(fold(company));
  const [result, reasonCode] = classifyVerification(status, titleFound, companyFound);
  return [result, reasonCode, { http_status: status, title_found: titleFound, company_found: companyFound, checked_chars: (body || '').length }];
}
// Núcleo de la verificación de vigencia (port fase 3): UNA sola ruta de escritura,
// compartida por el POST /verify de una oferta y por la activación en lote. Devuelve
// `{ error }` cuando no hay URL verificable (el llamante decide el 409).
async function runVerification(db, row, posting, requestedUrl) {
  // OJO: el id va en el SELECT — bindearlo después sin traerlo dio 500 undefined-unsupported (misma clase de bug de la sesión 28).
  const current = row.current_version_id
    ? await db.prepare('SELECT id, payload FROM opportunity_versions WHERE org_id=? AND opportunity_id=? AND id=?').bind(ORG, row.id, row.current_version_id).first()
    : await db.prepare('SELECT id, payload FROM opportunity_versions WHERE org_id=? AND opportunity_id=? ORDER BY version DESC LIMIT 1').bind(ORG, row.id).first();
  const reviewPayload = current ? JSON.parse(current.payload) : {};
  const postingPayload = JSON.parse(posting.payload);
  const url = requestedUrl || reviewPayload.application_url || postingPayload.url || null;
  if (!url || !/^https?:\/\//.test(url))
    return { error: 'Sin URL verificable: guarda un enlace de candidatura en la revisión' };
  const title = reviewPayload.headline ?? reviewPayload.title ?? postingPayload.title ?? '';
  const company = postingPayload.company ?? '';
  const method = 'http_status_content_v1';
  const [result, reasonCode, detail] = await checkTarget(url, title, company);
  // Evidencia raw inmutable (INSERT OR IGNORE con hash del contenido): repetir la
  // misma comprobación no duplica la evidencia, como en el núcleo local.
  const evidencePayload = JSON.stringify({ url, method, detail });
  const contentHash = await sha256Hex(evidencePayload);
  const evidenceId = `raw-${contentHash.slice(0, 32)}`;
  await db.prepare('INSERT OR IGNORE INTO raw_items (id,org_id,source,provider,external_id,content_hash,payload,captured_at) VALUES (?,?,?,?,?,?,?,?)')
    .bind(evidenceId, ORG, 'verification', method, row.job_id, contentHash, evidencePayload, now()).run();
  const checkedAt = now();
  const validUntil = result === 'open'
    ? new Date(Date.now() + ttlHoursForSource(row.source || posting.source) * 3_600_000).toISOString()
    : null;
  const statusDerived = { open: 'active', closed: 'closed', unknown: 'verifying' }[result];
  const statusReason = { open: `Verificado activa (${method}); vigente hasta ${validUntil}`,
    closed: `Cerrada según el origen (${reasonCode})`,
    unknown: `No verificable (${reasonCode}); sigue verificando` }[result];
  await db.batch([
    db.prepare('INSERT INTO verification_events (id,org_id,job_id,posting_id,checked_at,result,method,evidence_raw_id,valid_until,reason_code,verifier_version) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
      .bind(crypto.randomUUID(), ORG, row.job_id, row.posting_id ?? row.job_id, checkedAt, result, method, evidenceId, validUntil, reasonCode, '1'),
    db.prepare('UPDATE opportunities SET opportunity_status=?, last_verified_at=?, verified_until=?, status_reason=?, updated_at=? WHERE org_id=? AND id=?')
      .bind(statusDerived, checkedAt, validUntil, statusReason, checkedAt, ORG, row.id),
  ]);
  // CTA derivado en la VERSIÓN VIGENTE (append de carcasa next_step, igual que local):
  // enabled solo con active; disabled_reason narrado con la razón de la vigencia.
  let nextStepEnabled = Boolean(reviewPayload.next_step?.enabled);
  if (current && reviewPayload.next_step?.enabled !== (statusDerived === 'active')) {
    const payloadNext = { ...(reviewPayload.next_step || {}) };
    payloadNext.enabled = statusDerived === 'active';
    if (payloadNext.enabled) delete payloadNext.disabled_reason;
    else payloadNext.disabled_reason = statusReason;
    await db.prepare('UPDATE opportunity_versions SET payload=? WHERE org_id=? AND id=?')
      .bind(JSON.stringify({ ...reviewPayload, next_step: payloadNext }), ORG, current.id).run();
    nextStepEnabled = payloadNext.enabled;
  }
  return {
    result, method, checked_at: checkedAt, valid_until: validUntil,
    reason_code: reasonCode, evidence_raw_id: evidenceId,
    opportunity_status: statusDerived, next_step_enabled: nextStepEnabled,
    status_reason: statusReason, detail,
  };
}

async function handleAdminVerify(request, env, opportunityId) {
  const db = env.DB;
  await ensureSchema(db);
  const row = await db.prepare('SELECT * FROM opportunities WHERE org_id=? AND id=?').bind(ORG, opportunityId).first();
  if (!row) return Response.json({ detail: 'Oportunidad no encontrada' }, { status: 404 });
  // Snapshot del anuncio original vía jobs→posting_id (job_id NUNCA es un posting_id):
  // el JOIN correcto es el mismo que el resto de la superficie admin.
  const posting = await db.prepare(`SELECT p.payload AS payload, p.source AS source, p.id AS posting_id
    FROM jobs j JOIN job_postings p ON p.org_id=j.org_id AND p.id=j.posting_id
    WHERE j.org_id=? AND j.id=?`).bind(ORG, row.job_id).first();
  if (!posting) return Response.json({ detail: 'La oportunidad no tiene oferta original que verificar' }, { status: 409 });
  // URL a comprobar: explícita del operador (cuerpo), si no la de candidatura de la
  // revisión, si no la del anuncio original. Nunca se inventa una tercera fuente.
  let body = {};
  try { const parsed = await request.json(); if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) body = parsed; }
  catch { body = {}; } // cuerpo vacío = verificar la URL por defecto
  const outcome = await runVerification(db, row, posting, body.url || null);
  if (outcome.error) return Response.json({ detail: outcome.error }, { status: 409 });
  return Response.json(outcome, { headers: corsHeaders(request) });
}

async function handleAdminReview(request, env, opportunityId) {
  let body;
  try { body = await request.json(); } catch { return Response.json({ detail: 'Cuerpo JSON inválido' }, { status: 400 }); }
  if (typeof body !== 'object' || body === null) return Response.json({ detail: 'Cuerpo JSON inválido' }, { status: 400 });
  const { editorial_status, version_payload, locale, reviewed_by } = body;
  const finalLocale = locale === undefined ? 'es' : locale;
  if (!EDITORIAL_STATUSES.includes(editorial_status))
    return Response.json({ detail: 'editorial_status: valor fuera del vocabulario canónico (draft|needs_review|approved|published|withdrawn)' }, { status: 422 });
  if (!['es', 'en'].includes(finalLocale)) return Response.json({ detail: 'locale: debe ser es o en' }, { status: 422 });
  if (reviewed_by !== undefined && reviewed_by !== null && typeof reviewed_by !== 'string')
    return Response.json({ detail: 'reviewed_by: debe ser cadena o null' }, { status: 422 });
  const validation = versionPayloadError(version_payload);
  if (validation) return Response.json({ detail: validation }, { status: 422 });

  const db = env.DB;
  await ensureSchema(db);
  const row = await db.prepare('SELECT * FROM opportunities WHERE org_id=? AND id=?').bind(ORG, opportunityId).first();
  if (!row) return Response.json({ detail: 'Oportunidad no encontrada' }, { status: 404 });
  // Puntero con fallback: los items recogidos antes de setear current_version_id
  // en el ingest (sesión 28) siguen revisables si su versión inicial existe.
  let previousVersionId = row.current_version_id;
  if (!previousVersionId) {
    const prev = await db.prepare('SELECT id FROM opportunity_versions WHERE org_id=? AND opportunity_id=? ORDER BY version DESC LIMIT 1').bind(ORG, row.id).first();
    previousVersionId = prev?.id ?? null;
  }
  if (!previousVersionId) return Response.json({ detail: 'La oportunidad no tiene versión que revisar' }, { status: 409 });

  // Reglas de publicación (domain.py) con la vigencia real del catálogo cloud:
  // duration activa = catalog_entries.expires_at en el futuro.
  const payload = JSON.parse(JSON.stringify(version_payload));
  if (payload.next_step === undefined) payload.next_step = { enabled: false };
  const vig = await db.prepare('SELECT expires_at FROM catalog_entries WHERE org_id=? AND job_id=?').bind(ORG, row.job_id).first();
  const expiresMs = vig?.expires_at ? Date.parse(vig.expires_at) : NaN;
  const vigenciaActiva = Number.isFinite(expiresMs) && Date.now() < expiresMs;
  // En el cloud la fila está 'verifying' hasta que exista verificación dedicada:
  // vigencia vencida del catálogo = cerrada para la regla de publicación
  // (verificado en workerd 2026-10-15: sin esto, una vencida se publicaba).
  const cerrada = row.opportunity_status === 'closed' || (Number.isFinite(expiresMs) && !vigenciaActiva);
  if (editorial_status === 'published') {
    if ((payload.application_type ?? 'unknown') === 'unknown')
      return Response.json({ detail: 'No se publica sin modalidad de candidatura determinada; usa needs_review' }, { status: 422 });
    if (cerrada) return Response.json({ detail: 'No se publica una oportunidad cerrada' }, { status: 409 });
    if (payload.next_step.enabled && !vigenciaActiva)
      return Response.json({ detail: 'El siguiente paso solo se habilita con vigencia activa verificada' }, { status: 409 });
  }
  // Con vigencia activa el CTA se habilita solo: su disponibilidad deriva de la
  // verificación, no de que el operador recuerde un flag oculto.
  if (vigenciaActiva && payload.application_url && !payload.next_step.enabled) {
    payload.next_step.enabled = true;
    delete payload.next_step.disabled_reason;
  }
  const applied = await applyReview(db, row, payload, editorial_status, finalLocale, reviewed_by);
  return Response.json({
    id: row.id, job_id: row.job_id, current_version_id: applied.newId,
    version: applied.version, editorial_status, opportunity_status: row.opportunity_status,
    connection_type: row.connection_type, locale: finalLocale, updated_at: applied.created,
    reviewed_by: applied.reviewed_by,
    vigencia_activa: vigenciaActiva, cta_auto_enabled: vigenciaActiva && Boolean(payload.application_url),
  }, { headers: corsHeaders(request) });
}

// ------ admin (port fase 5: activación en lote, sesión 38) ------
// Escritura de una revisión editorial (versión NUEVA inmutable + puntero + estado):
// UNA sola ruta para el PATCH del panel y la activación en lote, con la procedencia
// del revisor registrada (espejo de opportunity_versions del núcleo local; el cloud
// aceptaba `reviewed_by` y lo descartaba).
async function applyReview(db, row, payload, editorialStatus, locale, reviewedBy) {
  const maxVersion = await db.prepare('SELECT max(version) AS v FROM opportunity_versions WHERE org_id=? AND opportunity_id=?').bind(ORG, row.id).first();
  const created = now();
  const newId = 'ver-' + crypto.randomUUID();
  const reviewer = reviewedBy || null;
  const reviewedAt = ['approved', 'published', 'withdrawn'].includes(editorialStatus) ? created : null;
  await db.batch([
    db.prepare(`INSERT INTO opportunity_versions (id,org_id,opportunity_id,version,locale,payload,created_by,created_at,reviewed_by,reviewed_at) VALUES (?,?,?,?,?,?,?,?,?,?)`)
      .bind(newId, ORG, row.id, (maxVersion?.v ?? 0) + 1, locale, JSON.stringify(payload), reviewer ?? 'admin', created, reviewer, reviewedAt),
    db.prepare('UPDATE opportunities SET current_version_id=?, editorial_status=?, updated_at=? WHERE org_id=? AND id=?')
      .bind(newId, editorialStatus, created, ORG, row.id),
  ]);
  return { newId, version: (maxVersion?.v ?? 0) + 1, created, reviewed_by: reviewer, reviewed_at: reviewedAt };
}

// Cota de escaneo del pool de drafts (no del lote): el catálogo tiene miles y una
// invocación no puede recorrerlos; la respuesta declara si cortó.
const SCAN_LIMIT = 400;
// Cota de ESCRITURA por invocación. Cada oferta escribe versión + puntero y, si se
// verifica, gasta además 1 fetch y las escrituras de evidencia; un lote grande
// agotaba el límite de subrequests a mitad y devolvía 500 con escrituras parciales.
// Los gates no escriben, así que el barrido puede seguir siendo 400.
const WRITE_BUDGET = 25;

// El cuello de botella real del producto: el catálogo recoge >1300 ofertas y la
// superficie de alumna solo sirve lo revisado por humanos (spec 15), pero publicar
// exigía redactar a mano el payload de cada oferta (sin modalidad de candidatura
// determinada no se publica). Esta ruta deriva el payload de forma DETERMINISTA
// desde la evidencia raw ya almacenada —nada inventado: título y datos literales,
// desconocidos explícitos como 'No especificado'—, verifica la vigencia y PUBLICA
// solo las verificadas `open`; el resto queda `needs_review` con la razón escrita.
// `dry_run` (por defecto) no escribe nada: devuelve el plan para que el operador decida.
async function handleAdminActivate(request, env) {
  const db = env.DB;
  await ensureSchema(db);
  let body = {};
  try { const parsed = await request.json(); if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) body = parsed; }
  catch { body = {}; }
  const dryRun = body.dry_run !== false;
  const verify = body.verify !== false;
  const market = body.market === undefined ? 'ES' : body.market;
  if (!['ES', 'any'].includes(market)) return Response.json({ detail: 'market: debe ser ES o any' }, { status: 422 });
  const role = body.role === undefined || body.role === null ? null : body.role;
  if (role && !ROLE_KEYWORDS[role]) return Response.json({ detail: 'role: perfil fuera del vocabulario canónico' }, { status: 422 });
  const reviewedBy = typeof body.reviewed_by === 'string' ? body.reviewed_by.trim().slice(0, 80) || null : null;
  // Mismo override operador que /verify (la URL del anuncio puede redirigir a una
  // canónica): la comprobación apunta donde el operador indica, nunca a un tercero nuevo.
  const verifyUrl = typeof body.verify_url === 'string' && /^https?:\/\//.test(body.verify_url) ? body.verify_url : null;
  const requested = Array.isArray(body.ids) ? body.ids.filter(v => typeof v === 'string' && /^[A-Za-z0-9-]{1,64}$/.test(v)) : null;
  // Un `IN ()` no es SQL válido: una lista vacía devolvía 500 en vez de decir que
  // no había nada que activar. Omitir el campo es lo que significa «escanea el pool».
  if (requested && !requested.length) return Response.json({ detail: 'ids: la lista está vacía; omite el campo para escanear el pool' }, { status: 422 });
  const ids = requested ? new Set(requested) : null;
  // Un override de URL solo tiene sentido para UNA oferta: aplicarlo a un lote
  // verificaría todas contra la misma página y las marcaría `open` sin evidencia propia.
  if (verifyUrl && (!ids || ids.size !== 1)) return Response.json({ detail: 'verify_url: requiere exactamente un id; en un lote se verifica la URL de cada anuncio' }, { status: 422 });
  const source = typeof body.source === 'string' && /^[a-z0-9-]{1,40}$/.test(body.source) ? body.source : null;
  // Sin `limit` que recorte la cola en silencio: el operador acota con `ids`/`source`.
  // El SELECT sí lleva una cota de escaneo (SCAN_LIMIT) y la respuesta DICE si cortó:
  // un plan parcial que se lee como completo es la forma más fácil de creer activado
  // lo que nunca se consideró.
  const days = 10; // la misma ventana de frescura de la superficie de alumna

  const rows = await db.prepare(`
    SELECT o.id AS opportunity_id, o.job_id, o.current_version_id, o.editorial_status, o.opportunity_status,
           p.id AS posting_id, p.source, p.payload AS posting_payload, c.expires_at, c.first_seen_at
      FROM opportunities o
      JOIN jobs j ON j.org_id=o.org_id AND j.id=o.job_id
      JOIN job_postings p ON p.org_id=j.org_id AND p.id=j.posting_id
      JOIN catalog_entries c ON c.org_id=o.org_id AND c.job_id=o.job_id
     WHERE o.org_id=? AND o.editorial_status='draft' AND o.opportunity_status <> 'closed' AND c.expires_at > ?
       ${source ? 'AND p.source=?' : ''} ${ids ? `AND o.id IN (${[...ids].map(() => '?').join(',')})` : ''}
     ORDER BY c.first_seen_at DESC LIMIT ${SCAN_LIMIT}`)
    .bind(ORG, now(), ...(source ? [source] : []), ...(ids ? [...ids] : [])).all();

  const items = [];
  const counters = { published: 0, needs_review: 0, skipped: 0, deferred: 0 };
  const writeBudget = dryRun ? 0 : WRITE_BUDGET;
  let written = 0;
  for (const row of rows.results) {
    // Identidad de la oportunidad con los MISMOS nombres de campo que espera el PATCH
    // (row.id/row.job_id): las dos rutas de escritura, applyReview y runVerification,
    // reciben este objeto. El SELECT de aquí usa o.id AS opportunity_id, y bindear un
    // undefined dio 500 en la primera ejecución real (workerd 2026-10-16).
    const opp = { id: row.opportunity_id, job_id: row.job_id, posting_id: row.posting_id,
      current_version_id: row.current_version_id, source: row.source };
    const p = JSON.parse(row.posting_payload);
    const description = descriptionOf(p);
    const derivedRole = classifyRole(p, fold(`${p.title ?? ''} ${p.location ?? ''} ${description}`));
    const skip = reason => { counters.skipped += 1; items.push({ id: row.opportunity_id, job_id: row.job_id, action: 'skipped', reason }); };
    if (!derivedRole) { skip('sin clasificación determinista de perfil'); continue; }
    if (role && derivedRole !== role) { skip(`perfil ${derivedRole} distinto del pedido (${role})`); continue; }
    if (!role && EXTRA_ROLES.has(derivedRole)) { skip(`perfil extra ${derivedRole}: se activa con role=${derivedRole} explícito (no protagoniza la vista por defecto)`); continue; }
    if (market === 'ES' && (nonSpain(p) || !spainSignal(p))) { skip('sin señal de mercado España'); continue; }
    if (!spanishBodyGate(description, false).ok) { skip('el anuncio no está en español (gate de cuerpo)'); continue; }
    const ages = p.posted_at ? (Date.now() - Date.parse(p.posted_at)) / 86400000 : null;
    if (ages !== null && Number.isFinite(ages) && ages > days) { skip(`publicado hace ${Math.floor(ages)} días: fuera de la ventana de frescura de ${days} días`); continue; }
    const url = typeof p.url === 'string' && /^https:\/\//.test(p.url) ? p.url : null;
    const applicationType = row.source.startsWith('ats-') ? 'company_ats' : (url ? 'external_platform' : 'unknown');
    let domain = null;
    try { domain = url ? new URL(url).host : null; } catch { domain = null; }
    const payload = {
      headline: String(p.title ?? '').slice(0, 180),
      role: ROLE_LABELS[derivedRole],
      short_summary: '',
      what_they_are_looking_for: [],
      what_you_would_do: [],
      why_it_may_be_interesting: [],
      compensation_summary: typeof p.salary === 'string' && p.salary.trim() ? p.salary.trim().slice(0, 300) : 'No especificado',
      location_summary: asText(p.location) ?? 'No especificado',
      language_requirements: ['Español'],
      experience_summary: 'No especificado',
      application_type: applicationType,
      application_url: url,
      next_step: { action: 'view_process', label: 'Ver proceso de candidatura', destination_label: 'Publicación original',
        destination_domain: domain, requires_account: null, enabled: false,
        disabled_reason: 'Verificación de vigencia pendiente' },
    };
    if (dryRun) {
      items.push({ id: row.opportunity_id, job_id: row.job_id, action: url ? 'publish_si_open' : 'needs_review', role: derivedRole,
        headline: payload.headline, company: p.company ?? null, source: row.source, application_type: applicationType,
        application_url: url, reason: url ? null : 'sin URL https del anuncio: no se publica una tarjeta sin destino' });
      continue;
    }
    if (written >= writeBudget) { counters.deferred += 1; continue; }
    if (!row.current_version_id && !(await db.prepare('SELECT id FROM opportunity_versions WHERE org_id=? AND opportunity_id=? LIMIT 1').bind(ORG, row.opportunity_id).first())) {
      skip('sin versión que revisar'); continue;
    }
    written += 1;
    let verification = null;
    const target = verifyUrl || url;
    if (verify && target) {
      verification = await runVerification(db, opp,
        { payload: row.posting_payload, source: row.source, posting_id: row.posting_id }, target);
      if (verification.error) verification = { result: 'unknown', reason_code: 'no_verificable', status_reason: verification.error };
    }
    // El CTA de la versión nueva se deriva de la verificación recién hecha (la MISMA
    // regla que runVerification aplica sobre la versión vigente): sin esto la publicada
    // nacía con `enabled:false` y una razón ya obsoleta, y el panel mostraba un CTA
    // apagado sobre una oferta verificada abierta.
    if (verification?.result === 'open') {
      payload.next_step.enabled = true;
      delete payload.next_step.disabled_reason;
    } else if (verification?.result) {
      payload.next_step.enabled = false;
      payload.next_step.disabled_reason = verification.status_reason;
    }
    // Sin URL no se publica: una tarjeta sin destino no se puede abrir y su CTA
    // nacería apagado. `application_type` conocido no sustituye al enlace.
    const publisher = Boolean(url) && applicationType !== 'unknown' && (!verify || verification?.result === 'open');
    const status = publisher ? 'published' : 'needs_review';
    const applied = await applyReview(db, opp, payload, status, 'es', reviewedBy ?? 'admin-activate');
    counters[status] += 1;
    items.push({ id: row.opportunity_id, job_id: row.job_id, action: status, role: derivedRole, version: applied.version,
      application_type: applicationType, application_url: url,
      verification: verification ? { result: verification.result, reason_code: verification.reason_code, valid_until: verification.valid_until ?? null } : null,
      reason: publisher ? null
        : !url ? 'sin URL del anuncio: no se publica una tarjeta sin destino'
        : applicationType === 'unknown' ? 'modalidad de candidatura indeterminada'
        : verification?.status_reason ?? 'sin verificación' });
  }
  return Response.json({
    dry_run: dryRun, verify, market, role, source, considered: rows.results.length,
    // `truncated` cubre las dos cotas: el barrido y las escrituras. `deferred` dice
    // cuántas se quedaron fuera del presupuesto para la siguiente pasada.
    scan: { limit: SCAN_LIMIT, write_budget: dryRun ? null : writeBudget, truncated: rows.results.length >= SCAN_LIMIT || counters.deferred > 0 },
    counts: counters, items,
  }, { headers: corsHeaders(request) });
}

// ------ recogida ------
async function runCollection(env, force = false) {
  const db = env.DB;
  await ensureSchema(db);
  const last = await db.prepare(
    "SELECT id,status,completed_at FROM collection_runs WHERE org_id=? AND status='completed' ORDER BY created_at DESC LIMIT 1"
  ).bind(ORG).first();
  if (!force && last?.completed_at) {
    const age = Date.now() - Date.parse(last.completed_at);
    if (Number.isFinite(age) && age < COLLECTION_INTERVAL_MS) return { skipped: true, last_run: last };
  }
  const runId = 'run-' + crypto.randomUUID();
  const day = dayKey();
  // El audit de slugs NO corre dentro de la recogida: con 17 fuentes, audit (10 fetches)
  // + ingest supera el presupuesto de subrequests por invocación y las fuentes de la
  // cola quedan cortadas (2026-10-15: 9/17 completadas y 8 con 'Too many subrequests').
  // Vive en /api/audit (invocación propia, budget entero; ?force=1 rerun) y, cuando
  // se deploye el cron, tendrá su propio trigger; ensureDaySlugAudit queda para ese uso.
  const slugAudit = null;
  const states = SOURCES.map(s => ({ code: s.code, name: s.name, status: 'queued', fetched: 0, accepted: 0 }));
  await db.prepare('INSERT INTO collection_runs (id,org_id,day,status,sources,created_at) VALUES (?,?,?,?,?,?)')
    .bind(runId, ORG, day, 'running', JSON.stringify(states), now()).run();
  const setState = (code, patch) => { const s = states.find(x => x.code === code); if (s) Object.assign(s, patch); };

  for (const source of SOURCES) {
    try {
      setState(source.code, { status: 'running' });
      // Ingest diferenciada (optimización D1 2026-10-14 + refresco condicional):
      // los external_ids con el mismo content_hash del run anterior no reescriben
      // evidencia ni duplicados; y de cada uno traemos la vigencia vigente del
      // catálogo para decidir en el camino barato si toca refrescar o seguir 0-coste.
      const known = new Map(); // `${external_id}|${content_hash}` → expires_at (ms)
      for (const row of (await db.prepare(
        `SELECT r.external_id AS external_id, r.content_hash AS content_hash, c.expires_at AS expires_at
           FROM raw_items r
           JOIN job_postings p ON p.org_id=r.org_id AND p.source=r.source AND p.external_id=r.external_id
           JOIN jobs j ON j.org_id=p.org_id AND j.posting_id=p.id
           LEFT JOIN catalog_entries c ON c.org_id=j.org_id AND c.job_id=j.id
          WHERE r.org_id=? AND r.source=?`)
        .bind(ORG, source.code).all()).results) {
        known.set(`${row.external_id}|${row.content_hash}`, row.expires_at ? Date.parse(row.expires_at) : NaN);
      }
      const candidates = await EXTRACTORS[source.kind](source);
      let accepted = 0;
      for (let i = 0; i < candidates.length; i += 50) {
        await ingestBatch(db, source, candidates.slice(i, i + 50), known);
        accepted += Math.min(50, candidates.length - i);
        setState(source.code, { fetched: accepted, accepted });
      }
      setState(source.code, { status: 'completed', fetched: candidates.length, accepted: candidates.length });
    } catch (error) {
      setState(source.code, { status: 'failed', warning: String(error.message || error).slice(0, 300) });
    }
  }
  await db.prepare('UPDATE collection_runs SET status=?, sources=?, completed_at=? WHERE id=?')
    .bind('completed', JSON.stringify(states), now(), runId).run();
  // El resultado del audit diario (corrido al principio de este run) viaja en la respuesta:
  // si un slug cambió, el operador lo ve renamed/gone antes de que el extractor falle.
  return slugAudit ? { run_id: runId, sources: states, slug_audit: slugAudit } : { run_id: runId, sources: states };
}

async function ingestBatch(db, source, candidates, known) {
  // Camino barato vs camino completo: la hash de contenido es de {titulo, empresa, url}.
  // Ya conocida (visto en raw_items de esta fuente): la evidencia raw es inmutable y
  // no se reinserta; los lotes D1 son transaccionales, así que existe todo lo demás
  // del run original. La vigencia del catálogo solo se refresca cuando la ventana
  // (10 días) queda por vencer (< REFRESH_AHEAD_MS): mientras esté fresca, 0 escritas.
  // Una edición real del anuncio cambia el hash y vuelve al camino completo
  // (raw nuevo + payload + tickets).
  const captured = now();
  const statements = [];
  for (const candidate of candidates) {
    const p = candidate.payload;
    if (!p.title || !p.url) continue; // sin título o enlace no hay oferta verificable
    const contentHash = await sha256(JSON.stringify({ t: p.title, c: p.company, u: p.url }));
    const jobId = stableId('job', `${source.code}|${candidate.external_id}`);
    const knownExpiry = known.get(`${candidate.external_id}|${contentHash}`);
    if (Number.isFinite(knownExpiry) && knownExpiry > Date.parse(captured) + REFRESH_AHEAD_MS) continue;
    // Vigencia fresca: la fila del catálogo sigue viva > REFRESH_AHEAD_MS → 0 escritas.
    if (known.has(`${candidate.external_id}|${contentHash}`)) {
      statements.push(
        db.prepare(`INSERT INTO catalog_entries (org_id,job_id,first_seen_at,expires_at) VALUES (?,?,?,?)
          ON CONFLICT(org_id, job_id) DO UPDATE SET expires_at=excluded.expires_at`)
          .bind(ORG, jobId, captured, new Date(Date.parse(captured) + CATALOG_WINDOW_MS).toISOString().replace('Z', '+00:00')),
      );
      continue;
    }
    const rawId = 'raw-' + crypto.randomUUID();
    const postingId = stableId('post', `${source.code}|${candidate.external_id}`);
    statements.push(
      db.prepare('INSERT OR IGNORE INTO raw_items (id,org_id,source,provider,external_id,content_hash,payload,captured_at) VALUES (?,?,?,?,?,?,?,?)')
        .bind(rawId, ORG, source.code, 'cloud-fetch-v1', candidate.external_id, contentHash, JSON.stringify(p), captured),
      db.prepare(`INSERT INTO job_postings (id,org_id,raw_id,source,external_id,payload) VALUES (?,?,?,?,?,?)
        ON CONFLICT(org_id, source, external_id) DO UPDATE SET raw_id=excluded.raw_id, payload=excluded.payload`)
        .bind(postingId, ORG, rawId, source.code, candidate.external_id, JSON.stringify(p)),
      db.prepare('INSERT OR IGNORE INTO jobs (id,org_id,posting_id) VALUES (?,?,?)').bind(jobId, ORG, postingId),
      db.prepare(`INSERT INTO catalog_entries (org_id,job_id,first_seen_at,expires_at) VALUES (?,?,?,?)
        ON CONFLICT(org_id, job_id) DO UPDATE SET expires_at=excluded.expires_at`)
        .bind(ORG, jobId, captured, new Date(Date.parse(captured) + CATALOG_WINDOW_MS).toISOString().replace('Z', '+00:00')),
      // El puntero nace seteado: sin esto el PATCH de revisión editorial no
      // encuentra la versión inicial (verificado en producción 2026-10-15, sesión 28).
      db.prepare('INSERT OR IGNORE INTO opportunities (id,org_id,job_id,current_version_id,editorial_status,opportunity_status,connection_type,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)')
        .bind('opp-' + jobId.slice(4), ORG, jobId, 'ver-' + jobId.slice(4) + '-1', 'draft', 'verifying', 'external_application', captured, captured),
      db.prepare(`INSERT OR IGNORE INTO opportunity_versions (id,org_id,opportunity_id,version,payload,created_by,created_at)
        VALUES (?,?,?,?,?,?,?)`)
        .bind('ver-' + jobId.slice(4) + '-1', ORG, 'opp-' + jobId.slice(4), 1,
          JSON.stringify({ title: p.title, company: p.company, location: p.location, url: p.url,
            salary: p.salary ?? null, posted_at: p.posted_at, application_type: 'unknown', next_step: { enabled: false } }),
          'cloud-collector-v1', captured),
    );
  }
  if (statements.length) await db.batch(statements);
}

// ------ API de lectura ------
// Vocabulario canónico de la app (apps/api/career/vocabulary.py, ROLE_FAMILIES,
// términos ya plegados): el motor cloud clasifica con la misma lista de verdad
// que presentation.py, ahora mismo espejada aquí. Actualizado 2026-10-14.
const ROLE_KEYWORDS = {
  closer: [
    'closer', 'closer de ventas', 'closer comercial', 'closer high ticket',
    'high ticket closer', 'high-ticket closer', 'closer high-ticket', 'closer de alto ticket', 'closer senior', 'closer b2c',
    'closer b2b', 'closer remoto', 'closser', 'clouser', 'sales closer',
    'especialista en cierre', 'experto en cierre de ventas', 'cerrador de ventas',
    'cerrador comercial', 'cerrador high ticket', 'cerrador de ventas inmobiliarias',
    'cerradora de ventas', 'comercial closer', 'vendedor consultivo',
    'asesor de ventas consultivas', 'venta consultiva', 'ventas consultivas',
    'consultative sales', 'solution selling', 'ventas complejas',
    'full-cycle sales', 'full cycle sales', 'end-to-end sales',
    'closing specialist', 'closing consultant', 'conversion specialist',
    'enrollment advisor', 'enrollment counselor', 'enrollment specialist',
    'enrollment consultant', 'admissions advisor', 'admissions associate',
    'admissions counselor', 'admissions officer', 'admissions consultant',
    'asesor de admisiones', 'asesora de admisiones', 'asesor/a de admisiones',
    'agente de admisiones', 'especialista de admisiones', 'ejecutivo de admisiones',
    'admisiones', 'asesor educativo', 'asesora educativa', 'consultor educativo',
    'orientador academico', 'orientadora academica', 'orientador educativo',
    'asesor de formacion', 'asesor comercial educativo', 'asesor de matricula',
    'ejecutivo de matricula', 'asesor de bootcamp', 'venta de formacion',
    'venta de cursos', 'venta de masters', 'venta de bootcamps',
    'student advisor', 'student enrollment advisor', 'student recruitment advisor',
    'programme advisor', 'program advisor', 'education advisor',
    'academic advisor', 'course advisor', 'bootcamp advisor',
    'patient advisor', 'patient coordinator', 'treatment coordinator',
    'treatment consultant', 'healthcare sales', 'medical sales advisor',
    'asesor de pacientes', 'cierre de matriculas', 'cierre de inscripciones',
  ],
  setter: [
    'setter', 'appointment setter', 'sales setter', 'high-ticket setter',
    'high ticket setter', 'setter de ventas', 'setter comercial', 'setter digital',
    'setter b2b', 'setter b2c', 'setter closer', 'setter/closer', 'setter + closer',
    'appointment booker', 'appointment coordinator', 'agendador de citas',
    'agendadora de citas', 'generador de citas', 'concertador de citas',
    'concertador comercial', 'captador de citas', 'captador de leads',
    'cualificador de leads', 'calificador de leads', 'lead qualifier',
    'lead qualification specialist', 'sales appointment setter',
    'business appointment setter', 'teleconcertador', 'teleoperador comercial',
    'lead generation specialist', 'lead generation',
    'especialista en generacion de leads', 'especialista en prospeccion',
  ],
  cold_caller: [
    'cold caller', 'cold calling', 'llamadas en frio',
    'prospector telefonico', 'prospectora telefonica', 'prospeccion telefonica',
  ],
  account_executive: [
    'account executive', 'ejecutivo de cuentas', 'ejecutiva de cuentas',
    'account manager', 'sales executive', 'sales consultant', 'sales advisor',
    'sales specialist', 'sales representative', 'commercial advisor',
    'commercial executive', 'business development executive',
    'ejecutivo comercial', 'ejecutiva comercial', 'ejecutivo de ventas',
    'ejecutiva de ventas', 'asesor comercial', 'asesora comercial',
    'asesor/a comercial', 'asesor comercial senior', 'representante comercial',
    'representante de ventas', 'representante de ventas senior', 'agente comercial',
    'agente de ventas', 'gestor comercial', 'gestora comercial', 'gestor de ventas',
    'especialista comercial', 'profesional de ventas', 'tecnico comercial',
    'tecnica comercial', 'televendedor', 'televendedora', 'televentas',
    'telemarketing', 'ventas telefonicas', 'ventas por videollamada',
    'consultor comercial', 'consultora comercial', 'consultor de ventas',
    'asesor de ventas', 'asesora de ventas',
    // Variantes con barra del mercado español, plegadas con evidencia del slug
    // asesor-de-ventas (sesión 22): 17/48 anuncios comerciales reales quedaban
    // sin familia porque las variantes no existían (('Asesor/a de Ventas',
    // 'Asesor/a Inmobiliario/a', 'AGENTE INMOBILIARIO/A', 'Vendedor/a').
    // La familia closer NO se pliega: 'asesor de ventas consultivas' sigue
    // ganando por orden de evaluación, y plegar el AE liso diluiría el cierre puro.
    'asesor/a de ventas',
    'asesor inmobiliario', 'asesor/a inmobiliario', 'asesor/a inmobiliario/a',
    'asesores inmobiliarios', 'agente inmobiliario', 'agentes inmobiliarios',
    'agente inmobiliario/a', 'vendedor', 'vendedora', 'vendedor/a',
    'asesor de programas', 'asesor de cursos', 'asesor de masters',
    'comercial digital', 'comercial online', 'inside sales',
    'inside sales representative', 'inside sales specialist',
    'inbound sales representative', 'outbound sales representative',
    'business development manager',
    'sales account executive', 'senior sales executive', 'remote sales consultant',
    'high-ticket sales consultant', 'high ticket sales consultant',
  ],
  sdr: ['sdr', 'bdr', 'sales development', 'sales development representative'],
};
// Señal fuerte de mercado España: la palabra España/país/ciudad explícita o 'remoto' en español.
// No se usa 'es' ni 'europe' como hints sueltos (subcadenas triviales y demasiados falsos positivos);
// una oferta sin señal ES explícita NO se presenta como España (exposición honesta del mercado).
const ES_HINTS = ['españa', 'spain', 'madrid', 'barcelona', 'valencia', 'sevilla', 'málaga', 'malaga', 'bilbao', 'zaragoza', 'remoto', 'europa'];
const NON_ES_HINTS = ['florida', 'texas', 'california', 'new york', 'london', 'londres', 'oklahoma', 'mississippi', 'georgia', 'st. petersburg', 'atlanta', 'nashville', 'dallas', 'okc'];

function matchesQuery(payload, query) {
  const haystack = `${payload.title ?? ''} ${payload.location ?? ''}`.toLowerCase();
  if (query.role && !ROLE_KEYWORDS[query.role].some(k => haystack.includes(k))) return false;
  if (query.market === 'ES') {
    if (NON_ES_HINTS.some(k => haystack.includes(k))) return false;
    if (!ES_HINTS.some(k => haystack.includes(k))) return false;
  }
  if (query.days && payload.posted_at) {
    const ageDays = (Date.now() - Date.parse(payload.posted_at)) / 86400000;
    if (Number.isFinite(ageDays) && ageDays > query.days) return false;
  }
  return true;
}

async function handleOffers(request, env, url) {
  await ensureSchema(env.DB);
  const query = {
    role: url.searchParams.get('role') || null,
    market: url.searchParams.get('market') || 'any',
    days: [1, 3, 7, 10].includes(Number(url.searchParams.get('days'))) ? Number(url.searchParams.get('days')) : null,
  };
  const rows = await env.DB.prepare(`
    SELECT j.id AS job_id, p.payload AS payload, c.first_seen_at
    FROM catalog_entries c
    JOIN jobs j ON j.org_id=c.org_id AND j.id=c.job_id
    JOIN job_postings p ON p.org_id=j.org_id AND p.id=j.posting_id
    JOIN opportunities o ON o.org_id=c.org_id AND o.job_id=c.job_id
      AND o.editorial_status IN ('approved','published')
    WHERE c.org_id=? AND c.expires_at > ?
    ORDER BY c.first_seen_at DESC LIMIT 500`).bind(ORG, now()).all();
  const offers = rows.results
    .map(r => { const p = JSON.parse(r.payload); return {
      job_id: r.job_id, title: p.title, company: p.company, location: p.location, url: p.url,
      salary: p.salary ?? null, posted_at: p.posted_at ?? null, application_type: 'unknown',
      source_first_seen_at: r.first_seen_at,
    }; })
    .filter(o => matchesQuery(o, query))
    .slice(0, 200);
  return Response.json({ total: offers.length, offers }, { headers: corsHeaders(request) });
}

// ------ superficie de la vista de alumna (contrato Opportunity del proxy /api/backend) ------
// Espejo en JS de apps/api/career/opportunities.py: mismos filtros (rol por vocabulario en el
// título, mercado España por señales fuertes, frescura), ranking España-primero y selección
// de excelencia (top 20, máx. 2 por empresa, AE/SDR fuera del top). Lo que la fuente no declara
// se muestra como 'No indicado'/sin datos; nunca se infiere application_type (unknown).
const ROLE_LABELS = { closer: 'Closer', setter: 'Setter', cold_caller: 'Cold Caller',
  account_executive: 'Ejecutivo comercial', sdr: 'SDR / BDR' };
const ROLE_PRIORITY = { closer: 0, setter: 1, cold_caller: 2, account_executive: 9, sdr: 10 };
const EXTRA_ROLES = new Set(['account_executive', 'sdr']);
const TOP_TARGET = 20;
const MARKET_HINTS = {
  EU: ['europa', 'europe', 'european union', 'reino unido', 'portugal', 'francia', 'alemania', 'irlanda', 'paises bajos'],
  LATAM: ['mexico', 'argentina', 'colombia', 'chile', 'peru', 'ecuador', 'uruguay', 'venezuela',
    'guatemala', 'honduras', 'el salvador', 'nicaragua', 'panama', 'costa rica', 'latin america', 'latam'],
  US: NON_ES_HINTS,
};

const fold = text => (text ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

// La fuente puede devolver la ubicación como lista o el momento de publicación como epoch;
// el contrato de la vista (Opportunity) es location: string y published_at: ISO string | null.
const asText = v => {
  if (v == null || v === '') return null;
  if (Array.isArray(v)) return v.map(x => (Array.isArray(x) ? asText(x) : String(x ?? '').trim())).filter(Boolean).join(', ') || null;
  if (typeof v === 'object') return null; // estructura inesperada: mejor 'ubícacion por confirmar' que volcar JSON
  return String(v).trim() || null;
};
const isoWhen = v => {
  const t = asText(v);
  if (t == null) return null;
  if (/^\d+$/.test(t)) return new Date(Number(t) < 2e10 ? Number(t) * 1000 : Number(t)).toISOString();
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", nbsp: ' ', apos: "'", ndash: '–', mdash: '—', hellip: '…', raquo: '»', laquo: '«', middot: '·' };
function decodeEntities(text) {
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, entity) => {
    if (ENTITIES[entity]) return ENTITIES[entity];
    if (entity.startsWith('#x')) return String.fromCodePoint(parseInt(entity.slice(2), 16));
    if (entity.startsWith('#')) return String.fromCodePoint(parseInt(entity.slice(1), 10));
    return m;
  });
}
// HTML doblemente escapado (Teamtailor RSS entrega `&lt;p&gt;`): si se decodifican las
// entidades DESPUÉS de quitar etiquetas, el cuerpo vuelve a tener `<strong>` y la tarjeta
// lo enseña como si fuera salario. Por eso: decodificar → quitar etiquetas → decodificar
// otra vez → quitar solo etiquetas con forma real (no cualquier `<...>` del texto).
function stripTags(text) {
  return text.replace(/<\/?(?:a|b|strong|em|i|u|s|span|p|div|br|li|ul|ol|h[1-6]|small|big|mark|blockquote|table|tbody|thead|tr|td|th|img|iframe|figure|figcaption|section|article|header|footer|font|sub|sup|hr|dl|dt|dd)\b[^>]*>/gi, (tag) => /^<\/?(?:p|div|li|br|h[1-6]|ul|ol|tr|blockquote)\b/i.test(tag) ? '\n' : '');
}
function plain(value) {
  let text = String(value ?? '');
  text = text.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '');
  text = stripTags(decodeEntities(text));
  text = stripTags(decodeEntities(text));
  return text.replace(/\u200b/g, '').replace(/[ \t]+/g, ' ').replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n').trim().slice(0, 20000);
}

// La descripción vive en el raw de la fuente (ya almacenado en qué apuntaba p.raw);
// ningún campo se inventa: si la fuente no trae cuerpo, la ficha queda honestamente vacía.
function descriptionOf(p) {
  const raw = p.raw ?? {};
  // GetOnBoard (JSON:API) anida el cuerpo en attributes.description: con solo el
  // listado raíz el gate no ve español y la fuente entera caía a 0 elegibles.
  return plain(raw.description || raw.attributes?.description || raw.descriptionDeMarkdown || raw.content || raw.jobDescription
    || raw.excerpt || raw.descriptionPlain || '');
}

function excerpt(details, pattern, fallback) {
  for (const line of details.split(/\n+|(?<=[.!?])\s+/)) {
    if (pattern.test(fold(line))) return line.replace(/\s+/g, ' ').trim().slice(0, 230);
  }
  return fallback;
}

// Una línea que menciona 'salario' o 'comisiones' NO es una cifra: sin importe
// verificable (€, EUR, USD, /mes, /hora, brutos, fijo, base) la oferta dice
// 'Importe no publicado'. Antes se publicaba como compensación cualquier párrafo
// que mencionara 'comisión' y contuviera un dígito (p. ej. '…desde 0').
const PAY_AMOUNT = /(?:\d[\d.,]*\s*(?:€|eur\b|euros?\b|k\b|mil\b|\$|usd\b|brutos?\b|netos?\b|líquidos?\b))|(?:(?:€|\$)\s*\d)|(?:\d[\d.,]*\s*(?:al mes|\/\s*mes|mensual(?:es)?|por mes|hora|\/\s*h(?:ora)?\b|a la semana|semanales?|anual(?:es)?|al año))/i;
const PAY_CONTEXT = /\b(?:salario|sueldo|compensacion|remuneracion|pago|retribucion|comisiones?|fijo|base|ote|variable)\b/;
function payFromDescription(details) {
  for (const line of details.split(/\n+|(?<=[.!?])\s+/)) {
    if (!COMP_WORDS.test(fold(line))) continue;
    const evidence = payEvidence(line);
    if (evidence) return evidence;
  }
  return null;
}
function payEvidence(line) {
  if (!line) return null;
  const folded = fold(line);
  if (!PAY_CONTEXT.test(folded) || !PAY_AMOUNT.test(line)) return null;
  const clean = line.replace(/\s+/g, ' ').replace(/^[-–·•\s]+/, '').trim();
  // Corte en palabra completa: 'Y en nuestra vertical de <strong>Inversor Pro…' ya no
  // puede acabar en mitad de una etiqueta ni de una palabra.
  if (clean.length <= 180) return clean;
  const cut = clean.slice(0, 180);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), 120)).trim()}…`;
}

const COMP_WORDS = /\b(?:salario|sueldo|compensacion|remuneracion|pago|comisiones|salary|compensation|pay rate)\b/;
const VARIABLE_WORDS = /\b(?:comision|commission|ote|promedio|potencial|hasta)\b/;

// El idioma: 3+ lexemas distintivos del español; sin inferir nada. Vocabulario ampliado
// 2026-10-13 con el lenguaje real de las ofertas de JobToday/LATAM del sector comercial
// (experiencia, cliente, campaña, capacitación, postúlate): presencia fuerte de español,
// no solo fórmulas formales tipo 'buscamos/ofrecemos'.
const LANG_ES = /\b(?:buscamos|ofrecemos|equipo|ventas|puesto|funciones|formacion|trabajar|nuestro|nuestra|tienes|seras|salario|horario|comisiones|necesitamos|incorporacion|llamadas|remuneracion|contratamos|tareas|experiencia|clientes?|telefono|sms|mail|lider|liderar|exito|crecimiento|capacitacion|entrenamiento|campana|incentivos|candidat[oa]s?|requisitos?|responsabilidades|interesad[oa]s|postul[ae]tes?|carrera|lunes|viernes|sabado|disciplina|proactiv[oa]|objetivos?|empresas?|persona|oferta|semana|mensual|seguimiento|proceso|convocatoria|entrevista)\b/g;
const LANG_EN_REQ = /\b(?:bilingual|bilingue|fluent|fluency|required|must|proficient|speaking|spoken|communication|requiere|requerido|dominio|nativo|hablantes|idioma|atencion|clientes)\b/;
const LANG_EN = /\b(?:english|ingles)\b/;

// Gate de cuerpo en español: UNA sola regla para la superficie de alumna y para la
// activación del operador (sin copias que diverjan). Portugués ≠ español: los lexemas
// legales compuestos se confunden al plegar ('vendas', 'comissoes', 'voce'); un anuncio
// portugués nunca es oferta en español, ni siquiera con el opt-in bilingüe.
const PORTUGUESE_TEXT = /\b(?:vendas|voce|comissoes|portugues|brasil)\b/;
function spanishBodyGate(description, includeBilingual = false) {
  const hayES = fold(description);
  const portuguese = PORTUGUESE_TEXT.test(hayES);
  const langES = (hayES.match(LANG_ES) || []).length >= 3;
  const enRequired = Boolean(hayES.match(LANG_EN)) && Boolean(hayES.match(LANG_EN_REQ));
  return { ok: !portuguese && (includeBilingual || (langES && !enRequired)), portuguese, langES, enRequired };
}

function spainSignal(p) { return ES_HINTS.some(k => `${p.title ?? ''} ${p.location ?? ''} ${p.description ?? ''}`.toLowerCase().includes(k)); }
function nonSpain(p) { return NON_ES_HINTS.some(k => `${p.title ?? ''} ${p.location ?? ''}`.toLowerCase().includes(k)); }

const ROLE_EVAL_ORDER = ['closer', 'setter', 'cold_caller', 'account_executive', 'sdr'];
function classifyRole(p, text) {
  // Determinista y con la misma prioridad que presentation.py: primero el título de toda
  // la vida, después la evidencia en el texto de la oferta; nunca se inventa familia.
  // 'closer' va primero (2026-10-14): su keyword es la menos ambigua y los títulos
  // combinados 'Setter y Closer de Ventas' (núcleo exacto del perfil WDC) no deben
  // clasificarse como setter solo por el orden de evaluación.
  for (const role of ROLE_EVAL_ORDER) {
    if (ROLE_KEYWORDS[role].some(k => fold(p.title ?? '').includes(k))) return role;
  }
  for (const role of ROLE_EVAL_ORDER) {
    if (ROLE_KEYWORDS[role].some(k => text.includes(k))) return role;
  }
  return null;
}

// Núcleo de la vista alumna, compartido por /v1/opportunities/search y /api/funnel:
// mismo gate de rol/idioma/dedupe y mismo ranking, sin duplicar la lógica.
// opts: { role, market, days, includeBilingual, starredOnly, includeExtraRoles,
// editorialOnly }.
// editorialOnly (default true): la superficie pública solo sirve ofertas con
// revisión editorial humana (evolución del fix del audit run-1 finding 1: los
// drafts recién recogidos NO salen a la alumna; spec 15 — revisión antes de
// exposición). approved y published son ambos estados revisados por el operador.
// handleFunnel la pide en false: es el diagnóstico HUNT del operador (recuento
// del embudo que guía ampliar/retirar fuentes); expone agregados, no contenido.
async function studentSurface(env, { role, market, days, includeBilingual, starredOnly, includeExtraRoles, editorialOnly = true }) {
  const db = env.DB;

  const rows = await db.prepare(`
    SELECT j.id AS job_id, j.starred AS starred, p.payload AS payload, p.source AS source, c.expires_at
    FROM catalog_entries c
    JOIN jobs j ON j.org_id=c.org_id AND j.id=c.job_id
    JOIN job_postings p ON p.org_id=j.org_id AND p.id=j.posting_id
    ${editorialOnly ? `JOIN opportunities o ON o.org_id=c.org_id AND o.job_id=c.job_id
      AND o.editorial_status IN ('approved','published')` : ''}
    WHERE c.org_id=? AND c.expires_at > ?
    ORDER BY c.first_seen_at DESC, j.id LIMIT 800`).bind(ORG, now()).all();

  const items = [];
  const evidence = new Set();
  // El mismo anuncio se publica por ciudad con URL distinta (Velian: Madrid, Sevilla y
  // Málaga con el mismo título). El dedupe por URL no los ve iguales; empresa+título
  // normalizados sí, y eso evita tres tarjetas idénticas en la vista de la alumna.
  const roleKeys = new Set();
  const quality = {};
  for (const row of rows.results) {
    if (starredOnly && !row.starred) continue;
    const p = JSON.parse(row.payload);
    // El cuerpo vive en el raw de la fuente (attributes.description en JSON:API,
    // raw.description en RSS): es la misma evidencia que usa el gate de idioma,
    // plegada para matchear los lexemas canónicos sin acento.
    const description = descriptionOf(p);
    const text = `${p.title ?? ''} ${p.location ?? ''} ${description}`;
    const derivedRole = classifyRole(p, fold(text));
    if (!derivedRole) continue; // sin clasificación determinista no pasa como superficie alumna
    if (role && derivedRole !== role) continue;
    // AE/SDR son trabajo comercial real, pero no protagonizan la vista: se ocultan de la
    // lista general salvo opt-in explícito (include_extra_roles, o elegir el perfil en el
    // desplegable), la MISMA regla que el núcleo local (opportunities.py). El flag estaba
    // en el contrato y se ignoraba: con el catálogo cloud sin AE publicados no se notaba,
    // y la primera activación de 109 AE los habría servido en la vista por defecto.
    if (EXTRA_ROLES.has(derivedRole) && !includeExtraRoles && role !== derivedRole) continue;
    if (market === 'ES') {
      if (nonSpain(p) || !spainSignal(p)) continue;
    } else if (market !== 'any') {
      // Mercados sin cobertura propia del motor: se exponen solo los que traen país explícito.
      const hay = fold(`${p.title ?? ''} ${p.location ?? ''} ${p.description ?? ''}`);
      if (!MARKET_HINTS[market].some(k => hay.includes(k))) continue;
    }
    // El regex de lexemas va sin acentos: se evalúa sobre el texto plegado (fold),
    // nunca sobre el original — 'formación' sin plegar no matchea 'formacion'.
    const language = spanishBodyGate(description, includeBilingual);
    if (!language.ok) continue;
    const langES = language.langES;
    // Solo se deduplica lo que TIENE URL: añadir `undefined` al set colapsaba
    // todas las ofertas sin enlace en la primera que se veía.
    if (p.url) {
      if (evidence.has(p.url)) continue;
      evidence.add(p.url);
    }
    // La dedupe por empresa+título exige AMBOS: con uno vacío, un `|` común
    // colapsaría ofertas distintas que solo comparten empresa o título.
    const companyKey = fold(p.company ?? '').trim();
    const titleKey = fold(p.title ?? '').trim();
    if (companyKey && titleKey) {
      const roleKey = `${companyKey}|${titleKey}`;
      if (roleKeys.has(roleKey)) continue;
      roleKeys.add(roleKey);
    }
    const titleHit = ROLE_KEYWORDS[derivedRole].some(k => fold(p.title ?? '').includes(k));
    // Compensación: salario estructurado; si no, la cita literal del anuncio; nunca se inventa.
    let pay = 'Importe no publicado';
    let note = 'Pregunta por el fijo y las comisiones antes de avanzar.';
    const salary = p.salary ?? null;
    if (typeof salary === 'string' && salary.trim()) {
      pay = salary.trim();
      note = VARIABLE_WORDS.test(fold(pay)) ? 'La parte variable no es un ingreso garantizado.' : 'Importe anunciado; confirma periodicidad y condiciones.';
    } else if (salary && typeof salary === 'object') {
      // JobToday expresa paga no estructurada como texto libre (extraOptions:
      // 'Comisiones', 'Salario + comisiones'): se expone tal cual, con su nota.
      const extra = typeof salary.extraOptions === 'string' && salary.extraOptions.trim() ? salary.extraOptions.trim() : null;
      const low = salary.from ?? salary.min; const high = salary.to ?? salary.max;
      const amount = v => Number(v) ? String(Math.round(Number(v))).replace(/\B(?=(\d{3})+(?!\d))/g, '.') : null;
      if (low && high) pay = `${amount(low)} – ${amount(high)} ${salary.currencyCode ?? ''}`.trim();
      else if (low || high) pay = `${low ? 'Desde' : 'Hasta'} ${amount(low ?? high)} ${salary.currencyCode ?? ''}`.trim();
      else if (extra) pay = extra;
      if (pay !== 'Importe no publicado') {
        note = VARIABLE_WORDS.test(fold(pay)) ? 'La parte variable no es un ingreso garantizado.' : 'Importe anunciado; confirma periodicidad y condiciones.';
      }
    } else {
      const evidenceLine = payFromDescription(description);
      if (evidenceLine) pay = evidenceLine;
    }
    const workText = fold(`${p.title ?? ''} ${p.location ?? ''} ${description.slice(0, 4000)}`);
    const modality = /\b(hybrid|hibrid[oa]|semi[ -]?presencial)\b/.test(workText) ? 'Híbrido'
      : /\b(remote|remot[oa]|teletrabajo|home office|work from home)\b/.test(workText) ? 'Remoto' : 'Presencial u híbrido';
    const ages = p.posted_at ? (Date.now() - Date.parse(p.posted_at)) / 86400000 : null;
    if (ages !== null && Number.isFinite(ages) && ages > days) continue;
    items.push({
      id: row.job_id,
      role: derivedRole,
      role_label: ROLE_LABELS[derivedRole],
      original_title: p.title ?? '',
      company: p.company ?? 'Empresa no indicada',
      compensation: pay,
      compensation_note: note,
      modality,
      location: asText(p.location) ?? 'Ubicación por confirmar',
      language: langES ? 'Anuncio en español' : 'Anuncio original en inglés',
      experience: /\bexperiencia\b/.test(fold(description)) ? excerpt(description, /\bexperiencia\b/, 'Experiencia no especificada') : 'Experiencia no especificada',
      schedule: excerpt(description, /\b(?:jornada|horario|disponibilidad|\d+\s*horas?\s*(?:semanal|a la semana))\b/, 'Horario no especificado'),
      contract: excerpt(description, /\b(?:contrato|contractor|freelance|autonom[oa])\b/, 'Contrato no especificado'),
      description,
      published_at: isoWhen(p.posted_at) ?? null,
      expires_at: row.expires_at,
      source_code: row.source,
      source_name: SOURCES.find(s => s.code === row.source)?.name ?? row.source,
      source_url: p.url,
      starred: Boolean(row.starred),
      excellence_rank: null,
      is_selected: false,
    });
    quality[row.job_id] = {
      es: spainSignal(p) ? 0 : 1,
      score: (titleHit ? 50 : 25) + (ages !== null && ages <= 3 ? 20 : 10) + (pay !== 'Importe no publicado' ? 1 : 0),
      published_ts: ages !== null ? Date.now() - ages * 86400000 : 0,
      role: derivedRole,
    };
  }

  // Ranking España-primero (sin interpretar remoto como worldwide) y selección top-20:
  // el mismo comportamiento que la vista local, para que el dominio no Romance estilos distintos.
  const ranked = [...items].sort((a, b) => {
    const qa = quality[a.id]; const qb = quality[b.id];
    return [qa.es - qb.es, qb.score - qa.score, qb.published_ts - qa.published_ts,
      ROLE_PRIORITY[qa.role] - ROLE_PRIORITY[qb.role]][0];
  });
  const selected = [];
  const counts = {};
  for (const offer of ranked) {
    if (selected.length >= TOP_TARGET) break;
    if (EXTRA_ROLES.has(offer.role)) continue;
    const company = offer.company.trim().toLowerCase();
    if ((counts[company] ?? 0) >= 2) continue;
    counts[company] = (counts[company] ?? 0) + 1;
    selected.push(offer);
  }
  const selectedIds = new Set(selected.map(o => o.id));
  ranked.forEach((offer, index) => {
    offer.excellence_rank = selectedIds.has(offer.id) ? index + 1 : null;
    offer.is_selected = selectedIds.has(offer.id);
  });
  return { ranked, total: ranked.length, selectionTotal: selected.length };
}

async function handleStudentSearch(request, env) {
  await ensureSchema(env.DB);
  let body;
  try { body = await request.json(); } catch { return Response.json({ detail: 'Cuerpo no válido' }, { status: 422 }); }
  const role = body?.role ?? null;
  if (role && !ROLE_KEYWORDS[role]) return Response.json({ detail: 'Perfil no válido' }, { status: 422 });
  const market = ['any', 'ES', 'EU', 'LATAM', 'US'].includes(body?.market) ? body.market : 'any';
  const days = Number.isInteger(body?.days) && body.days >= 1 && body.days <= 10 ? body.days : 10;
  const includeBilingual = body?.include_bilingual === true;
  const starredOnly = body?.starred_only === true;
  // El default del contrato es false (OpportunityQuery.include_extra_roles): sin la
  // clave, el comportamiento es el de la alumna, no el del operador.
  const includeExtraRoles = body?.include_extra_roles === true;
  const { ranked, total, selectionTotal } = await studentSurface(env, { role, market, days, includeBilingual, starredOnly, includeExtraRoles });
  return Response.json({ items: ranked, total, selection_total: selectionTotal }, { headers: corsHeaders(request) });
}

async function handleStar(request, env, jobId) {
  // Audit run-1 finding 2: PATCH star es MUTACIÓN de estado compartido (el marcador
  // usa starred_only de la superficie); exige credencial admin como el resto de
  // escrituras. Local no cambia (backend FastAPI propio); en modo hospedado la
  // vista alumna guarda en su navegador (localStorage) sin tocar este endpoint.
  const adminCheck = requireAdmin(request, env);
  if (adminCheck) return adminCheck;
  if (!/^[A-Za-z0-9-]+$/.test(jobId)) return Response.json({ detail: 'Id no válido' }, { status: 400 });
  let body;
  try { body = await request.json(); } catch { return Response.json({ detail: 'Cuerpo no válido' }, { status: 422 }); }
  if (typeof body?.starred !== 'boolean') return Response.json({ detail: 'Cuerpo no válido' }, { status: 422 });
  await ensureSchema(env.DB);
  const result = await env.DB.prepare('UPDATE jobs SET starred=? WHERE id=? AND org_id=?')
    .bind(body.starred ? 1 : 0, jobId, ORG).run();
  if (!result.meta.changes) return Response.json({ detail: 'Oferta no encontrada' }, { status: 404 });
  return Response.json({ ok: true }, { headers: corsHeaders(request) });
}

// Embudo por fuente (solo lectura): revisadas del último run (estado por fuente,
// la misma contabilidad honesta de aceptadas que deja el run), catálogo vivo por
// fuente y elegibles/seleccionadas del catálogo con la vista alumna por defecto
// (ES por gate, bilingüe opt-in off, frescura 10 días). Los elegibles son del
// catálogo actual, no delta del run: el mismo cuerpo alimenta varias recogidas.
async function handleFunnel(env) {
  const db = env.DB;
  await ensureSchema(db);
  const { ranked, selectionTotal } = await studentSurface(env, {
    role: null, market: 'any', days: 10, includeBilingual: false,
    starredOnly: false, includeExtraRoles: true, editorialOnly: false,
  });
  const bySource = new Map(SOURCES.map(s => [s.code, {
    code: s.code, name: s.name, elegible: 0, seleccionada: 0, roles: {},
  }]));
  for (const offer of ranked) {
    const row = bySource.get(offer.source_code);
    if (!row) continue;
    row.elegible += 1;
    if (offer.is_selected) row.seleccionada += 1;
    row.roles[offer.role] = (row.roles[offer.role] ?? 0) + 1;
  }
  const cat = await db.prepare(`
    SELECT p.source AS code, count(*) AS n FROM catalog_entries c
    JOIN jobs j ON j.org_id=c.org_id AND j.id=c.job_id
    JOIN job_postings p ON p.org_id=j.org_id AND p.id=j.posting_id
    WHERE c.org_id=? AND c.expires_at > ? GROUP BY p.source`).bind(ORG, now()).all();
  for (const row of cat.results) {
    const entry = bySource.get(row.code);
    if (entry) entry.catalogo = row.n;
  }
  const run = await db.prepare('SELECT id,day,status,sources FROM collection_runs WHERE org_id=? ORDER BY created_at DESC LIMIT 1').bind(ORG).first();
  const postFor = new Map(((run && JSON.parse(run.sources)) || []).map(s => [s.code, s]));
  const sources = [...bySource.values()].filter(r => r.catalogo || postFor.has(r.code)).map(r => {
    const post = postFor.get(r.code);
    return {
      ...r,
      revisadas: post ? post.accepted : null,
      run_status: post ? post.status : null,
      fuente: post && post.status !== 'completed' ? (post.warning || undefined) : undefined,
    };
  });
  return Response.json({
    engine: 'closer-ia-ops-engine', org: ORG,
    generated_at: now(),
    last_run: run ? { id: run.id, day: run.day, status: run.status } : null,
    totales: {
      revisadas: sources.reduce((n, s) => n + (s.revisadas ?? 0), 0),
      catalogo: sources.reduce((n, s) => n + (s.catalogo ?? 0), 0),
      elegible: ranked.length,
      seleccionada: selectionTotal,
    },
    sources,
  });
}

async function handleStatus(env) {
  const db = env.DB;
  await ensureSchema(db);
  const run = await db.prepare('SELECT * FROM collection_runs WHERE org_id=? ORDER BY created_at DESC LIMIT 1').bind(ORG).first();
  const counts = await db.batch([
    db.prepare('SELECT count(*) AS n FROM raw_items WHERE org_id=?').bind(ORG),
    db.prepare('SELECT count(*) AS n FROM catalog_entries WHERE org_id=? AND expires_at > ?').bind(ORG, now()),
  ]);
  return Response.json({
    engine: 'closer-ia-ops-engine', org: ORG,
    raw_items: counts[0].results[0].n, catalog_active: counts[1].results[0].n,
    latest_run: run ? { id: run.id, day: run.day, status: run.status, created_at: run.created_at, completed_at: run.completed_at, sources: JSON.parse(run.sources) } : null,
  });
}

const corsHeaders = request => ({
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, X-Collect-Token',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS, PATCH',
});

// ------ entrada ------
export default {
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(runCollection(env).catch(() => {}));
    // Audit de slugs en cada tick programado: cubre también días sin lecturas.
    ctx.waitUntil(runSlugAudit(env).catch(() => {}));
  },
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders(request) });
    const adminMatch = url.pathname.match(/^\/v1\/admin\/opportunities(?:\/([a-zA-Z0-9-]{1,64})(\/verify)?)?$/);
    if (adminMatch) {
      // Superficie admin del catálogo cloud (port del panel por fases): fase 1 =
      // LECTURA con filtros; fase 2 = PATCH de revisión editorial con versiones
      // inmutables. Ambas bajo ADMIN_TOKEN (secreto de producción); sin cabecera
      // válida 401. Los gastos (Apify/AI/SerpApi) NO viven aquí.
      const adminCheck = requireAdmin(request, env);
      if (adminCheck) return adminCheck;
      // Port fase 5 (sesión 38): POST /activate = activación en lote del pool elegible
      // (dry_run por defecto). Va ANTES de las rutas por id: 'activate' no es un id.
      if (request.method === 'POST' && adminMatch[1] === 'activate' && !adminMatch[2]) return handleAdminActivate(request, env);
      // Port fase 3 (sesión 32): POST {id}/verify = verificación de vigencia.
      if (request.method === 'POST' && adminMatch[1] && adminMatch[2] === '/verify') return handleAdminVerify(request, env, adminMatch[1]);
      if (request.method === 'PATCH' && adminMatch[1]) return handleAdminReview(request, env, adminMatch[1]);
      if (request.method === 'GET' && adminMatch[1]) return handleAdminDetail(request, env, adminMatch[1]);
      if (request.method === 'POST' && adminMatch[1]) return Response.json({ detail: 'POST solo con /verify: POST /v1/admin/opportunities/{id}/verify' }, { status: 405 });
      if (!adminMatch[1] && request.method === 'PATCH') return Response.json({ detail: 'PATCH requiere el id de la oportunidad: /v1/admin/opportunities/{id}' }, { status: 404 });
      const p = url.searchParams;
      const status = ['draft', 'needs_review', 'approved', 'published', 'withdrawn'].includes(p.get('status') || '') ? p.get('status') : null;
      const source = /^[a-z0-9-]{1,40}$/.test(p.get('source') || '') ? p.get('source') : null;
      const limit = Math.min(Math.max(Number(p.get('limit')) || 50, 1), 200);
      const rows = await env.DB.prepare(`
        SELECT o.id AS opportunity_id, o.org_id, o.editorial_status, o.opportunity_status, o.connection_type, o.created_at, o.updated_at,
               j.id AS job_id, p.source, p.payload
          FROM opportunities o
          JOIN jobs j ON j.org_id=o.org_id AND j.id=o.job_id
          JOIN job_postings p ON p.org_id=j.org_id AND p.id=j.posting_id
         WHERE o.org_id=? ${status ? 'AND o.editorial_status=?' : ''} ${source ? 'AND p.source=?' : ''}
         ORDER BY o.created_at DESC LIMIT ?`).bind(ORG, ...(status ? [status] : []), ...(source ? [source] : []), limit).all();
      const counter = await env.DB.prepare(`
        SELECT editorial_status, COUNT(*) AS n FROM opportunities WHERE org_id=? GROUP BY editorial_status`).bind(ORG).all();
      const items = rows.results.map(r => {
        const payload = JSON.parse(r.payload);
        return { id: r.opportunity_id, job_id: r.job_id, original_title: payload.title ?? null, company: payload.company ?? null, source_url: payload.url ?? null,
          source: r.source, editorial_status: r.editorial_status, opportunity_status: r.opportunity_status,
          connection_type: r.connection_type, created_at: r.created_at, updated_at: r.updated_at };
      });
      return Response.json({ items, total: rows.results.length, counts: Object.fromEntries(counter.results.map(c => [c.editorial_status, c.n])) }, { headers: corsHeaders(request) });
    }
    if (url.pathname === '/api/offers') {
      // Refresco perezoso: si la última recogida es vieja, lanza una en segundo plano sin bloquear la lectura.
      ctx.waitUntil(runCollection(env).catch(() => {}));
      return handleOffers(request, env, url);
    }
    if (url.pathname === '/v1/opportunities/search') {
      // Refresco perezoso en la superficie de la alumna (elección del operador 2026-10-15,
      // mientras el schema de Sites deploy no acepte `crons`): una lectura con la última
      // recogida >6 h lanza la recogida en 2º plano. El umbral anti-duplicados interno de
      // runCollection (6 h) evita que dos lecturas juntas paguen dos veces.
      ctx.waitUntil(runCollection(env).catch(() => {}));
    }
    if (url.pathname === '/api/status') return handleStatus(env);
    if (url.pathname === '/api/funnel') return handleFunnel(env);
    if (url.pathname === '/api/audit') return handleAudit(request, env);
    if (url.pathname === '/api/collect' && request.method === 'POST') {
      if (!env.COLLECT_TOKEN || request.headers.get('X-Collect-Token') !== env.COLLECT_TOKEN) {
        return Response.json({ detail: 'No autorizado' }, { status: 401 });
      }
      const result = await runCollection(env, true);
      return Response.json(result);
    }
    // Superficie de la vista de alumna (consumida por el proxy /api/backend de Next en el dominio):
    const starMatch = url.pathname.match(/^\/v1\/jobs\/([^/]+)\/star$/);
    if (url.pathname === '/v1/opportunities/search' && request.method === 'POST') return handleStudentSearch(request, env);
    if (starMatch && request.method === 'PATCH') return handleStar(request, env, starMatch[1]);
    if (url.pathname.startsWith('/v1/')) {
      // El modo hospedado solo expone la vista de alumna; el admin con fichas de edición sigue
      // siendo el modo local del operador. Explícito para no servir HTML de assets por accidente.
      return Response.json({ detail: 'Ruta no disponible en modo hospedado' }, { status: 404 });
    }
    if (env.ASSETS) return env.ASSETS.fetch(request);
    return Response.json({ engine: 'closer-ia-ops-engine', hint: 'Lecturas: /api/offers · /api/status · /api/audit' });
  },
};
