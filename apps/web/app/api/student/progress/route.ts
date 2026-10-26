import { NextRequest } from 'next/server';
import { withCookies } from '../../../../lib/adminAuth';
import { authenticateStudent } from '../../../../lib/studentAuth';
import { studentByEmail } from '../../../../lib/students';
import { listApplications } from '../../../../lib/applications';
import { periodDays, readActivity, summarize } from '../../../../lib/studentActivity';
import { directReview, idleNudge, sentThisWeek, weeklyGoals } from '../../../../lib/studentRetention';
import { applicationFunnel, masteryByScenario, xpAndLevel } from '../../../../lib/studentMetrics';

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
  // Candidaturas: si no se pueden leer se declara (`applications: null`), no se cuentan como cero. Si la lectura
  // llegó al tope se dice (`applications_truncated`) en vez de presentar cifras y XP cortos como exactos.
  const appPage = await listApplications(auth.student.user_id).catch(() => null);
  const apps = appPage?.rows ?? null;
  const statuses = apps ? apps.map(app => app.status) : null;
  return reply({
    progress: summarize(read.rows, days, new Date(), read.truncated),
    metrics: { xp: xpAndLevel(read.rows, statuses), mastery: masteryByScenario(read.rows), applications: statuses ? applicationFunnel(statuses) : null, applications_truncated: appPage?.truncated ?? null },
    retention: { nudge: idleNudge(read.rows), review: directReview(read.rows), goals: weeklyGoals(read.rows, apps && !appPage?.truncated ? sentThisWeek(apps) : null) },
  });
}
