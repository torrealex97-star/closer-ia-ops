import { NextRequest } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { collectAll } from '../../../../lib/collectors';
import { collectFallback } from '../../../../lib/serpapiFallback';
import { collectGoogleJobs } from '../../../../lib/googleJobs';
import { dailyAuto as dailyApify } from '../../../../lib/apifyAuto';
import { publicBaseUrl } from '../../../../lib/adminAuth';
import { weeklyAiReport } from '../../../../lib/aiReview';
import { runAutoReview } from '../../../../lib/autoReview';
import { activateEngine } from '../../../../lib/engineActivate';
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
  const outcomes = await collectAll('cron', undefined, budget.deadline(10_000)).catch(() => []);
  if (outcomes.some(o => o.truncated)) budget.cut('apis');
  // Google Jobs (SerpApi, clave ya conectada): dorks de closer/ES y LatAm. Entra después de las APIs
  // oficiales porque cuesta por búsqueda; si no hay tiempo se corta y se declara, sin tocar los demás pasos.
  const googleJobs = budget.remaining() >= MIN_STEP_MS
    ? await collectGoogleJobs('cron', budget.deadline(6_500)).catch(() => ({ source: 'google-jobs' as const, ok: false, error: 'fallo inesperado' }))
    : (budget.cut('googleJobs'), { source: 'google-jobs' as const, ok: false, error: 'sin tiempo en el presupuesto del cron' });
  if ('truncated' in googleJobs && googleJobs.truncated) budget.cut('googleJobs');
  // Respaldo de cobertura: los portales que NO tienen API oficial conectada (sin clave, clave rechazada
  // o fallo) se buscan en Google acotados a ese portal con SerpApi. Acotado por
  // `SERPAPI_FALLBACK_MAX_SEARCHES` y por el objetivo diario; cada búsqueda declara su coste. Una
  // fuente pausada a propósito no cuenta como ausente y no se paga su respaldo.
  const missingApis = outcomes.filter(o => !o.ok && o.error !== 'Fuente pausada').map(o => o.provider);
  const fallback = budget.remaining() >= MIN_STEP_MS
    ? await collectFallback('cron', { deadline: budget.deadline(5_000), missing: missingApis }).catch(() => null)
    : (budget.cut('fallback'), null);
  if (fallback?.truncated) budget.cut('fallback');
  // Nivel de pago opt-in: con APIFY_SKIP_IF_GOOD_PER_DAY, si las fuentes gratuitas ya cubren el objetivo no se lanza gasto nuevo
  // (lo ya lanzado sí se recoge). Sin esa variable, comportamiento de siempre.
  const paid = budget.remaining() >= MIN_STEP_MS ? skipPaidTier(await loadMetrics().catch(() => null)) : { skip: true as const };
  const apify = await dailyApify(publicBaseUrl(request), { start: !paid.skip, deadline: budget.deadline(9_000) }).catch(() => ({ started: [], harvested: [], truncated: false } as Awaited<ReturnType<typeof dailyApify>>));
  if ('truncated' in apify && apify.truncated) budget.cut('apify');
  const vigencia = budget.remaining() >= MIN_STEP_MS ? await refreshVigencia(20, budget.deadline(5_000)).catch(() => ({ checked: 0, withdrawn: 0 })) : (budget.cut('vigencia'), { checked: 0, withdrawn: 0 });
  if ('truncated' in vigencia && vigencia.truncated) budget.cut('vigencia');
  // Cualificación automática al final: primero aprueba por reglas lo que cumple hechos comprobables y,
  // si queda hueco de tope y la IA está en vivo, le pasa solo las dudosas. Un fallo no tumba el resto.
  const auto = budget.remaining() >= MIN_STEP_MS
    ? await runAutoReview({ deadline: budget.end }).catch(() => ({ checked: 0, approved: 0, exceptions: 0, used_before: null, cap: 0, by_reason: {}, ai: null, truncated: true }))
    : (budget.cut('auto'), { checked: 0, approved: 0, exceptions: 0, used_before: null, cap: 0, by_reason: {}, ai: null, truncated: true });
  if (auto.truncated) budget.cut('auto');
  // Catálogo del motor: misma idea que en las fuentes externas pero sobre el pool del engine
  // (los borradores que ve la alumna). Clasifica, publica lo verificado abierto y retira lo que
  // no es un puesto comercial; solo las excepciones quedan para una persona. Se corta cuando el
  // presupuesto manda y la siguiente ejecución continúa desde donde quedó.
  const engine = budget.remaining() >= MIN_STEP_MS
    ? await activateEngine({ passes: 1, deadline: budget.deadline(12_000) }).catch(() => null)
    : (budget.cut('engine'), null);
  if (engine?.truncated) budget.cut('engine');
  const report = new Date().getUTCDay() === 1 && budget.remaining() >= MIN_STEP_MS ? await weeklyAiReport().catch(() => false) : null;
  return Response.json({ outcomes, fallback, googleJobs, vigencia, apify, auto, aiReview: auto.ai, engine, weeklyReport: report, paidTierSkipped: paid.skip ? ('reason' in paid ? paid.reason : 'sin tiempo') : null, truncated: budget.truncated, spent_ms: budget.spent() });
}
