import { NextRequest } from 'next/server';
import { withCookies } from '../../../../lib/adminAuth';
import { authenticateStudent } from '../../../../lib/studentAuth';
import { studentByEmail } from '../../../../lib/students';
import { periodDays, readActivity, summarize } from '../../../../lib/studentActivity';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Progreso de la alumna logueada: ventana de 7/30/90 días + resumen «de siempre» (logros y racha no dependen del periodo).
export async function GET(request: NextRequest) {
  const auth = await authenticateStudent(request);
  if (!auth.ok) return Response.json({ detail: auth.detail }, { status: auth.status });
  const reply = (body: unknown, status = 200) => withCookies(Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } }), auth.setCookies);
  const row = await studentByEmail(auth.student.email);
  if (!row) return reply({ detail: 'Tu cuenta no tiene acceso al portal de alumnas.' }, 403);
  const days = periodDays(request.nextUrl.searchParams.get('days'));
  const read = await readActivity({ studentId: row.id });
  // Sin lectura no se inventan ceros: la vista dice que no se pudo cargar.
  if (!read) return reply({ detail: 'No se pudo cargar tu progreso ahora mismo.' }, 503);
  return reply({ progress: summarize(read.rows, days, new Date(), read.truncated) });
}
