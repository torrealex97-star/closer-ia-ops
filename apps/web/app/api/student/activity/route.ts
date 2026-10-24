import { NextRequest } from 'next/server';
import { originBlocked, withCookies } from '../../../../lib/adminAuth';
import { authenticateStudent } from '../../../../lib/studentAuth';
import { studentByEmail } from '../../../../lib/students';
import { allowWrite, checkActivity, recordActivity } from '../../../../lib/studentActivity';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Registra una revisión de formación, el examen de egreso o una práctica de la alumna logueada.
// La alumna sale SIEMPRE de la sesión; la nota del examen la calcula el servidor (no se fía del `score` del navegador).
export async function POST(request: NextRequest) {
  if (originBlocked(request)) return Response.json({ detail: 'Origen no permitido' }, { status: 403 });
  const auth = await authenticateStudent(request);
  if (!auth.ok) return Response.json({ detail: auth.detail }, { status: auth.status });
  const reply = (body: unknown, status: number) => withCookies(Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } }), auth.setCookies);
  const checked = checkActivity(await request.json().catch(() => null));
  if (!checked.ok) return reply({ detail: checked.detail }, 422);
  const row = await studentByEmail(auth.student.email);
  if (!row) return reply({ detail: 'Tu cuenta no tiene acceso al portal de alumnas.' }, 403);
  if (!allowWrite(row.id)) return reply({ detail: 'Demasiados registros seguidos. Espera unos minutos.' }, 429);
  if (!await recordActivity(row.id, checked.value)) return reply({ detail: 'No se pudo guardar tu actividad ahora mismo.' }, 503);
  return reply({ ok: true, score: checked.value.score, passed: checked.passed }, 201);
}
