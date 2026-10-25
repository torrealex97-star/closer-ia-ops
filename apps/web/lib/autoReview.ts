import { ORG, approvalsToday, decideByRule, type ExternalOffer } from './external';
import { marketFor, type Market } from './market';
import { spanishWords } from './offerScore';
import { spainSignal } from './esPlaces';
import { serviceRest } from './supabaseAuth';
import { timeLeft } from './cronBudget';
import { config as aiConfig, runAiReview, type ReviewSummary } from './aiReview';

// Cualificación automática. Objetivo del propietario (2026-10-25): la IA clasifica y añade; una
// persona solo revisa lo complejo. Por eso:
//   1) las REGLAS cierran lo que son hechos comprobables (perfil, mercado, español, sin banderas,
//      enlace vivo y puntuación): lo claro se aprueba y lo que ni siquiera es un anuncio se retira;
//   2) la IA lee lo dudoso que SÍ podría mostrarse (puntuación baja, idioma) y decide con fundamento;
//      sus aprobaciones, retiradas y dudas se aplican con guarda de estado y se pueden deshacer;
//   3) solo queda en la cola humana lo que la IA declara dudoso, impugna una bandera roja o cae en la
//      muestra de auditoría (10 %). Lo demás no espera a nadie.
// Topes: 100 aprobaciones automáticas al día (reglas + IA, contadas juntas) y 150 retiradas por
// ejecución. Una regla mal ajustada no puede vaciar o publicar el catálogo de golpe.
export const DAILY_CAP = 100;
export const MIN_SCORE = 55;
export const MAX_AI_PER_RUN = 60;

export type RuleVerdict = {
  decision: 'approve' | 'human' | 'withdraw';
  why: string;
  market: Market | null;
  basis: string;
  /** Si la IA puede decidirla: tiene perfil, mercado y podría mostrarse si se aprueba. */
  ai: boolean;
};
type Row = Pick<ExternalOffer, 'title' | 'company' | 'description' | 'location' | 'salary' | 'role' | 'score' | 'spain' | 'verified_result' | 'market' | 'market_basis' | 'url'> & { red_flags?: string[] | null };

// Páginas de resultados de un portal, no anuncios: «Ofertas de trabajo de Closer de ventas» con 737
// resultados, sin empresa y con la URL del listado. Aprobarlas llevaría a la alumna a un buscador.
const INDEX_TITLE = /^\s*(?:ofertas? de (?:trabajo|empleo)|empleos? (?:de|en)|trabajos? (?:de|en)|bolsa de empleo|vacantes? (?:de|en)|job (?:openings|listings)|jobs? in|search results)\b/i;
const INDEX_URL = /\/(?:ofertas?-trabajo|ofertas?-empleo|empleos?|jobs?\/search|jobsearch|search\/jobs|vacantes?)\b/i;
const isIndexPage = (row: Row) => (!row.company && INDEX_TITLE.test(row.title ?? '')) || INDEX_URL.test(row.url ?? '');

// Código de estado de EE. UU. al final de la ubicación («Miramar, FL», «El Paso, TX 79901»). El
// gazetteer español contiene Miramar y El Paso (municipios reales), así que una oferta de Florida se
// colaba como española. En la revisión manda el dato literal: si hay estado de EE. UU., no es España.
const US_STATE = /,\s*(?:AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC)\s*(?:\d{5}(?:-\d{4})?)?\s*$/i;

/** La decisión determinista, sin red. Se exporta para poder probarla caso por caso. */
export function judgeOffer(row: Row): RuleVerdict {
  // Mercado y España se recalculan: las columnas guardadas pueden venir de un gazetteer anterior y no
  // se usan para decidir sobre una oferta que va a ver una alumna.
  const computed = marketFor(row);
  const us = US_STATE.test(row.location ?? '');
  const market: Market | null = us ? 'US_LATINO' : computed.market ?? (row.market as Market | null | undefined) ?? null;
  const basis = us ? 'ubicacion_estados_unidos' : computed.market ? computed.basis : row.market_basis ?? computed.basis;
  const spain = us ? false : spainSignal(row.title, row.location);
  const verdict = (decision: RuleVerdict['decision'], why: string, ai = false): RuleVerdict => ({ decision, why, market, basis, ai });

  if (isIndexPage(row)) return verdict('withdraw', 'no_es_oferta');
  if (row.verified_result === 'closed') return verdict('withdraw', 'enlace_cerrado');
  if (!row.role) return verdict('human', 'sin_perfil');
  if (!market) return verdict('human', 'sin_mercado');
  if (spain === false && market === 'ES') return verdict('human', 'mercado_dudoso');
  if ((row.red_flags ?? []).length) return verdict('human', 'banderas_rojas');
  if ((row.score ?? 0) < MIN_SCORE) return verdict('human', 'score_bajo', true);
  const words = spanishWords(`${row.title ?? ''} ${row.description ?? ''}`);
  if (words < 3) return verdict('human', 'idioma_dudoso', true);
  return verdict('approve', 'cumple_reglas');
}

export type AutoSummary = {
  checked: number;
  approved: number;
  withdrawn: number;
  exceptions: number;
  used_before: number | null;
  cap: number;
  by_reason: Record<string, number>;
  ai: ReviewSummary | null;
  /** Motivo del proveedor cuando la IA no pudo revisar (se muestra en el panel, no se esconde). */
  ai_error?: string;
  truncated?: boolean;
  failed_writes?: number;
};

type AutoDeps = { deadline?: number; cap?: number; ai?: typeof runAiReview; /** Inyecciones de la pasada IA (modelo simulado, resolución DNS) para las pruebas. */ aiDeps?: Partial<Parameters<typeof runAiReview>[0]> };

export async function runAutoReview(deps: AutoDeps = {}): Promise<AutoSummary> {
  const cap = Math.max(0, Math.min(deps.cap ?? DAILY_CAP, DAILY_CAP));
  // Cuenta las aprobaciones automáticas de hoy, vengan de las reglas o de la IA: el tope es uno.
  const used = await approvalsToday(['auto-reglas', 'ai-review']);
  const summary: AutoSummary = { checked: 0, approved: 0, withdrawn: 0, exceptions: 0, used_before: used, cap, by_reason: {}, ai: null };
  // Sin saber cuántas se aprobaron hoy no se aprueba ninguna: el tope es una garantía, no una estimación.
  if (used === null) return { ...summary, truncated: true };
  const remaining = cap - used;
  if (remaining <= 0) return summary;

  const now = new Date().toISOString();
  // Solo borradores vivos, por puntuación: si hay más que tope, entran las mejores y el resto espera a mañana.
  const limit = Math.min(remaining + 40, 200);
  const response = await serviceRest(`external_offers?org_id=eq.${ORG}&editorial_status=eq.draft&expires_at=gt.${encodeURIComponent(now)}&select=id,title,description,location,salary,role,score,spain,verified_result,market,market_basis,red_flags,url&order=score.desc&limit=${limit}`);
  const rows = response.ok ? await response.json().catch(() => null) : null;
  if (!Array.isArray(rows)) return { ...summary, truncated: true };

  const approve: string[] = [], withdraw: string[] = [], toAi: string[] = [];
  let rulesHuman = 0;
  for (const row of rows as Array<Row & { id: string }>) {
    if (timeLeft(deps.deadline) < 1_500) { summary.truncated = true; break; }
    summary.checked++;
    const verdict = judgeOffer(row);
    if (verdict.decision === 'approve' && approve.length < remaining) { approve.push(row.id); continue; }
    if (verdict.decision === 'withdraw') { withdraw.push(row.id); continue; }
    if (verdict.ai && toAi.length < MAX_AI_PER_RUN) { toAi.push(row.id); continue; }
    rulesHuman++;
    const key = verdict.decision === 'approve' ? 'tope_diario' : verdict.why;
    summary.by_reason[key] = (summary.by_reason[key] ?? 0) + 1;
  }

  // Una escritura por lote con guarda de estado; se cuenta lo que la base confirma, no lo enviado.
  const apply = async (ids: string[], status: 'approved' | 'withdrawn', why: string) => {
    let done = 0;
    for (let i = 0; i < ids.length; i += 100) {
      const chunk = ids.slice(i, i + 100);
      const n = await decideByRule(chunk, status, { decision: status === 'approved' ? 'approve' : 'withdraw', why, rule: 'reglas_v2', at: now });
      if (n === null) summary.failed_writes = (summary.failed_writes ?? 0) + chunk.length;
      else done += n;
    }
    return done;
  };
  summary.approved = await apply(approve, 'approved', 'cumple_reglas');
  summary.withdrawn = await apply(withdraw, 'withdrawn', 'no_encaja');

  // La IA clasifica lo dudoso que podría mostrarse. Su tope de aprobaciones es el que queda del día;
  // sus retiradas y sus dudas se aplican con la misma guarda y se pueden deshacer.
  const cfg = aiConfig();
  const left = remaining - summary.approved;
  const aiCalls = Math.min(toAi.length, MAX_AI_PER_RUN);
  if (cfg.autoQualify && cfg.enabled && aiCalls > 0 && left > 0 && timeLeft(deps.deadline) > 15_000) {
    summary.ai = await (deps.ai ?? runAiReview)({
      ids: toAi.slice(0, aiCalls), apply: true, humanQueue: true, minScore: 0,
      maxCalls: aiCalls, maxApprovals: left, maxWithdrawals: cfg.maxWithdrawals,
      concurrency: cfg.concurrency, target: cfg.target, deadline: deps.deadline,
      ...deps.aiDeps,
    }).catch(() => null);
  } else if (toAi.length) {
    // Sin hueco, sin presupuesto o sin clave: esas ofertas se quedan en la cola humana, no se aprueban solas.
    summary.by_reason.ia_pendiente = (summary.by_reason.ia_pendiente ?? 0) + toAi.length;
  }

  // Cola humana final: lo que las reglas no pudieron cerrar + lo que la IA declara dudoso + lo que no
  // llegó a revisarse (corte de tiempo o fallo declarado del proveedor).
  let exceptions = rulesHuman;
  const ai = summary.ai;
  if (ai) {
    summary.approved += ai.approved ?? 0;
    summary.withdrawn += ai.withdrawn ?? 0;
    exceptions += ai.human;
    const unreviewed = Math.max(0, aiCalls - ai.reviewed);
    exceptions += unreviewed;
    if (ai.human) summary.by_reason.ia_duda = (summary.by_reason.ia_duda ?? 0) + ai.human;
    if (unreviewed > 0) summary.by_reason.ia_pendiente = (summary.by_reason.ia_pendiente ?? 0) + unreviewed;
    if (ai.skipped) summary.by_reason.ia_sin_proveedor = (summary.by_reason.ia_sin_proveedor ?? 0) + unreviewed;
    if (ai.failed_calls) summary.by_reason.ia_fallos = ai.failed_calls;
    if (ai.error) summary.ai_error = ai.error;
    if (ai.truncated) summary.truncated = true;
    if (ai.failed_writes) summary.failed_writes = (summary.failed_writes ?? 0) + ai.failed_writes;
  }
  summary.exceptions = exceptions;
  return summary;
}
