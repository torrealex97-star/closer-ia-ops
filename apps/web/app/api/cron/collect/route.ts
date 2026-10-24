import { NextRequest } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { collectAll } from '../../../../lib/collectors';
import { collectGoogleJobs } from '../../../../lib/googleJobs';
import { dailyAuto as dailyApify } from '../../../../lib/apifyAuto';
import { publicBaseUrl } from '../../../../lib/adminAuth';
import { weeklyAiReport } from '../../../../lib/aiReview';
import { runAutoReview } from '../../../../lib/autoReview';
import { loadMetrics } from '../../../../lib/metrics';
import { skipPaidTier } from '../../../../lib/sourceTiers';
import { refreshVigencia } from '../../../../lib/external';
import { createBudget, MIN_STEP_MS, totalFromEnv } from '../../../../lib/cronBudget';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

// Vercel Cron llama aquí con `Authorization: Bearer $CRON_SECRET`. Recoge las APIs oficiales que tengan clave guardada.
export async function GET(request: NextRequest) {
  const expected = process.env.CRON_SECRET ?? '';
  const given = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  const a = Buffer.from(given), b = Buffer.from(expected);
  if (expected.length < 16 || a.length !== b.length || !timingSafeEqual(a, b)) return Response.json({ detail: 'No autorizado.' }, { status: 401 });
  // Un solo reloj para todo el cron (40 s de 60): cada paso recibe su fin, comprueba el reloj antes de cada llamada externa y, si se
  // queda sin tiempo, se corta y lo DECLARA (`truncated`). Todo es idempotente: la siguiente ejecución continúa. Orden por prioridad:
  // datos nuevos (APIs oficiales → Google Jobs, que cuesta por búsqueda) → lo ya pagado en Apify →
  // vigencia (las más antiguas primero) → revisor IA (shadow).
  const budget = createBudget(totalFromEnv());
  const outcomes = await collectAll('cron', undefined, budget.deadline(12_000)).catch(() => []);
  if (outcomes.some(o => o.truncated)) budget.cut('apis');
  // Google Jobs (SerpApi, clave ya conectada): 3 dorks de closer/ES al día. Entra después de las APIs
  // oficiales porque cuesta por búsqueda; si no hay tiempo se corta y se declara, sin tocar los demás pasos.
  const googleJobs = budget.remaining() >= MIN_STEP_MS
    ? await collectGoogleJobs('cron', budget.deadline(7_000)).catch(() => ({ source: 'google-jobs' as const, ok: false, error: 'fallo inesperado' }))
    : (budget.cut('googleJobs'), { source: 'google-jobs' as const, ok: false, error: 'sin tiempo en el presupuesto del cron' });
  if ('truncated' in googleJobs && googleJobs.truncated) budget.cut('googleJobs');
  // Nivel de pago opt-in: con APIFY_SKIP_IF_GOOD_PER_DAY, si las fuentes gratuitas ya cubren el objetivo no se lanza gasto nuevo
  // (lo ya lanzado sí se recoge). Sin esa variable, comportamiento de siempre.
  const paid = budget.remaining() >= MIN_STEP_MS ? skipPaidTier(await loadMetrics().catch(() => null)) : { skip: true as const };
  const apify = await dailyApify(publicBaseUrl(request), { start: !paid.skip, deadline: budget.deadline(11_000) }).catch(() => ({ started: [], harvested: [], truncated: false } as Awaited<ReturnType<typeof dailyApify>>));
  if ('truncated' in apify && apify.truncated) budget.cut('apify');
  const vigencia = budget.remaining() >= MIN_STEP_MS ? await refreshVigencia(20, budget.deadline(6_000)).catch(() => ({ checked: 0, withdrawn: 0 })) : (budget.cut('vigencia'), { checked: 0, withdrawn: 0 });
  if ('truncated' in vigencia && vigencia.truncated) budget.cut('vigencia');
  // Cualificación automática al final: primero aprueba por reglas lo que cumple hechos comprobables y,
  // si queda hueco de tope y la IA está en vivo, le pasa solo las dudosas. Un fallo no tumba el resto.
  const auto = budget.remaining() >= MIN_STEP_MS
    ? await runAutoReview({ deadline: budget.end }).catch(() => ({ checked: 0, approved: 0, exceptions: 0, used_before: null, cap: 0, by_reason: {}, ai: null, truncated: true }))
    : (budget.cut('auto'), { checked: 0, approved: 0, exceptions: 0, used_before: null, cap: 0, by_reason: {}, ai: null, truncated: true });
  if (auto.truncated) budget.cut('auto');
  const report = new Date().getUTCDay() === 1 && budget.remaining() >= MIN_STEP_MS ? await weeklyAiReport().catch(() => false) : null;
  return Response.json({ outcomes, googleJobs, vigencia, apify, auto, aiReview: auto.ai, weeklyReport: report, paidTierSkipped: paid.skip ? ('reason' in paid ? paid.reason : 'sin tiempo') : null, truncated: budget.truncated, spent_ms: budget.spent() });
}
