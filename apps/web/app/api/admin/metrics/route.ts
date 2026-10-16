import { NextRequest } from 'next/server';
import { authenticate, withCookies } from '../../../../lib/adminAuth';
import { loadMetrics } from '../../../../lib/metrics';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const auth = await authenticate(request);
  if (!auth.ok) return Response.json({ detail: auth.detail }, { status: auth.status });
  const metrics = await loadMetrics();
  if (!metrics) return Response.json({ detail: 'No se pudieron calcular las métricas.' }, { status: 503 });
  return withCookies(Response.json(metrics, { headers: { 'Cache-Control': 'no-store' } }), auth.setCookies);
}
