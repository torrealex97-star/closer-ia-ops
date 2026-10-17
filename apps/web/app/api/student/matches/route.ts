import { NextRequest } from 'next/server';
import { withCookies } from '../../../../lib/adminAuth';
import { authenticateStudent } from '../../../../lib/studentAuth';
import { recommendForStudent } from '../../../../lib/matching';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Ofertas recomendadas para la alumna logueada (solo lectura; nada se envía ni se guarda). El user_id sale de la sesión.
export async function GET(request: NextRequest) {
  const auth = await authenticateStudent(request);
  if (!auth.ok) return Response.json({ detail: auth.detail }, { status: auth.status });
  return withCookies(Response.json(await recommendForStudent(auth.student.user_id), { headers: { 'Cache-Control': 'no-store' } }), auth.setCookies);
}
