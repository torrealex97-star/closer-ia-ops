import { createHmac, timingSafeEqual } from 'node:crypto';
import { ingest, MAX_CANDIDATES, ORG, type Candidate } from './external';
import { getSecret } from './integrations';
import { serviceRest } from './supabaseAuth';

// Actores de Apify: el scraping corre en la infraestructura de Apify (con sus proxies), no en la nuestra, y los
// resultados se recogen por lotes en el catálogo externo. De pago por uso: desactivado por defecto, con límites por
// ejecución (memoria, tiempo, elementos) y un tope mensual. Aprobar lo recogido sigue siendo humano.
const base = () => (process.env.APIFY_API_BASE ?? 'https://api.apify.com').replace(/\/$/, '');
export const MONTHLY_BUDGET_USD = () => Number(process.env.APIFY_MONTHLY_BUDGET_USD) > 0 ? Number(process.env.APIFY_MONTHLY_BUDGET_USD) : 10;
const RESERVE_USD = 1; // lo que se reserva por ejecución en curso hasta conocer su coste real

export type ActorRow = { id: string; label: string; actor: string; source: string; input_template: Record<string, unknown> | null; max_items: number; memory_mb: number; timeout_s: number; schedule_daily: boolean; created_by: string; created_at: string };
export type RunRow = { id: string; actor_id: string; run_id: string; dataset_id: string | null; status: string; started_at: string; finished_at: string | null; items_total: number | null; harvested: number; cost_usd: number | null; error: string | null };
export const PRESETS = [{ label: 'JobSpy (Indeed, LinkedIn, Glassdoor…)', actor: 'aakash19/jobspy', source: 'apify-jobspy' }];
export const ACTOR_RE = /^[A-Za-z0-9._-]+[/~][A-Za-z0-9._-]+$/;
const actorPath = (actor: string) => actor.replace('/', '~');
export const QUERIES = ['closer de ventas', 'closer high ticket', 'setter de ventas', 'televenta', 'asesor comercial', 'ejecutivo comercial', 'cold caller'];

// ---- token de la clave de Apify y del webhook ----
export const apifyToken = () => getSecret('apify');
const webhookSecret = () => process.env.APIFY_WEBHOOK_SECRET ?? process.env.CRON_SECRET ?? process.env.INGEST_TOKEN ?? '';
export const webhookToken = () => webhookSecret() ? createHmac('sha256', webhookSecret()).update('apify-webhook').digest('hex') : '';
export function webhookTokenValid(given: string) {
  const expected = webhookToken(); const a = Buffer.from(given), b = Buffer.from(expected);
  return Boolean(expected) && a.length === b.length && timingSafeEqual(a, b);
}

const api = (path: string, token: string, init: RequestInit = {}) => fetch(`${base()}${path}`, { cache: 'no-store', signal: AbortSignal.timeout(25000), ...init, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers as Record<string, string>) } });
const norm = (k: string) => k.toLowerCase().replace(/[^a-z0-9]/g, '');
const first = (obj: Record<string, unknown>, names: string[]): unknown => { const idx = new Map(Object.keys(obj).map(k => [norm(k), k])); for (const n of names) { const k = idx.get(n); if (k && obj[k] != null && obj[k] !== '') return obj[k]; } return undefined; };

// ---- entrada del actor: se adapta a su esquema real o a una plantilla del propietario ----
type Prop = { type?: string; default?: unknown; items?: { type?: string } };
export async function fetchSchema(actor: string, token: string): Promise<{ properties: Record<string, Prop>; required: string[] } | null> {
  const response = await api(`/v2/acts/${actorPath(actor)}/builds/default`, token);
  if (!response.ok) return null;
  const data = (await response.json().catch(() => ({}))).data;
  let schema = data?.inputSchema; if (typeof schema === 'string') { try { schema = JSON.parse(schema); } catch { schema = null; } }
  return schema?.properties ? { properties: schema.properties, required: schema.required ?? [] } : null;
}

type Vars = { query: string; location: string; country: string; max_items: number; hours_old: number; sites: string[] };
const SYNONYMS: Record<keyof Vars, string[]> = {
  query: ['searchterm', 'searchterms', 'search', 'searchquery', 'query', 'keyword', 'keywords', 'jobtitle', 'jobtitles', 'position'],
  location: ['location', 'locations', 'city', 'where'],
  country: ['countryindeed', 'country', 'countrycode'],
  max_items: ['resultswanted', 'maxitems', 'maxresults', 'maxjobs', 'limit', 'numberofresults', 'resultslimit'],
  hours_old: ['hoursold', 'maxhoursold', 'hoursago'],
  sites: ['sitename', 'sitenames', 'sites', 'jobboards', 'boards', 'platforms'],
};
const coerce = (v: string | number | string[], p: Prop) => p.type === 'array' ? (Array.isArray(v) ? v : [String(v)]) : p.type === 'integer' || p.type === 'number' ? Number(Array.isArray(v) ? v[0] : v) : Array.isArray(v) ? v.join(' OR ') : String(v);

export function adaptInput(schema: { properties: Record<string, Prop>; required: string[] }, vars: Vars): { input: Record<string, unknown>; missing: string[] } {
  const input: Record<string, unknown> = {}; const byNorm = new Map(Object.keys(schema.properties).map(k => [norm(k), k]));
  for (const [name, synonyms] of Object.entries(SYNONYMS) as Array<[keyof Vars, string[]]>) {
    const key = synonyms.map(s => byNorm.get(s)).find(Boolean); if (key) input[key] = coerce(vars[name], schema.properties[key]);
  }
  const proxy = byNorm.get('proxyconfiguration'); if (proxy && schema.properties[proxy].type === 'object') input[proxy] = { useApifyProxy: true };
  const missing = schema.required.filter(k => input[k] === undefined && schema.properties[k]?.default === undefined);
  return { input, missing };
}

export function fillTemplate(template: unknown, vars: Vars): unknown {
  if (typeof template === 'string') {
    const whole = /^\{\{(query|location|country|max_items|hours_old|sites)\}\}$/.exec(template);
    if (whole) return vars[whole[1] as keyof Vars];
    return template.replace(/\{\{(query|location|country|max_items|hours_old)\}\}/g, (_, k: keyof Vars) => String(vars[k]));
  }
  if (Array.isArray(template)) return template.map(t => fillTemplate(t, vars));
  if (template && typeof template === 'object') return Object.fromEntries(Object.entries(template).map(([k, v]) => [k, fillTemplate(v, vars)]));
  return template;
}

// Una consulta combinada con OR (JobSpy/Indeed/LinkedIn la entienden): una ejecución cubre todos los perfiles y gasta menos.
export const varsFor = (actor: Pick<ActorRow, 'max_items'>): Vars => ({ query: QUERIES.map(q => `"${q}"`).join(' OR '), location: 'España', country: 'Spain', max_items: actor.max_items, hours_old: 240, sites: ['indeed', 'linkedin', 'glassdoor', 'google'] });

// ---- presupuesto ----
export async function monthSpent(): Promise<number> {
  const since = new Date(); since.setUTCDate(1); since.setUTCHours(0, 0, 0, 0);
  const response = await serviceRest(`apify_runs?org_id=eq.${ORG}&started_at=gte.${encodeURIComponent(since.toISOString())}&select=cost_usd,status`);
  const rows = response.ok ? await response.json().catch(() => []) as Array<{ cost_usd: number | null; status: string }> : [];
  return (Array.isArray(rows) ? rows : []).reduce((sum, r) => sum + (r.cost_usd != null ? Number(r.cost_usd) : r.status === 'RUNNING' ? RESERVE_USD : 0), 0);
}

export async function listActors(): Promise<ActorRow[] | null> {
  const r = await serviceRest(`apify_actors?org_id=eq.${ORG}&select=*&order=created_at.asc`); const rows = r.ok ? await r.json().catch(() => null) : null; return Array.isArray(rows) ? rows : null;
}
export async function listRuns(limit = 15): Promise<RunRow[] | null> {
  const r = await serviceRest(`apify_runs?org_id=eq.${ORG}&select=*&order=started_at.desc&limit=${limit}`); const rows = r.ok ? await r.json().catch(() => null) : null; return Array.isArray(rows) ? rows : null;
}

export type StartResult = { ok: true; run_id: string } | { ok: false; error: string };
export async function startRun(actor: ActorRow, by: string, publicBase: string): Promise<StartResult> {
  const token = await apifyToken(); if (!token) return { ok: false, error: 'Guarda antes la clave de Apify en la pestaña APIs.' };
  const [spent, runs] = await Promise.all([monthSpent(), listRuns(30)]);
  if (spent + RESERVE_USD > MONTHLY_BUDGET_USD()) return { ok: false, error: `Presupuesto mensual agotado (${spent.toFixed(2)} de ${MONTHLY_BUDGET_USD()} USD).` };
  if (runs?.some(r => r.actor_id === actor.id && r.status === 'RUNNING' && Date.now() - Date.parse(r.started_at) < 2 * 3600 * 1000)) return { ok: false, error: 'Ya hay una ejecución en curso de este actor.' };
  const vars = varsFor(actor); let input: Record<string, unknown>;
  if (actor.input_template) input = fillTemplate(actor.input_template, vars) as Record<string, unknown>;
  else {
    const schema = await fetchSchema(actor.actor, token); if (!schema) return { ok: false, error: 'No se pudo leer el esquema de entrada del actor. Pega una plantilla de entrada.' };
    const adapted = adaptInput(schema, vars);
    if (adapted.missing.length) return { ok: false, error: `El actor exige campos que no sé rellenar (${adapted.missing.join(', ')}). Pega una plantilla de entrada con ellos.` };
    input = adapted.input;
  }
  const params = new URLSearchParams({ memory: String(actor.memory_mb), timeout: String(actor.timeout_s), maxItems: String(actor.max_items) });
  const hook = webhookToken() ? Buffer.from(JSON.stringify([{ eventTypes: ['ACTOR.RUN.SUCCEEDED', 'ACTOR.RUN.FAILED', 'ACTOR.RUN.TIMED_OUT', 'ACTOR.RUN.ABORTED'], requestUrl: `${publicBase}/api/apify/webhook?t=${webhookToken()}` }])).toString('base64') : '';
  if (hook) params.set('webhooks', hook);
  const response = await api(`/v2/acts/${actorPath(actor.actor)}/runs?${params}`, token, { method: 'POST', body: JSON.stringify(input) });
  if (!response.ok) return { ok: false, error: response.status === 401 || response.status === 403 ? 'Apify rechazó la clave.' : `Apify respondió HTTP ${response.status}.` };
  const run = (await response.json().catch(() => ({}))).data as { id?: string; defaultDatasetId?: string } | undefined;
  if (!run?.id) return { ok: false, error: 'Apify no devolvió el identificador de la ejecución.' };
  await serviceRest('apify_runs', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ org_id: ORG, actor_id: actor.id, run_id: run.id, dataset_id: run.defaultDatasetId ?? null, status: 'RUNNING', started_by: by }) });
  return { ok: true, run_id: run.id };
}

// ---- elementos del dataset -> candidatos ----
const text = (v: unknown): string | null => typeof v === 'string' ? v : typeof v === 'number' ? String(v) : v && typeof v === 'object' ? Object.values(v as Record<string, unknown>).filter(x => typeof x === 'string' && x).join(', ') || null : null;
export function mapItem(item: Record<string, unknown>): Candidate | null {
  const title = text(first(item, ['title', 'jobtitle', 'positiontitle', 'position', 'name']));
  const url = text(first(item, ['joburldirect', 'jobdirecturl', 'applyurl', 'joburl', 'jobpostingurl', 'url', 'link']));
  if (!title || !url) return null;
  const min = first(item, ['minamount', 'salarymin']), max = first(item, ['maxamount', 'salarymax']), cur = text(first(item, ['currency'])) ?? '€', interval = text(first(item, ['interval']));
  const structured = text(first(item, ['salary', 'salaryrange', 'salarydescription', 'compensation', 'wage'])) ?? (min || max ? `${[min, max].filter(Boolean).join('–')} ${cur}${interval ? ` / ${interval}` : ''}` : null);
  return {
    external_id: text(first(item, ['id', 'jobid', 'jobkey', 'key', 'externalid'])) ?? url, title, url, salary: structured,
    company: text(first(item, ['company', 'companyname', 'employer', 'organization', 'hiringorganization'])), location: text(first(item, ['location', 'joblocation', 'city'])),
    description: text(first(item, ['description', 'jobdescription', 'descriptiontext', 'snippet'])),
    posted_at: text(first(item, ['dateposted', 'postedat', 'publishedat', 'posteddate', 'published', 'date', 'created', 'listeddate'])),
    raw: { site: text(first(item, ['site', 'source', 'platform'])) ?? '', job_type: text(first(item, ['jobtype', 'employmenttype'])) ?? '', is_remote: first(item, ['isremote', 'remote']) === true, provider: 'apify' },
  };
}

// ---- recoger resultados (reanudable: guarda cuántos elementos lleva) ----
const DONE = new Set(['SUCCEEDED']); const FAILED = new Set(['FAILED', 'TIMED-OUT', 'ABORTED', 'TIMED_OUT']);
export async function harvestRun(run: RunRow, actor: ActorRow, budgetMs = 40000): Promise<{ status: string; harvested: number; done: boolean; error?: string }> {
  const token = await apifyToken(); if (!token) return { status: run.status, harvested: run.harvested, done: false, error: 'Sin clave de Apify.' };
  const info = await api(`/v2/actor-runs/${run.run_id}`, token); if (!info.ok) return { status: run.status, harvested: run.harvested, done: false, error: `HTTP ${info.status}` };
  const data = (await info.json().catch(() => ({}))).data as { status?: string; defaultDatasetId?: string; usageTotalUsd?: number } | undefined; const status = data?.status ?? run.status;
  const patch = (body: Record<string, unknown>) => serviceRest(`apify_runs?run_id=eq.${encodeURIComponent(run.run_id)}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(body) });
  if (FAILED.has(status)) { await patch({ status, finished_at: new Date().toISOString(), cost_usd: data?.usageTotalUsd ?? null, error: `La ejecución terminó como ${status}.` }); return { status, harvested: run.harvested, done: true, error: status }; }
  if (!DONE.has(status)) return { status, harvested: run.harvested, done: false };
  const dataset = run.dataset_id ?? data?.defaultDatasetId; if (!dataset) { await patch({ status, error: 'Sin dataset.' }); return { status, harvested: run.harvested, done: true, error: 'Sin dataset' }; }
  const started = Date.now(); let offset = run.harvested, harvested = run.harvested, finished = false;
  while (Date.now() - started < budgetMs) {
    const page = await api(`/v2/datasets/${dataset}/items?clean=true&format=json&offset=${offset}&limit=${MAX_CANDIDATES}`, token);
    if (!page.ok) return { status, harvested, done: false, error: `Dataset HTTP ${page.status}` };
    const items = await page.json().catch(() => []) as Array<Record<string, unknown>>;
    if (!Array.isArray(items) || !items.length) { finished = true; break; }
    await ingest(actor.source, 'apify', items.map(mapItem).filter((c): c is Candidate => c !== null), `Apify ${actor.actor} · ${run.run_id}`);
    offset += items.length; harvested += items.length; await patch({ harvested, items_total: harvested });
    if (items.length < MAX_CANDIDATES) { finished = true; break; }
  }
  if (finished) await patch({ status, harvested, items_total: harvested, finished_at: new Date().toISOString(), cost_usd: data?.usageTotalUsd ?? null, error: null });
  return { status, harvested, done: finished };
}

export async function harvestPending(budgetMs = 40000): Promise<Array<{ run_id: string; status: string; harvested: number; done: boolean; error?: string }>> {
  const [runs, actors] = await Promise.all([listRuns(30), listActors()]); const out = []; const started = Date.now();
  for (const run of (runs ?? []).filter(r => r.status === 'RUNNING' || (r.status === 'SUCCEEDED' && !r.finished_at))) {
    const actor = actors?.find(a => a.id === run.actor_id); if (!actor) continue;
    const left = budgetMs - (Date.now() - started); if (left < 3000) break;
    out.push({ run_id: run.run_id, ...await harvestRun(run, actor, left) });
  }
  return out;
}

// Cron diario: lanza los actores marcados como diarios (si hace más de 20 h de la última ejecución y hay presupuesto) y recoge lo pendiente.
export async function dailyApify(publicBase: string) {
  const [actors, runs] = await Promise.all([listActors(), listRuns(60)]); const started: Array<{ actor: string; ok: boolean; error?: string }> = [];
  for (const a of (actors ?? []).filter(x => x.schedule_daily)) {
    if (runs?.some(r => r.actor_id === a.id && Date.now() - Date.parse(r.started_at) < 20 * 3600 * 1000)) continue;
    const r = await startRun(a, 'cron', publicBase); started.push({ actor: a.actor, ok: r.ok, error: r.ok ? undefined : r.error });
  }
  return { started, harvested: await harvestPending(25000) };
}
