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
  { code: 'jobtoday-telemarketing', name: 'JobToday Telemarketing', kind: 'jobtoday', slug: 'telemarketing' },
  { code: 'jobtoday-remoto', name: 'JobToday Comercial remoto', kind: 'jobtoday', slug: 'ventas-remoto' },
  { code: 'jobtoday-ventas', name: 'JobToday Ventas', kind: 'jobtoday', slug: 'ventas' },
  { code: 'jobtoday-comercial', name: 'JobToday Comercial', kind: 'jobtoday', slug: 'comercial' },
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
  // Ampliación familia closer (2026-10-15): slugs verificados hoy contra el sitio
  // real (200 + __NEXT_DATA__): 'closers' 8 ítems y 'closer-remoto' 7 — perfiles
  // reales de closer/setter en español (Skool Scaling, Manager Sales,
  // Bastida&Farina, Hispaconex, Hotmart). Motivación: con la familia estricta
  // 'closer' la vista alumna en España rendía solo 3-4; los solapes entre slugs
  // se dedupean por URL en la superficie, y un 401/410 en algún slug no oculta
  // las demás fuentes ('closser' es 410 y 'closer-ventas' 308→ canónico, nada que añadir).
  { code: 'jobtoday-closers', name: 'JobToday Closers', kind: 'jobtoday', slug: 'closers' },
  { code: 'jobtoday-closer-remoto', name: 'JobToday Closer remoto', kind: 'jobtoday', slug: 'closer-remoto' },
  // Himalayas a 1 término (budget 2026-10-15): hoy 3 fetches produjeron 0 elegibles
  // en producción (45 revisadas); 'closer' es su término con yield medido. Si el
  // funnel diurno vuelve a pedir cobertura, se restauran los 3 términos.
  { code: 'himalayas', name: 'Himalayas', kind: 'himalayas' },
  { code: 'weworkremotely', name: 'We Work Remotely · ventas', kind: 'rss', slug: 'https://weworkremotely.com/categories/remote-sales-and-marketing-jobs.rss' },
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
  { code: 'ats-teamtailor-monestcapital', name: 'Monest Capital · Teamtailor', kind: 'teamtailor', slug: 'monestcapital' },
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
async function sourceJobToday(source) {
  const html = await fetchText(`https://jobtoday.com/es/trabajos-${source.slug}`);
  const match = html.match(/<script id="__NEXT_DATA__"[^>]*>(.*?)<\/script>/s);
  if (!match) throw new Error('JobToday no incluye su listado embebido; formato cambiado');
  let data;
  try { data = JSON.parse(match[1]); } catch { throw new Error('NEXT_DATA no parseable'); }
  const sections = data?.props?.pageProps?.feed?.sections;
  if (!Array.isArray(sections)) throw new Error('La estructura embebida de JobToday ha cambiado');
  const rows = sections.flatMap(s => (s.items || [])).filter(it => it && typeof it.payload === 'object').map(it => it.payload);
  return rows.slice(0, MAX_ITEMS_PER_SOURCE).map(row => {
    const external = String(row.key || row.canonicalUrl || '');
    if (!external) return null;
    // Modelo real de JobToday (verificado contra payloads 2026-10-14):
    // título del puesto en row.role, entidad contratante en companyName,
    // dirección legible en row.address, cuerpo completo en row.description,
    // fecha como createDate (epoch ms) o postedSecondsAgo (edad). Si el
    // extractor usa claves que no existen (title, workplaceAddress) el
    // ingestBatch descarta silenciosamente cada candidato: no hay ofertas.
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
  }).filter(Boolean);
}

async function sourceGreenhouse(source) {
  const data = JSON.parse(await fetchText(`https://boards-api.greenhouse.io/v1/boards/${source.slug}/jobs`));
  return (data.jobs || []).slice(0, MAX_ITEMS_PER_SOURCE).map(j => ({ external_id: String(j.id), payload: {
    title: j.title, company: source.name.split(' · ')[0], location: pick(j.location, 'name'),
    url: j.absolute_url, posted_at: j.updated_at ? new Date(j.updated_at).toISOString() : null, raw: j,
  } }));
}

async function sourceAshby(source) {
  const data = JSON.parse(await fetchText(`https://api.ashbyhq.com/posting-api/board/${source.slug}`));
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
  jobtoday: sourceJobToday, greenhouse: sourceGreenhouse, ashby: sourceAshby,
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
  const force = new URL(request.url).searchParams.get('force') === '1';
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
      db.prepare('INSERT OR IGNORE INTO opportunities (id,org_id,job_id,editorial_status,opportunity_status,connection_type,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)')
        .bind('opp-' + jobId.slice(4), ORG, jobId, 'draft', 'verifying', 'external_application', captured, captured),
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

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", nbsp: ' ' };
function plain(value) {
  let text = String(value ?? '');
  text = text.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '');
  text = text.replace(/<\/?(p|div|li|br|h[1-6])\b[^>]*>/gi, '\n');
  text = text.replace(/<[^>]+>/g, '');
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, entity) => {
    if (ENTITIES[entity]) return ENTITIES[entity];
    if (entity.startsWith('#x')) return String.fromCodePoint(parseInt(entity.slice(2), 16));
    if (entity.startsWith('#')) return String.fromCodePoint(parseInt(entity.slice(1), 10));
    return m;
  }).replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, 20000);
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

const COMP_WORDS = /\b(?:salario|sueldo|compensacion|remuneracion|pago|comisiones|salary|compensation|pay rate)\b/;
const VARIABLE_WORDS = /\b(?:comision|commission|ote|promedio|potencial|hasta)\b/;

// El idioma: 3+ lexemas distintivos del español; sin inferir nada. Vocabulario ampliado
// 2026-10-13 con el lenguaje real de las ofertas de JobToday/LATAM del sector comercial
// (experiencia, cliente, campaña, capacitación, postúlate): presencia fuerte de español,
// no solo fórmulas formales tipo 'buscamos/ofrecemos'.
const LANG_ES = /\b(?:buscamos|ofrecemos|equipo|ventas|puesto|funciones|formacion|trabajar|nuestro|nuestra|tienes|seras|salario|horario|comisiones|necesitamos|incorporacion|llamadas|remuneracion|contratamos|tareas|experiencia|clientes?|telefono|sms|mail|lider|liderar|exito|crecimiento|capacitacion|entrenamiento|campana|incentivos|candidat[oa]s?|requisitos?|responsabilidades|interesad[oa]s|postul[ae]tes?|carrera|lunes|viernes|sabado|disciplina|proactiv[oa]|objetivos?|empresas?|persona|oferta|semana|mensual|seguimiento|proceso|convocatoria|entrevista)\b/g;
const LANG_EN_REQ = /\b(?:bilingual|bilingue|fluent|fluency|required|must|proficient|speaking|spoken|communication|requiere|requerido|dominio|nativo|hablantes|idioma|atencion|clientes)\b/;
const LANG_EN = /\b(?:english|ingles)\b/;

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
// opts: { role, market, days, includeBilingual, starredOnly, includeExtraRoles }.
// Devuelve { ranked, total, selectionTotal }: solo lectura del catálogo.
async function studentSurface(env, { role, market, days, includeBilingual, starredOnly, includeExtraRoles }) {
  const db = env.DB;

  const rows = await db.prepare(`
    SELECT j.id AS job_id, j.starred AS starred, p.payload AS payload, p.source AS source, c.expires_at
    FROM catalog_entries c
    JOIN jobs j ON j.org_id=c.org_id AND j.id=c.job_id
    JOIN job_postings p ON p.org_id=j.org_id AND p.id=j.posting_id
    WHERE c.org_id=? AND c.expires_at > ?
    ORDER BY c.first_seen_at DESC, j.id LIMIT 800`).bind(ORG, now()).all();

  const items = [];
  const evidence = new Set();
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
    if (market === 'ES') {
      if (nonSpain(p) || !spainSignal(p)) continue;
    } else if (market !== 'any') {
      // Mercados sin cobertura propia del motor: se exponen solo los que traen país explícito.
      const hay = fold(`${p.title ?? ''} ${p.location ?? ''} ${p.description ?? ''}`);
      if (!MARKET_HINTS[market].some(k => hay.includes(k))) continue;
    }
    // El regex de lexemas va sin acentos: se evalúa sobre el texto plegado (fold),
    // nunca sobre el original — 'formación' sin plegar no matchea 'formacion'.
    const hayES = fold(description);
    // Portugués ≠ español: los lexémas legales compuestos se confunden al plegar
    // ('vendas' tiene forma ES distinta, 'comissões'→'comissoes', 'você'→'voce').
    // Un anuncio portugués nunca es oferta en español, ni siquiera opt-in bilingüe.
    if (/\b(?:vendas|voce|comissoes|portugues|brasil)\b/.test(hayES)) continue;
    const langES = (hayES.match(LANG_ES) || []).length >= 3;
    const enRequired = Boolean(hayES.match(LANG_EN)) && Boolean(hayES.match(LANG_EN_REQ));
    if (!includeBilingual && (!langES || enRequired)) continue;
    if (p.url && evidence.has(p.url)) continue;
    evidence.add(p.url);
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
      const evidenceLine = excerpt(description, COMP_WORDS, '');
      if (evidenceLine && /\d|base|fijo|comision/.test(fold(evidenceLine))) pay = evidenceLine;
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
      score: (titleHit ? 50 : 25) + (ages !== null && ages <= 3 ? 20 : 10) + (!pay.startsWith('Importe no publicado') ? 1 : 0),
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
  const includeExtraRoles = body?.include_extra_roles !== false;
  const { ranked, total, selectionTotal } = await studentSurface(env, { role, market, days, includeBilingual, starredOnly, includeExtraRoles });
  return Response.json({ items: ranked, total, selection_total: selectionTotal }, { headers: corsHeaders(request) });
}

async function handleStar(request, env, jobId) {
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
    starredOnly: false, includeExtraRoles: true,
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
    if (url.pathname === '/api/offers') {
      // Refresco perezoso: si la última recogida es vieja, lanza una en segundo plano sin bloquear la lectura.
      ctx.waitUntil(runCollection(env).catch(() => {}));
      return handleOffers(request, env, url);
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
