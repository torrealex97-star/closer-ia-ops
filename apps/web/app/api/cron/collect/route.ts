import { NextRequest } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { collectAll } from '../../../../lib/collectors';
import { dailyApify } from '../../../../lib/apify';
import { publicBaseUrl } from '../../../../lib/adminAuth';
import { runAiReview, weeklyAiReport } from '../../../../lib/aiReview';
import { loadMetrics } from '../../../../lib/metrics';
import { skipPaidTier } from '../../../../lib/sourceTiers';
import { refreshVigencia } from '../../../../lib/external';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

// Vercel Cron llama aquí con `Authorization: Bearer $CRON_SECRET`. Recoge las APIs oficiales que tengan clave guardada.
export async function GET(request: NextRequest) {
  const expected = process.env.CRON_SECRET ?? '';
  const given = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  const a = Buffer.from(given), b = Buffer.from(expected);
  if (expected.length < 16 || a.length !== b.length || !timingSafeEqual(a, b)) return Response.json({ detail: 'No autorizado.' }, { status: 401 });
  const outcomes = await collectAll('cron');
  const vigencia = await refreshVigencia().catch(() => ({ checked: 0, withdrawn: 0 }));
  // Actores de Apify marcados como diarios (si hay presupuesto) y recogida de lo que haya terminado.
  // Nivel de pago opt-in: con APIFY_SKIP_IF_GOOD_PER_DAY, si las fuentes gratuitas ya cubren el objetivo no se lanza gasto nuevo
  // (lo ya lanzado sí se recoge). Sin esa variable, comportamiento de siempre.
  const paid = skipPaidTier(await loadMetrics().catch(() => null));
  const apify = await dailyApify(publicBaseUrl(request), { start: !paid.skip }).catch(() => ({ started: [], harvested: [] }));
  // Revisor IA dentro del mismo cron (sin crons nuevos): shadow salvo AI_REVIEW_MODE=live. Un fallo no tumba el resto.
  const aiReview = await runAiReview().catch(() => ({ skipped: 'error' }));
  const report = new Date().getUTCDay() === 1 ? await weeklyAiReport().catch(() => false) : null;
  return Response.json({ outcomes, vigencia, apify, paidTierSkipped: paid.skip ? paid.reason : null, aiReview, weeklyReport: report });
}
