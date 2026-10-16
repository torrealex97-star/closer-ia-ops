import { getSecret, type Provider } from './integrations';
import { ingest, type Candidate } from './external';

// Recolectores de APIs oficiales con clave (InfoJobs, Adzuna, Jooble). Permiso explícito del proveedor:
// es la vía de menor riesgo. Volumen bajo: pocas consultas por pasada, una página cada una.
export const QUERIES = ['closer de ventas', 'closer high ticket', 'setter de ventas', 'televenta', 'asesor comercial', 'ejecutivo comercial', 'cold caller'];
export const API_PROVIDERS = ['infojobs', 'adzuna', 'jooble'] as const;
export type ApiProvider = (typeof API_PROVIDERS)[number];

const json = async (response: Response) => { if (!response.ok) throw new Error(`HTTP ${response.status}`); return response.json(); };
const pairOf = (k: string) => { const i = k.indexOf(':'); if (i <= 0) throw new Error('Formato de clave incorrecto'); return [k.slice(0, i), k.slice(i + 1)] as const; };
const money = (min?: number | null, max?: number | null, cur = '€') => (min && max ? `${Math.round(min)}–${Math.round(max)} ${cur}` : min || max ? `${Math.round((min ?? max) as number)} ${cur}` : null);

type Fetcher = (query: string) => Promise<Candidate[]>;
const fetchers: Record<ApiProvider, (secret: string) => Fetcher> = {
  infojobs: secret => {
    const [id, key] = pairOf(secret); const auth = `Basic ${Buffer.from(`${id}:${key}`).toString('base64')}`;
    return async query => {
      const data = await json(await fetch(`${process.env.INFOJOBS_API_BASE ?? 'https://api.infojobs.net'}/api/9/offer?q=${encodeURIComponent(query)}&maxResults=50&order=updated-desc`, { cache: 'no-store', signal: AbortSignal.timeout(20000), headers: { Authorization: auth } }));
      return (data.offers ?? []).map((o: Record<string, any>) => ({ // eslint-disable-line @typescript-eslint/no-explicit-any
        external_id: String(o.id), title: o.title, company: o.author?.name ?? null, location: [o.city, o.province?.value].filter(Boolean).join(', ') || null,
        url: o.link, salary: o.salaryDescription ?? null, posted_at: o.published ?? o.updated ?? null, description: null, raw: { provider: 'infojobs', category: o.category?.value ?? '' },
      }));
    };
  },
  adzuna: secret => {
    const [id, key] = pairOf(secret);
    return async query => {
      const data = await json(await fetch(`${process.env.ADZUNA_API_BASE ?? 'https://api.adzuna.com'}/v1/api/jobs/es/search/1?app_id=${encodeURIComponent(id)}&app_key=${encodeURIComponent(key)}&results_per_page=50&max_days_old=10&sort_by=date&what=${encodeURIComponent(query)}`, { cache: 'no-store', signal: AbortSignal.timeout(20000) }));
      return (data.results ?? []).map((o: Record<string, any>) => ({ // eslint-disable-line @typescript-eslint/no-explicit-any
        external_id: String(o.id), title: o.title, company: o.company?.display_name ?? null, location: o.location?.display_name ?? null, url: o.redirect_url,
        salary: money(o.salary_min, o.salary_max), posted_at: o.created ?? null, description: o.description ?? null, raw: { provider: 'adzuna', category: o.category?.label ?? '' },
      }));
    };
  },
  jooble: secret => async query => {
    const data = await json(await fetch(`${process.env.JOOBLE_API_BASE ?? 'https://jooble.org'}/api/${encodeURIComponent(secret)}`, { method: 'POST', cache: 'no-store', signal: AbortSignal.timeout(20000), headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ keywords: query, location: 'España', page: 1, searchMode: 1 }) }));
    return (data.jobs ?? []).map((o: Record<string, any>) => ({ // eslint-disable-line @typescript-eslint/no-explicit-any
      external_id: String(o.id ?? o.link), title: o.title, company: o.company ?? null, location: o.location ?? null, url: o.link,
      salary: o.salary || null, posted_at: o.updated ?? null, description: o.snippet ?? null, raw: { provider: 'jooble', job_type: o.type ?? '' },
    }));
  },
};

export type CollectOutcome = { provider: ApiProvider; ok: boolean; received?: number; accepted?: number; error?: string };

// Recoge un proveedor con la clave guardada: una consulta tras otra, y un fallo de una no tumba las demás.
export async function collectProvider(provider: ApiProvider, via: string): Promise<CollectOutcome> {
  const secret = await getSecret(provider as Provider);
  if (!secret) return { provider, ok: false, error: 'Sin clave guardada' };
  try {
    const fetchQuery = fetchers[provider](secret);
    const all: Candidate[] = []; const errors: string[] = [];
    for (const query of QUERIES) {
      try { all.push(...await fetchQuery(query)); } catch (err) { errors.push(`${query}: ${(err as Error).message}`); }
    }
    if (!all.length && errors.length) return { provider, ok: false, error: errors[0] };
    const result = await ingest(provider, via, all, errors.length ? `${errors.length} consulta(s) fallaron` : undefined);
    return { provider, ok: true, received: result.received, accepted: result.accepted };
  } catch (err) { return { provider, ok: false, error: (err as Error).message }; }
}

export async function collectAll(via: string, only?: ApiProvider): Promise<CollectOutcome[]> {
  const list = only ? [only] : [...API_PROVIDERS];
  const outcomes: CollectOutcome[] = [];
  for (const p of list) outcomes.push(await collectProvider(p, via));
  return outcomes;
}
