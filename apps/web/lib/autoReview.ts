import { ORG, approvalsToday, approveByRule, markForReview, withdrawByRule, type ExternalOffer } from './external';
import { marketFor, type Market } from './market';
import { spanishWords } from './offerScore';
import { assessOffer } from './offerRisk';
import { serviceRest } from './supabaseAuth';
import { timeLeft } from './cronBudget';
import { config as aiConfig, runAiReview, type ReviewSummary } from './aiReview';

// Cualificación automática: las REGLAS deciden lo claro y la IA solo desempata lo dudoso.
// Antes, cada oferta esperaba a una persona; con el volumen actual eso dejaba la cola sin vaciar y
// las alumnas veían poco. Ahora entra sola la que cumple hechos comprobables (perfil, mercado,
// idioma español, puntuación suficiente, sin banderas rojas y enlace no cerrado). Lo que no cumple
// todo eso NO se aprueba «por si acaso»: queda en la cola de excepciones, que es lo que el
// propietario quiere revisar a mano.
// Tope diario: una regla mal ajustada no puede publicar miles de ofertas de golpe.
export const DAILY_CAP = 100;
export const MIN_SCORE = 55;

export type RuleVerdict = { decision: 'approve' | 'human' | 'withdraw'; why: string; market: Market | null; basis: string };
type Row = Pick<ExternalOffer, 'title' | 'company' | 'description' | 'location' | 'salary' | 'role' | 'score' | 'spain' | 'verified_result' | 'market' | 'market_basis' | 'url'> & { red_flags?: string[] | null };

// Páginas de resultados de un portal, no anuncios: «Ofertas de trabajo de Closer de ventas» con 737
// resultados, sin empresa y con la URL del listado. Aprobarlas mandaría a la alumna a un buscador, y
// dejarlas en la cola humana le pediría a una persona que cierre lo que ni siquiera es una oferta.
const INDEX_TITLE = /^\s*(?:ofertas? de (?:trabajo|empleo)|empleos? (?:de|en)|trabajos? (?:de|en)|bolsa de empleo|vacantes? (?:de|en)|job (?:openings|listings)|jobs? in|search results)\b/i;
// Solo el PLURAL: los portales usan el plural para el listado y el singular para la ficha de una oferta
// concreta. En producción, `/oferta-empleo/69/<hash>` es una oferta de Jobijoba y `/empleo/23-14660_…` una de
// Univision: con `s?` la regla las retiraba como si fueran listados (y una de ellas la había aprobado una
// persona a mano).
const INDEX_URL = /\/(?:ofertas-trabajo|ofertas-empleo|empleos|jobs?\/search|jobsearch|search\/jobs|vacantes)\b/i;
const isIndexPage = (row: Retirable) => (!row.company && INDEX_TITLE.test(row.title ?? '')) || INDEX_URL.test(row.url ?? '');

// Campos que bastan para decidir una retirada (sin leer la descripción). La auditoría del catálogo usa
// exactamente este tipo, así que no puede quedarse corta de datos sin que el compilador lo diga.
type Retirable = Pick<Row, 'title' | 'company' | 'url' | 'verified_result'>;

/**
 * Lo que las reglas retiran sin mirar nada más: una página de resultados de un portal o un enlace ya cerrado.
 * Se aísla para que la auditoría del catálogo (ofertas YA aprobadas) use el mismo criterio y no una copia que
 * se desincronice: una regla equivocada se vería en la auditoría antes de borrar nada.
 */
export function withdrawalReason(row: Retirable): string | null {
  if (isIndexPage(row)) return 'no_es_oferta';
  if (row.verified_result === 'closed') return 'enlace_cerrado';
  return null;
}

// Código de estado de EE. UU. al final de la ubicación («Miramar, FL», «El Paso, TX 79901»). El gazetteer
// español contiene Miramar y El Paso (municipios reales), así que una oferta de Florida se colaba como
// española y acababa delante de alumnas de España. En la revisión manda el dato literal del anuncio.
const US_STATE = /,\s*(?:AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC)\s*(?:\d{5}(?:-\d{4})?)?\s*$/i;

/** La decisión determinista, sin red. Se exporta para poder probarla caso por caso. */
export function judgeOffer(row: Row): RuleVerdict {
  const computed = marketFor(row);
  const us = US_STATE.test(row.location ?? '');
  const market: Market | null = us ? 'US_LATINO' : (row.market as Market | null | undefined) ?? computed.market;
  const basis = us ? 'ubicacion_estados_unidos' : row.market_basis ?? computed.basis;
  const verdict = (decision: RuleVerdict['decision'], why: string): RuleVerdict => ({ decision, why, market, basis });
  const retire = withdrawalReason(row);
  if (retire) return verdict('withdraw', retire);
  if (!row.role) return verdict('human', 'sin_perfil');
  if (!market) return verdict('human', 'sin_mercado');
  if (row.spain === false && market === 'ES') return verdict('human', 'mercado_dudoso');
  if ((row.red_flags ?? []).length) return verdict('human', 'banderas_rojas');
  // Texto del anuncio con señales de estafa o condiciones dudosas: nunca entra sola, la revisa una persona.
  const risk = assessOffer(row);
  if (risk.risk_level !== 'SAFE') return verdict('human', risk.risk_level === 'BLOCKED' ? 'oferta_peligrosa' : 'oferta_con_avisos');
  if ((row.score ?? 0) < MIN_SCORE) return verdict('human', 'score_bajo');
  const words = spanishWords(`${row.title ?? ''} ${row.description ?? ''}`);
  if (words < 3) return verdict('human', 'idioma_dudoso');
  return verdict('approve', 'cumple_reglas');
}

export type AutoSummary = {
  checked: number;
  approved: number;
  /** Retiradas por no ser un anuncio (listado de portal) o porque el enlace está cerrado. */
  withdrawn: number;
  exceptions: number;
  /** Filas que la base confirma movidas a la cola humana (no lo que se intentó). */
  moved?: number;
  used_before: number | null;
  cap: number;
  by_reason: Record<string, number>;
  ai: ReviewSummary | null;
  truncated?: boolean;
  failed_writes?: number;
};

type AutoDeps = { deadline?: number; cap?: number; ai?: typeof runAiReview };

export async function runAutoReview(deps: AutoDeps = {}): Promise<AutoSummary> {
  const cap = Math.max(0, Math.min(deps.cap ?? DAILY_CAP, DAILY_CAP));
  const used = await approvalsToday();
  const summary: AutoSummary = { checked: 0, approved: 0, withdrawn: 0, exceptions: 0, used_before: used, cap, by_reason: {}, ai: null };
  // Sin saber cuántas se aprobaron hoy no se aprueba ninguna: el tope es una garantía, no una estimación.
  if (used === null) return { ...summary, truncated: true };
  const remaining = cap - used;
  if (remaining <= 0) return summary;

  const now = new Date().toISOString();
  // Solo borradores vivos, por puntuación: si hay más que tope, entran las mejores y el resto espera a mañana.
  const limit = Math.min(remaining + 20, 120);
  const response = await serviceRest(`external_offers?org_id=eq.${ORG}&editorial_status=eq.draft&expires_at=gt.${encodeURIComponent(now)}&select=id,title,company,description,location,salary,role,score,spain,verified_result,market,market_basis,red_flags,url&order=score.desc&limit=${limit}`);
  const rows = response.ok ? await response.json().catch(() => null) : null;
  if (!Array.isArray(rows)) return { ...summary, truncated: true };

  const clear: string[] = [];
  // Lo que las reglas no cierran se agrupa por motivo: una escritura por motivo, no una por oferta.
  const human = new Map<string, string[]>();
  const retired = new Map<string, string[]>();
  for (const row of rows as Array<Row & { id: string }>) {
    if (timeLeft(deps.deadline) < 1_500) { summary.truncated = true; break; }
    summary.checked++;
    const verdict = judgeOffer(row);
    if (verdict.decision === 'approve') {
      if (clear.length + summary.approved < remaining) { clear.push(row.id); continue; }
      // Cumple las reglas pero no cabe en el tope de hoy: se queda en borrador para mañana;
      // mandarla a la cola humana sería pedirle a una persona trabajo que la máquina ya sabe hacer.
      summary.exceptions++;
      summary.by_reason.tope_diario = (summary.by_reason.tope_diario ?? 0) + 1;
      continue;
    }
    summary.by_reason[verdict.why] = (summary.by_reason[verdict.why] ?? 0) + 1;
    // Ni es un anuncio ni se puede mostrar: se retira. No gasta cupo de aprobaciones y no ocupa la cola
    // humana con algo que una persona no puede arreglar.
    if (verdict.decision === 'withdraw') {
      const out = retired.get(verdict.why) ?? [];
      out.push(row.id); retired.set(verdict.why, out);
      continue;
    }
    summary.exceptions++;
    const bucket = human.get(verdict.why) ?? [];
    bucket.push(row.id); human.set(verdict.why, bucket);
  }

  // Una sola escritura con guarda de estado; se cuenta lo que la base confirma.
  for (let i = 0; i < clear.length; i += 100) {
    const n = await approveByRule(clear.slice(i, i + 100), { decision: 'approve', why: 'cumple_reglas', rule: 'reglas_v1', at: now });
    if (n === null) summary.failed_writes = (summary.failed_writes ?? 0) + Math.min(100, clear.length - i);
    else summary.approved += n;
  }

  // Retiradas: misma guarda de estado (solo borradores) y se cuenta lo que confirma la base.
  for (const [reason, ids] of retired) {
    for (let i = 0; i < ids.length; i += 100) {
      const batch = ids.slice(i, i + 100);
      const n = await withdrawByRule(batch, { decision: 'withdraw', why: reason, rule: 'reglas_v1', at: now });
      if (n === null) summary.failed_writes = (summary.failed_writes ?? 0) + batch.length;
      else summary.withdrawn += n;
    }
  }

  // La cola de excepciones se llena de verdad: hasta ahora solo se contaba y cada pasada dejaba todo
  // en borradores, así que el panel mostraba «0 a revisar» con miles esperando a una persona.
  for (const [reason, ids] of human) {
    for (let i = 0; i < ids.length; i += 100) {
      const batch = ids.slice(i, i + 100);
      const n = await markForReview(batch, { decision: 'human', why: reason, rule: 'reglas_v1', at: now });
      if (n === null) summary.failed_writes = (summary.failed_writes ?? 0) + batch.length;
      else summary.moved = (summary.moved ?? 0) + n;
    }
  }

  // Desempate: solo si hay hueco, la IA está en vivo y queda presupuesto. Su cupo es lo que queda del tope
  // diario —`remaining` ya cuenta sus aprobaciones de hoy, no solo las de las reglas— y viaja como ENTORNO
  // EXPLÍCITO de esta llamada: antes se escribía en `process.env` y se restauraba, así que dos pasadas
  // simultáneas se pisaban el límite entre sí (y el proceso quedaba con el valor de la otra).
  const cfg = aiConfig();
  const left = remaining - summary.approved;
  if (cfg.mode === 'live' && left > 0 && timeLeft(deps.deadline) > 25_000) {
    const env = { ...process.env, AI_REVIEW_MAX_APPROVALS: String(Math.min(left, cfg.maxApprovals)) };
    summary.ai = await (deps.ai ?? runAiReview)({ deadline: deps.deadline, env }).catch(() => null);
  } else if (cfg.mode === 'shadow') {
    summary.ai = { mode: 'shadow', reviewed: 0, would_approve: 0, would_withdraw: 0, human: summary.exceptions, applied: 0, skipped: 'reglas en vivo; la IA solo anota (AI_REVIEW_MODE=shadow)' };
  }
  return summary;
}
