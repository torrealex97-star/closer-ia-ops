import { serviceRest } from './supabaseAuth';
import { isHumanReviewer, ORG } from './external';
// Puerta de salida propuesta de shadow → live (informativa: NO activa nada por sí sola).
export const MIN_PAIRS = 30;
export const MAX_FALSE_APPROVE_RATE = 0.05;

export type AgreementRow = { editorial_status: string; reviewed_by: string | null; ai_review: { would_decide?: string; applied?: boolean } | null };
export type Agreement = {
  proposed: number; deferred: number; pending: number; pairs: number; agree: number;
  false_approve: number; false_withdraw: number; ai_approvals_decided: number;
  agree_rate: number | null; false_approve_rate: number | null;
  verdict: 'insufficient' | 'not_ready' | 'ready'; min_pairs: number; max_false_approve_rate: number;
};

const humanDecision = (r: AgreementRow): 'approve' | 'withdraw' | null => {
  // Cualquier revisor automático (IA, reglas, vigencia, cola de excepciones) queda fuera: no es contraste humano.
  if (!isHumanReviewer(r.reviewed_by)) return null;
  if (r.editorial_status === 'approved' || r.editorial_status === 'published') return 'approve';
  if (r.editorial_status === 'withdrawn') return 'withdraw';
  return null;
};

// Compara lo que la IA habría hecho (sombra) con lo que decidió después una persona. Las decisiones aplicadas por la IA no cuentan:
// no hay contraste humano. Sin pares suficientes no se calcula veredicto de «listo».
export function computeAgreement(rows: AgreementRow[]): Agreement {
  let proposed = 0, deferred = 0, pending = 0, agree = 0, falseApprove = 0, falseWithdraw = 0, aiApprovals = 0;
  for (const r of rows) {
    const ai = r.ai_review;
    if (!ai || ai.applied === true) continue;
    if (ai.would_decide === 'human') { deferred++; continue; }
    if (ai.would_decide !== 'approve' && ai.would_decide !== 'withdraw') continue;
    proposed++;
    const h = humanDecision(r);
    if (!h) { pending++; continue; }
    if (ai.would_decide === 'approve') aiApprovals++;
    if (h === ai.would_decide) agree++;
    else if (ai.would_decide === 'approve') falseApprove++;
    else falseWithdraw++;
  }
  const pairs = agree + falseApprove + falseWithdraw;
  const falseApproveRate = aiApprovals ? falseApprove / aiApprovals : null;
  const verdict = pairs < MIN_PAIRS ? 'insufficient' : (falseApproveRate ?? 0) <= MAX_FALSE_APPROVE_RATE ? 'ready' : 'not_ready';
  const round = (n: number) => Math.round(n * 1000) / 1000;
  return { proposed, deferred, pending, pairs, agree, false_approve: falseApprove, false_withdraw: falseWithdraw, ai_approvals_decided: aiApprovals,
    agree_rate: pairs ? round(agree / pairs) : null, false_approve_rate: falseApproveRate === null ? null : round(falseApproveRate),
    verdict, min_pairs: MIN_PAIRS, max_false_approve_rate: MAX_FALSE_APPROVE_RATE };
}

export async function loadAgreement(): Promise<Agreement | null> {
  const response = await serviceRest(`external_offers?org_id=eq.${ORG}&ai_review->>would_decide=not.is.null&select=editorial_status,reviewed_by,ai_review&limit=5000`);
  if (!response.ok) return null;
  const rows = await response.json().catch(() => null);
  return Array.isArray(rows) ? computeAgreement(rows) : null;
}
