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
// Vocabulario de búsqueda de closer: sólo términos que en la medición real (2026-10-26) devolvieron
// ofertas en español y remotas. Un término = una petición pública; se rotan por día para que el
// presupuesto de subrequests del Worker no deje fuera ninguna fuente.
const CLOSER_TERMS = [
  'closer', 'closer remoto', 'remote closer', 'closer de ventas', 'sales closer',
  'cierre comercial', 'cierre de ventas', 'cierre de negocios', 'cerrador de ventas',
  'high ticket', 'inside sales', 'setter', 'agendador', 'comercial remoto',
  'asesor comercial remoto', 'agente comercial remoto', 'ejecutivo comercial remoto',
  'ventas remotas', 'closing sales', 'televentas remoto',
];
// Términos de esta ejecución: ventana fija por día (determinista y comprobable) que avanza
// `perRun` posiciones cada día, así en CLOSER_TERMS.length / perRun días se cubren todos sin
// repetir y sin depender de estado guardado.
function pickTerms(perRun, when = new Date()) {
  const total = CLOSER_TERMS.length;
  const size = Math.max(1, Math.min(perRun || 3, total));
  const day = Math.floor(Date.parse(`${when.toISOString().slice(0, 10)}T00:00:00Z`) / 86400000);
  const start = (day * size) % total;
  return Array.from({ length: size }, (_, i) => CLOSER_TERMS[(start + i) % total]);
}
// Peticiones que costará una fuente: el Worker tiene un tope de subrequests POR INVOCACIÓN y,
// cuando se agota, las últimas fuentes fallaban con «Too many subrequests». Se cuenta antes
// para aplazar (declarado) en vez de romper, y el orden rota por día para que ninguna se
// quede siempre al final.
function fetchCost(source) {
  if (source.kind === 'jobtoday-cities') return (source.paths || []).length;
  if (source.kind === 'getonbrd') return 2;
  if (source.terms) return source.termsPerRun || 3;
  if (source.kind === 'freehire') return source.region === 'latam' ? 1 : 3;
  return 1;
}

// Filtro de ROL en el origen (2026-10-26). Las búsquedas por término de las fuentes gratuitas
// devuelven mucho ruido (dependientes de tienda, «Data Engineer», becarios, «Sales Assistant 30 h»).
// Cada candidato ingerido cuesta 6 escrituras de D1 (raw, posting, job, catálogo, oportunidad y
// versión) y el ruido NUNCA puede salir a la alumna, así que se descarta ANTES de escribir.
//
// Qué se queda: las familias del perfil WDC (closer, setter, cold caller, sdr). La familia
// `account_executive` NO entra por aquí: ya llega abundante por el barrido por categoría de
// FreeHire (medido 2026-10-26: 278 candidatos por pasada, 851 en catálogo, 19 elegibles y
// **0 closers**) y duplicarla gastaría la cuota mensual de escrituras de D1 sin aportar closers.
//
// No es una lista paralela: la familia sale del MISMO `classifyRole` del motor (prioridad
// closer → setter → cold_caller → account_executive → sdr), así que clasificador y filtro no
// pueden divergir. Lo descartado se cuenta y se publica en el estado del run (`filtered`), para
// que «leídas» no se lea como «no había nada».
const PROFILE_FAMILIES = new Set(['closer', 'setter', 'cold_caller', 'sdr']);
const extractFiltered = new Map();
const resetExtractFiltered = () => extractFiltered.clear();
const filteredOf = code => extractFiltered.get(code) || 0;
const countFiltered = code => extractFiltered.set(code, filteredOf(code) + 1);
function familyOf(payload) {
  const text = fold(`${payload.title ?? ''} ${payload.location ?? ''} ${String(payload.raw?.description ?? payload.raw?.excerpt ?? payload.raw?.summary ?? '').slice(0, 800)}`);
  return classifyRole({ title: payload.title }, text);
}
const isProfileCandidate = payload => PROFILE_FAMILIES.has(familyOf(payload));

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
  // Madrid probado y retirado el 2026-10-23: la nacional ya devuelve el inventario de
  // Madrid (Velian, Accenture, Talent Class) y la página de ciudad no añadió ni una
  // oferta nueva al catálogo en la recogida real (17 candidatos leídos, 0 nuevas), así
  // que gastar un fetch ahí no compra nada. El cuello no es la plaza: es el inventario.
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
  // Búsquedas de CLOSER por término (2026-10-26, medido contra la API real): la consulta
  // por categoría traía comerciales genéricos (58 elegibles, sólo 2 closers); con `q` y
  // términos en español, la misma fuente devuelve 58 ofertas únicas de closer en español
  // y remotas (ES/LATAM). Mismo conector, 1 petición por término; los términos ROTAN por
  // día para que el presupuesto de subrequests cubra todo el vocabulario en una semana.
  // Ventana ampliada (2026-10-26, tras medir rendimiento por término): 6 términos por pasada en
  // ES y 5 en LATAM cubren los 20 del vocabulario en ~4 días y no dejan sin presupuesto al resto
  // de fuentes. Es 1 petición por término: más términos, no más límite de ofertas.
  { code: 'freehire-closer', name: 'FreeHire España · closer', kind: 'freehire', region: 'es', terms: true, termsPerRun: 6 },
  { code: 'freehire-latam-closer', name: 'FreeHire LATAM · closer', kind: 'freehire', region: 'latam', terms: true, termsPerRun: 5 },
  // Himalayas: retirada el 2026-10-22 por inglés (0 elegibles con `q=closer`). Medición de
  // hoy 2026-10-26 con el vocabulario español: 19 closers únicos en español y remotos
  // (Colombia, México, Perú, Guatemala y remoto en USD), así que vuelve solo con términos.
  { code: 'himalayas-closer', name: 'Himalayas · closer (ES/remoto)', kind: 'himalayas', terms: true, termsPerRun: 4 },
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

async function sourceHimalayas(source = {}) {
  // Términos del vocabulario (rotan por día). Cada término es una búsqueda pública: si una
  // falla, las demás siguen y lo traído se ingiere; sólo si fallan TODAS la fuente se declara
  // caída (un fallo no puede esconder los resultados buenos de los otros términos).
  const seen = new Set(); const all = []; const errors = [];
  for (const term of pickTerms(source.termsPerRun || 3)) {
    try {
      const data = JSON.parse(await fetchText(`https://himalayas.app/jobs/api/search?q=${encodeURIComponent(term)}&sort=recent&page=1`));
      for (const j of (data.jobs || data || []).slice(0, 100)) {
        const external = String(pick(j, 'id', 'jobId', 'slug') || j.title || '');
        if (!external || seen.has(external)) continue;
        seen.add(external);
        const payload = {
          title: pick(j, 'title', 'jobTitle'), company: pick(j, 'companyName', 'company'),
          location: pick(j, 'locationRestrictions', 'location'), url: pick(j, 'applicationLink', 'jobUrl', 'guid'),
          posted_at: pick(j, 'publishedDate', 'pubDate'), raw: { ...j, search_term: term },
        };
        if (!isProfileCandidate(payload)) { countFiltered(source.code); continue; }
        all.push({ external_id: external, payload });
      }
    } catch (error) { errors.push(`${term}: ${String(error.message || error).slice(0, 80)}`); }
  }
  if (errors.length && !all.length) throw new Error(`ningún término respondió (${errors[0]})`);
  return all.slice(0, MAX_ITEMS_PER_SOURCE);
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
  // Dos modos: por CATEGORÍA (barrido amplio) y por TÉRMINO `q` (lo que trae closers: medido
  // 2026-10-26, la categoría daba 58 elegibles y sólo 2 closers; los términos en español, 58
  // closers únicos en español y remotos). Los términos rotan por día.
  const terms = source.terms ? pickTerms(source.termsPerRun || 3) : [null];
  const maxPages = source.terms ? 1 : source.region === 'latam' ? 1 : 3;
  const all = []; const seen = new Set(); const errors = [];
  for (const term of terms) {
    const params = new URLSearchParams({ limit: '100', sort: 'posted_at', order: 'desc' });
    if (term) params.set('q', term); else params.set('category', 'sales');
    if (source.region === 'es') params.set('countries', 'ES');
    if (source.region === 'latam') params.set('regions', 'latam');
    try {
      for (let page = 0; page < maxPages; page++) {
        const offset = page * 100;
        const data = JSON.parse(await fetchText(`https://freehire.me/api/v1/jobs/search?${params}&offset=${offset}`));
        const rows = data.data || [];
        for (const row of rows) {
          const reality = row.reality && typeof row.reality === 'object' ? row.reality : {};
          if (reality.class && !['fresh', null, undefined].includes(reality.class)) continue;
          const external = String(row.public_slug || row.url || '');
          if (!external || !row.url || seen.has(external.slice(-120))) continue;
          seen.add(external.slice(-120));
          const payload = {
            title: row.title, company: row.company ?? row.company_name ?? null, location: Array.isArray(row.countries) ? row.countries.join(', ') : (row.location || null),
            url: row.url, posted_at: row.posted_at ?? null, raw: term ? { ...row, search_term: term } : row,
          };
          // Solo las búsquedas por término filtran por rol: el barrido por categoría conserva su
          // comportamiento amplio (es el que descubre roles fuera del vocabulario de closer).
          if (term && !isProfileCandidate(payload)) { countFiltered(source.code); continue; }
          all.push({ external_id: external.slice(-120), payload });
        }
        const total = data.meta?.total; const pageLen = rows.length;
        if (!Number.isFinite(total) || offset + 100 >= total || pageLen < 100) break;
      }
    } catch (error) { errors.push(`${term ?? 'categoría'}: ${String(error.message || error).slice(0, 80)}`); }
  }
  if (errors.length && !all.length) throw new Error(`ninguna búsqueda respondió (${errors[0]})`);
  return all.slice(0, MAX_ITEMS_PER_SOURCE);
}

// Superficie de pruebas (Node importa este módulo y comprueba vocabulario, rotación y extractores
// sin red ni D1). Los Workers ignoran exportaciones extra; `sites/engine/deploy-manifest.json`
// solo declara el módulo y el entrypoint.
export const __test = { CLOSER_TERMS, pickTerms, fetchCost, sourceFreehire, sourceHimalayas, SOURCES, isProfileCandidate, familyOf, PROFILE_FAMILIES, filteredOf, resetExtractFiltered, classifyRole, hasWord };

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
  const counters = { published: 0, needs_review: 0, skipped: 0, withdrawn: 0, deferred: 0 };
  const writeBudget = dryRun ? 0 : WRITE_BUDGET;
  let written = 0;
  // Lo que la puerta determinista descarta NO se queda en el pool de borradores: se retira con su
  // razón y deja de pedir revisión humana. Se agrupa por razón para retirarlo en pocas escrituras
  // (una por motivo) en vez de una por oferta. Es reversible: la fila se conserva y un PATCH puede
  // devolverla a revisión.
  const rejects = new Map();
  const reject = (id, reason) => {
    counters.skipped += 1;
    const group = rejects.get(reason) ?? [];
    group.push(id);
    rejects.set(reason, group);
    items.push({ id, action: 'withdraw', reason });
  };
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
    if (!derivedRole) { reject(row.opportunity_id, 'sin perfil comercial reconocible'); continue; }
    if (role && derivedRole !== role) { skip(`perfil ${derivedRole} distinto del pedido (${role})`); continue; }
    if (market === 'ES' && (nonSpain(p) || !spainSignal(p))) { reject(row.opportunity_id, 'sin señal de mercado España'); continue; }
    // Sin texto no hay evidencia de idioma: no es «no está en español». Se deja en borrador (como antes)
    // en vez de retirar en bloque, con un motivo falso, todo lo que llega sin descripción.
    if (!description.trim()) { skip('sin descripción: no se puede comprobar el idioma'); continue; }
    if (!spanishBodyGate(description, false).ok) { reject(row.opportunity_id, 'el anuncio no está en español'); continue; }
    const ages = p.posted_at ? (Date.now() - Date.parse(p.posted_at)) / 86400000 : null;
    if (ages !== null && Number.isFinite(ages) && ages > days) { reject(row.opportunity_id, `publicado hace más de ${days} días`); continue; }
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
  // Retirada en bloque de lo descartado (solo en ejecución real). Una escritura por motivo;
  // guarda `editorial_status='draft'` para no pisar lo que una persona movió entretanto.
  if (!dryRun) {
    for (const [reason, group] of rejects) {
      for (let i = 0; i < group.length; i += 80) {
        const chunk = group.slice(i, i + 80);
        const applied = await db.prepare(`UPDATE opportunities SET editorial_status='withdrawn', status_reason=?, updated_at=?
          WHERE org_id=? AND editorial_status='draft' AND id IN (${chunk.map(() => '?').join(',')})`)
          .bind(`clasificación automática: ${reason}`, now(), ORG, ...chunk).run();
        counters.withdrawn += Number(applied?.meta?.changes ?? 0);
      }
    }
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
  resetExtractFiltered();
  await db.prepare('INSERT INTO collection_runs (id,org_id,day,status,sources,created_at) VALUES (?,?,?,?,?,?)')
    .bind(runId, ORG, day, 'running', JSON.stringify(states), now()).run();
  const setState = (code, patch) => { const s = states.find(x => x.code === code); if (s) Object.assign(s, patch); };

  // El tope de subrequests por invocación es del Worker, no una decisión de producto: no se recorta
  // cuántas ofertas se traen, se reparte el presupuesto y lo que NO cabe se APLAZA declarándolo en el
  // estado del run (antes esas fuentes fallaban con «Too many subrequests»). El punto de partida rota
  // por día para que ninguna se quede siempre al final.
  const budget = Math.max(SOURCES.length, Number(env?.MAX_SUBREQUESTS || 40));
  const rotate = Math.floor(Date.parse(`${day}T00:00:00Z`) / 86400000) % SOURCES.length;
  const ordered = [...SOURCES.slice(rotate), ...SOURCES.slice(0, rotate)];
  let spent = 0;
  for (const source of ordered) {
    const cost = fetchCost(source);
    if (spent + cost > budget) {
      setState(source.code, { status: 'deferred', warning: `Aplazada: el presupuesto de ${budget} peticiones de esta ejecución se agotó (entra en la siguiente)` });
      continue;
    }
    spent += cost;
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
      setState(source.code, { status: 'completed', fetched: candidates.length, accepted: candidates.length, filtered: filteredOf(source.code) });
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
    // Variantes con evidencia real (pasada de Workana 2026-10-26): un proyecto de
    // «Seguimiento y Cierre de Ventas por WhatsApp» quedaba sin perfil.
    'cierre de ventas', 'cierre comercial', 'cierre de negocios',
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
    // «Ejecutivo(a) Comercial» (Workana 2026-10-26): la forma con (a) no estaba y se perdía.
    'ejecutivo(a) comercial', 'ejecutiva(o) comercial',
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
// Municipios (8.132), provincias y comunidades de España (INE, vía Code for Spain).
// Se compara por SEGMENTO exacto de la ubicación y nunca por subcadena: «Uña» se
// pliega a «una» y esa subcadena está en cualquier frase en español.
const ES_PLACES = `a arnoia
a bana
a bola
a caniza
a capela
a coruna
a estrada
a fonsagrada
a guarda
a gudina
a illa de arousa
a lama
a laracha
a merca
a mezquita
a pastoriza
a peroxa
a pobra de trives
a pobra do brollon
a pobra do caraminal
a pontenova
a rua
a teixeira
a veiga
ababuj
abades
abadia
abadin
abadino
abaigar
abajas
abalos
abaltzisketa
abanades
abanilla
abanto
abanto y ciervana-abanto zierbena
abaran
abarca de campos
abartzuza
abarzuza
abaurrea alta
abaurrea baja
abaurregaina
abaurrepea
abegondo
abejar
abejuela
abella de la conca
abengibre
abenojar
aberin
abertura
abezames
abia de la obispalia
abia de las torres
abiego
abizanda
abla
ablanque
ablitas
abrera
abrucena
abusejo
acebeda, la
acebedo
acebo
acebron, el
acedera
acehuche
aceituna
acered
aceuchal
adahuesca
adalia
adamuz
adanero
adeje
ademuz
adios
adobes
ador
adra
adrada de haza
adrada de piron
adrada, la
adradas
adrados
aduna
agaete
agallas
ager
agoitz
agolada
agon
agoncillo
agost
agramunt
agreda
agres
agron
aguadulce
aguaron
aguas candidas
aguasal
aguaton
aguaviva
agudo
aguero
aguilafuente
aguilar de bureba
aguilar de campoo
aguilar de campos
aguilar de codes
aguilar de la frontera
aguilar de segarra
aguilar del alfambra
aguilar del rio alhama
aguilas
aguilon
aguimes
agullana
agullent
agulo
agurain
ahigal
ahigal de los aceiteros
ahigal de villarino
ahillones
aia
aiara
aibar
aiegi
aielo de malferit
aielo de rugat
aiguafreda
aiguamurcia
aiguaviva
aigues
ain
ainsa-sobrarbe
ainzon
aisa
aitona
aizarnazabal
ajalvir
ajamil de cameros
ajangiz
ajofrin
alacant
alacon
aladren
alaejos
alagon
alagon del rio
alaior
alajar
alajero
alameda
alameda de gardon, la
alameda de la sagra
alameda del valle
alamedilla
alamedilla, la
alamillo
alaminos
alamo, el
alamus, els
alange
alanis
alaquas
alar del rey
alaraz
alarba
alarcon
alarilla
alaro
alas i cerc
alatoz
alava
alba
alba de cerrato
alba de tormes
alba de yeltes
albacete
albages, l'
albaida
albaida del aljarafe
albal
albala
albaladejo
albaladejo del cuende
albalat de la ribera
albalat dels sorells
albalat dels tarongers
albalate de cinca
albalate de las nogueras
albalate de zorita
albalate del arzobispo
albalatillo
albanchez
albanchez de magina
albanya
albares
albarracin
albarreal de tajo
albatana
albatarrec
albatera
albelda
albelda de iregua
albendea
albendiego
albentosa
alberca de zancara, la
alberca, la
albergueria de arganan, la
alberic
alberite
alberite de san juan
albero alto
albero bajo
alberuela de tubo
albesa
albeta
albi, l'
albillos
albinyana
albiol, l'
albiztur
albocasser
alboloduy
albolote
albondon
albons
alborache
alboraia
alboraya
alborea
alborge
albornos
albox
albudeite
albuera, la
albuixech
albunan
albunol
albunuelas
alburquerque
alcabon
alcadozo
alcaine
alcala de ebro
alcala de guadaira
alcala de gurrea
alcala de henares
alcala de la selva
alcala de la vega
alcala de los gazules
alcala de moncayo
alcala de xivert
alcala del jucar
alcala del obispo
alcala del rio
alcala del valle
alcala la real
alcalali
alcampell
alcanadre
alcanar
alcanices
alcaniz
alcanizo
alcano
alcantara
alcantarilla
alcantera de xuquer
alcantud
alcaracejos
alcaraz
alcarras
alcasser
alcaucin
alcaudete
alcaudete de la jara
alcazar de san juan
alcazar del rey
alcazaren
alcazares, los
alcoba
alcobendas
alcocer
alcocero de mola
alcohujate
alcoi
alcolea
alcolea de calatrava
alcolea de cinca
alcolea de las penas
alcolea de tajo
alcolea del pinar
alcolea del rio
alcoleja
alcoletge
alcollarin
alconaba
alconada
alconada de maderuelo
alconchel
alconchel de ariza
alconchel de la estrella
alconera
alcontar
alcora, l'
alcorcon
alcorisa
alcoroches
alcosser
alcover
alcoy
alcubierre
alcubilla de avellaneda
alcubilla de las penas
alcubilla de nogales
alcubillas
alcublas
alcudia
alcudia de crespins, l'
alcudia de monteagud
alcudia de veo
alcudia, l'
alcuescar
aldaia
aldea de san miguel
aldea de san nicolas, la
aldea del cano
aldea del fresno
aldea del obispo
aldea del obispo, la
aldea del rey
aldea en cabo
aldea real
aldea, l'
aldeacentenera
aldeacipreste
aldeadavila de la ribera
aldealafuente
aldealcorvo
aldealengua
aldealengua de pedraza
aldealengua de santa maria
aldealices
aldealpozo
aldealsenor
aldeamayor de san martin
aldeanueva de barbarroya
aldeanueva de ebro
aldeanueva de figueroa
aldeanueva de guadalajara
aldeanueva de la serrezuela
aldeanueva de la sierra
aldeanueva de la vera
aldeanueva de san bartolome
aldeanueva de santa cruz
aldeanueva del camino
aldeanueva del codonal
aldeaquemada
aldearrodrigo
aldearrubia
aldeaseca
aldeaseca de alba
aldeaseca de la frontera
aldeasona
aldeatejada
aldeavieja de tormes
aldehorno
aldehuela de la boveda
aldehuela de liestos
aldehuela de perianez
aldehuela de yeltes
aldehuela del codonal
aldehuela del jerte
aldehuela, la
aldehuelas, las
aldeire
aldeonte
aldover
aledo
alegia
alegria-dulantzi
aleixar, l'
alella
alentisque
alerre
alesanco
aleson
alfacar
alfafar
alfafara
alfajarin
alfambra
alfamen
alfantega
alfara de carles
alfara de la baronia
alfara del patriarca
alfaraz de sayago
alfarb
alfarnate
alfarnatejo
alfaro
alfarras
alfarrasi
alfas del pi, l'
alfauir
alfes
alfondeguilla
alforja
alforque
alfoz
alfoz de bricia
alfoz de lloredo
alfoz de quintanaduenas
alfoz de santa gadea
algaba, la
algadefe
algaida
algamitas
algar
algar de mesa
algar de palancia
algarinejo
algarra
algarrobo
algatocin
algeciras
algemesi
algerri
algete
algimia d'alfara
algimia de almonacid
alginet
algodonales
algodre
algora
algorfa
alguaire
alguazas
alguena
alhabia
alhama de almeria
alhama de aragon
alhama de granada
alhama de murcia
alhambra
alhaurin de la torre
alhaurin el grande
alhendin
alhondiga
alia
aliaga
aliaguilla
alicante
alicun
alicun de ortega
alija del infantado
alins
alio
alique
aliseda
aliud
aljaraque
aljucen
alkiza
allande
allariz
allepuz
aller
allin
allo
alloza
allueva
almacelles
almachar
almaden
almaden de la plata
almadenejos
almadrones
almagro
almajano
almaluez
almansa
almanza
almaraz
almaraz de duero
almarcha, la
almargen
almarza
almarza de cameros
almassera
almassora
almatret
almazan
almazul
almedijar
almedina
almedinilla
almegijar
almeida de sayago
almenar
almenar de soria
almenara
almenara de adaja
almenara de tormes
almendra
almendral
almendral de la canada
almendralejo
almendro, el
almendros
almensilla
almeria
almisera
almochuel
almocita
almodovar del campo
almodovar del pinar
almodovar del rio
almogia
almoguera
almohaja
almoharin
almoines
almolda, la
almonacid de la cuba
almonacid de la sierra
almonacid de toledo
almonacid de zorita
almonacid del marquesado
almonaster la real
almonte
almoradi
almorox
almoster
almudaina
almudevar
almunecar
almunia de dona godina, la
almunia de san juan
almuniente
almuradiel
almussafes
alobras
alocen
alonsotegi
alora
alos de balaguer
alosno
alovera
alozaina
alp
alpandeire
alpanseque
alpartir
alpedrete
alpenes
alpens
alpera
alpicat
alpuente
alpujarra de la sierra
alqueria d'asnar, l'
alqueria de la comtessa, l'
alquerias del nino perdido
alqueries, les
alquezar
alquife
alsasua
alsodux
alt aneu
altable
altafulla
altarejos
altea
altorricon
altos, los
altsasu
altura
altzaga
altzo
alustante
alzira
amavida
amayuelas de arriba
ambel
ambite
amer
ames
amescoa baja
ametlla de mar, l'
ametlla del valles, l'
ameyugo
amezketa
amieva
amoeiro
amorebieta-etxano
amoroto
ampolla, l'
amposta
ampudia
ampuero
amurrio
amusco
amusquillo
anadon
anana
anaya
anaya de alba
anchuelo
anchuras
ancin
andalucia
andavias
andilla
andoain
andorra
andosilla
andratx
andujar
ane
anento
angles
anglesola
angon
anguciana
angues
anguiano
anguita
anguix
anievas
aninon
anna
anoeta
anon de moncayo
anora
anorbe
anover de tajo
anover de tormes
anquela del ducado
anquela del pedregal
anso
ansoain
antas
antas de ulla
antella
antequera
antigua
antigua, la
antiguedad
antillon
antsoain
antzin
antzuola
anue
aoiz
araba
arabayona de mogica
aracena
arafo
aragon
aragues del puerto
arahal
arahuetes
araitz
arakaldo
arakil
arama
aramaio
aranarache
aranaratxe
arancon
aranda de duero
aranda de moncayo
arandiga
arandilla
arandilla del arroyo
aranga
aranguren
aranjuez
arano
arantza
arantzazu
aranuel
aranzueque
arapiles
aras
aras de los olmos
arauzo de miel
arauzo de salce
arauzo de torre
arbancon
arbeca
arbeteta
arbizu
arbo
arboc, l'
arboleas
arboli
arbucies
arcas
arce
arcediano
arcenillas
archena
archez
archidona
arcicollar
arco, el
arconada
arcones
arcos
arcos de jalon
arcos de la frontera
arcos de la polvorosa
arcos de la sierra
arcos de las salinas
arcos, los
ardales
ardisa
ardon
areatza
arellano
aren
arenal, el
arenales de san gregorio
arenas
arenas de iguna
arenas de san juan
arenas de san pedro
arenas del rey
arenillas
arenillas de riopisuerga
arens de lledo
arenys de mar
arenys de munt
arenzana de abajo
arenzana de arriba
ares
ares del maestrat
areso
aretxabaleta
arevalillo
arevalillo de cega
arevalo
arevalo de la sierra
argamasilla de alba
argamasilla de calatrava
arganda del rey
arganin
arganza
argavieso
argecilla
argelaguer
argelita
argencola
argente
argentera, l'
argentona
arges
argonos
arguedas
arguis
arguisuelas
argujillo
aria
ariany
aribe
arico
arija
arino
ariza
arjona
arjonilla
arlanzon
armallones
armananzas
armentera, l'
armenteros
armilla
arminon
armuna
armuna de almanzora
armuna de tajuna
arnedillo
arnedo
arnes
arnoia, a
arnuero
aroche
arona
arquillinos
arquillos
arrabalde
arraia-maeztu
arrancacepas
arrankudiaga-zollo
arrasate
arratzu
arratzua-ubarrundia
arraya de oca
arrecife
arredondo
arres
arriate
arrieta
arrigorriaga
arroba de los montes
arroniz
arroyo de la encomienda
arroyo de la luz
arroyo de las fraguas
arroyo de san servan
arroyo del ojanco
arroyomolinos
arroyomolinos de la vera
arroyomolinos de leon
arruazu
arrubal
arseguel
arta
artajona
artana
artazu
artea
arteixo
artenara
artes
artesa de lleida
artesa de segre
artieda
artzentales
artzi
artziniega
arucas
arzua
as neves
as nogais
as pontes de garcia rodriguez
as somozas
asco
asin
aspa
aspariegos
asparrena
aspe
asteasu
astigarraga
astillero, el
astorga
astudillo
asturianos
asturias
atajate
atalaya
atalaya del canavate
atalaya, la
atanzon
atapuerca
ataquines
atarfe
atarrabia
ataun
atazar, el
atea
ateca
atetz
atienza
atxondo
atzeneta d'albaida
atzeneta del maestrat
atzubia, l'
aulesti
aunon
auritz
ausejo
ausejo de la sierra
ausines, los
autilla del pino
autillo de campos
autol
aveinte
avellaneda
avellanes i santa linya, les
avellanosa de muno
avia
avila
aviles
avinyo
avinyonet de puigventos
avinyonet del penedes
avion
ayala
ayamonte
ayegui
ayerbe
ayllon
ayna
ayodar
ayoo de vidriales
ayora
ayuela
azagra
azaila
azanuy-alins
azara
azkoien
azkoitia
azlor
aznalcazar
aznalcollar
azofra
azpeitia
azuaga
azuara
azuebar
azuelo
azuqueca de henares
azutan
babilafuente
bacares
badajoz
badalona
badaran
badenas
badia del valles
badolatosa
badules
baells
baena
baeza
baga
baguena
bagues
bahabon
bahabon de esgueva
baides
bailen
bailo
baiona
baix pallars
bakaiku
bakio
balaguer
balanegra
balazote
balbases, los
balboa
balconchan
baldellou
baleares
balears, illes
baleira
balenya
baliarrain
ballestero, el
ballesteros de calatrava
ballobar
balmaseda
balones
balsa de ves
balsareny
baltanas
baltar
bana, a
banares
banastas
bande
baneza, la
banobarez
banon
banos de ebro
banos de la encina
banos de molgas
banos de montemayor
banos de rio tobia
banos de rioja
banos de tajo
banos de valdearados
banuelos
banuelos de bureba
banyalbufar
banyeres de mariola
banyeres del penedes
banyoles
baquerin de campos
barajas de melo
barakaldo
baralla
baranain
baraona
barasoain
barbadas
barbadillo
barbadillo de herreros
barbadillo del mercado
barbadillo del pez
barbalos
barbarin
barbastro
barbate
barbens
barbera de la conca
barbera del valles
barboles
barbolla
barbues
barbunales
barca
barcabo
barcarrota
barcelona
barcena de campos
barcena de cicero
barcena de pie de concha
barceo
barchin del hoyo
barcial de la loma
barcial del barco
barcience
barco de avila, el
barco de valdeorras, o
barcones
bardallur
bareyo
bargas
bargota
barillas
barjas
barlovento
baronia de rialb, la
barracas
barrachina
barraco, el
barrado
barrax
barreiros
barrika
barrio de muno
barriopedro
barrios de bureba, los
barrios de colina
barrios de luna, los
barrios, los
barro
barroman
barruecopardo
barruelo de santullan
barruelo del valle
barrundia
barx
barxeta
basaburua
basardilla
basauri
bascara
basconcillos del tozo
bascones de ojeda
bascunana
bascunana de san pedro
bassella
bastida
bastida, la
batea
baterno
batres
bausen
bayarcal
bayarque
bayubas de abajo
bayubas de arriba
baza
baztan
bea
beade
beamud
beariz
beas
beas de granada
beas de guadix
beas de segura
beasain
becedas
becedillas
beceite
becerrea
becerril de campos
becerril de la sierra
becilla de valderaduey
bedar
bedia
bedmar y garciez
begijar
begonte
begues
begur
beintza-labaien
beire
beires
beizama
bejar
bejis
belalcazar
belascoain
belauntza
belbimbre
belchite
belena
belgida
belianes
belinchon
bell-lloc d'urgell
bellaguarda
bellcaire d'emporda
bellcaire d'urgell
bellmunt d'urgell
bellmunt del priorat
bello
bellprat
bellpuig
bellreguard
bellus
bellvei
bellver de cerdanya
bellvis
belmez
belmez de la moraleda
belmonte
belmonte de campos
belmonte de gracian
belmonte de miranda
belmonte de san jose
belmonte de tajo
belmontejo
belorado
belver de cinca
belver de los montes
belvis de la jara
belvis de monroy
bembibre
benabarre
benacazon
benadalid
benafarces
benafer
benafigos
benageber
benaguasil
benahadux
benahavis
benalauria
benalmadena
benalua
benalua de las villas
benalup-casas viejas
benamargosa
benamaurel
benameji
benamocarra
benaocaz
benaojan
benarraba
benasau
benasque
benassal
benatae
benavent de segria
benavente
benavides
benavites
benegiles
beneixama
beneixida
benejuzar
benetusser
benferri
beniarbeig
beniarda
beniarjo
beniarres
beniatjar
benicarlo
benicasim
benicassim
benicolet
benicull de xuquer
benidoleig
benidorm
beniel
benifaio
benifairo de la valldigna
benifairo de les valls
benifallet
benifallim
benifato
benifla
beniganim
benigembla
benijofar
benilloba
benillup
benimantell
benimarfull
benimassot
benimeli
benimodo
benimuslem
beniparrell
benirredra
benissa
benissanet
benissano
benissoda
benissuera
benitachell
benitagla
benizalon
benlloc
benquerencia
benquerencia de la serena
bentarique
benuza
bera
berango
berantevilla
beranuy
berastegi
beraton
berbegal
berberana
berbinzana
berceo
bercero
berceruelo
berchules
bercial
bercial de zapardiel
bercianos del paramo
bercianos del real camino
bercimuel
berdejo
berga
bergara
bergasa
bergasillas bajera
berge
bergondo
beriain
berja
berlanas, las
berlanga
berlanga de duero
berlanga del bierzo
berlangas de roa
bermellar
bermeo
bermillo de sayago
bernardos
bernedo
berninches
bernuy de porreros
bernuy-zapardiel
berriatua
berriobeiti
berrioplano
berriozar
berriz
berrobi
berrocal
berrocal de huebra
berrocal de salvatierra
berrocalejo
berrocalejo de aragona
berrueces
berrueco
berrueco, el
bertizarana
berzocana
berzosa de bureba
berzosa del lozoya
berzosilla
besalu
bescano
betancuria
betanzos
betelu
betera
beteta
betxi
beuda
bezares
bezas
biar
bicorp
bidania-goiatz
bidankoze
bidaurreta
biel
bielsa
bienservida
bienvenida
bierge
biescas
bigastro
bigues i riells del fai
bijuesca
bilar
bilbao
bimenes
binaced
binefar
binissalem
biosca
biota
bisaurri
bisbal d'emporda, la
bisbal de montsant, la
bisbal del penedes, la
biscarrues
bisimbre
biure
biurrun-olcoz
bizkaia
blacos
blanca
blancafort
blancas
blancos, os
blanes
blascomillan
blasconuno de matacabras
blascosancho
blazquez, los
blecua y torres
blesa
bliecos
boada
boada de campos
boadella i les escaules
boadilla de rioseco
boadilla del camino
boadilla del monte
boal
boalo, el
bobadilla
bobadilla del campo
boboras
boca de huergano
bocairent
boceguillas
bocigas
bocos de duero
bodera, la
bodon, el
bodonal de la sierra
boecillo
bogajo
bogarra
bohodon, el
bohonal de ibor
bohoyo
boimorto
boiro
bola, a
bolanos de calatrava
bolanos de campos
bolbaite
bollullos de la mitacion
bollullos par del condado
bolo, o
boltana
bolulla
bolvir
bonansa
bonar
bonares
bonastre
bonete
boniches
bonilla de la sierra
bonillo, el
bonrepos i mirambell
boqueixon
boquineni
borau
bordalba
bordes, es
bordils
bordon
borge, el
borges blanques, les
borges del camp, les
borja
borjabad
bormujos
bornos
borobia
borox
borrassa
borreda
borrenes
borriana
borriol
bosque, el
bossost
bot
botarell
botija
botorrita
bouza, la
boveda
boveda de toro, la
boveda del rio almar
bovera
bozoo
brabos
brafim
brahojos de medina
branosera
braojos
brazacorta
brazatortas
brazuelo
brea de aragon
brea de tajo
breda
brena alta
brena baja
brenes
breto
bretocino
brieva
brieva de cameros
brihuega
brime de sog
brime de urz
brinas
brincones
brion
briones
briviesca
bronchales
broto
brozas
bruc, el
brull, el
brunete
brunyola i sant marti sapresa
buberos
bubierca
bubion
buciegas
budia
buena
buenache de alarcon
buenache de la sierra
buenamadre
buenaventura
buenavista
buenavista de valdavia
buenavista del norte
buendia
bueu
bufali
bugarra
bugedo
buger
buitrago
buitrago del lozoya
bujalance
bujalaro
bujaraloz
bularros
bulbuente
bullas
buniel
bunol
bunuel
bunyola
burbaguena
burela
bureta
burganes de valverde
burgelu
burgi
burgo de ebro, el
burgo de osma-ciudad de osma
burgo ranero, el
burgo, el
burgohondo
burgos
burguete
burgui
burguillos
burguillos de toledo
burguillos del cerro
burjassot
burlada
burlata
buron
burriana
burujon
busot
busquistar
bustares
bustarviejo
buste, el
bustillo de chaves
bustillo de la vega
bustillo del oro
bustillo del paramo
bustillo del paramo de carrion
busto de bureba
busto, el
busturia
cabaces
cabaco, el
caballar
cabana de bergantinos
cabanabona
cabanas
cabanas de ebro
cabanas de la sagra
cabanas de polendos
cabanas de sayago
cabanas de yepes
cabanas del castillo
cabanas raras
cabanelles
cabanes
cabanes de esgueva
cabanillas
cabanillas de la sierra
cabanillas del campo
cabanyes, les
cabeza de bejar, la
cabeza del buey
cabeza del caballo
cabeza la vaca
cabezabellosa
cabezabellosa de la calzada
cabezamesada
cabezarados
cabezarrubias del puerto
cabezas de alambre
cabezas de san juan, las
cabezas del pozo
cabezas del villar
cabezas rubias
cabezon de cameros
cabezon de la sal
cabezon de la sierra
cabezon de liebana
cabezon de pisuerga
cabezon de valderaduey
cabezuela
cabezuela del valle
cabizuela
cabo
cabolafuente
cabra
cabra de mora
cabra del camp
cabra del santo cristo
cabrales
cabranes
cabredo
cabrejas del campo
cabrejas del pinar
cabrera d'anoia
cabrera de mar
cabrera, la
cabrerizos
cabrero
cabreros del monte
cabreros del rio
cabrillanes
cabrillas
cabrils
cabuerniga
cacabelos
caceres
cachorrilla
cacin
cadalso
cadalso de los vidrios
cadaques
cadiar
cadiz
cadreita
cadrete
cajar
cala
calabazas de fuentiduena
calaceite
calaf
calafell
calahorra
calahorra de boedo
calahorra, la
calamocha
calamonte
calanas
calanda
calasparra
calatanazor
calatayud
calatorao
calcena
caldas de reis
caldearenas
calders
caldes d'estrac
caldes de malavella
caldes de montbui
calella
calera de leon
calera y chozas
caleruega
caleruela
calicasas
calig
calldetenes
calles
callosa d'en sarria
callosa de segura
callus
calmarza
calomarde
calonge de segarra
calonge i sant antoni
calp
caltojar
calvarrasa de abajo
calvarrasa de arriba
calvia
calvos de randin
calzada de bejar, la
calzada de calatrava
calzada de don diego
calzada de los molinos
calzada de oropesa
calzada de valdunciel
calzada del coto
calzadilla
calzadilla de los barros
calzadilla de tera
camaleno
camanas
camarasa
camarena
camarena de la sierra
camarenilla
camargo
camarillas
camarinas
camarles
camarma de esteruelas
camarzana de tera
camas
cambados
cambil
cambre
cambrils
caminomorisco
caminreal
camos
camp de mirra, el
campana, la
campanario
campanet
campaspero
campazas
campdevanol
campelles
campello, el
campezo
campillo de altobuey
campillo de aragon
campillo de aranda
campillo de arenas
campillo de azaba
campillo de deleitosa
campillo de duenas
campillo de la jara, el
campillo de llerena
campillo de ranas
campillo, el
campillos
campillos-paravientos
campillos-sierra
campins
campisabalos
campllong
campo
campo de criptana
campo de mirra
campo de penaranda, el
campo de san pedro
campo de villavidel
campo lameiro
campo lugar
campo real
campofrio
campolara
camponaraya
campoo de enmedio
campoo de yuso
camporredondo
camporrells
camporrobles
campos
campos del paraiso
campos del rio
campotejar
camprodon
camprovin
camunas
canada
canada de benatanduz
canada de calatrava
canada de verich, la
canada del hoyo
canada juncosa
canada rosal
canada vellida
canal de berdun
canalejas de penafiel
canalejas del arroyo
canales
canales de la sierra
canals
canamaque
canamares
canamero
canar
canarias
canas
canavate, el
canaveral
canaveral de leon
canaveras
canaveruelas
candamo
candasnos
candelaria
candelario
candeleda
candilichera
canejan
canena
canencia
canet d'adri
canet d'en berenguer
canet de mar
canet lo roig
canete
canete de las torres
canete la real
canfranc
cangas
cangas de onis
cangas del narcea
canicosa de la sierra
caniles
canillas de abajo
canillas de aceituno
canillas de albaida
canillas de esgueva
canillas de rio tuerto
caniza, a
canizal
canizar
canizar del olivar
canizares
canizo
canjayar
canonja, la
canovelles
canoves i samalus
canredondo
cantabrana
cantabria
cantagallo
cantalapiedra
cantalejo
cantallops
cantalojas
cantalpino
cantaracillo
cantavieja
cantillana
cantimpalos
cantiveros
cantoria
canyelles
capafonts
caparroso
capcanes
capdepera
capdesaso
capela, a
capella
capellades
capileira
capilla
capillas
capmany
capolat
carabana
carabantes
carabias
caracena
caracuel de calatrava
carataunas
caravaca de la cruz
caravia
carazo
carbajales de alba
carbajo
carbajosa de la sagrada
carballeda de avia
carballeda de valdeorras
carballedo
carballino, o
carballo
carbellino
carboneras
carboneras de guadazaon
carbonero el mayor
carboneros
carcaboso
carcabuey
carcaixent
carcar
carcastillo
carcedo de bureba
carcedo de burgos
carcelen
carcer
carcheles
cardedeu
cardena
cardenadijo
cardenajimeno
cardenas
cardenete
cardenosa
cardenosa de volpejera
cardenuela riopico
cardiel de los montes
cardona
cardoso de la sierra, el
carenas
carinena
carino
carlet
carlota, la
carme
carmena
carmenes
carmona
carmonita
carnota
carolina, la
carpio
carpio de azaba
carpio de tajo, el
carpio, el
carracedelo
carral
carranque
carrascal de barregas
carrascal del obispo
carrascal del rio
carrascalejo
carrascalejo, el
carrascosa
carrascosa de abajo
carrascosa de haro
carrascosa de la sierra
carratraca
carreno
carrera, la
carrias
carriches
carricola
carrion de calatrava
carrion de los cespedes
carrion de los condes
carrizo
carrizosa
carrocera
cartagena
cartajima
cartama
cartaya
cartelle
cartes
carucedo
casa de uceda
casabermeja
casafranca
casalarreina
casar de caceres
casar de escalona, el
casar de palomero
casar, el
casarabonela
casarejos
casares
casares de las hurdes
casariche
casarrubios del monte
casarrubuelos
casas altas
casas bajas
casas de benitez
casas de don antonio
casas de don gomez
casas de don pedro
casas de fernando alonso
casas de garcimolina
casas de guijarro
casas de haro
casas de juan nunez
casas de lazaro
casas de los pinos
casas de millan
casas de miravete
casas de reina
casas de san galindo
casas de ves
casas del castanar
casas del conde, las
casas del monte
casas del puerto
casas-ibanez
casasbuenas
casaseca de campean
casaseca de las chanas
casasimarro
casasola
casasola de arion
casatejada
casavieja
casbas de huesca
cascajares de bureba
cascajares de la sierra
cascante
cascante del rio
caseda
caseres
casillas
casillas de coria
casillas de flores
casinos
casla
caso
caspe
caspuenas
cassa de la selva
casserres
castalla
castanar de ibor
castanares de rioja
castaneda
castano del robledo
castaras
castejon
castejon de alarba
castejon de henares
castejon de las armas
castejon de monegros
castejon de sos
castejon de tornos
castejon de valdejasa
castejon del puente
castel de cabra
castelflorite
castell d'aro, platja d'aro i s'agaro
castell de cabres
castell de castells
castell de guadalest, el
castell de l'areny
castell de mur
castell, es
castellanos de castro
castellanos de moriscos
castellanos de villiquera
castellanos de zapardiel
castellar
castellar de la frontera
castellar de la muela
castellar de la ribera
castellar de n'hug
castellar de santiago
castellar del riu
castellar del valles
castellar, el
castellbell i el vilar
castellbisbal
castellcir
castelldans
castelldefels
castellet i la gornal
castellfollit de la roca
castellfollit de riubregos
castellfollit del boix
castellfort
castellgali
castellnou de bages
castellnou de seana
castellnovo
castello
castello d'empuries
castello de farfanya
castello de la plana
castello de rugat
castelloli
castellon
castellon de la plana
castellonet de la conquesta
castellote
castellsera
castelltercol
castellvell del camp
castellvi de la marca
castellvi de rosanes
castelnou
castelseras
castielfabib
castiello de jaca
castigaleu
castil de peones
castil de vela
castilblanco
castilblanco de los arroyos
castildelgado
castilfale
castilforte
castilfrio de la sierra
castiliscar
castilla la mancha
castilla y leon
castilla-la mancha
castillazuelo
castilleja de guzman
castilleja de la cuesta
castilleja del campo
castillejar
castillejo de iniesta
castillejo de martin viejo
castillejo de mesleon
castillejo de robledo
castillejo-sierra
castillo de bayuela
castillo de garcimunoz
castillo de las guardas, el
castillo de locubin
castillo de villamalefa
castillo-albaranez
castillonroy
castillonuevo
castilnuevo
castilruiz
castraz
castrejon de la pena
castrejon de trabancos
castrelo de mino
castrelo do val
castril
castrillo de cabrera
castrillo de don juan
castrillo de duero
castrillo de la guarena
castrillo de la reina
castrillo de la valduerna
castrillo de la vega
castrillo de onielo
castrillo de riopisuerga
castrillo de villavega
castrillo del val
castrillo mota de judios
castrillo-tejeriego
castrillon
castro caldelas
castro de filabres
castro de fuentiduena
castro de rei
castro del rio
castro-urdiales
castrobol
castrocalbon
castrocontrigo
castrodeza
castrogonzalo
castrojeriz
castrojimeno
castromembibre
castromocho
castromonte
castronuevo
castronuevo de esgueva
castronuno
castropodame
castropol
castroponce
castroserna de abajo
castroserracin
castrotierra de valmadrigal
castroverde
castroverde de campos
castroverde de cerrato
castroviejo
castuera
catadau
cataluna
catalunya
catarroja
cati
catllar, el
catoira
catral
caudete
caudete de las fuentes
caudiel
cava
cavia
cayuela
cazalegas
cazalilla
cazalla de la sierra
cazorla
cazurra
cea
cebanico
cebolla
cebrecos
cebreros
cebrones del rio
ceclavin
cedeira
cedillo
cedillo de la torre
cedillo del condado
cedrillas
cee
cehegin
ceinos de campos
celada del camino
celadas
celanova
cella
cellera de ter, la
cellorigo
celra
cendea de olza
cendejas de enmedio
cendejas de la torre
cenes de la vega
cenicero
cenicientos
cenizate
cenlle
centelles
centenera
centenera de andaluz
cepeda
cepeda la mora
cerbon
cerceda
cercedilla
cercs
cerda
cerdanyola del valles
cerdedo-cotobade
cerdido
cereceda de la sierra
cerecinos de campos
cerecinos del carrizal
cerezal de penahorcada
cerezo
cerezo de abajo
cerezo de arriba
cerezo de rio tiron
cernadilla
cerollera, la
cerralbo
cerralbos, los
cerraton de juarros
cerro de andevalo, el
cerro, el
cervantes
cervatos de la cueza
cervello
cervera
cervera de buitrago
cervera de la canada
cervera de los montes
cervera de pisuerga
cervera del llano
cervera del maestre
cervera del rio alhama
cerveruela
cervia de les garrigues
cervia de ter
cervillego de la cruz
cervo
cespedosa de tormes
cetina
ceuta
ceuti
cevico de la torre
cevico navero
chagarcia medianero
chalamera
chamartin
chandrexa de queixa
chane
chantada
chapineria
chauchina
checa
cheles
chella
chelva
chequilla
chera
chercos
cheste
chia
chiclana de la frontera
chiclana de segura
chilches
chillaron de cuenca
chillaron del rey
chillon
chilluevar
chiloeches
chimeneas
chimillas
chinchilla de monte-aragon
chinchon
chipiona
chiprana
chirivel
chiva
chodes
chodos
chovar
chozas de abajo
chozas de canales
chucena
chueca
chulilla
chumillas
churriana de la vega
ciadoncha
cidamon
cidones
ciempozuelos
cierva, la
cieza
cifuentes
cigales
cigudosa
cigunuela
cihuela
cihuri
cijuela
cillan
cillaperlata
cilleros
cilleros de la bastida
cilleruelo de abajo
cilleruelo de arriba
cilleruelo de san mames
cillorigo de liebana
cimanes de la vega
cimanes del tejar
cimballa
cinco olivas
cincovillas
cinctorres
cintruenigo
ciperez
cirat
cirauqui
ciria
ciriza
ciruelas
ciruelos
ciruelos de cervera
ciruelos del pinar
ciruena
cirujales del rio
cisla
cisneros
cistella
cisterniga
cistierna
ciudad real
ciudad rodrigo
ciutadella de menorca
ciutadilla
cizur
clares de ribota
clariana de cardener
clavijo
coana
cobdar
cobeja
cobena
cobeta
cobisa
cobos de cerrato
cobos de fuentiduena
cobreros
coca
coca de alba
cocentaina
codo
codonera, la
codorniz
codos
codosera, la
cofrentes
cogeces de iscar
cogeces del monte
cogollor
cogollos
cogollos de guadix
cogollos de la vega
cogolludo
cogul, el
coin
coiros
colera
coles
colilla, la
colindres
coll de nargo
collado de contreras
collado de la vera
collado del miron
collado hermoso
collado mediano
collado villalba
collazos de boedo
collbato
colldejou
collsuspina
colmenar
colmenar de montemayor
colmenar de oreja
colmenar del arroyo
colmenar viejo
colmenarejo
colomera
colomers
colunga
colungo
coma i la pedra, la
comares
comillas
competa
comunidad de madrid
comunidad foral de navarra
comunidad valenciana
conca de dalt
condado de castilnovo
condado de trevino
condemios de abajo
condemios de arriba
conesa
confrides
congosto
congosto de valdavia
congostrina
conil de la frontera
conquista
conquista de la sierra
consell
constanti
constantina
constanzana
consuegra
contamina
contreras
coomonte
copernal
copons
corbalan
corbera
corbera d'ebre
corbera de llobregat
corbillos de los oteros
corbins
corca
corcos
corcubion
cordoba
cordobilla de lacara
cordovilla
cordovilla la real
cordovin
corduente
corella
corera
coreses
corgo, o
coria
coria del rio
coripe
coristanco
cornago
cornella de llobregat
cornella del terri
cornudella de montsant
coronada, la
coronil, el
corpa
corporales
corral de almaguer
corral de ayllon
corral de calatrava
corral-rubio
corrales de buelna, los
corrales de duero
corrales del vino
corrales, los
corte de peleas
corteconcepcion
cortegada
cortegana
cortelazor
cortes
cortes de aragon
cortes de arenoso
cortes de baza
cortes de la frontera
cortes de pallas
cortes y graena
cortijos, los
corua±a, a
corullon
coruna del conde
coruna, a
corvera de asturias
corvera de toranzo
cosa
coscurita
coslada
cospeito
costitx
costur
cosuenda
cotanes del monte
cotes
cotillas
covaleda
covarrubias
covelo
coves de vinroma, les
cox
cozar
cozuelos de fuentiduena
crecente
creixell
cremenes
crespia
crespos
cretas
crevillent
cristina
cristobal
crivillen
cruilles, monells i sant sadurni de l'heura
cuacos de yuste
cuadros
cualedro
cuarte de huerva
cuba, la
cubas de la sagra
cubel
cubelles
cubells
cubilla
cubillas de cerrato
cubillas de los oteros
cubillas de rueda
cubillas de santa marta
cubillo
cubillo de uceda, el
cubillo del campo
cubillos
cubillos del sil
cubla
cubo de benavente
cubo de bureba
cubo de don sancho, el
cubo de la solana
cubo de tierra del vino, el
cucalon
cudillero
cuelgamures
cuellar
cuenca
cuenca de campos
cuerlas, las
cuerva
cuervo de sevilla, el
cuervo, el
cueva de agreda
cueva de roa, la
cueva del hierro
cuevas bajas
cuevas de almuden
cuevas de provanco
cuevas de san clemente
cuevas de san marcos
cuevas del almanzora
cuevas del becerro
cuevas del campo
cuevas del valle
cuevas labradas
culla
cullar
cullar vega
cullera
culleredo
cumbre, la
cumbres de enmedio
cumbres de san bartolome
cumbres mayores
cunit
cuntis
curiel de duero
curtis
cutar
cuzcurrita de rio tiron
daganzo de arriba
daimiel
daimus
dalias
darnius
daroca
daroca de rioja
darro
das
daya nueva
daya vieja
deba
degana
dehesa de montejo
dehesa de romanos
dehesas de guadix
dehesas viejas
deia
deierri
deifontes
deleitosa
deltebre
denia
derio
descargamaria
desojo
destriana
devanos
deza
dicastillo
diego del carpio
diezma
dilar
dima
dios le guarde
dodro
dolar
dolores
domeno
domingo garcia
domingo perez
domingo perez de granada
don alvaro
don benito
dona mencia
donamaria
donemiliaga
doneztebe
donhierro
doninos de ledesma
doninos de salamanca
donjimeno
donostia
donvidas
dos aguas
dos hermanas
dos torres
dosbarrios
dosrius
dozon
driebes
dudar
duenas
duesaigues
dumbria
durango
durcal
duron
duruelo
duruelo de la sierra
ea
echarri
ecija
eguesibar
eibar
eivissa
ejea de los caballeros
ejeme
ejido, el
ejulve
el acebron
el alamo
el almendro
el arco
el arenal
el astillero
el atazar
el ballestero
el barco de avila
el barraco
el berrueco
el boalo
el bodon
el bohodon
el bonillo
el borge
el bosque
el bruc
el brull
el burgo
el burgo de ebro
el burgo ranero
el buste
el busto
el cabaco
el camp de mirra
el campello
el campillo
el campillo de la jara
el campo de penaranda
el canavate
el cardoso de la sierra
el carpio
el carpio de tajo
el carrascalejo
el casar
el casar de escalona
el castell de guadalest
el castellar
el castillo de las guardas
el catllar
el cerro
el cerro de andevalo
el cogul
el coronil
el cubillo de uceda
el cubo de don sancho
el cubo de tierra del vino
el cuervo
el cuervo de sevilla
el ejido
el escorial
el espinar
el far d'emporda
el fondo de les neus
el frago
el franco
el frasno
el fresno
el garrobo
el gastor
el genoves
el gordo
el grado
el granado
el guijo
el herrumblar
el hito
el hornillo
el hoyo de pinares
el lloar
el losar del barco
el maderal
el madrono
el maillo
el manzano
el masnou
el masroig
el mila
el milano
el miron
el molar
el montmell
el morell
el olivar
el ordial
el oso
el palau d'anglesola
el palmar de troya
el palomar
el papiol
el parral
el paso
el payo
el pedernoso
el pedregal
el pedroso
el pedroso de la armuna
el pego
el peral
el perdigon
el perello
el picazo
el pinar
el pinar de el hierro
el pinell de brai
el pinero
el pino de tormes
el pinos
el pla de santa maria
el pla del penedes
el poal
el poble nou de benitatxell
el pobo
el pobo de duenas
el pont d'armentera
el pont de bar
el pont de suert
el pont de vilomara i rocafort
el port de la selva
el pozuelo
el prat de llobregat
el provencio
el puente del arzobispo
el puerto de santa maria
el pueyo de araguas
el puig de santa maria
el rafol d'almunia
el rasillo de cameros
el real de gandia
el real de la jara
el real de san vicente
el recuenco
el redal
el robledo
el romeral
el ronquillo
el rosario
el rourell
el royo
el rubio
el sahugo
el saucejo
el sauzal
el soleras
el sotillo
el tanque
el tejado
el tiemblo
el toboso
el tornadizo
el torno
el toro
el valle
el valle de altomira
el vallecillo
el vellon
el vendrell
el verger
el villar de arnedo
el vilosell
el viso
el viso de san juan
el viso del alcor
elantxobe
elburgo
elche
elche de la sierra
elciego
elda
elduain
elgeta
elgoibar
elgorriaga
eliana, l'
eljas
elo
elorrio
elortzibar
elvillar
elx
embid
embid de ariza
emperador
encina de san silvestre
encina, la
encinacorba
encinas
encinas de abajo
encinas de arriba
encinas de esgueva
encinas reales
encinasola
encinasola de los comendadores
encinedo
encinillas
encio
enciso
endrinal
eneritz
eneriz
enguera
enguidanos
enix
enova, l'
entrala
entrambasaguas
entrena
entrimo
entrin bajo
epila
erandio
eratsun
ercina, la
ereno
ergoiena
erla
ermua
errenteria
errezil
erriberabeitia
erriberagoitia
erriberri
errigoiti
erro
erromantzatua
erronkari
erustes
escacena del campo
escala, l'
escalante
escalona
escalona del prado
escalonilla
escamilla
escanuela
escarabajosa de cabezas
escariche
escatron
escobar de campos
escobar de polendos
escobosa de almazan
escopete
escorca
escorial, el
escorihuela
escucha
escurial
escurial de la sierra
escuzar
esgos
esguevillas de esgueva
eskoriatza
eskuernaga
eslava
eslida
espadana
espadanedo
espadilla
esparragalejo
esparragosa de la serena
esparragosa de lares
esparreguera
espartinas
espartza zaraitzu
esparza de salazar
espeja
espeja de san marcelino
espejo
espejon
espeluy
espera
espiel
espinar, el
espinelves
espino de la orbada
espinosa de cerrato
espinosa de cervera
espinosa de henares
espinosa de los caballeros
espinosa de los monteros
espinosa de villagonzalo
espinosa del camino
espinoso del rey
espirdo
esplegares
espluga calba, l'
espluga de francoli, l'
esplugues de llobregat
esplus
espolla
esponella
esporles
espot
espronceda
espunyola, l'
esquirol, l'
esquivias
estables
estada
estadilla
estamariu
estany, l'
estaras
estella-lizarra
estellencs
estepa
estepa de san juan
estepar
estepona
estercuel
esteribar
esterri d'aneu
esterri de cardos
estivella
estollo
estopinan del castillo
estrada, a
estrella, la
estremera
estriegana
estubeny
etayo
etxalar
etxarri
etxarri aranatz
etxauri
etxebarri
etxebarria
eulate
euskadi
extremadura
ezcabarte
ezcaray
ezcaroz
ezkaroze
ezkio-itsaso
ezkurra
ezprogui
fabara
fabero
fageca
fago
falces
falset
famorca
fanlo
fanzara
far d'emporda, el
farajan
faramontanos de tabara
fariza
farlete
farrera
fasnia
fatarella, la
faura
favara
fayon
fayos, los
febro, la
felanitx
felix
fene
ferez
feria
fermoselle
fernan caballero
fernan-nunez
ferreira
ferreras de abajo
ferreras de arriba
ferreries
ferreruela
ferreruela de huerva
ferrol
figaro-montmany
figols
figols i alinya
figuera, la
figueres
figuerola del camp
figueroles
figueruela de arriba
figueruelas
finana
fines
finestrat
firgas
fiscal
fisterra
fitero
flaca
flix
flores de avila
floresta, la
florida de liebana
fogars de la selva
fogars de montclus
foios
foixa
folgoso de la ribera
folgoso do courel
folgueroles
fombellida
fombuena
fompedraza
foncea
fondarella
fondo de les neus, el
fondon
fonelas
fonfria
fonollosa
fonsagrada, a
font d'en carros, la
font de la figuera, la
font-rubi
fontanals de cerdanya
fontanar
fontanarejo
fontanars dels alforins
fontanilles
fontcoberta
fontellas
fontihoyuelo
fontioso
fontiveros
fonz
fonzaleche
foradada
foradada del toscar
forallac
forcall
forcarei
fores
forfoleda
formentera
formentera del segura
formiche alto
fornalutx
fornells de la selva
fornelos de montes
fornes
fornoles
fortaleny
fortanete
fortia
fortuna
forua
foz
foz-calanda
frades
frades de la sierra
fraga
frago, el
frailes
franco, el
frandovinez
franqueses del valles, les
frasno, el
frechilla
frechilla de almazan
fregenal de la sierra
fregeneda, la
freginals
freila
frescano
fresneda de altarejos
fresneda de cuellar
fresneda de la sierra
fresneda de la sierra tiron
fresneda, la
fresnedilla
fresnedillas de la oliva
fresnedoso
fresnedoso de ibor
fresnena
fresnillo de las duenas
fresno alhandiga
fresno de cantespino
fresno de caracena
fresno de la fuente
fresno de la polvorosa
fresno de la ribera
fresno de la vega
fresno de rio tiron
fresno de rodilla
fresno de sayago
fresno de torote
fresno del rio
fresno el viejo
fresno, el
frias
frias de albarracin
friera de valverde
frigiliana
friol
fromista
frontera
frontera, la
fruiz
frumales
fuembellida
fuencaliente
fuencaliente de la palma
fuencemillan
fuendejalon
fuendetodos
fuenferrada
fuengirola
fuenlabrada
fuenlabrada de los montes
fuenllana
fuenmayor
fuensaldana
fuensalida
fuensanta
fuensanta de martos
fuente alamo de murcia
fuente carreteros
fuente de cantos
fuente de pedro naharro
fuente de piedra
fuente de san esteban, la
fuente de santa cruz
fuente del arco
fuente del maestre
fuente el fresno
fuente el olmo de fuentiduena
fuente el olmo de iscar
fuente el sauz
fuente el saz de jarama
fuente el sol
fuente encalada
fuente la lancha
fuente la reina
fuente obejuna
fuente palmera
fuente vaqueros
fuente-alamo
fuente-olmedo
fuente-tojar
fuentealbilla
fuentearmegil
fuentebureba
fuentecambron
fuentecantos
fuentecen
fuenteguinaldo
fuenteheridos
fuentelahiguera de albatages
fuentelapena
fuentelcesped
fuentelencina
fuentelespino de haro
fuentelespino de moya
fuenteliante
fuentelisendo
fuentelmonge
fuentelsaz
fuentelsaz de soria
fuentelviejo
fuentemolinos
fuentenava de jabaga
fuentenebro
fuentenovilla
fuentepelayo
fuentepinel
fuentepinilla
fuenterrebollo
fuenterroble de salvatierra
fuenterrobles
fuentes
fuentes calientes
fuentes claras
fuentes de andalucia
fuentes de ano
fuentes de ayodar
fuentes de bejar
fuentes de carbajal
fuentes de ebro
fuentes de jiloca
fuentes de leon
fuentes de magana
fuentes de nava
fuentes de onoro
fuentes de ropel
fuentes de rubielos
fuentes de valdepero
fuentesauco
fuentesauco de fuentiduena
fuentesecas
fuentesoto
fuentespalda
fuentespina
fuentespreadas
fuentestrun
fuentiduena
fuentiduena de tajo
fuerte del rey
fuertescusa
fueva, la
fuliola, la
fulleda
funes
fustinana
gabaldon
gabias, las
gabiria
gador
gaia
gaianes
gaibiel
gaintza
gajanejos
gajates
galapagar
galapagos
galar
galaroza
galbarros
galbarruli
galdakao
galdames
galdar
galende
galera
galera, la
galicia
galilea
galindo y perahuy
galinduste
galipentzu
galisancho
galisteo
gallardos, los
gallega, la
gallegos
gallegos de altamiros
gallegos de arganan
gallegos de hornija
gallegos de sobrinos
gallegos de solmiron
gallegos del pan
gallegos del rio
gallifa
gallinero de cameros
gallipienzo
gallocanta
gallues
gallur
galoze
galve
galve de sorbe
galvez
gamiz-fika
gamones
gandesa
gandia
garaballa
garachico
garafia
garai
garaioa
garbayuela
garcia
garciaz
garcibuey
garcihernandez
garcillan
garciotum
garcirrey
garde
gares
gargallo
garganta de los montes
garganta del villar
garganta la olla
garganta, la
gargantilla
gargantilla del lozoya y pinilla de buitrago
garguera
garidells, els
garinoain
garlitos
garrafe de torio
garralda
garray
garriga, la
garrigas
garrigoles
garriguella
garrobo, el
garrovilla, la
garrovillas de alconetar
garrucha
garvin
gascones
gascuena
gascuena de bornova
gastor, el
gata
gata de gorgos
gatika
gaton de campos
gatova
gaubea
gaucin
gautegiz arteaga
gava
gavarda
gavet de la conca
gavilanes
gaztelu
gazteluberri
gea de albarracin
gejuelo del barro
geldo
gelida
gelsa
gelves
gema
gemuno
genalguacil
genave
genevilla
genoves, el
ger
gerena
gergal
geria
gerindote
gernika-lumo
gesalatz
gestalgar
getafe
getaria
getxo
gibraleon
gijon
gil garcia
gilbuena
gilena
gilet
gimenells i el pla de la font
gimialcon
gimileo
ginebrosa, la
gines
ginestar
gineta, la
gipuzkoa
girona
gironella
gisclareny
gistain
gizaburuaga
gobernador
godall
godella
godelleta
godojos
goizueta
gojar
golmayo
golmes
golosalvo
golpejas
gomara
gombren
gomecello
gomesende
gomezserracin
gondomar
gonerri
gor
gorafe
gordaliza del pino
gordexola
gordo, el
gordoncillo
gorga
gorliz
gormaz
gorza
gosol
gotarrendura
gotor
gozon
gradefes
grado
grado, el
graja de campalbo
graja de iniesta
grajal de campos
grajera
granada
granada de rio-tinto, la
granada, la
granadella, la
granadilla de abona
granado, el
granatula de calatrava
grandas de salime
grandes y san martin
granen
granera
granja d'escarp, la
granja de la costera, la
granja de moreruela
granja de rocamora
granja de torrehermosa
granja, la
granjuela, la
granollers
granon
granucillo
granyanella
granyena de les garrigues
granyena de segarra
gratallops
graus
gravalos
grazalema
griegos
grijalba
grijota
grinon
grisalena
grisel
grisen
grove, o
guadahortuna
guadalajara
guadalaviar
guadalcanal
guadalcazar
guadalix de la sierra
guadalmez
guadalupe
guadamur
guadarrama
guadassequies
guadassuar
guadiana
guadix
guadramiro
guajares, los
gualba
gualchos
gualta
guancha, la
guarda, a
guardamar de la safor
guardamar del segura
guardia de jaen, la
guardia, la
guardiola de bergueda
guardo
guarena
guaro
guarrate
guarroman
guaza de campos
gudar
gudina, a
guejar sierra
guenes
guesa
guesalaz
guevejar
guia de isora
guiamets, els
guijarrosa, la
guijo de avila
guijo de coria
guijo de galisteo
guijo de granadilla
guijo de santa barbara
guijo, el
guijuelo
guillena
guils de cerdanya
guimar
guimera
guingueta d'aneu, la
guirguillano
guisando
guissona
guitiriz
guixers
gumiel de izan
gumiel de mercado
guntin
gurb
guriezo
gurrea de gallego
gusendos de los oteros
gutierre-munoz
haba, la
hacinas
harana
haria
haro
haza
hazas de cesto
helechosa de los montes
hellin
henarejos
henche
heras de ayuso
herbers
herce
herencia
herencias, las
herguijuela
herguijuela de ciudad rodrigo
herguijuela de la sierra
herguijuela del campo
hermandad de campoo de suso
hermedes de cerrato
hermigua
hermisende
hernan-perez
hernani
hernansancho
hernialde
herradon de pinares
herramelluri
herrera
herrera de alcantara
herrera de los navarros
herrera de pisuerga
herrera de soria
herrera de valdecanas
herrera del duque
herrera, la
herreria
herrerias
herreros de suso
herreruela
herreruela de oropesa
herrin de campos
herrumblar, el
hervas
hervias
hiendelaencina
higuera de albalat
higuera de calatrava
higuera de la serena
higuera de la sierra
higuera de las duenas
higuera de llerena
higuera de vargas
higuera la real
higueras
higueruela
higueruelas
hija de dios, la
hijar
hijes
hiniesta, la
hinojal
hinojales
hinojares
hinojos
hinojosa de duero
hinojosa de jarque
hinojosa de san vicente
hinojosa del campo
hinojosa del duque
hinojosa del valle
hinojosa, la
hinojosas de calatrava
hinojosos, los
hiriberri
hiruela, la
hita
hito, el
holguera
hombrados
hondarribia
hondon de las nieves
hondon de los frailes
honrubia
honrubia de la cuesta
hontalbilla
hontanar
hontanares de eresma
hontanas
hontanaya
hontangas
hontecillas
hontoba
hontoria de cerrato
hontoria de la cantera
hontoria de valdearados
hontoria del pinar
horcajada, la
horcajo de la sierra-aoslos
horcajo de las torres
horcajo de los montes
horcajo de montemayor
horcajo de santiago
horcajo medianero
horcajuelo de la sierra
horche
hormazas, las
hormigos
hormilla
hormilleja
hornachos
hornachuelos
hornillo, el
hornillos de cameros
hornillos de cerrato
hornillos de eresma
hornillos del camino
hornos
hornos de moncalvillo
horra, la
horta de sant joan
hortezuela de ocen
hortiguela
hospital de orbigo
hospitalet de llobregat, l'
hostalets de pierola, els
hostalric
hoya, la
hoya-gonzalo
hoyales de roa
hoyo de manzanares
hoyo de pinares, el
hoyocasero
hoyorredondo
hoyos
hoyos de miguel munoz
hoyos del collado
hoyos del espino
hoz de jaca
hoz de la vieja, la
hoz y costean
huarte
huecas
huecija
huelaga
huelago
huelamo
huelma
huelva
huelves
hueneja
huercal de almeria
huercal-overa
huercanos
huerce, la
huerguina
huermeces
huermeces del cerro
huerta
huerta de arriba
huerta de la obispalia
huerta de rey
huerta de valdecarabanos
huerta del marquesado
huertahernando
huerto
huertos, los
huesa
huesa del comun
huesca
huescar
huete
huetor de santillan
huetor tajar
huetor vega
hueva
huevar del aljarafe
humada
humanes
humanes de madrid
humilladero
hurones
hurtumpascual
husillos
ibahernando
ibargoiti
ibarra
ibarrangelu
ibdes
ibeas de juarros
ibi
ibias
ibieca
ibrillos
ibros
icod de los vinos
idiazabal
iekora
igantzi
igea
iglesiarrubia
iglesias
iglesuela del cid, la
iglesuela del tietar, la
igorre
igries
igualada
igualeja
iguena
iguzquiza
ikaztegieta
ilche
illa de arousa, a
illan de vacas
illana
illano
illar
illas
illes balears
illescas
illora
illueca
imotz
inca
incio, o
ingenio
iniesta
iniestola
instincion
inviernas, las
iraneta
irixo, o
irixoa
iruela, la
iruelos
irueste
irun
iruna
iruna de oca
iruna oka
irura
iruraiz-gauna
irurtzun
isaba
isabena
isar
iscar
isla cristina
isla mayor
islas baleares
isona i conca della
isovol
ispaster
istan
isuerre
itero de la vega
itero del castillo
itrabo
itsasondo
ituero de azaba
ituero y lama
ituren
iturmendi
itza
itzaltzu
iurreta
ivars d'urgell
ivars de noguera
ivorra
iza
izaba
izagaondoa
izagre
izalzu
iznajar
iznalloz
iznate
iznatoraf
izurtza
jabaloyas
jabalquinto
jabugo
jaca
jacarilla
jadraque
jaen
jafre
jaitz
jalance
jalon de cameros
jambrina
jamilena
jana, la
jaraba
jarafuel
jaraicejo
jaraiz de la vera
jaramillo de la fuente
jaramillo quemado
jarandilla de la vera
jarilla
jarque de la val
jarque de moncayo
jasa
jatar
jatiel
jaulin
jaurrieta
javea
javier
jayena
jerez de la frontera
jerez de los caballeros
jerez del marquesado
jerica
jerte
jete
jijona
jimena
jimena de la frontera
jimera de libar
jirueque
joarilla de las matas
jodar
jonquera, la
jorba
jorcas
jorquera
josa
josa i tuixen
joyosa, la
juarros de riomoros
juarros de voltoya
jubrique
juia
jumilla
jun
junciana
juncosa
juneda
junta de traslaloma
junta de villalba de losa
jurisdiccion de lara
jurisdiccion de san zadornil
juslapena
justel
juviles
juzbado
juzcar
kanpezu
karrantza harana
kortezubi
kripan
kuartango
la acebeda
la adrada
la alameda de gardon
la alamedilla
la alberca
la alberca de zancara
la albergueria de arganan
la albuera
la aldea de san nicolas
la aldea del obispo
la aldehuela
la algaba
la almarcha
la almolda
la almunia de dona godina
la antigua
la atalaya
la baneza
la baronia de rialb
la bastida
la bisbal d'emporda
la bisbal de montsant
la bisbal del penedes
la bodera
la bouza
la boveda de toro
la cabeza de bejar
la cabrera
la calahorra
la calzada de bejar
la campana
la canada de verich
la canonja
la carlota
la carolina
la carrera
la cellera de ter
la cerollera
la cierva
la codonera
la codosera
la colilla
la coma i la pedra
la coronada
la cuba
la cueva de roa
la cumbre
la encina
la ercina
la estrella
la fatarella
la febro
la figuera
la floresta
la font d'en carros
la font de la figuera
la fregeneda
la fresneda
la frontera
la fuente de san esteban
la fueva
la fuliola
la galera
la gallega
la garganta
la garriga
la garrovilla
la ginebrosa
la gineta
la granada
la granada de rio-tinto
la granadella
la granja
la granja d'escarp
la granja de la costera
la granjuela
la guancha
la guardia
la guardia de jaen
la guijarrosa
la guingueta d'aneu
la haba
la herrera
la hija de dios
la hiniesta
la hinojosa
la hiruela
la horcajada
la horra
la hoya
la hoz de la vieja
la huerce
la iglesuela del cid
la iglesuela del tietar
la iruela
la jana
la jonquera
la joyosa
la lapa
la lastrilla
la linea de la concepcion
la llacuna
la llagosta
la llosa
la llosa de ranes
la losa
la losilla
la luisiana
la malaha
la maso
la mata
la mata de ledesma
la mata de los olmos
la mata de morella
la matanza de acentejo
la matilla
la maya
la mierla
la minosa
la mojonera
la molsosa
la morera
la morera de montsant
la mudarra
la muela
la nava
la nava de ricomalillo
la nava de santiago
la nou de bergueda
la nou de gaia
la nucia
la oliva
la olmeda de jadraque
la orbada
la orotava
la palma d'ebre
la palma de cervello
la palma del condado
la parra
la parra de las vegas
la parrilla
la pedraja de portillo
la pena
la pera
la peraleja
la pernia
la pesga
la pesquera
la peza
la pobla de benifassa
la pobla de cervoles
la pobla de claramunt
la pobla de farnals
la pobla de lillet
la pobla de mafumet
la pobla de massaluca
la pobla de montornes
la pobla de segur
la pobla de vallbona
la pobla del duc
la pobla llarga
la pobla tornesa
la pola de gordon
la portella
la portellada
la poveda de soria
la puebla de alfinden
la puebla de almoradiel
la puebla de arganzon
la puebla de castro
la puebla de cazalla
la puebla de hijar
la puebla de los infantes
la puebla de montalban
la puebla de valdavia
la puebla de valverde
la puebla del rio
la pueblanueva
la puerta de segura
la quar
la rambla
la rapita
la recueja
la redonda
la revilla y ahedo
la riba
la riba de escalote
la riera de gaia
la rinconada
la rinconada de la sierra
la rioja
la robla
la roca de la sierra
la roca del valles
la roda
la roda de andalucia
la romana
la sagrada
la salzadella
la seca
la secuita
la selva de mar
la selva del camp
la senia
la sentiu de sio
la sequera de haza
la serna
la serna del monte
la serrada
la serratella
la seu d'urgell
la sierpe
la solana
la sotonera
la taha
la tala
la tallada d'emporda
la toba
la torre
la torre d'en besora
la torre d'en domenec
la torre de cabdella
la torre de claramunt
la torre de esteban hambran
la torre de fontaubella
la torre de l'espanyol
la torre de les macanes
la torre del valle
la union
la union de campos
la vajol
la vall d'alcala
la vall d'ebo
la vall d'en bas
la vall d'uixo
la vall de bianya
la vall de boi
la vall de gallinera
la vall de laguar
la vansa i fornols
la vecilla
la velles
la victoria
la victoria de acentejo
la vid de bureba
la vid de ojeda
la vid y barrios
la vidola
la vila joiosa
la vilavella
la vilella alta
la vilella baixa
la villa de don fadrique
la viluena
la yesa
la yunta
la zaida
la zarza
la zarza de pumareda
la zarza-perrunal
la zoma
la zubia
labajos
labastida
labores, las
labuerda
lachar
ladrillar
lagartera
lagartos
lagata
lagran
laguardia
lagueruela
laguna dalga
laguna de cameros
laguna de contreras
laguna de duero
laguna de negrillos
laguna del marquesado
lagunaseca
lagunilla
lagunilla del jubera
lahiguera
lakuntza
lalin
laluenga
lalueza
lama, a
lamason
lana
lanaja
lancara
lanciego
landete
lanestosa
langa
langa de duero
langa del castillo
langayo
langreo
languilla
lanjaron
lantadilla
lantaron
lanteira
lantejuela
lantz
lantziego
lanzahita
lanzuela
lapa, la
laperdiguera
lapoblacion
lapuebla de labarca
laracha, a
lardero
laredo
larouco
laroya
larrabetzu
larraga
larraona
larraul
larraun
larrodrigo
larva
lasarte-oria
lascellas-ponzano
lascuarre
laspaules
laspuna
lastras de cuellar
lastras del pozo
lastrilla, la
laudio
laujar de andarax
laukiz
laviana
laxe
layana
layos
laza
lazagurria
lazkao
leaburu
leache
leatxe
lebrija
lecera
lechon
lecinena
lecrin
ledana
ledanca
ledesma
ledesma de la cogolla
ledigos
ledrada
leganes
leganiel
legarda
legaria
legazpi
legorreta
legutio
leintz-gatzaga
leioa
leiro
leitza
leiva
lekeitio
lekunberri
lemoa
lemoiz
lena
lentegi
leon
leotz
leoz
lepe
lerga
lerin
lerma
les
les alqueries
les avellanes i santa linya
les borges blanques
les borges del camp
les cabanyes
les coves de vinroma
les franqueses del valles
les llosses
les masies de roda
les masies de voltrega
les oluges
les piles
les planes d'hostoles
les preses
les useres
les valls d'aguilar
les valls de valira
lesaka
letur
letux
leza
leza de rio leza
lezama
lezaun
lezo
lezuza
librilla
libros
liceras
lidon
liedena
liendo
lierganes
lietor
lijar
lillo
limpias
linares
linares de la sierra
linares de mora
linares de riofrio
linea de la concepcion, la
linyola
litago
lituenigo
lizartza
lizoain-arriasgoiti
lizoainibar-arriasgoiti
llacuna, la
llado
lladorre
lladurs
llagosta, la
llagostera
llamas de la ribera
llambilles
llanars
llanca
llanera
llanera de ranes
llanes
llano de bureba
llano de olmedo
llanos de aridane, los
llanos de tormes, los
llanos del caudillo
llardecans
llauri
llavorsi
lledo
lleida
llera
llerena
llers
lles de cerdanya
lliber
llica d'amunt
llica de vall
llimiana
llinars del valles
lliria
llivia
lloar, el
llobera
llocnou d'en fenollet
llocnou de la corona
llocnou de sant jeroni
llodio
llombai
llorac
llorenc del penedes
lloret de mar
lloret de vistalegre
llosa de ranes, la
llosa, la
lloseta
llosses, les
llubi
lluca
llucena
llucmajor
llutxent
loarre
lobeira
lobera de onsella
lobios
lobon
lobras
lodosa
loeches
logrono
logrosan
loiu
loja
loma de ucieza
lomas
lominchar
lomoviejo
longares
longas
longida
longuida
lopera
loporzano
lora de estepa
lora del rio
loranca de tajuna
lorca
lorcha
loriguilla
lorqui
los alcazares
los altos
los arcos
los ausines
los balbases
los barrios
los barrios de bureba
los barrios de luna
los blazquez
los cerralbos
los corrales
los corrales de buelna
los cortijos
los fayos
los gallardos
los guajares
los hinojosos
los huertos
los llanos de aridane
los llanos de tormes
los marines
los molares
los molinos
los montesinos
los navalmorales
los navalucillos
los olmos
los palacios y villafranca
los pintanos
los pozuelos de calatrava
los rabanos
los realejos
los santos
los santos de la humosa
los santos de maimona
los silos
los tojos
los valdecolmenas
los villares
los villares de soria
los yebenes
losa del obispo
losa, la
losacino
losacio
losar de la vera
losar del barco, el
loscorrales
loscos
losilla, la
lourenza
lousame
lozoya
lozoyuela-navas-sieteiglesias
lubian
lubrin
lucainena de las torres
lucar
lucena
lucena de jalon
lucena del cid
lucena del puerto
luceni
luciana
lucillo
lucillos
ludiente
luelmo
luena
luesia
luesma
lugo
lugros
luisiana, la
lujar
lumbier
lumbrales
lumbreras de cameros
lumpiaque
luna
lupiana
lupinen-ortilla
lupion
luque
luquin
luyego
luzaga
luzaide
luzon
macael
macanet de cabrenys
macanet de la selva
macastre
maceda
machacon
macharaviaya
macotera
madarcos
maderal, el
maderuelo
madremanya
madrid
madridanos
madridejos
madrigal de la vera
madrigal de las altas torres
madrigal del monte
madrigalejo
madrigalejo del monte
madrigueras
madronal
madronera
madrono, el
maella
maello
magacela
magallon
magan
magana
magaz de cepeda
magaz de pisuerga
maguilla
mahamud
mahide
mahora
maia de montcal
maials
maicas
maillo, el
mainar
maire de castroponce
mairena del alcor
mairena del aljarafe
majadahonda
majadas
majadas, las
majaelrayo
majan
malaga
malaga del fresno
malagon
malaguilla
malaha, la
malanquilla
malcocinado
malda
malejan
malgrat de mar
malla
mallabia
mallen
malon
malpartida
malpartida de caceres
malpartida de corneja
malpartida de la serena
malpartida de plasencia
malpica de bergantinos
malpica de tajo
maluenda
malva
mamblas
mambrilla de castrejon
mambrillas de lara
mamolar
manacor
manaria
mancera de abajo
mancera de arriba
mancha real
manchita
manchones
manciles
mancor de la vall
mandayona
maneru
manganeses de la lampreana
manganeses de la polvorosa
manilva
manises
manjabalago y ortigosa de rioalmar
manjarres
manlleu
manon
manquillos
manresa
mansilla de la sierra
mansilla de las mulas
mansilla mayor
mantiel
mantinos
manuel
manueta
manzanal de arriba
manzanal de los infantes
manzanal del barco
manzanares
manzanares de rioja
manzanares el real
manzaneda
manzaneque
manzanera
manzanilla
manzanillo
manzano, el
mao
maqueda
mara
maracena
marana
maranchon
maranon
marazoleja
marazuela
marbella
marca
marchagaz
marchal
marchamalo
marchena
marcilla
marcilla de campos
margalef
marganell
maria
maria de huerva
maria de la salut
mariana
marin
marina de cudeyo
marinaleda
marines
marines, los
marjaliza
markina-xemein
marlin
marmolejo
marracos
marratxi
marrupe
martiago
martiherrero
martin de la jara
martin de yeltes
martin del rio
martin miguel
martin munoz de la dehesa
martin munoz de las posadas
martinamor
martinez
martorell
martorelles
martos
marugan
maruri-jatabe
marzales
mas de barberans
mas de las matas
masarac i vilarnadal
mascaraque
masdenverge
masegosa
masegoso
masegoso de tajuna
maside
masies de roda, les
masies de voltrega, les
masllorenc
masnou, el
maso, la
maspujols
masquefa
masroig, el
massalaves
massalcoreig
massalfassar
massamagrell
massanassa
massanes
massoteres
masueco
mata de alcantara
mata de cuellar
mata de ledesma, la
mata de los olmos, la
mata de morella, la
mata, la
matabuena
matadeon de los oteros
matadepera
matalebreras
matallana de torio
matamala de almazan
matanza
matanza de acentejo, la
matapozuelos
mataro
matarrubia
matet
matilla de arzon
matilla de los canos
matilla de los canos del rio
matilla la seca
matilla, la
matillas
matute
maya, la
mayalde
mayorga
mazaleon
mazarambroz
mazarete
mazaricos
mazariegos
mazarron
mazcuerras
mazuecos
mazuecos de valdeginate
mazuela
meano
mecerreyes
meco
medellin
mediana de aragon
mediana de voltoya
medina de las torres
medina de pomar
medina de rioseco
medina del campo
medina sidonia
medinaceli
medinilla
medio cudeyo
mediona
medranda
medrano
megeces
megina
meira
meis
mejorada
mejorada del campo
melgar de abajo
melgar de arriba
melgar de fernamental
melgar de tera
melgar de yuso
meliana
melida
melide
melilla
melon
melque de cercos
membibre de la hoz
membribe de la sierra
membrilla
membrillera
membrio
menaka
menarguens
menasalbas
mendaro
mendata
mendavia
mendaza
mendexa
mendigorria
meneses de campos
mengabril
mengamunoz
mengibar
mentrida
mequinenza
meranges
merca, a
mercadal, es
merida
merindad de cuesta-urria
merindad de montija
merindad de rio ubierna
merindad de sotoscueva
merindad de valdeporres
merindad de valdivielso
meruelo
mesas de ibor
mesas, las
mesegar de corneja
mesegar de tajo
mesia
mesones de isuela
mestanza
metauten
mezalocha
mezquita de jarque
mezquita, a
miajadas
mianos
micereces de tera
micieces de ojeda
miedes de aragon
miedes de atienza
miengo
miera
mieres
mierla, la
mieza
migjorn gran, es
miguel esteban
miguelanez
miguelturra
mijares
mijas
mila, el
milagro
milagros
milano, el
millana
millanes
millares
millena
milles de la polvorosa
milmarcos
minas de riotinto
minaya
minglanilla
mingorria
mino
mino de medinaceli
mino de san esteban
minosa, la
mira
mirabel
mirabueno
miraflores de la sierra
mirafuentes
miralcamp
miralrio
miramar
mirambel
miranda de arga
miranda de azan
miranda de ebro
miranda del castanar
mirandilla
miraveche
miravet
miravete de la sierra
miron, el
mironcillo
miruena de los infanzones
mislata
moana
mocejon
mochales
moclin
moclinejo
modubar de la emparedada
moeche
mogan
mogarraz
mogente
moguer
mohedas de granadilla
mohedas de la jara
mohernando
moia
moixent
mojacar
mojados
mojonera, la
molacillos
molar, el
molares, los
molezuelas de la carballeda
molina de aragon
molina de segura
molinaseca
molinicos
molinillo
molinos
molinos de duero
molinos, los
molins de rei
molledo
mollerussa
mollet de peralada
mollet del valles
mollina
mollo
molsosa, la
molvizar
mombeltran
momblona
mombuey
monachil
monasterio
monasterio de la sierra
monasterio de rodilla
monasterio de vega
moncada
moncalvillo
moncofa
monda
mondariz
mondariz-balneario
mondejar
mondonedo
mondragon
monegrillo
monesma y cajigar
monesterio
moneva
monfarracinos
monfero
monflorite-lascasas
monforte de la sierra
monforte de lemos
monforte de moyuela
monforte del cid
monistrol de calders
monistrol de montserrat
monleon
monleras
monovar
monover
monreal
monreal de ariza
monreal del campo
monreal del llano
monroy
monroyo
monsagro
monsalupe
mont-ral
mont-ras
mont-roig del camp
montagut i oix
montalban
montalban de cordoba
montalbanejo
montalbo
montalvos
montamarta
montan
montanchez
montanejos
montanuy
montarron
montaverner
montblanc
montbrio del camp
montcada
montcada i reixac
montclar
monteagudo
monteagudo de las salinas
monteagudo de las vicarias
monteagudo del castillo
montealegre de campos
montealegre del castillo
montearagon
montecorto
montederramo
montefrio
montehermoso
montejaque
montejicar
montejo
montejo de arevalo
montejo de la sierra
montejo de la vega de la serrezuela
montejo de tiermes
montella i martinet
montellano
montemayor
montemayor de pililla
montemayor del rio
montemolin
montenegro de cameros
monterde
monterde de albarracin
monterrei
monterroso
monterrubio
monterrubio de armuna
monterrubio de la demanda
monterrubio de la serena
monterrubio de la sierra
montesa
montesclaros
montesinos, los
montesquiu
montferrer i castellbo
montferri
montgai
montgat
montichelvo
montiel
montijo
montilla
montillana
montitxelvo
montizon
montmajor
montmaneu
montmell, el
montmelo
montoliu de lleida
montoliu de segarra
monton
montorio
montornes de segarra
montornes del valles
montoro
montroi
montroy
montseny
montserrat
montuiri
monturque
monzon
monzon de campos
mora
mora d'ebre
mora de rubielos
mora la nova
moradillo de roa
moral de calatrava
moral de hornuez
moral de la reina
moral de sayago
moraleda de zafayona
moraleja
moraleja de enmedio
moraleja de las panaderas
moraleja de matacabras
moraleja de sayago
moraleja del vino
morales de campos
morales de rey
morales de toro
morales de valverde
morales del vino
moralina
moralzarzal
morana
morasverdes
morata de jalon
morata de jiloca
morata de tajuna
moratalla
moratilla de los meleros
moratinos
morcillo
morcin
moreda araba
moreda de alava
morelabor
morell, el
morella
morenilla
morentin
morera de montsant, la
morera, la
moreruela de los infanzones
moreruela de tabara
mores
morga
moriles
morille
morinigo
moriscos
moron de almazan
moron de la frontera
moronta
moros
mos
moscardon
mosqueruela
mostoles
mota de altarejos
mota del cuervo
mota del marques
motilla del palancar
motilleja
motril
moya
moyuela
mozarbez
mozoncillo
mozota
mucientes
muda
mudarra, la
muduex
muel
muela, la
muelas de los caballeros
muelas del pan
mues
muga de sayago
mugardos
muinos
mula
munana
mundaka
munebrega
munera
mungia
munico
muniesa
munilla
munitibar-arbatzegi gerrikaitz
munogalindo
munogrande
munomer del peco
munopedro
munopepe
munosancho
munotello
munoveros
muntanyola
mura
muras
murchante
murcia
murero
murias de paredes
muriel
muriel de la fuente
muriel viejo
murieta
murillo de gallego
murillo de rio leza
murillo el cuende
murillo el fruto
murla
muro
muro de aguas
muro de alcoy
muro en cameros
muros
muros de nalon
murtas
murueta
muruzabal
museros
muskiz
mutiloa
mutriku
mutxamel
muxia
muxika
nabarniz
nabaskoze
nacimiento
nafria de ucero
najera
nalda
nalec
nambroca
naquera
narboneta
naron
narrillos del alamo
narrillos del rebollar
narros
narros de matalayegua
narros de salduena
narros del castillo
narros del puerto
naut aran
nava
nava de arevalo
nava de bejar
nava de francia
nava de la asuncion
nava de ricomalillo, la
nava de roa
nava de santiago, la
nava de sotrobal
nava del barco
nava del rey
nava, la
navacarros
navacepedilla de corneja
navacerrada
navaconcejo
navadijos
navaescurial
navafria
navahermosa
navahondilla
navajas
navajun
naval
navalacruz
navalafuente
navalagamella
navalcan
navalcarnero
navaleno
navales
navalilla
navalmanzano
navalmoral
navalmoral de bejar
navalmoral de la mata
navalmoralejo
navalmorales, los
navalonguilla
navalosa
navalperal de pinares
navalperal de tormes
navalpino
navalucillos, los
navaluenga
navalvillar de ibor
navalvillar de pela
navamorales
navamorcuende
navaquesera
navarcles
navardun
navares de ayuso
navares de enmedio
navares de las cuevas
navaridas
navarra
navarredonda de gredos
navarredonda de la rinconada
navarredonda y san mames
navarredondilla
navarres
navarrete
navarrevisca
navas
navas de bureba
navas de estena
navas de jadraque, las
navas de jorquera
navas de la concepcion, las
navas de oro
navas de riofrio
navas de san antonio
navas de san juan
navas del madrono
navas del marques, las
navas del rey
navascues
navasfrias
navata
navatalgordo
navatejares
naves
navezuelas
navia
navia de suarna
navianos de valverde
nazar
nebreda
neda
negredo
negreira
negrilla de palencia
negueira de muniz
neila
neila de san miguel
nepas
nerja
nerpio
nerva
nestares
nevada
neves, as
niebla
nieva
nieva de cameros
nigran
niguelas
niguella
niharra
nijar
nivar
noalejo
noblejas
noceda del bierzo
noez
nogais, as
nogal de las huertas
nogales
nogueira de ramuin
noguera de albarracin
nogueras
nogueruelas
noia
noja
nolay
nombela
nombrevilla
nonaspe
norena
nou de bergueda, la
nou de gaia, la
novales
novallas
novelda
noves
novetle
noviercas
novillas
nucia, la
nueno
nueva carteya
nueva villa de las torres
nuevalos
nuevo baztan
nuez de ebro
nules
nulles
numancia de la sagra
nuno gomez
nunomoral
o barco de valdeorras
o bolo
o carballino
o corgo
o grove
o incio
o irixo
o paramo
o pereiro de aguiar
o pino
o porrino
o rosal
o savinao
o valadouro
o vicedo
obanos
obejo
obon
ocana
ocentejo
ochagavia
ochanduri
oco
ocon
oden
odena
odieta
odon
oencia
ogassa
ogijares
ohanes
oia
oiartzun
oibar
oimbra
oiz
ojacastro
ojen
ojos
ojos negros
ojos-albos
okondo
olaberria
olaibar
olazagutia
olazti
olba
olea de boedo
oleiros
olejua
olerdola
olesa de bonesvalls
olesa de montserrat
oliana
olias del rey
oliete
oliola
olite
olius
oliva
oliva de la frontera
oliva de merida
oliva de plasencia
oliva, la
olivar, el
olivares
olivares de duero
olivares de jucar
olivella
olivenza
ollaran
ollauri
olleria, l'
olmeda de cobeta
olmeda de jadraque, la
olmeda de la cuesta
olmeda de las fuentes
olmeda del rey
olmedilla de alarcon
olmedilla de eliz
olmedillo de roa
olmedo
olmedo de camaces
olmillos de castro
olmillos de muno
olmos de esgueva
olmos de ojeda
olmos de penafiel
olmos, los
olocau
olocau del rey
olombrada
oloritz
oloriz
olost
olot
oltza zendea
oluges, les
olula de castro
olula del rio
olvan
olvega
olvena
olvera
olves
omanas, las
omellons, els
omells de na gaia, els
ona
onati
oncala
onda
ondara
ondarroa
onil
onis
ontigola
ontinena
ontinyent
ontur
onzonilla
oquillas
orba
orbada, la
orbaizeta
orbaneja riopico
orbara
orbita
orcajo
orce
orcera
ordes
ordial, el
ordis
ordizia
orduna
orea
orejana
orellana de la sierra
orellana la vieja
orendain
orera
ores
orexa
organya
orgaz
orgiva
oria
orihuela
orihuela del tremedal
orio
oris
orisoain
orista
orkoien
ormaiztegi
orontze
oronz
oropesa
oropesa del mar
oroso
orotava, la
orotz-betelu
oroz-betelu
orozko
orpesa
orpi
orreaga
orrios
orrius
ortigosa de cameros
ortigosa de pestano
ortigosa del monte
ortigueira
ortuella
orusco de tajuna
orxa, l'
orxeta
os blancos
os de balaguer
osa de la vega
oseja
oseja de sajambre
osera de ebro
oso, el
osor
osornillo
osorno la mayor
ossa de montiel
osso de cinca
osso de sio
osuna
oteiza
otero
otero de bodas
otero de herreros
otivar
otos
otsagabia
otxandio
ourense
ourol
outeiro de rei
outes
oviedo
oyon-oion
oza-cesuras
pacs del penedes
paderne
paderne de allariz
padiernos
padilla de abajo
padilla de arriba
padrenda
padron
padrones de bureba
padul
padules
paiporta
pais vasco
pajara
pajarejos
pajares de adaja
pajares de la laguna
pajares de la lampreana
pajares de los oteros
pajaron
pajaroncillo
palacios de goda
palacios de la sierra
palacios de la valduerna
palacios de riopisuerga
palacios de sanabria
palacios del arzobispo
palacios del pan
palacios del sil
palacios y villafranca, los
palaciosrubios
palafolls
palafrugell
palamos
palanques
palas de rei
palau d'anglesola, el
palau de santa eulalia
palau-sator
palau-saverdera
palau-solita i plegamans
palazuelo de vedija
palazuelos de eresma
palazuelos de la sierra
palazuelos de muno
palencia
palencia de negrilla
palenciana
palenzuela
pallaresos, els
palleja
palma
palma d'ebre, la
palma de cervello, la
palma de gandia
palma del condado, la
palma del rio
palmaces de jadraque
palmar de troya, el
palmas de gran canaria, las
palmas, las
palmera
palo
palol de revardit
palomar de arroyos
palomar, el
palomares del campo
palomares del rio
palomas
palomeque
palomera
palomero
palos de la frontera
pals
pampaneira
pampliega
pamplona
pancorbo
pancrudo
paniza
panticosa
pantoja
panton
papatrigo
papiol, el
paracuellos
paracuellos de jarama
paracuellos de jiloca
paracuellos de la ribera
parada de arriba
parada de rubiales
parada de sil
paradas
paradela
paradinas de san juan
paramo de boedo
paramo del sil
paramo, o
parauta
parcent
pardilla
pardines
pardos
paredes
paredes de escalona
paredes de nava
paredes de siguenza
pareja
parets del valles
parla
parlava
parra de las vegas, la
parra, la
parral, el
parras de castellote, las
parres
parrilla, la
parrillas
partaloa
partido de la sierra en tobalina
pasaia
pasaron de la vera
pascualcobo
paso, el
passanant i belltall
pastores
pastoriza, a
pastrana
pastriz
paterna
paterna de rivera
paterna del campo
paterna del madera
paterna del rio
patones
pau
pauls
pavias
paymogo
payo de ojeda
payo, el
pazos de borben
pazuengos
peal de becerro
pechina
pedernoso, el
pedrafita do cebreiro
pedraja de portillo, la
pedrajas de san esteban
pedralba
pedralba de la praderia
pedraza
pedraza de alba
pedraza de campos
pedregal, el
pedreguer
pedrera
pedret i marza
pedrezuela
pedro abad
pedro bernardo
pedro martinez
pedro munoz
pedro-rodriguez
pedroche
pedrola
pedroneras, las
pedrosa de duero
pedrosa de la vega
pedrosa de rio urbel
pedrosa del paramo
pedrosa del principe
pedrosa del rey
pedrosas, las
pedrosillo de alba
pedrosillo de los aires
pedrosillo el ralo
pedroso
pedroso de acim
pedroso de la armuna, el
pedroso, el
pegalajar
pego
pego, el
peguerinos
pelabravo
pelahustan
pelarrodriguez
pelayos
pelayos de la presa
pelayos del arroyo
peleagonzalo
peleas de abajo
peligros
pena, la
penacaballera
penacerrada-urizaharra
penafiel
penaflor
penaflor de hornija
penagos
penaguila
penalba
penalba de avila
penalen
penalsordo
penalver
penamellera alta
penamellera baja
penaparda
penaranda de bracamonte
penaranda de duero
penarandilla
penarroya de tastavins
penarroya-pueblonuevo
penarrubia
penas de riglos, las
penas de san pedro
penascosa
penausende
penelles
peniscola
pepino
peque
pera, la
peracense
perafita
perafort
peral de arlanza
peral, el
peralada
peraleda de la mata
peraleda de san roman
peraleda del zaucejo
peraleja, la
peralejos
peralejos de abajo
peralejos de arriba
peralejos de las truchas
perales
perales de tajuna
perales del alfambra
perales del puerto
peralta
peralta de alcofea
peralta de calasanz
peraltilla
peralveche
peramola
peranzanes
perarrua
perdigon, el
perdiguera
pereiro de aguiar, o
perello, el
perena de la ribera
pereruela
periana
perilla de castro
pernia, la
peromingo
perosillo
peroxa, a
pertusa
pesaguero
pescueza
pesga, la
pesoz
pesquera
pesquera de duero
pesquera, la
petilla de aragon
petin
petra
petrer
petres
petrola
peza, la
pezuela de las torres
pias
picanya
picassent
picazo, el
picon
piedrabuena
piedrahita
piedrahita de castro
piedralaves
piedramillera
piedras albas
piedratajada
pielagos
piera
piernigas
pilar de la horadada
pilas
piles
piles, les
pilona
pina de campos
pina de ebro
pina de esgueva
pina de montalgrao
pinar
pinar de el hierro, el
pinar, el
pinarejo
pinarejos
pinarnegrillo
pineda de giguela
pineda de la sierra
pineda de mar
pineda trasmonte
pinedas
pinel de abajo
pinel de arriba
pinell de brai, el
pinell de solsones
pinero, el
pinet
pinilla de jadraque
pinilla de los barruecos
pinilla de los moros
pinilla de molina
pinilla de toro
pinilla del campo
pinilla del valle
pinilla trasmonte
pinillos
pino de tormes, el
pino del oro
pino del rio
pino, o
pinofranqueado
pinor
pinos
pinos genil
pinos puente
pinos, el
pinoso
pinseque
pintanos, los
pinto
pinuecar-gandullas
piornal
pioz
piqueras
piqueras del castillo
pira
piraces
pitarque
pitiegua
pitillas
pizarra
pizarral
pla de santa maria, el
pla del penedes, el
plan
planes
planes d'hostoles, les
planoles
plans de sio, els
plasencia
plasencia de jalon
plasenzuela
pleitas
plenas
plentzia
pliego
plou
poal, el
pobla de benifassa, la
pobla de cervoles, la
pobla de claramunt, la
pobla de farnals, la
pobla de lillet, la
pobla de mafumet, la
pobla de massaluca, la
pobla de montornes, la
pobla de segur, la
pobla de vallbona, la
pobla del duc, la
pobla llarga, la
pobla tornesa, la
pobla, sa
poblacion de arroyo
poblacion de campos
poblacion de cerrato
pobladura de pelayo garcia
pobladura de valderaduey
pobladura del valle
poble nou de benitatxell, el
poblete
poblets, els
pobo de duenas, el
pobo, el
poboleda
pobra de trives, a
pobra do brollon, a
pobra do caraminal, a
poio
pol
pola de gordon, la
polaciones
polan
polanco
polenino
polentinos
policar
polinya
polinya de xuquer
pollenca
pollos
polop
polopos
pomar de valdivia
pomer
ponferrada
ponga
pont d'armentera, el
pont de bar, el
pont de molins
pont de suert, el
pont de vilomara i rocafort, el
ponte caldelas
ponteareas
ponteceso
pontecesures
pontedeume
pontedeva
pontenova, a
pontes de garcia rodriguez, as
pontevedra
pontils
pontons
pontos
ponts
porcuna
porqueira
porqueres
porrera
porreres
porrino, o
port de la selva, el
portaje
portalrubio de guadamejud
portas
portbou
portell de morella
portella, la
portellada, la
portezuelo
portilla
portillo
portillo de soria
portillo de toledo
porto
porto do son
portomarin
portugalete
portugos
porzuna
posada de valdeon
posadas
potes
potries
poveda
poveda de la sierra
poveda de las cintas
poveda de soria, la
povedilla
poyales del hoyo
poyatos
poza de la sal
poza de la vega
pozal de gallinas
pozaldez
pozalmuro
pozan de vero
pozanco
pozo alcon
pozo canada
pozo de almoguera
pozo de guadalajara
pozo de urama
pozo-lorente
pozoamargo
pozoantiguo
pozoblanco
pozohondo
pozondon
pozorrubielos de la mancha
pozorrubio de santiago
pozos de hinojo
pozuel de ariza
pozuel del campo
pozuelo
pozuelo de alarcon
pozuelo de aragon
pozuelo de calatrava
pozuelo de la orden
pozuelo de tabara
pozuelo de zarzon
pozuelo del paramo
pozuelo del rey
pozuelo, el
pozuelos de calatrava, los
pradanos de bureba
pradanos de ojeda
pradejon
pradell de la teixeta
pradena
pradena de atienza
pradena del rincon
prades
pradilla de ebro
pradillo
prado
prado de la guzpena
prado del rey
pradoluengo
prados redondos
pradosegar
prat de comte
prat de llobregat, el
pratdip
prats de llucanes
prats de rei, els
prats i sansor
pravia
preixana
preixens
prejano
premia de dalt
premia de mar
presencio
preses, les
priaranza del bierzo
priego
priego de cordoba
principado de asturias
prioro
proaza
provencio, el
prullans
pruna
pucol
puebla de alborton
puebla de alcocer
puebla de alfinden, la
puebla de almenara
puebla de almoradiel, la
puebla de arenoso
puebla de arganzon, la
puebla de azaba
puebla de belena
puebla de castro, la
puebla de cazalla, la
puebla de don fadrique
puebla de don rodrigo
puebla de guzman
puebla de hijar, la
puebla de la calzada
puebla de la reina
puebla de la sierra
puebla de lillo
puebla de los infantes, la
puebla de montalban, la
puebla de obando
puebla de pedraza
puebla de san medel
puebla de san miguel
puebla de sanabria
puebla de sancho perez
puebla de valdavia, la
puebla de valles
puebla de valverde, la
puebla de yeltes
puebla del maestre
puebla del principe
puebla del prior
puebla del rio, la
puebla del salvador
pueblanueva, la
pueblica de valverde
pueblonuevo de miramontes
pueblonuevo del guadiana
puendeluna
puente de domingo florez
puente de genave
puente de montanana
puente del arzobispo, el
puente del congosto
puente genil
puente la reina
puente la reina de jaca
puente viesgo
puentedura
puentes viejas
puerta de segura, la
puertas
puerto castilla
puerto de bejar
puerto de la cruz
puerto de san vicente
puerto de santa cruz
puerto de santa maria, el
puerto del rosario
puerto lapice
puerto lumbreras
puerto moral
puerto real
puerto seguro
puerto serrano
puertolas
puertollano
puertomingalvo
pueyo
pueyo de araguas, el
pueyo de santa cruz
puig de santa maria, el
puig-reig
puigcerda
puigdalber
puiggros
puigpelat
puigpunyent
puigverd d'agramunt
puigverd de lleida
puiu
pujalt
pujerra
pulgar
pulianas
pulpi
punta umbria
puntagorda
puntallana
punxin
puras
purchena
purujosa
purullena
quar, la
quart
quart de les valls
quart de poblet
quartell
quatretonda
quatretondeta
quel
quemada
quentar
quer
queralbs
quero
querol
quesa
quesada
quicena
quijorna
quinoneria
quintana de la serena
quintana del castillo
quintana del marco
quintana del pidio
quintana del puente
quintana redonda
quintana y congosto
quintanabureba
quintanaelez
quintanaortuno
quintanapalla
quintanar de la orden
quintanar de la sierra
quintanar del rey
quintanas de gormaz
quintanavides
quintanilla de arriba
quintanilla de la mata
quintanilla de onesimo
quintanilla de onsona
quintanilla de trigueros
quintanilla de urz
quintanilla del agua y tordueles
quintanilla del coco
quintanilla del molar
quintanilla del monte
quintanilla del olmo
quintanilla san garcia
quintanilla vivar
quintanillas, las
quintela de leirado
quinto
quiroga
quiros
quiruelas de vidriales
quismondo
rabade
rabanales
rabanera
rabanera del pinar
rabano
rabano de aliste
rabanos
rabanos, los
rabe de las calzadas
rabos
rada de haro
rafal
rafales
rafelbunyol
rafelcofer
rafelguaraf
rafol d'almunia, el
rafol de salem
ragama
ragol
rairiz de veiga
rajadell
ramales de la victoria
rambla, la
ramiras
ramiro
rapariegos
rapita, la
rascafria
rasillo de cameros, el
rasines
rasquera
rasueros
real
real de gandia, el
real de la jara, el
real de san vicente, el
real sitio de san ildefonso
realejos, los
rebollar
rebolledo de la torre
rebollo
rebollosa de jadraque
recas
recueja, la
recuenco, el
recuerda
redal, el
redecilla del camino
redecilla del campo
redonda, la
redondela
redovan
reduena
regencos
region de murcia
regueras de arriba
regueras, las
regumiel de la sierra
reillo
reina
reinosa
reinoso
reinoso de cerrato
relleu
rellinars
rello
remolinos
remondo
rena
renau
renedo de esgueva
renedo de la vega
renera
renieblas
reocin
requejo
requena
requena de campos
respenda de la pena
retamal de llerena
retamoso de la jara
retascon
retiendas
retortillo
retortillo de soria
retuerta
retuerta del bullaque
reus
revellinos
revenga de campos
revilla de collazos
revilla del campo
revilla vallejera
revilla y ahedo, la
revillarruz
reyero
rezmondo
reznos
riaguas de san bartolome
rialp
riano
rianxo
riaza
riba de escalote, la
riba de saelices
riba, la
riba-roja d'ebre
riba-roja de turia
ribadavia
ribadedeva
ribadeo
ribadesella
ribadumia
ribaforada
ribafrecha
ribamontan al mar
ribamontan al monte
ribas de campos
ribas de sil
ribatejada
ribeira
ribeira de piquin
ribera alta
ribera baja
ribera d'ondara
ribera d'urgellet
ribera de arriba
ribera del fresno
riberos de la cueza
ribes de freser
ribesalbes
ribota
ricla
ricote
riego de la vega
riello
riells i viabrea
rielves
riera de gaia, la
rillo
rillo de gallo
rincon de la victoria
rincon de soto
rinconada de la sierra, la
rinconada, la
riner
riocabado
riocavado de la sierra
riodeva
riofrio
riofrio de aliste
riofrio de riaza
riofrio del llano
riogordo
rioja
rioja, la
riola
riolobos
rionansa
rionegro del puente
riopar
rios
riosa
rioseco de soria
rioseco de tapia
riotorto
riotuerto
ripoll
ripollet
risco
riu de cerdanya
riudarenes
riudaura
riudecanyes
riudecols
riudellots de la selva
riudoms
riumors
rivas-vaciamadrid
rivilla de barajas
roa
roales
roales de campos
robla, la
robladillo
robleda
robleda-cervantes
robledillo de gata
robledillo de la jara
robledillo de la vera
robledillo de mohernando
robledillo de trujillo
robledo
robledo de chavela
robledo de corpes
robledo del mazo
robledo, el
robledollano
robliza de cojos
robregordo
robres
robres del castillo
roca de la sierra, la
roca del valles, la
rocafort
rocafort de queralt
rociana del condado
roda de andalucia, la
roda de bera
roda de eresma
roda de ter
roda, la
rodeiro
rodenas
rodezno
rodonya
roelos de sayago
rois
rojales
rojas
rollamienta
rollan
romana, la
romangordo
romanillos de atienza
romanones
romanos
romanzado
romeral, el
roncal
roncesvalles
ronda
ronquillo, el
roperuelos del paramo
roquetas de mar
roquetes
rosal de la frontera
rosal, o
rosalejo
rosario, el
roses
rosinos de la requejada
rossell
rossello
rota
rotgla i corbera
rotova
roturas
rourell, el
royo, el
royuela
royuela de rio franco
rozalen del monte
rozas de madrid, las
rozas de puerto real
rozas de valdearroyo, las
rua, a
ruanes
rubena
rubi
rubi de bracamonte
rubia
rubiales
rubielos de la cerida
rubielos de mora
rubio
rubio, el
rubite
rublacedo de abajo
rucandio
rueda
rueda de jalon
rueda de la sierra
ruente
ruesca
ruesga
rugat
ruidera
ruiloba
rupia
rupit i pruit
rus
rute
sabadell
sabero
sabinan
sabinanigo
sabiote
sacanet
sacecorbo
saceda-trasierra
sacedon
saceruela
sacramenia
sada
sadaba
saelices
saelices de la sal
saelices de mayorga
saelices el chico
sagas
sagra
sagrada, la
sagunt
sagunto
sahagun
sahugo, el
sahun
sajazarra
salamanca
salar
salares
salas
salas altas
salas bajas
salas de bureba
salas de los infantes
salas de pallars
salce
salceda de caselas
salcedillo
saldana
saldana de burgos
saldeana
saldes
saldias
saldon
salduero
salem
sales de llierca
salillas
salillas de jalon
salinas
salinas de oro
salinas de pisuerga
salinas del manzano
salines, ses
salinillas de bureba
sallent
sallent de gallego
salmeron
salmeroncillos
salmoral
salobral
salobre
salobrena
salomo
salorino
salou
salt
salteras
salvacanete
salvadios
salvador de zapardiel
salvaleon
salvaterra de mino
salvatierra
salvatierra de esca
salvatierra de los barros
salvatierra de santiago
salvatierra de tormes
salzadella, la
samaniego
samboal
samir de los canos
samos
samper de calanda
samper del salz
san adrian
san adrian de juarros
san adrian del valle
san agustin
san agustin del guadalix
san agustin del pozo
san amaro
san andres del congosto
san andres del rabanedo
san andres del rey
san andres y sauces
san antonio de benageber
san asensio
san bartolome
san bartolome de bejar
san bartolome de corneja
san bartolome de la torre
san bartolome de las abiertas
san bartolome de pinares
san bartolome de tirajana
san carlos del valle
san cebrian de campos
san cebrian de castro
san cebrian de mazote
san cebrian de muda
san cibrao das vinas
san clemente
san cristobal de boedo
san cristobal de cuellar
san cristobal de entrevinas
san cristobal de la cuesta
san cristobal de la laguna
san cristobal de la polantera
san cristobal de la vega
san cristobal de segovia
san cristovo de cea
san emiliano
san esteban de gormaz
san esteban de la sierra
san esteban de litera
san esteban de los patos
san esteban de nogales
san esteban de zapardiel
san esteban del molar
san esteban del valle
san felices
san felices de buelna
san felices de los gallegos
san fernando
san fernando de henares
san fulgencio
san garcia de ingelmos
san isidro
san javier
san jorge
san jose del valle
san juan de aznalfarache
san juan de gredos
san juan de la encinilla
san juan de la nava
san juan de la rambla
san juan de plan
san juan del molinillo
san juan del monte
san juan del olmo
san juan del puerto
san justo
san justo de la vega
san leonardo de yague
san llorente
san lorenzo de calatrava
san lorenzo de el escorial
san lorenzo de la parrilla
san lorenzo de tormes
san mames de burgos
san mames de campos
san martin de boniches
san martin de la vega
san martin de la vega del alberche
san martin de la virgen de moncayo
san martin de montalban
san martin de oscos
san martin de pusa
san martin de rubiales
san martin de trevejo
san martin de unx
san martin de valdeiglesias
san martin de valderaduey
san martin de valveni
san martin del castanar
san martin del pimpollar
san martin del rey aurelio
san martin del rio
san martin del tesorillo
san martin y mudrian
san mateo de gallego
san miguel de abona
san miguel de aguayo
san miguel de bernuy
san miguel de corneja
san miguel de la ribera
san miguel de salinas
san miguel de serrezuela
san miguel de valero
san miguel del arroyo
san miguel del cinca
san miguel del pino
san miguel del robledo
san miguel del valle
san millan
san millan de la cogolla
san millan de lara
san millan de los caballeros
san millan de yecora
san morales
san munoz
san nicolas del puerto
san pablo de la moraleja
san pablo de los montes
san pascual
san pedro
san pedro bercianos
san pedro de ceque
san pedro de gaillos
san pedro de la nave-almendra
san pedro de latarce
san pedro de merida
san pedro de rozados
san pedro del arroyo
san pedro del pinatar
san pedro del romeral
san pedro del valle
san pedro manrique
san pedro palmiches
san pelayo
san pelayo de guarena
san rafael del rio
san roman de cameros
san roman de hornija
san roman de la cuba
san roman de los montes
san roque
san roque de riomiera
san sadurnino
san salvador
san sebastian
san sebastian de la gomera
san sebastian de los ballesteros
san sebastian de los reyes
san silvestre de guzman
san tirso de abres
san torcuato
san vicente de alcantara
san vicente de arevalo
san vicente de la barquera
san vicente de la cabeza
san vicente de la sonsierra
san vicente del palacio
san vicente del raspeig
san vicente del valle
san vitero
san xoan de rio
sanauja
sancedo
sanchidrian
sanchon de la ribera
sanchon de la sagrada
sanchonuno
sanchorreja
sanchotello
sancti-spiritus
sandias
sando
sanet y negrals
sangarcia
sangarren
sanguesa
sanlucar de barrameda
sanlucar de guadiana
sanlucar la mayor
sansol
sant adria de besos
sant agusti de llucanes
sant andreu de la barca
sant andreu de llavaneres
sant andreu salou
sant aniol de finestres
sant antoni de portmany
sant antoni de vilamajor
sant bartomeu del grau
sant boi de llobregat
sant boi de llucanes
sant cebria de vallalta
sant celoni
sant climent de llobregat
sant climent sescebes
sant cugat del valles
sant cugat sesgarrigues
sant esteve de la sarga
sant esteve de palautordera
sant esteve sesrovires
sant feliu de buixalleu
sant feliu de codines
sant feliu de guixols
sant feliu de llobregat
sant feliu de pallerols
sant feliu sasserra
sant ferriol
sant fost de campsentelles
sant fruitos de bages
sant gregori
sant guim de freixenet
sant guim de la plana
sant hilari sacalm
sant hipolit de voltrega
sant iscle de vallalta
sant jaume d'enveja
sant jaume de frontanya
sant jaume de llierca
sant jaume dels domenys
sant joan
sant joan d'alacant
sant joan de labritja
sant joan de les abadesses
sant joan de mollet
sant joan de moro
sant joan de vilatorrada
sant joan despi
sant joan les fonts
sant joanet
sant jordi
sant jordi desvalls
sant josep de sa talaia
sant julia de cerdanyola
sant julia de ramis
sant julia de vilatorta
sant julia del llor i bonmati
sant just desvern
sant llorenc d'hortons
sant llorenc de la muga
sant llorenc de morunys
sant llorenc des cardassar
sant llorenc savall
sant lluis
sant marti d'albars
sant marti de centelles
sant marti de llemena
sant marti de riucorb
sant marti de tous
sant marti sarroca
sant marti sesgueioles
sant marti vell
sant mateu
sant mateu de bages
sant miquel de campmajor
sant miquel de fluvia
sant mori
sant pau de seguries
sant pere de ribes
sant pere de riudebitlles
sant pere de torello
sant pere de vilamajor
sant pere pescador
sant pere sallavinera
sant pol de mar
sant quinti de mediona
sant quirze de besora
sant quirze del valles
sant quirze safaja
sant ramon
sant sadurni d'anoia
sant sadurni d'osormort
sant salvador de guardiola
sant vicenc de castellet
sant vicenc de montalt
sant vicenc de torello
sant vicenc dels horts
sant vicent del raspeig
santa amalia
santa ana
santa ana de pusa
santa ana la real
santa barbara
santa barbara de casa
santa brigida
santa cecilia
santa cecilia de voltrega
santa cecilia del alcor
santa cilia
santa clara de avedillo
santa coloma
santa coloma de cervello
santa coloma de farners
santa coloma de gramenet
santa coloma de queralt
santa colomba de curueno
santa colomba de las monjas
santa colomba de somoza
santa comba
santa cristina d'aro
santa cristina de la polvorosa
santa cristina de valmadrigal
santa croya de tera
santa cruz de bezana
santa cruz de boedo
santa cruz de grio
santa cruz de la palma
santa cruz de la salceda
santa cruz de la seros
santa cruz de la sierra
santa cruz de la zarza
santa cruz de los canamos
santa cruz de marchena
santa cruz de moncayo
santa cruz de moya
santa cruz de mudela
santa cruz de nogueras
santa cruz de paniagua
santa cruz de pinares
santa cruz de tenerife
santa cruz de yanguas
santa cruz del comercio
santa cruz del retamar
santa cruz del valle
santa cruz del valle urbion
santa elena
santa elena de jamuz
santa engracia del jubera
santa eufemia
santa eufemia del arroyo
santa eufemia del barco
santa eugenia
santa eugenia de berga
santa eulalia
santa eulalia bajera
santa eulalia de gallego
santa eulalia de oscos
santa eulalia de riuprimer
santa eulalia de roncana
santa eularia des riu
santa fe
santa fe de mondujar
santa fe del penedes
santa gadea del cid
santa ines
santa llogaia d'alguema
santa lucia de tirajana
santa magdalena de pulpis
santa margalida
santa margarida de montbui
santa margarida i els monjos
santa maria d'olo
santa maria de besora
santa maria de cayon
santa maria de dulcis
santa maria de guia de gran canaria
santa maria de huerta
santa maria de la alameda
santa maria de la isla
santa maria de la vega
santa maria de las hoyas
santa maria de los caballeros
santa maria de los llanos
santa maria de martorelles
santa maria de merles
santa maria de miralles
santa maria de ordas
santa maria de palautordera
santa maria de sando
santa maria de valverde
santa maria del arroyo
santa maria del berrocal
santa maria del cami
santa maria del campo
santa maria del campo rus
santa maria del cubillo
santa maria del invierno
santa maria del mercadillo
santa maria del monte de cea
santa maria del paramo
santa maria del tietar
santa maria del val
santa maria la real de nieva
santa maria ribarredonda
santa marina del rey
santa marta
santa marta de magasca
santa marta de tormes
santa marta del cerro
santa olalla
santa olalla de bureba
santa olalla del cala
santa oliva
santa pau
santa perpetua de mogoda
santa pola
santa susanna
santa ursula
santacara
santaella
santaliestra y san quilez
santander
santanyi
santas martas
santed
santervas de campos
santervas de la vega
santesteban
santiago de alcantara
santiago de calatrava
santiago de compostela
santiago de la puebla
santiago del campo
santiago del collado
santiago del teide
santiago del tormes
santiago millas
santiago-pontones
santibanez de bejar
santibanez de ecla
santibanez de esgueva
santibanez de la pena
santibanez de la sierra
santibanez de tera
santibanez de valcorba
santibanez de vidriales
santibanez del val
santibanez el alto
santibanez el bajo
santillana del mar
santiponce
santiso
santisteban del puerto
santiurde de reinosa
santiurde de toranzo
santiuste
santiuste de pedraza
santiuste de san juan bautista
santiz
santo adriano
santo domingo de la calzada
santo domingo de las posadas
santo domingo de piron
santo domingo de silos
santo domingo-caudilla
santo tome
santo tome de zabarcos
santo tome del puerto
santomera
santona
santorcaz
santos de la humosa, los
santos de maimona, los
santos, los
santovenia
santovenia de la valdoncina
santovenia de pisuerga
santoyo
santpedor
santurde de rioja
santurdejo
santurtzi
sanxenxo
sanzoles
sardon de duero
sardon de los frailes
sargentes de la lora
sariego
sariegos
sarinena
saro
sarracin
sarral
sarreaus
sarria
sarria de ter
sarries
sarrion
sarroca de bellera
sarroca de lleida
sartaguda
sartajada
sartze
sasamon
sastago
sauca
saucedilla
saucejo, el
saucelle
sauquillo de cabezas
saus, camallera i llampaies
sauzal, el
savalla del comtat
savinao, o
sax
sayalonga
sayaton
sebulcor
seca, la
secastilla
secuita, la
sedavi
sedella
sediles
segart
segorbe
segovia
segura
segura de la sierra
segura de leon
segura de los banos
segura de toro
segurilla
seira
selas
selaya
sella
sellent
selva
selva de mar, la
selva del camp, la
semillas
sempere
sena
sena de luna
senan
sencelles
senes
senes de alcubierre
senia, la
senija
seno
senterada
sentiu de sio, la
sentmenat
senyera
sepulcro-hilario
sepulveda
sequera de fresno
sequera de haza, la
sequeros
serinya
serna del monte, la
serna, la
seron
seron de nagima
seros
serra
serra de daro
serrada
serrada, la
serradilla
serradilla del arroyo
serradilla del llano
serranillos
serranillos del valle
serratella, la
serrato
serrejon
sesa
sesena
sesma
sestao
sestrica
sesue
setcases
setenil de las bodegas
setiles
seu d'urgell, la
seva
sevilla
sevilla la nueva
sevilleja de la jara
sidamon
sienes
siero
sierpe, la
sierra de fuentes
sierra de luna
sierra de yeguas
sierra engarceran
sierro
sietamo
siete aguas
siete iglesias de trabancos
sieteiglesias de tormes
sigeres
siguenza
sigues
siles
silla
silleda
silos, los
sils
simancas
simat de la valldigna
sinarcas
sineu
singra
sinlabajos
siruela
sisamon
sisante
sitges
siurana
soba
sober
sobradiel
sobradillo
sobrado
sobremunt
sobrescobio
socovos
socuellamos
sojuela
solana de avila
solana de los barros
solana de rioalmar
solana del pino
solana, la
solanillos del extremo
solarana
solera de gabaldon
soleras, el
soliedra
solivella
sollana
soller
solorzano
solosancho
solsona
somiedo
somolinos
somontin
somosierra
somozas, as
son servera
sondika
soneja
sonseca
sopeira
sopela
soportujar
sopuerta
sora
soraluze-placencia de las armas
sorbas
sordillos
soria
soriguera
sorihuela
sorihuela del guadalimar
sorlada
sort
sorvilan
sorzano
sos del rey catolico
soses
sot de chera
sot de ferrer
sotalbo
sotes
sotillo
sotillo de la adrada
sotillo de la ribera
sotillo de las palomas
sotillo del rincon
sotillo, el
soto de cerrato
soto de la vega
soto del barco
soto del real
soto en cameros
soto y amio
sotobanado y priorato
sotodosos
sotonera, la
sotorribas
sotosalbos
sotoserrano
sotragero
sotresgudo
soutomaior
suances
subirats
sudanell
sueca
suellacabras
suera
sueras
sufli
sukarrieta
sumacarcer
sunbilla
sunyer
suria
susinos del paramo
susqueda
tabanera de cerrato
tabanera de valdavia
tabanera la luenga
tabara
tabera de abajo
tabernas
taberno
taboada
taboadela
tabuenca
tacoronte
tafalla
tagamanent
taha, la
tahal
tajahuerce
tajueco
tala, la
talamanca
talamanca de jarama
talamantes
talarn
talarrubias
talavan
talavera
talavera de la reina
talavera la real
talaveruela de la vera
talayuela
talayuelas
tales
taliga
tallada d'emporda, la
talveila
tamajon
tamames
tamara de campos
tamarite de litera
tamariz de campos
tamaron
tamurejo
tanque, el
tapia de casariego
tapioles
taradell
taragudo
taramundi
tarancon
taravilla
tarazona
tarazona de guarena
tarazona de la mancha
tarbena
tardaguila
tardajos
tardelcuende
tardienta
tariego de cerrato
tarifa
taroda
tarragona
tarrega
tarres
tarroja de segarra
tartanedo
tauste
tavernes blanques
tavernes de la valldigna
tavernoles
tavertet
tazacorte
teba
tebar
tegueste
teguise
teia
teixeira, a
tejada
tejadillos
tejado
tejado, el
tejeda
tejeda de tietar
tejeda y segoyuela
telde
tella-sin
tembleque
tendilla
tenebron
teo
teresa
teresa de cofrentes
termens
teror
terque
terrades
terradillos
terradillos de esgueva
terrassa
terrateig
terrer
terriente
terrinches
terroba
teruel
terzaga
teulada
teverga
tiana
tias
tibi
tiebas-muruarte de reta
tiedra
tielmes
tiemblo, el
tierga
tierz
tierzo
tietar
tijarafe
tijola
tinajas
tinajo
tineo
tinieblas de la sierra
tinosillos
tirapu
tirgo
tirig
tirvia
titaguas
titulcia
tiurana
tivenys
tivissa
toba, la
tobar
tobarra
tobed
tobia
toboso, el
tocina
todolella
toen
toga
tojos, los
tolbanos
toledo
tollos
tolocirio
tolosa
tolox
tolva
tomares
tomelloso
tomino
tona
topas
toques
tora
toral de los guzmanes
toral de los vados
toras
tordehumos
tordellego
tordelrabano
tordera
tordesillas
tordesilos
tordillos
tordoia
tordomar
torello
toreno
torija
toril
toril y masegoso
torla-ordesa
torlengua
tormantos
tormellas
tormon
tormos
torms, els
tornabous
tornadizo, el
tornadizos de avila
tornavacas
torno, el
tornos
toro
toro, el
torquemada
torralba
torralba de aragon
torralba de calatrava
torralba de los frailes
torralba de los sisones
torralba de oropesa
torralba de ribota
torralba del pinar
torralba del rio
torralbilla
torre alhaquime
torre d'en besora, la
torre d'en domenec, la
torre de arcas
torre de cabdella, la
torre de claramunt, la
torre de don miguel
torre de esgueva
torre de esteban hambran, la
torre de fontaubella, la
torre de juan abad
torre de l'espanyol, la
torre de las arcas
torre de les macanes, la
torre de miguel sesmero
torre de penafiel
torre de santa maria
torre del bierzo
torre del burgo
torre del compte
torre del valle, la
torre en cameros
torre la ribera
torre los negros
torre val de san pedro
torre, la
torre-cardela
torre-pacheco
torre-serona
torreadrada
torrebaja
torrebesses
torreblacos
torreblanca
torreblascopedro
torrecaballeros
torrecampo
torrechiva
torrecilla de alcaniz
torrecilla de la abadesa
torrecilla de la jara
torrecilla de la orden
torrecilla de la torre
torrecilla de los angeles
torrecilla del monte
torrecilla del pinar
torrecilla del rebollar
torrecilla en cameros
torrecilla sobre alesanco
torrecillas de la tiesa
torrecuadrada de molina
torrecuadradilla
torredelcampo
torredembarra
torredonjimeno
torrefarrera
torrefeta i florejacs
torregalindo
torregamones
torregrossa
torrehermosa
torreiglesias
torrejon de ardoz
torrejon de la calzada
torrejon de velasco
torrejon del rey
torrejon el rubio
torrejoncillo
torrejoncillo del rey
torrelacarcel
torrelaguna
torrelameu
torrelapaja
torrelara
torrelavega
torrelavit
torrella
torrellas
torrelles de foix
torrelles de llobregat
torrelobaton
torrelodones
torremanzanas
torremayor
torremejia
torremenga
torremocha
torremocha de jadraque
torremocha de jarama
torremocha de jiloca
torremocha del campo
torremocha del pinar
torremochuela
torremolinos
torremontalbo
torremormojon
torrent
torrente de cinca
torrenueva
torrenueva costa
torreorgaz
torrepadre
torreperogil
torrequemada
torres
torres de albanchez
torres de albarracin
torres de alcanadre
torres de barbues
torres de berrellen
torres de cotillas, las
torres de la alameda
torres de segre
torres del carrizal
torres del rio
torres torres
torresandino
torrescarcela
torresmenudas
torrevelilla
torrevieja
torrico
torrijas
torrijo de la canada
torrijo del campo
torrijos
torroella de fluvia
torroella de montgri
torroja del priorat
torrox
torrubia
torrubia de soria
torrubia del campo
torrubia del castillo
tortella
tortola de henares
tortoles
tortoles de esgueva
tortosa
tortuera
tortuero
torvizcon
tosantos
toses
tosos
tossa de mar
totalan
totana
totanes
touro
tous
trabada
trabadelo
trabanca
trabazos
tragacete
traid
traiguera
tramacastiel
tramacastilla
tramaced
trasierra
trasmiras
trasmoz
trasobares
traspinedo
trazo
trebujena
trefacio
tremedal de tormes
tremp
tres cantos
tres villas, las
trescasas
tresjuncos
trespaderne
tresviso
trevago
trevelez
treviana
triacastela
tribaldos
tricio
trigueros
trigueros del valle
trijueque
trillo
triollo
tronchon
truchas
trucios-turtzioz
trujillanos
trujillo
tubilla del agua
tubilla del lago
tudanca
tudela
tudela de duero
tudelilla
tuejar
tui
tuineje
tulebras
turcia
turegano
turis
turleque
turon
turre
turrillas
txulapain
ubeda
ubide
ubrique
ucar
uceda
ucero
ucles
udias
ugao-miraballes
ugena
ugijar
uharte
uharte arakil
ujados
ujue
ulea
uleila del campo
ulla
ullastrell
ullastret
ulldecona
ulldemolins
ultramort
ultzama
umbrete
umbrias
una
una de quintana
uncastillo
unciti
undues de lerda
union de campos, la
union, la
untzue
unzue
urbel del castillo
urda
urdax
urdazubi
urdiain
urdiales del paramo
urduliz
urduna
urkabustaiz
urnieta
urones de castroponce
urracal
urraul alto
urraul bajo
urrea de gaen
urrea de jalon
urretxu
urries
urroz
urroz-villa
uruena
uruenas
urunuela
urus
urzainki
urzainqui
usagre
usansolo
used
useras
useres, les
usurbil
utande
utebo
uterga
utiel
utrera
utrillas
uxue
uztarroz
uztarroze
vacarisses
vadillo
vadillo de la guarena
vadillo de la sierra
vadocondes
vajol, la
val de goni
val de san lorenzo
val de san martin
val de san vicente
val do dubra
valacloche
valadouro, o
valbona
valbuena de duero
valbuena de pisuerga
valcabado
valcarlos
valdaliga
valdaracete
valdarachas
valdastillas
valde-ucieza
valdealgorfa
valdeande
valdearcos de la vega
valdearenas
valdeavellano
valdeavellano de tera
valdeavero
valdeaveruelo
valdecaballeros
valdecanas de tajo
valdecarros
valdecasa
valdecolmenas, los
valdeconcha
valdecuenca
valdefinjas
valdefresno
valdefuentes
valdefuentes de sangusin
valdefuentes del paramo
valdeganga
valdegena
valdegovia
valdegrudas
valdehijaderos
valdehorna
valdehuncar
valdelacalzada
valdelacasa
valdelacasa de tajo
valdelageve
valdelagua del cerro
valdelaguna
valdelarco
valdelcubo
valdelinares
valdelosa
valdeltormo
valdelugueros
valdemadera
valdemaluque
valdemanco
valdemanco del esteras
valdemaqueda
valdemeca
valdemierque
valdemora
valdemorales
valdemorillo
valdemorillo de la sierra
valdemoro
valdemoro-sierra
valdenebro
valdenebro de los valles
valdenuno fernandez
valdeobispo
valdeolea
valdeolivas
valdeolmillos
valdeolmos-alalpardo
valdepenas
valdepenas de jaen
valdepenas de la sierra
valdepielago
valdepielagos
valdepolo
valdeprado
valdeprado del rio
valdeprados
valderas
valderrabano
valderrebollo
valderredible
valderrey
valderrobres
valderrodilla
valderrodrigo
valderrubio
valderrueda
valdes
valdesamario
valdescorriel
valdesotos
valdestillas
valdetorres
valdetorres de jarama
valdetortola
valdevacas de montejo
valdevacas y guijar
valdeverdeja
valdevimbre
valdezate
valdilecha
valdorros
valdovino
valdunciel
valdunquillo
valencia
valencia de alcantara
valencia de don juan
valencia de las torres
valencia del mombuey
valencia del ventoso
valencina de la concepcion
valenzuela
valenzuela de calatrava
valeras, las
valero
valfarta
valfermoso de tajuna
valga
valganon
valhermoso
valhermoso de la fuente
valjunquera
vall d'alba
vall d'alcala, la
vall d'ebo, la
vall d'en bas, la
vall d'uixo, la
vall de almonacid
vall de bianya, la
vall de boi, la
vall de cardos
vall de gallinera, la
vall de laguar, la
vall-llobrega
vallada
valladolid
vallanca
vallarta de bureba
vallat
vallbona d'anoia
vallbona de les monges
vallcebre
vallclara
valldemossa
valle de abdalajis
valle de altomira, el
valle de ancares
valle de arana
valle de bardaji
valle de carranza
valle de cerrato
valle de egues
valle de elorz
valle de hecho
valle de la serena
valle de las navas
valle de lierp
valle de losa
valle de manzanedo
valle de matamoros
valle de mena
valle de oca
valle de ollo
valle de santa ana
valle de santibanez
valle de sedano
valle de tabladillo
valle de tobalina
valle de trapaga-trapagaran
valle de valdebezana
valle de valdelaguna
valle de valdelucio
valle de villaverde
valle de yerri
valle de zamanzas
valle del retortillo
valle del zalabi
valle gran rey
valle, el
vallecillo
vallecillo, el
vallehermoso
vallejera
vallejera de riofrio
vallelado
valleruela de pedraza
valleruela de sepulveda
valles
valles de palenzuela
vallesa de la guarena
valleseco
vallfogona de balaguer
vallfogona de ripolles
vallfogona de riucorb
vallgorguina
vallibona
vallirana
vallmoll
vallromanes
valls
valls d'aguilar, les
valls de valira, les
valluercanes
valmadrid
valmala
valmojado
valor
valoria la buena
valpalmas
valsalabroso
valsalobre
valseca
valsequillo
valsequillo de gran canaria
valtablado del rio
valtajeros
valtiendas
valtierra
valtorres
valverde
valverde de alcala
valverde de burguillos
valverde de campos
valverde de jucar
valverde de la vera
valverde de la virgen
valverde de leganes
valverde de llerena
valverde de los arroyos
valverde de merida
valverde de valdelacasa
valverde del camino
valverde del fresno
valverde del majano
valverde-enrique
valverdejo
valverdon
vandellos i l'hospitalet de l'infant
vansa i fornols, la
vara de rey
veciana
vecilla, la
vecinos
vedra
vega de espinareda
vega de infanzones
vega de liebana
vega de pas
vega de ruiponce
vega de san mateo
vega de santa maria
vega de tera
vega de tirados
vega de valcarce
vega de valdetronco
vega de villalobos
vega del codorno
vegacervera
vegadeo
vegalatrave
veganzones
vegaquemada
vegas de matute
vegas del condado
vegas del genil
vegaviana
veguillas de la sierra
veguillas, las
veiga, a
vejer de la frontera
velada
velamazan
velascalvaro
velayos
velefique
velez de benaudalla
velez-blanco
velez-malaga
velez-rubio
velilla
velilla de cinca
velilla de ebro
velilla de jiloca
velilla de la sierra
velilla de los ajos
velilla de san antonio
velilla del rio carrion
velles, la
vellisca
velliza
vellon, el
vencillon
vendrell, el
venialbo
venta de banos
venta del moro
ventallo
ventas con pena aguilera, las
ventas de huelma
ventas de retamosa, las
ventas de san julian, las
ventosa
ventosa de la cuesta
ventosa del rio almar
ventosilla y tejadilla
ventrosa
venturada
vera
vera de moncayo
verdu
verea
verger, el
verges
verin
vertavillo
vespella de gaia
vezdemarban
viacamp y litera
viana
viana de cega
viana de duero
viana de jadraque
viana do bolo
viandar de la vera
vianos
viator
vic
vicar
vicedo, o
vicien
victoria de acentejo, la
victoria, la
vid de bureba, la
vid de ojeda, la
vid y barrios, la
vidangoz
vidayanes
videmala
vidola, la
vidra
vidreres
vielha e mijaran
vierlas
vigo
viguera
vila de cruces
vila joiosa, la
vila-real
vila-rodona
vila-sacra
vila-sana
vila-seca
vilabella
vilabertran
vilablareix
vilaboa
vilada
viladamat
viladasens
viladecans
viladecavalls
vilademuls
viladrau
vilafames
vilafant
vilaflor de chasna
vilafranca
vilafranca de bonany
vilafranca del penedes
vilagarcia de arousa
vilagrassa
vilajuiga
vilalba
vilalba dels arcs
vilalba sasserra
vilaller
vilallonga
vilallonga de ter
vilallonga del camp
vilamacolum
vilamalla
vilamaniscle
vilamarin
vilamartin de valdeorras
vilamarxant
vilamos
vilanant
vilanova d'alcolea
vilanova d'escornalbou
vilanova de arousa
vilanova de bellpuig
vilanova de l'aguda
vilanova de la barca
vilanova de meia
vilanova de prades
vilanova de sau
vilanova de segria
vilanova del cami
vilanova del valles
vilanova i la geltru
vilaplana
vilar de barrio
vilar de canes
vilar de santos
vilardevos
vilarino de conso
vilarmaior
vilasantar
vilassar de dalt
vilassar de mar
vilaur
vilavella, la
vilaverd
vilches
vilella alta, la
vilella baixa, la
vilena
villa de don fadrique, la
villa de mazo
villa de otura
villa de ves
villa del campo
villa del prado
villa del rey
villa del rio
villabanez
villabaruz de campos
villabasta de valdavia
villablanca
villablino
villabona
villabragima
villabraz
villabrazaro
villabuena de alava
villabuena del puente
villacanas
villacarralon
villacarriedo
villacarrillo
villacastin
villacid de campos
villacidaler
villaciervos
villaco
villaconancio
villaconejos
villaconejos de trabaque
villada
villadangos del paramo
villademor de la vega
villadepera
villadiego
villadoz
villaeles de valdavia
villaescusa
villaescusa de haro
villaescusa de roa
villaescusa la sombria
villaespasa
villafafila
villafeliche
villaferruena
villaflor
villaflores
villafrades de campos
villafranca
villafranca de cordoba
villafranca de duero
villafranca de ebro
villafranca de la sierra
villafranca de los barros
villafranca de los caballeros
villafranca del bierzo
villafranca del campo
villafranca del cid
villafranca montes de oca
villafrechos
villafruela
villafuerte
villafufre
villagalijo
villagarcia de campos
villagarcia de la torre
villagarcia del llano
villagaton
villageriz
villagomez la nueva
villagonzalo
villagonzalo de tormes
villagonzalo pedernales
villahan
villaharta
villahermosa
villahermosa del campo
villahermosa del rio
villaherreros
villahoz
villajoyosa
villalaco
villalan de campos
villalar de los comuneros
villalazan
villalba de duero
villalba de guardo
villalba de la lampreana
villalba de la loma
villalba de la sierra
villalba de los alcores
villalba de los barros
villalba de los llanos
villalba de perejil
villalba de rioja
villalba del alcor
villalba del rey
villalbarba
villalbilla
villalbilla de burgos
villalbilla de gumiel
villalcampo
villalcazar de sirga
villalcon
villaldemiro
villalengua
villalgordo del jucar
villalgordo del marquesado
villalmanzo
villalobar de rioja
villalobon
villalobos
villalon de campos
villalonga
villalonso
villalpando
villalpardo
villalube
villaluenga de la sagra
villaluenga de la vega
villaluenga del rosario
villamalea
villamalur
villamanan
villamandos
villamanin
villamanrique
villamanrique de la condesa
villamanrique de tajo
villamanta
villamantilla
villamartin
villamartin de campos
villamartin de don sancho
villamayor
villamayor de calatrava
villamayor de campos
villamayor de gallego
villamayor de los montes
villamayor de monjardin
villamayor de santiago
villamayor de trevino
villambistia
villamediana
villamediana de iregua
villamedianilla
villamejil
villamena
villameriel
villamesias
villamiel
villamiel de la sierra
villamiel de toledo
villaminaya
villamol
villamontan de la valduerna
villamor de los escuderos
villamoratiel de las matas
villamoronta
villamuelas
villamuera de la cueza
villamuriel de campos
villamuriel de cerrato
villan de tordesillas
villanazar
villangomez
villanova
villanua
villanubla
villanueva de aezkoa
villanueva de alcardete
villanueva de alcoron
villanueva de algaidas
villanueva de argano
villanueva de argecilla
villanueva de avila
villanueva de azoague
villanueva de bogas
villanueva de cameros
villanueva de campean
villanueva de carazo
villanueva de cordoba
villanueva de duero
villanueva de gallego
villanueva de gomez
villanueva de gormaz
villanueva de guadamejud
villanueva de gumiel
villanueva de huerva
villanueva de jiloca
villanueva de la canada
villanueva de la concepcion
villanueva de la condesa
villanueva de la fuente
villanueva de la jara
villanueva de la reina
villanueva de la serena
villanueva de la sierra
villanueva de la torre
villanueva de la vera
villanueva de las cruces
villanueva de las manzanas
villanueva de las peras
villanueva de las torres
villanueva de los caballeros
villanueva de los castillejos
villanueva de los infantes
villanueva de oscos
villanueva de perales
villanueva de san carlos
villanueva de san juan
villanueva de san mancio
villanueva de sigena
villanueva de tapia
villanueva de teba
villanueva de viver
villanueva del aceral
villanueva del ariscal
villanueva del arzobispo
villanueva del campillo
villanueva del campo
villanueva del conde
villanueva del duque
villanueva del fresno
villanueva del pardillo
villanueva del rebollar
villanueva del rebollar de la sierra
villanueva del rey
villanueva del rio segura
villanueva del rio y minas
villanueva del rosario
villanueva del trabuco
villanueva mesia
villanuno de valdavia
villaobispo de otero
villaornate y castro
villapalacios
villaprovedo
villaquejida
villaquilambre
villaquiran de la puebla
villaquiran de los infantes
villar de arganan
villar de arnedo, el
villar de canas
villar de ciervo
villar de corneja
villar de domingo garcia
villar de fallaves
villar de gallimazo
villar de la encina
villar de la yegua
villar de los navarros
villar de olalla
villar de peralonso
villar de plasencia
villar de rena
villar de samaniego
villar de torre
villar del ala
villar del arzobispo
villar del buey
villar del campo
villar del cobo
villar del humo
villar del infantado
villar del olmo
villar del pedroso
villar del pozo
villar del rey
villar del rio
villar del salz
villar y velasco
villaralbo
villaralto
villarcayo de merindad de castilla la vieja
villardeciervos
villardefrades
villardiegua de la ribera
villardiga
villardompardo
villardondiego
villarejo
villarejo de fuentes
villarejo de la penuela
villarejo de montalban
villarejo de orbigo
villarejo de salvanes
villarejo del valle
villarejo-periesteban
villares de jadraque
villares de la reina
villares de orbigo
villares de soria, los
villares de yeltes
villares del saz
villares, los
villargordo del cabriel
villariezo
villarino de los aires
villarluengo
villarmayor
villarmentero de campos
villarmentero de esgueva
villarmuerto
villarquemado
villarrabe
villarramiel
villarrasa
villarreal de huerva
villarrin de campos
villarrobledo
villarrodrigo
villarroya
villarroya de la sierra
villarroya de los pinares
villarroya del campo
villarrubia de los ojos
villarrubia de santiago
villarrubio
villarta
villarta de los montes
villarta de san juan
villarta-quintana
villas de la ventosa
villasabariego
villasandino
villasarracino
villasayas
villasbuenas
villasbuenas de gata
villasdardo
villaseca de arciel
villaseca de henares
villaseca de la sagra
villaseca de uceda
villaseco de los gamitos
villaseco de los reyes
villaseco del pan
villaselan
villasequilla
villasexmir
villasila de valdavia
villasrubias
villastar
villasur de herreros
villatobas
villatoro
villatorres
villatoya
villatuelda
villatuerta
villaturde
villaturiel
villaumbrales
villava
villavaliente
villavaquerin
villavelayo
villavellid
villavendimio
villaverde de guadalimar
villaverde de guarena
villaverde de iscar
villaverde de medina
villaverde de montejo
villaverde de rioja
villaverde del monte
villaverde del rio
villaverde y pasaconsol
villaverde-mogina
villaveza de valverde
villaveza del agua
villavicencio de los caballeros
villaviciosa
villaviciosa de cordoba
villaviciosa de odon
villavieja de yeltes
villavieja del lozoya
villaviudas
villayerno morquillas
villayon
villazala
villazanzo de valderaduey
villazopeque
villegas
villeguillo
villel
villel de mesa
villena
villerias de campos
villodre
villodrigo
villoldo
villora
villores
villoria
villoruebo
villoruela
villoslada de cameros
villota del paramo
villovieco
vilobi d'onyar
vilobi del penedes
vilopriu
viloria
viloria de rioja
vilosell, el
viluena, la
vilvestre
vilviestre del pinar
vimbodi i poblet
vimianzo
vinaceite
vinaixa
vinalesa
vinaros
vinas
vindel
vinebre
vinegra de morana
viniegra de abajo
viniegra de arriba
vinuela
vinuelas
vinuesa
vinyols i els arcs
visiedo
viso de san juan, el
viso del alcor, el
viso del marques
viso, el
vistabella
vistabella del maestrat
vita
vitigudino
vitoria-gasteiz
viveiro
vivel del rio martin
viver
viver i serrateix
viveros
vizcainos
vizmanos
viznar
voto
vozmediano
wamba
xabia
xalo
xativa
xeraco
xeresa
xermade
xert
xerta
xilxes
xinzo de limia
xirivella
xixona
xodos
xove
xunqueira de ambia
xunqueira de espadanedo
yaiza
yanguas
yanguas de eresma
yatova
yebenes, los
yebes
yebra
yebra de basa
yecla
yecla de yeltes
yecora
yelamos de abajo
yelamos de arriba
yeles
yelo
yemeda
yepes
yernes y tameza
yesa
yesa, la
yesero
yeste
yuncler
yunclillos
yuncos
yunquera
yunquera de henares
yunta, la
zabaltza
zabalza
zael
zafarraya
zafra
zafra de zancara
zafrilla
zagra
zahara
zahinos
zaida, la
zaidin
zalamea de la serena
zalamea la real
zaldibar
zaldibia
zalduondo
zalla
zamarra
zamayon
zambrana
zamora
zamudio
zangoza
zaorejas
zapardiel de la canada
zapardiel de la ribera
zaragoza
zarapicos
zaratamo
zaratan
zarautz
zarra
zarraton
zarza de granadilla
zarza de montanchez
zarza de pumareda, la
zarza de tajo
zarza la mayor
zarza, la
zarza-capilla
zarza-perrunal, la
zarzalejo
zarzosa
zarzosa de rio pisuerga
zarzuela
zarzuela de jadraque
zarzuela del monte
zarzuela del pinar
zas
zazuar
zeanuri
zeberio
zegama
zerain
zestoa
zierbena
zigoitia
ziordia
ziortza-bolibar
zirauki
ziritza
zizur mayor
zizur nagusia
zizurkil
zoma, la
zorita
zorita de la frontera
zorita de los canes
zorita del maestrazgo
zorraquin
zotes del paramo
zubia, la
zubieta
zucaina
zuera
zufre
zugarramurdi
zuheros
zuia
zujar
zumaia
zumarraga
zuneda
zuniga
zurgena`.split('\n');
const ES_PLACE_SET = new Set(ES_PLACES);
const placeSegments = text => fold(String(text ?? '')).split(/[,;|()[\]{}·\n]+|\s[-–—]\s|\s\/\s/).map(p => p.replace(/\s+/g, ' ').trim()).filter(Boolean);
const placeInSpain = location => Boolean(location) && placeSegments(location).some(p => ES_PLACE_SET.has(p));

function matchesQuery(payload, query) {
  const haystack = `${payload.title ?? ''} ${payload.location ?? ''}`.toLowerCase();
  if (query.role && !ROLE_KEYWORDS[query.role].some(k => haystack.includes(k))) return false;
  if (query.market === 'ES') {
    if (NON_ES_HINTS.some(k => haystack.includes(k))) return false;
    if (!ES_HINTS.some(k => haystack.includes(k)) && !placeInSpain(payload.location)) return false;
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

function spainSignal(p) { return ES_HINTS.some(k => `${p.title ?? ''} ${p.location ?? ''} ${p.description ?? ''}`.toLowerCase().includes(k)) || placeInSpain(p.location); }
function nonSpain(p) { return NON_ES_HINTS.some(k => `${p.title ?? ''} ${p.location ?? ''}`.toLowerCase().includes(k)); }

const ROLE_EVAL_ORDER = ['closer', 'setter', 'cold_caller', 'account_executive', 'sdr'];
// Coincidencia por PALABRA completa (2026-10-26). `includes` metía «…bring online stores'
// inventory closer to their customers» (una vacante de Java) en la familia closer: el 30 % de los
// closers de una medición eran ofertas de ingeniería. Se exige frontera a ambos lados y se admite
// el plural ('closers', 'setters', 'agendadores'). Mismo criterio que roleFromTitle en
// apps/web/lib/vocabulary.ts para que el embudo y el panel no discrepen.
const isWordChar = ch => ch !== undefined && /[a-z0-9]/.test(ch);
function hasWord(text, keyword) {
  if (!text || !keyword) return false;
  for (let from = 0; ;) {
    const at = text.indexOf(keyword, from);
    if (at < 0) return false;
    let end = at + keyword.length;
    if (text[end] === 's') end += 1;
    else if (text[end] === 'e' && text[end + 1] === 's') end += 2;
    if (!isWordChar(at === 0 ? undefined : text[at - 1]) && !isWordChar(text[end])) return true;
    from = at + 1;
  }
}
// `closer` a secas en el CUERPO no es evidencia de rol: en inglés es el comparativo («bring
// inventory closer to their customers», «teams closer together»). Medido 2026-10-26: vacantes de
// Java y de SRE/DevOps entraban como closer y quedaban elegibles para la alumna. En el título sí
// cuenta (es donde vive el nombre del puesto) y en el cuerpo siguen contando las fórmulas
// inequívocas: «closer de ventas», «sales closer», «high ticket closer», «closer remoto»…
const BODY_AMBIGUOUS_KEYWORDS = new Set(['closer']);
function classifyRole(p, text) {
  // Determinista y con la misma prioridad que presentation.py: primero el título de toda
  // la vida, después la evidencia en el texto de la oferta; nunca se inventa familia.
  // 'closer' va primero (2026-10-14): su keyword es la menos ambigua y los títulos
  // combinados 'Setter y Closer de Ventas' (núcleo exacto del perfil WDC) no deben
  // clasificarse como setter solo por el orden de evaluación.
  const title = fold(p.title ?? '');
  const body = String(text ?? '');
  for (const role of ROLE_EVAL_ORDER) {
    if (ROLE_KEYWORDS[role].some(k => hasWord(title, k))) return role;
  }
  for (const role of ROLE_EVAL_ORDER) {
    if (ROLE_KEYWORDS[role].some(k => !BODY_AMBIGUOUS_KEYWORDS.has(k) && hasWord(body, k))) return role;
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
