import { getSecret, type Provider } from './integrations';
import { ingest, pausedSourcesStrict, type Candidate } from './external';
import { callTimeout, timeLeft, MIN_STEP_MS } from './cronBudget';

// Recolectores de APIs oficiales con clave (InfoJobs, Adzuna, Jooble). Permiso explícito del proveedor:
// es la vía de menor riesgo. Volumen bajo: pocas consultas por pasada, una página cada una.
export const QUERIES = ['closer de ventas', 'closer high ticket', 'setter de ventas', 'televenta', 'asesor comercial', 'ejecutivo comercial', 'cold caller'];
export const API_PROVIDERS = ['infojobs', 'adzuna', 'jooble'] as const;
export type ApiProvider = (typeof API_PROVIDERS)[number];

const json = async (response: Response) => { if (!response.ok) throw new Error(`HTTP ${response.status}`); return response.json(); };
const pairOf = (k: string) => { const i = k.indexOf(':'); if (i <= 0) throw new Error('Formato de clave incorrecto'); return [k.slice(0, i), k.slice(i + 1)] as const; };
const money = (min?: number | null, max?: number | null, cur = '€') => (min && max ? `${Math.round(min)}–${Math.round(max)} ${cur}` : min || max ? `${Math.round((min ?? max) as number)} ${cur}` : null);

type Fetcher = (query: string, timeoutMs: number) => Promise<Candidate[]>;
const fetchers: Record<ApiProvider, (secret: string) => Fetcher> = {
  infojobs: secret => {
    const [id, key] = pairOf(secret); const auth = `Basic ${Buffer.from(`${id}:${key}`).toString('base64')}`;
    return async (query, timeoutMs) => {
      const data = await json(await fetch(`${process.env.INFOJOBS_API_BASE ?? 'https://api.infojobs.net'}/api/9/offer?q=${encodeURIComponent(query)}&maxResults=50&order=updated-desc`, { cache: 'no-store', signal: AbortSignal.timeout(timeoutMs), headers: { Authorization: auth } }));
      return (data.offers ?? []).map((o: Record<string, any>) => ({ // eslint-disable-line @typescript-eslint/no-explicit-any
        external_id: String(o.id), title: o.title, company: o.author?.name ?? null, location: [o.city, o.province?.value].filter(Boolean).join(', ') || null,
        url: o.link, salary: o.salaryDescription ?? null, posted_at: o.published ?? o.updated ?? null, description: null, raw: { provider: 'infojobs', category: o.category?.value ?? '' },
      }));
    };
  },
  adzuna: secret => {
    const [id, key] = pairOf(secret);
    return async (query, timeoutMs) => {
      const data = await json(await fetch(`${process.env.ADZUNA_API_BASE ?? 'https://api.adzuna.com'}/v1/api/jobs/es/search/1?app_id=${encodeURIComponent(id)}&app_key=${encodeURIComponent(key)}&results_per_page=50&max_days_old=10&sort_by=date&what=${encodeURIComponent(query)}`, { cache: 'no-store', signal: AbortSignal.timeout(timeoutMs) }));
      return (data.results ?? []).map((o: Record<string, any>) => ({ // eslint-disable-line @typescript-eslint/no-explicit-any
        external_id: String(o.id), title: o.title, company: o.company?.display_name ?? null, location: o.location?.display_name ?? null, url: o.redirect_url,
        salary: money(o.salary_min, o.salary_max), posted_at: o.created ?? null, description: o.description ?? null, raw: { provider: 'adzuna', category: o.category?.label ?? '' },
      }));
    };
  },
  // Jooble emite una clave POR DOMINIO de país: la de jooble.org solo devuelve ofertas de EE. UU.
  // Para España hay que usar la clave de es.jooble.org y pegarle a ese dominio.
  jooble: secret => async (query, timeoutMs) => {
    const data = await json(await fetch(`${process.env.JOOBLE_API_BASE ?? 'https://es.jooble.org'}/api/${encodeURIComponent(secret)}`, { method: 'POST', cache: 'no-store', signal: AbortSignal.timeout(timeoutMs), headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ keywords: query, location: 'España', page: 1, searchMode: 1 }) }));
    return (data.jobs ?? []).map((o: Record<string, any>) => ({ // eslint-disable-line @typescript-eslint/no-explicit-any
      external_id: String(o.id ?? o.link), title: o.title, company: o.company ?? null, location: o.location ?? null, url: o.link,
      salary: o.salary || null, posted_at: o.updated ?? null, description: o.snippet ?? null, raw: { provider: 'jooble', job_type: o.type ?? '' },
    }));
  },
};

export type CollectOutcome = { provider: ApiProvider; ok: boolean; received?: number; accepted?: number; error?: string; truncated?: boolean };

// Recoge un proveedor con la clave guardada: una consulta tras otra, y un fallo de una no tumba las demás.
// Con `deadline` (presupuesto del cron) deja de lanzar consultas cuando no queda tiempo, guarda lo ya recogido y lo declara.
export async function collectProvider(provider: ApiProvider, via: string, deadline?: number): Promise<CollectOutcome> {
  try {
    const paused = await pausedSourcesStrict();
    if (!paused) return { provider, ok: false, error: 'No se pudo comprobar si la fuente está pausada; se reintenta en la próxima ejecución.' };
    if (paused.has(provider)) return { provider, ok: false, error: 'Fuente pausada' };
    const secret = await getSecret(provider as Provider);
    if (!secret) return { provider, ok: false, error: 'Sin clave guardada' };
    const fetchQuery = fetchers[provider](secret);
    const all: Candidate[] = []; const errors: string[] = []; let truncated = false;
    for (const query of QUERIES) {
      if (timeLeft(deadline) < MIN_STEP_MS) { truncated = true; break; }
      try { all.push(...await fetchQuery(query, callTimeout(20000, deadline))); } catch (err) { errors.push(`${query}: ${(err as Error).message}`); }
    }
    if (!all.length && errors.length) return { provider, ok: false, error: errors[0], truncated: truncated || undefined };
    if (!all.length && truncated) return { provider, ok: false, error: 'Sin tiempo en el presupuesto del cron: se reintentará en la próxima ejecución.', truncated: true };
    const notes = [errors.length ? `${errors.length} consulta(s) fallaron` : '', truncated ? 'cortada por presupuesto de tiempo' : ''].filter(Boolean).join(' · ') || undefined;
    const result = await ingest(provider, via, all, notes);
    return { provider, ok: true, received: result.received, accepted: result.accepted, truncated: truncated || undefined };
  } catch (err) { return { provider, ok: false, error: (err as Error).message }; }
}

// Reparte el tiempo que queda a partes iguales entre los proveedores que faltan: uno lento no deja sin hueco a los demás.
export async function collectAll(via: string, only?: ApiProvider, deadline?: number): Promise<CollectOutcome[]> {
  const list = only ? [only] : [...API_PROVIDERS];
  const outcomes: CollectOutcome[] = [];
  for (let i = 0; i < list.length; i++) {
    const share = deadline === undefined ? undefined : Date.now() + Math.max(0, timeLeft(deadline)) / (list.length - i);
    if (timeLeft(deadline) < MIN_STEP_MS) { outcomes.push({ provider: list[i], ok: false, error: 'Sin tiempo en el presupuesto del cron: se reintentará en la próxima ejecución.', truncated: true }); continue; }
    outcomes.push(await collectProvider(list[i], via, share));
  }
  return outcomes;
}
