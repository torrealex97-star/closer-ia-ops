// closer-ia-ops — motor de recogida en la nube (Cloudflare Worker + D1).
// Principios del repo: evidencia raw inmutable (append-only), separada del procesado;
// org-scoped; nunca inventar fuentes (solo canales verificados); fallo de una fuente
// no oculta las demás; exposición honesta de lo desconocido (application_type: unknown).

const ORG = 'cloud-wdc';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36';
const COLLECTION_INTERVAL_MS = 6 * 60 * 60 * 1000; // refresco si la última recogida > 6 h
const MAX_ITEMS_PER_SOURCE = 300;

// Fuentes públicas de España verificadas (JobToday slugs canónicos verificados 2026-10-09;
// ATS de la watchlist WDC; sin claves ni scraping autenticado).
const SOURCES = [
  { code: 'jobtoday', name: 'JobToday España', kind: 'jobtoday', slug: 'closer-de-ventas' },
  { code: 'jobtoday-telemarketing', name: 'JobToday Telemarketing', kind: 'jobtoday', slug: 'telemarketing' },
  { code: 'jobtoday-remoto', name: 'JobToday Comercial remoto', kind: 'jobtoday', slug: 'ventas-remoto' },
  { code: 'jobtoday-ventas', name: 'JobToday Ventas', kind: 'jobtoday', slug: 'ventas' },
  { code: 'jobtoday-comercial', name: 'JobToday Comercial', kind: 'jobtoday', slug: 'comercial' },
  { code: 'ats-greenhouse-cabify', name: 'Cabify · Greenhouse', kind: 'greenhouse', slug: 'cabify' },
  { code: 'ats-greenhouse-wallapop', name: 'Wallapop · Greenhouse', kind: 'greenhouse', slug: 'wallapop' },
  { code: 'ats-greenhouse-typeform', name: 'Typeform · Greenhouse', kind: 'greenhouse', slug: 'typeform' },
  { code: 'ats-ashby-pennylane', name: 'Pennylane · Ashby', kind: 'ashby', slug: 'pennylane' },
  { code: 'ats-recruitee-livestorm', name: 'Livestorm · Recruitee', kind: 'recruitee', slug: 'livestorm' },
  { code: 'ats-teamtailor-monestcapital', name: 'Monest Capital · Teamtailor', kind: 'teamtailor', slug: 'monestcapital' },
  { code: 'himalayas', name: 'Himalayas', kind: 'himalayas' },
  { code: 'weworkremotely', name: 'We Work Remotely · ventas', kind: 'rss', slug: 'https://weworkremotely.com/categories/remote-sales-and-marketing-jobs.rss' },
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
    return { external_id: external, payload: {
      title: pick(row, 'title', 'positionName'), company: pick(row, 'company', 'companyName'),
      location: pick(row, 'workplaceAddress', 'location', 'city'), url: row.canonicalUrl ? `https://jobtoday.com${row.canonicalUrl}` : null,
      salary: pick(row, 'salary'), posted_at: row.createDate ? new Date(row.createDate).toISOString() : null, raw: row,
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
  const terms = ['closer', 'ventas', 'sales'];
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

const EXTRACTORS = {
  jobtoday: sourceJobToday, greenhouse: sourceGreenhouse, ashby: sourceAshby,
  recruitee: sourceRecruitee, teamtailor: sourceTeamtailorRss, himalayas: sourceHimalayas, rss: sourceRss,
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

async function handleAudit(request, env) {
  const db = env.DB;
  await ensureSchema(db);
  const day = dayKey();
  const existing = await db.prepare(
    'SELECT source,slug,status,http_status,canonical_url,renamed_from,checked_at FROM slug_audit WHERE org_id=? AND day=? ORDER BY source')
    .bind(ORG, day).all();
  if (existing.results.length >= jobTodaySources().length) {
    return Response.json({ day, cached: true, slugs: existing.results }, { headers: corsHeaders(request) });
  }
  const result = await runSlugAudit(env);
  return Response.json({ ...result, cached: false }, { headers: corsHeaders(request) });
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
  const states = SOURCES.map(s => ({ code: s.code, name: s.name, status: 'queued', fetched: 0, accepted: 0 }));
  await db.prepare('INSERT INTO collection_runs (id,org_id,day,status,sources,created_at) VALUES (?,?,?,?,?,?)')
    .bind(runId, ORG, day, 'running', JSON.stringify(states), now()).run();
  const setState = (code, patch) => { const s = states.find(x => x.code === code); if (s) Object.assign(s, patch); };

  for (const source of SOURCES) {
    try {
      setState(source.code, { status: 'running' });
      const candidates = await EXTRACTORS[source.kind](source);
      let accepted = 0;
      for (let i = 0; i < candidates.length; i += 50) {
        await ingestBatch(db, source, candidates.slice(i, i + 50));
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
  // Audit de slugs forma parte de la recogida: si un slug cambió, el resultado lo muestra
  // como renamed/gone antes de que el extractor falle.
  const slugAudit = await runSlugAudit(env).catch(error => ({ error: String(error.message || error).slice(0, 200) }));
  return { run_id: runId, sources: states, slug_audit: slugAudit };
}

async function ingestBatch(db, source, candidates) {
  const captured = now();
  const statements = [];
  for (const candidate of candidates) {
    const p = candidate.payload;
    if (!p.title || !p.url) continue; // sin título o enlace no hay oferta verificable
    const contentHash = await sha256(JSON.stringify({ t: p.title, c: p.company, u: p.url }));
    const rawId = 'raw-' + crypto.randomUUID();
    const jobId = stableId('job', `${source.code}|${candidate.external_id}`);
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
        .bind(ORG, jobId, captured, new Date(Date.parse(captured) + 10 * 86400000).toISOString().replace('Z', '+00:00')),
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
const ROLE_KEYWORDS = {
  closer: ['closer', 'cierre de ventas', 'comercial de cierre'],
  setter: ['setter', 'qualificador'],
  cold_caller: ['cold call', 'telemarketing', 'televentas', 'televendedor'],
  account_executive: ['account executive', 'ejecutivo comercial', 'executive'],
  sdr: ['sdr', 'sales development'],
};
// Señal fuerte de mercado España: la palabra España/país/ciudad explícita o 'remoto' en español.
// No se usa 'es' ni 'europe' como hints sueltos (subcadenas triviales y demasiados falsos positivos);
// una oferta sin señal ES explícita NO se presenta como España (exposición honesta del mercado).
const ES_HINTS = ['españa', 'spain', 'madrid', 'barcelona', 'valencia', 'sevilla', 'málaga', 'malaga', 'bilbao', 'zaragoza', 'remoto', 'europa'];
const NON_ES_HINTS = ['florida', 'texas', 'california', 'new york', 'london', 'londres', 'oklahoma', 'mississippi', 'georgia', 'st. petersburg', 'atlanta', 'nashville', 'dallas', 'okc'];

// Perfil detectado por palabras explícitas del título/ubicación; null si ninguna aparece (nunca se asume).
function detectRole(payload) {
  const haystack = `${payload.title ?? ''} ${payload.location ?? ''}`.toLowerCase();
  return Object.keys(ROLE_KEYWORDS).find(role => ROLE_KEYWORDS[role].some(k => haystack.includes(k))) ?? null;
}

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
      job_id: r.job_id, role: detectRole(p), title: p.title, company: p.company, location: p.location, url: p.url,
      salary: p.salary ?? null, posted_at: p.posted_at ?? null, application_type: 'unknown',
      source_first_seen_at: r.first_seen_at,
    }; })
    .filter(o => matchesQuery(o, query))
    .slice(0, 200);
  return Response.json({ total: offers.length, offers }, { headers: corsHeaders(request) });
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
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
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
    if (url.pathname === '/api/audit') return handleAudit(request, env);
    if (url.pathname === '/api/collect' && request.method === 'POST') {
      if (!env.COLLECT_TOKEN || request.headers.get('X-Collect-Token') !== env.COLLECT_TOKEN) {
        return Response.json({ detail: 'No autorizado' }, { status: 401 });
      }
      const result = await runCollection(env, true);
      return Response.json(result);
    }
    return env.ASSETS.fetch(request);
  },
};
