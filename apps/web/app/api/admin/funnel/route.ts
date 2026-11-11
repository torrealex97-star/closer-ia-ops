import { NextRequest } from 'next/server';
import { authenticate, withCookies } from '../../../../lib/adminAuth';
import { loadFunnel } from '../../../../lib/funnel';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const auth = await authenticate(request);
  if (!auth.ok) return Response.json({ detail: auth.detail }, { status: auth.status });
  const funnel = await loadFunnel();
  if (!funnel) return Response.json({ detail: 'No se pudo calcular el embudo.' }, { status: 503 });
  return withCookies(Response.json(funnel, { headers: { 'Cache-Control': 'no-store' } }), auth.setCookies);
}
