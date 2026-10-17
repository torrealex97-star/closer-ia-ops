import { NextRequest } from 'next/server';
import { authenticate, withCookies } from '../../../../lib/adminAuth';
import { loadAgreement } from '../../../../lib/aiAgreement';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const auth = await authenticate(request);
  if (!auth.ok) return Response.json({ detail: auth.detail }, { status: auth.status });
  const agreement = await loadAgreement();
  if (!agreement) return Response.json({ detail: 'No se pudo calcular el acuerdo IA/humano.' }, { status: 503 });
  return withCookies(Response.json(agreement, { headers: { 'Cache-Control': 'no-store' } }), auth.setCookies);
}
