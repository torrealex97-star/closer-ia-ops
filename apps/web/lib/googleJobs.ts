import { getSecret } from './integrations';
import { ingest, pausedSourcesStrict, type Candidate } from './external';
import { callTimeout, timeLeft } from './cronBudget';

// Google Jobs vía SerpApi: la única fuente de ofertas ya conectada que puede
// aportar closers de España sin una clave nueva. Google Jobs indexa InfoJobs,
// LinkedIn y portales, así que devuelve el inventario que los portales publican
// y el buscador ya tiene rastreado. Una búsqueda por dork y sin paginación: el
// `next_page_token` cuesta otra búsqueda y no se usa.
export const GOOGLE_JOBS_SOURCE = 'google-jobs';

// El vocabulario canónico del repo (ROLE_FAMILIES.closer), no inventado aquí:
// closer puro, high ticket y el título combinado setter/closer.
export const GOOGLE_JOBS_DORKS = [
  'closer de ventas España',
  'closer high ticket España',
  'setter closer España',
] as const;

// Precio de lista de SerpApi por búsqueda (Starter: 25 USD/1000). En el plan
// gratuito las búsquedas salen de las 250 mensuales; el coste se declara igual
// para que el operador vea lo que consume.
export const SEARCH_USD = 0.025;

export const maxDorks = (env: NodeJS.ProcessEnv = process.env) => {
  const raw = Number(env.SERPAPI_JOBS_MAX_DORKS ?? 3);
  return Number.isFinite(raw) ? Math.min(Math.max(Math.floor(raw), 0), GOOGLE_JOBS_DORKS.length) : 3;
};

// Fecha relativa tal como la publica Google («hace 2 días», «3 days ago»). Solo
// se usa cuando la fuente la dice; si no hay frase reconocible, la fecha queda
// desconocida en vez de inventarse.
const UNITS: Record<string, number> = {
  minuto: 60, minutos: 60, minute: 60, minutes: 60,
  hora: 3600, horas: 3600, hour: 3600, hours: 3600,
  dia: 86400, dias: 86400, day: 86400, days: 86400,
  semana: 604800, semanas: 604800, week: 604800, weeks: 604800,
  mes: 2592000, meses: 2592000, month: 2592000, months: 2592000,
};
const fold = (text: string) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

export function postedAt(value: unknown, now = Date.now()): string | null {
  if (typeof value !== 'string') return null;
  const text = fold(value).trim();
  if (!text) return null;
  if (/\b(just posted|recien publicado|hoy|today|ayer|yesterday)\b/.test(text)) {
    return new Date(now - (/ayer|yesterday/.test(text) ? 86400_000 : 0)).toISOString();
  }
  const match = text.match(/(\d+)\s*(?:\+\s*)?(minuto|minutos|minute|minutes|hora|horas|hour|hours|dia|dias|day|days|semana|semanas|week|weeks|mes|meses|month|months)/);
  if (!match) return null;
  const unit = UNITS[match[2]];
  if (!unit) return null;
  return new Date(now - Number(match[1]) * unit * 1000).toISOString();
}

const httpUrl = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return /^https?:\/\/[^\s]+$/i.test(text) ? text : null;
};

const clip = (value: unknown, max: number): string | null => {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const text = String(value).replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, max) : null;
};

// Un `jobs_results` de google_jobs, tal como lo documenta SerpApi. El enlace de
// la oferta es `share_link`; `link` y `apply_options` son alternativas cuando la
// fuente no comparte ficha propia.
export function toCandidate(row: unknown): Candidate | null {
  if (!row || typeof row !== 'object') return null;
  const job = row as Record<string, unknown>;
  const detected = job.detected_extensions && typeof job.detected_extensions === 'object'
    ? job.detected_extensions as Record<string, unknown> : {};
  const apply = Array.isArray(job.apply_options) ? job.apply_options : [];
  const first = apply[0] && typeof apply[0] === 'object' ? apply[0] as Record<string, unknown> : {};
  const url = httpUrl(job.share_link) ?? httpUrl(job.link) ?? httpUrl(first.link);
  const title = clip(job.title, 200);
  if (!url || !title) return null; // sin enlace o título no hay oferta verificable
  const external_id = clip(job.job_id, 200) ?? url;
  const salary = clip(detected.salary, 200);
  return {
    external_id,
    title,
    company: clip(job.company_name, 200) ?? clip(job.via, 200),
    location: clip(job.location, 200),
    url,
    salary,
    description: clip(job.description, 6000),
    posted_at: postedAt(detected.posted_at),
    raw: { provider: 'google', site: clip(job.via, 80) ?? undefined },
  };
}

export type GoogleJobsOutcome = {
  source: typeof GOOGLE_JOBS_SOURCE;
  ok: boolean;
  received?: number;
  accepted?: number;
  searches?: number;
  cost_usd?: number;
  error?: string;
  truncated?: boolean;
};

type Fetcher = (query: string, timeoutMs: number) => Promise<Candidate[]>;

export function serpapiFetcher(secret: string): Fetcher {
  return async (query, timeoutMs) => {
    const base = process.env.SERPAPI_API_BASE ?? 'https://serpapi.com';
    const url = `${base}/search.json?engine=google_jobs&q=${encodeURIComponent(query)}&gl=es&hl=es&api_key=${encodeURIComponent(secret)}`;
    const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json() as Record<string, unknown>;
    const error = typeof data.error === 'string' ? data.error : '';
    if (error) {
      // Un dork sin resultados no es un fallo del proveedor: no oculta los demás.
      if (/returned any results|hasn't returned/i.test(error)) return [];
      throw new Error(`SerpApi: ${error}`);
    }
    const rows = Array.isArray(data.jobs_results) ? data.jobs_results : [];
    return rows.map(toCandidate).filter((c): c is Candidate => c !== null);
  };
}

// Recoge los dorks de closer/ES con la clave ya guardada. Un fallo de un dork no
// tumba los demás; sin tiempo se corta y se declara. Nada se publica: los
// candidatos entran como borradores y siguen exigiendo la revisión del operador.
export async function collectGoogleJobs(via: string, deadline?: number, fetchFor: (secret: string) => Fetcher = serpapiFetcher): Promise<GoogleJobsOutcome> {
  try {
    const paused = await pausedSourcesStrict();
    if (!paused) return { source: GOOGLE_JOBS_SOURCE, ok: false, error: 'No se pudo comprobar si la fuente está pausada; se reintenta en la próxima ejecución.' };
    if (paused.has(GOOGLE_JOBS_SOURCE)) return { source: GOOGLE_JOBS_SOURCE, ok: false, error: 'Fuente pausada' };
    const limit = maxDorks();
    if (limit === 0) return { source: GOOGLE_JOBS_SOURCE, ok: false, error: 'Recogida de Google Jobs desactivada (SERPAPI_JOBS_MAX_DORKS=0).' };
    const secret = await getSecret('serpapi');
    if (!secret) return { source: GOOGLE_JOBS_SOURCE, ok: false, error: 'Sin clave guardada de SerpApi' };
    const fetchQuery = fetchFor(secret);
    const all: Candidate[] = []; const errors: string[] = []; let truncated = false; let searches = 0;
    for (const dork of GOOGLE_JOBS_DORKS.slice(0, limit)) {
      // 3,5 s: por debajo no da tiempo ni a una llamada útil; se corta y se dice.
      if (timeLeft(deadline) < 3_500) { truncated = true; break; }
      searches++;
      try { all.push(...await fetchQuery(dork, callTimeout(12_000, deadline))); }
      catch (err) { errors.push(`${dork}: ${(err as Error).message}`); }
    }
    const cost = Number((searches * SEARCH_USD).toFixed(3));
    if (!all.length && errors.length) return { source: GOOGLE_JOBS_SOURCE, ok: false, error: errors[0], searches, cost_usd: cost, truncated: truncated || undefined };
    if (!all.length && truncated) return { source: GOOGLE_JOBS_SOURCE, ok: false, error: 'Sin tiempo en el presupuesto del cron: se reintentará en la próxima ejecución.', searches, cost_usd: cost, truncated: true };
    // El mismo anuncio sale en varios dorks: se queda uno por id y por URL canónica.
    const unique = [...new Map(all.map(c => [`${c.external_id}|${c.url}`, c])).values()];
    const notes = [errors.length ? `${errors.length} búsqueda(s) fallaron` : '', truncated ? 'cortada por presupuesto de tiempo' : ''].filter(Boolean).join(' · ') || undefined;
    const result = await ingest(GOOGLE_JOBS_SOURCE, via, unique, notes);
    return { source: GOOGLE_JOBS_SOURCE, ok: true, received: result.received, accepted: result.accepted, searches, cost_usd: cost, truncated: truncated || undefined };
  } catch (err) {
    return { source: GOOGLE_JOBS_SOURCE, ok: false, error: (err as Error).message };
  }
}
