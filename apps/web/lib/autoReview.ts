import { ORG, approvalsToday, approveByRule, type ExternalOffer } from './external';
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

export type RuleVerdict = { decision: 'approve' | 'human'; why: string; market: Market | null; basis: string };
type Row = Pick<ExternalOffer, 'title' | 'description' | 'location' | 'salary' | 'role' | 'score' | 'spain' | 'verified_result' | 'market' | 'market_basis'> & { red_flags?: string[] | null };

/** La decisión determinista, sin red. Se exporta para poder probarla caso por caso. */
export function judgeOffer(row: Row): RuleVerdict {
  const computed = marketFor(row);
  const market = (row.market as Market | null | undefined) ?? computed.market;
  const basis = row.market_basis ?? computed.basis;
  const human = (why: string): RuleVerdict => ({ decision: 'human', why, market, basis });
  if (!row.role) return human('sin_perfil');
  if (row.verified_result === 'closed') return human('enlace_cerrado');
  if (!market) return human('sin_mercado');
  if (row.spain === false && market === 'ES') return human('mercado_dudoso');
  if ((row.red_flags ?? []).length) return human('banderas_rojas');
  // Texto del anuncio con señales de estafa o condiciones dudosas: nunca entra sola, la revisa una persona.
  const risk = assessOffer(row);
  if (risk.risk_level !== 'SAFE') return human(risk.risk_level === 'BLOCKED' ? 'oferta_peligrosa' : 'oferta_con_avisos');
  if ((row.score ?? 0) < MIN_SCORE) return human('score_bajo');
  const words = spanishWords(`${row.title ?? ''} ${row.description ?? ''}`);
  if (words < 3) return human('idioma_dudoso');
  return { decision: 'approve', why: 'cumple_reglas', market, basis };
}

export type AutoSummary = {
  checked: number;
  approved: number;
  exceptions: number;
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
  const summary: AutoSummary = { checked: 0, approved: 0, exceptions: 0, used_before: used, cap, by_reason: {}, ai: null };
  // Sin saber cuántas se aprobaron hoy no se aprueba ninguna: el tope es una garantía, no una estimación.
  if (used === null) return { ...summary, truncated: true };
  const remaining = cap - used;
  if (remaining <= 0) return summary;

  const now = new Date().toISOString();
  // Solo borradores vivos, por puntuación: si hay más que tope, entran las mejores y el resto espera a mañana.
  const limit = Math.min(remaining + 20, 120);
  const response = await serviceRest(`external_offers?org_id=eq.${ORG}&editorial_status=eq.draft&expires_at=gt.${encodeURIComponent(now)}&select=id,title,description,location,salary,role,score,spain,verified_result,market,market_basis,red_flags&order=score.desc&limit=${limit}`);
  const rows = response.ok ? await response.json().catch(() => null) : null;
  if (!Array.isArray(rows)) return { ...summary, truncated: true };

  const clear: string[] = [];
  for (const row of rows as Array<Row & { id: string }>) {
    if (timeLeft(deps.deadline) < 1_500) { summary.truncated = true; break; }
    summary.checked++;
    const verdict = judgeOffer(row);
    if (verdict.decision === 'approve' && clear.length + summary.approved < remaining) { clear.push(row.id); continue; }
    summary.exceptions++;
    const key = verdict.decision === 'approve' ? 'tope_diario' : verdict.why;
    summary.by_reason[key] = (summary.by_reason[key] ?? 0) + 1;
  }

  // Una sola escritura con guarda de estado; se cuenta lo que la base confirma.
  for (let i = 0; i < clear.length; i += 100) {
    const n = await approveByRule(clear.slice(i, i + 100), { decision: 'approve', why: 'cumple_reglas', rule: 'reglas_v1', at: now });
    if (n === null) summary.failed_writes = (summary.failed_writes ?? 0) + Math.min(100, clear.length - i);
    else summary.approved += n;
  }

  // Desempate: solo si hay hueco, la IA está en vivo y queda presupuesto. Sus aprobaciones también
  // cuentan contra el mismo tope diario (se limita la variable que lee su puerta y se restaura).
  const cfg = aiConfig();
  const left = remaining - summary.approved;
  if (cfg.mode === 'live' && left > 0 && timeLeft(deps.deadline) > 25_000) {
    const previous = process.env.AI_REVIEW_MAX_APPROVALS;
    process.env.AI_REVIEW_MAX_APPROVALS = String(Math.min(left, cfg.maxApprovals));
    try { summary.ai = await (deps.ai ?? runAiReview)({ deadline: deps.deadline }).catch(() => null); }
    finally {
      if (previous === undefined) delete process.env.AI_REVIEW_MAX_APPROVALS;
      else process.env.AI_REVIEW_MAX_APPROVALS = previous;
    }
  } else if (cfg.mode === 'shadow') {
    summary.ai = { mode: 'shadow', reviewed: 0, would_approve: 0, would_withdraw: 0, human: summary.exceptions, applied: 0, skipped: 'reglas en vivo; la IA solo anota (AI_REVIEW_MODE=shadow)' };
  }
  return summary;
}
