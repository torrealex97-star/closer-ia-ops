import { randomUUID } from 'node:crypto';
import { timeLeft, MIN_STEP_MS } from './cronBudget';
import { dailyApify, listActors, listRuns, RUN_CAP_USD, startRun, TEST_CAP_USD, type ActorRow, type HarvestResult, type RunRow } from './apify';
import { ORG } from './external';
import { PORTALS, portalBySource, type Portal, type Recipe } from './apifyCatalog';
import { serviceRest } from './supabaseAuth';

// Búsqueda automática con buscadores de repuesto. Si el primero no arranca, falla o termina sin ofertas, se prueba el
// siguiente hasta que uno funcione (con tope de intentos y respetando el presupuesto). Todo queda anotado en el historial.
const DAY = 24 * 3600 * 1000, FAIL = new Set(['FAILED', 'TIMED-OUT', 'TIMED_OUT', 'ABORTED']);
export const MAX_ATTEMPTS = 3, MAX_PER_DAY = 6;
const isActive = (r: RunRow) => r.status === 'RUNNING' || (r.status === 'SUCCEEDED' && !r.finished_at);
const isFailed = (r: RunRow) => FAIL.has(r.status) || (r.status === 'SUCCEEDED' && Boolean(r.finished_at) && r.harvested === 0);
const isGood = (r: RunRow) => r.status === 'SUCCEEDED' && Boolean(r.finished_at) && r.harvested > 0;
const age = (r: RunRow, now: number) => now - Date.parse(r.started_at);

export type RecipeState = 'ok' | 'failed' | 'running' | 'unknown';
export function recipeState(actorId: string | undefined, runs: RunRow[], now = Date.now()): { state: RecipeState; error?: string; items?: number } {
  const last = actorId ? runs.filter(r => r.actor_id === actorId && age(r, now) < DAY).sort((a, b) => b.started_at.localeCompare(a.started_at))[0] : undefined;
  if (!last) return { state: 'unknown' };
  if (isActive(last)) return { state: 'running' };
  if (isFailed(last)) return { state: 'failed', error: last.error ?? (last.harvested === 0 ? 'No devolvió ofertas.' : undefined) };
  return { state: 'ok', items: last.harvested };
}

// Los que fallaron en las últimas 24 h van al final; el resto conserva el orden del catálogo.
export function orderRecipes(portal: Portal, rows: ActorRow[], runs: RunRow[], now = Date.now()): Recipe[] {
  const failed = (r: Recipe) => recipeState(rows.find(a => a.actor === r.actor)?.id, runs, now).state === 'failed';
  return [...portal.recipes.filter(r => !failed(r)), ...portal.recipes.filter(failed)];
}

async function ensureRows(portal: Portal, by: string): Promise<ActorRow[]> {
  let rows = (await listActors() ?? []).filter(a => a.source === portal.source);
  for (const r of portal.recipes.filter(x => !rows.some(a => a.actor === x.actor))) {
    await serviceRest('apify_actors', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ org_id: ORG, label: r.name, actor: r.actor, source: portal.source, input_template: null, max_items: portal.maxItems, memory_mb: 1024, timeout_s: 900, schedule_daily: rows.some(a => a.schedule_daily), created_by: by }) }).catch(() => null);
  }
  rows = (await listActors() ?? []).filter(a => a.source === portal.source);
  return rows;
}

// Un intento que ni siquiera arrancó se anota en el historial (coste 0) para que cuente en la salud del buscador.
async function recordStartFailure(row: ActorRow, error: string, by: string) {
  await serviceRest('apify_runs', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ org_id: ORG, actor_id: row.id, run_id: `noarranco${randomUUID().replace(/-/g, '').slice(0, 14)}`, status: 'FAILED', started_by: by, finished_at: new Date().toISOString(), harvested: 0, items_total: 0, error: error.slice(0, 300) }) }).catch(() => null);
}

// Errores que NO dependen del buscador: probar otro no sirve (presupuesto, clave, ya hay una búsqueda, base de datos).
const GLOBAL_STOP = /Presupuesto|gasto del mes|Guarda antes la clave|rechaz[oó] la clave|Ya hay una ejecuci|registrar/i;

export type SearchResult = { ok: true; recipe: string; actor: string; fallback: boolean; attempts: Array<{ recipe: string; error: string }> }
  | { ok: false; busy?: boolean; stopped?: boolean; error: string; attempts: Array<{ recipe: string; error: string }> };
export async function searchPortal(portal: Portal, opts: { by: string; publicBase: string; test?: boolean; maxAttempts?: number; now?: number }): Promise<SearchResult> {
  const now = opts.now ?? Date.now(), attempts: Array<{ recipe: string; error: string }> = [];
  const [rows, runs] = [await ensureRows(portal, opts.by), await listRuns(80) ?? []];
  const todays = runs.filter(r => rows.some(a => a.id === r.actor_id) && age(r, now) < DAY).length;
  if (todays >= MAX_PER_DAY * 2) return { ok: false, stopped: true, error: 'Ya se han hecho muchos intentos hoy en este portal; se vuelve a intentar mañana.', attempts };
  for (const recipe of orderRecipes(portal, rows, runs, now).slice(0, opts.maxAttempts ?? MAX_ATTEMPTS)) {
    const row = rows.find(a => a.actor === recipe.actor); if (!row) continue;
    const usable = opts.test ? { ...row, max_items: portal.testItems } : row;
    const r = await startRun(usable, opts.by, opts.publicBase, { maxChargeUsd: opts.test ? TEST_CAP_USD : RUN_CAP_USD, vars: { max_items: usable.max_items, ...(portal.query ? { query: portal.query } : {}) } });
    if (r.ok) return { ok: true, recipe: recipe.name, actor: recipe.actor, fallback: attempts.length > 0, attempts };
    if (GLOBAL_STOP.test(r.error)) return { ok: false, busy: /Ya hay una ejecuci/i.test(r.error), stopped: true, error: r.error, attempts };
    attempts.push({ recipe: recipe.name, error: r.error }); await recordStartFailure(row, r.error, opts.by);
  }
  return { ok: false, error: attempts.length ? 'Ningún buscador de este portal ha podido arrancar ahora.' : 'Este portal no tiene buscadores disponibles.', attempts };
}

// Tras recoger una ejecución: si terminó mal o sin ofertas, se lanza el siguiente buscador del mismo portal (una vez por incidente).
export async function recoverAfter(run: RunRow, actor: ActorRow, result: HarvestResult, publicBase: string) {
  const portal = portalBySource(actor.source); if (!portal || !result.done) return undefined;
  if (!(result.error || FAIL.has(result.status) || result.harvested === 0)) return undefined;
  const [rows, runs] = [(await listActors() ?? []).filter(a => a.source === portal.source), await listRuns(80) ?? []];
  const ids = new Set(rows.map(a => a.id)), now = Date.now();
  const portalRuns = runs.filter(r => ids.has(r.actor_id) && r.run_id !== run.run_id);
  if (portalRuns.some(r => (isGood(r) || isActive(r)) && age(r, now) < 20 * 3600 * 1000)) return undefined; // ya hay otra búsqueda sana o en curso
  if (!rows.some(a => a.schedule_daily) && run.started_by === 'cron') return undefined;
  const out = await searchPortal(portal, { by: 'auto-recuperacion', publicBase, now });
  return { portal: portal.id, ok: out.ok, ...(out.ok ? { recipe: out.recipe } : { error: out.error }) };
}

// Cron: cada portal activado hace UNA búsqueda al día (con repuestos); los actores sueltos siguen la lógica antigua.
export async function dailyAuto(publicBase: string, opts: { start?: boolean; deadline?: number } = {}) {
  const [actors, runs] = [await listActors() ?? [], await listRuns(80) ?? []]; const started: Array<{ actor: string; ok: boolean; error?: string }> = []; const now = Date.now();
  for (const portal of opts.start === false ? [] : PORTALS) {
    const rows = actors.filter(a => a.source === portal.source); if (!rows.some(a => a.schedule_daily)) continue;
    const ids = new Set(rows.map(a => a.id));
    if (runs.some(r => ids.has(r.actor_id) && (isGood(r) || isActive(r)) && age(r, now) < 20 * 3600 * 1000)) continue;
    if (timeLeft(opts.deadline) < MIN_STEP_MS * 2) { started.push({ actor: portal.recipes[0].actor, ok: false, error: 'Sin tiempo en el presupuesto del cron: se lanzará en la próxima ejecución.' }); continue; }
    const r = await searchPortal(portal, { by: 'cron', publicBase, now });
    started.push({ actor: r.ok ? r.actor : portal.recipes[0].actor, ok: r.ok, ...(r.ok ? {} : { error: r.error }) });
  }
  const legacy = await dailyApify(publicBase, { ...opts, skip: a => Boolean(portalBySource(a.source)), after: (run, actor, res) => recoverAfter(run, actor, res, publicBase) });
  return { ...legacy, started: [...started, ...legacy.started] };
}

// ---- Vista en lenguaje llano para el panel ----
export type PortalView = {
  id: string; name: string; plain: string; caution?: string; daily: boolean; maxItems: number;
  state: 'off' | 'new' | 'running' | 'ok' | 'trying' | 'down'; headline: string; detail: string;
  last: { when: string; items: number; cost: number | null } | null;
  recipes: Array<{ name: string; state: RecipeState; detail: string }>;
};
const ago = (iso: string, now: number) => { const m = Math.max(0, Math.round((now - Date.parse(iso)) / 60000)); return m < 60 ? `hace ${m} min` : m < 48 * 60 ? `hace ${Math.round(m / 60)} h` : `hace ${Math.round(m / 1440)} días`; };
// Mensajes técnicos → frase que entiende cualquiera.
export function plainError(error: string | null | undefined): string {
  const e = error ?? '';
  if (!e) return 'No dio ningún motivo.';
  if (/esquema|plantilla|campos|exige/i.test(e)) return 'Este buscador cambió su forma de funcionar.';
  if (/HTTP 4(04|10)|no encontrado|not found/i.test(e)) return 'Este buscador ya no está disponible en Apify.';
  if (/TIMED|Tiempo/i.test(e)) return 'Tardó demasiado y se cortó.';
  if (/FAILED|ABORTED|terminó como/i.test(e)) return 'Se detuvo con un error.';
  if (/0 ofertas|devolvi/i.test(e)) return 'No encontró ofertas.';
  return e.length > 140 ? `${e.slice(0, 137)}…` : e;
}
export function portalViews(actors: ActorRow[], runs: RunRow[], now = Date.now()): PortalView[] {
  return PORTALS.map(p => {
    const rows = actors.filter(a => a.source === p.source), ids = new Set(rows.map(a => a.id)), mine = runs.filter(r => ids.has(r.actor_id)).sort((a, b) => b.started_at.localeCompare(a.started_at));
    const recipes = p.recipes.map(r => { const row = rows.find(a => a.actor === r.actor); const s = recipeState(row?.id, runs, now);
      return { name: r.name, state: s.state, detail: s.state === 'ok' ? `Funcionó: ${s.items} ofertas` : s.state === 'failed' ? plainError(s.error) : s.state === 'running' ? 'Buscando ahora…' : 'Aún sin probar' }; });
    const good = mine.find(isGood), daily = rows.some(a => a.schedule_daily);
    const last = good ? { when: ago(good.finished_at ?? good.started_at, now), items: good.harvested, cost: good.cost_usd == null ? null : Number(good.cost_usd) } : null;
    const failedN = recipes.filter(r => r.state === 'failed').length;
    let state: PortalView['state'], headline: string, detail: string;
    if (mine.some(isActive)) { state = 'running'; headline = 'Buscando ahora…'; detail = 'Tarda entre 1 y 5 minutos. Las ofertas aparecen solas en «Fuentes externas».'; }
    else if (good && mine[0] === good && now - Date.parse(good.started_at) < 48 * 3600 * 1000) { state = 'ok'; headline = 'Funciona'; detail = `Última búsqueda ${last!.when}: ${last!.items} ofertas${last!.cost != null ? ` (${last!.cost.toFixed(2)} USD)` : ''}.`; }
    else if (failedN === p.recipes.length) { state = 'down'; headline = 'Ahora mismo ningún buscador funciona'; detail = daily ? 'La app lo reintentará mañana sola. También puedes pulsar «Buscar ahora».' : 'Pulsa «Buscar ahora» para reintentar; la app probará todos los buscadores por orden.'; }
    else if (failedN > 0) { state = 'trying'; headline = 'Un buscador falló; se usa el siguiente'; detail = 'No tienes que hacer nada: la app cambia de buscador sola.'; }
    else if (!mine.length) { state = daily ? 'new' : 'off'; headline = daily ? 'Activado, aún sin primera búsqueda' : 'Sin probar'; detail = 'Pulsa «Probar con 10 ofertas»: cuesta céntimos y comprueba que todo funciona.'; }
    else { state = 'trying'; headline = 'Esperando la próxima búsqueda'; detail = 'Pulsa «Buscar ahora» o espera a la búsqueda diaria.'; }
    return { id: p.id, name: p.name, plain: p.plain, caution: p.caution, daily, maxItems: p.maxItems, state, headline, detail, last, recipes };
  });
}
