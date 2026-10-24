import { NextRequest } from 'next/server';
import { authenticate, originBlocked, publicBaseUrl, withCookies } from '../../../../lib/adminAuth';
import { inviteStudent, listStudents, removeStudent, setStudentStatus } from '../../../../lib/students';
import { periodDays, readActivity, summarize, type ActivityRow } from '../../../../lib/studentActivity';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Alumnas desde el panel: cualquier operador lista, invita y pausa/reactiva (reversible); solo el propietario da de baja.
async function gate(request: NextRequest, write: boolean, ownerOnly = false) {
  if (write && originBlocked(request)) return { error: Response.json({ detail: 'Origen no permitido' }, { status: 403 }) };
  const auth = await authenticate(request);
  if (!auth.ok) return { error: Response.json({ detail: auth.detail }, { status: auth.status }) };
  if (ownerOnly && auth.admin.role !== 'owner') return { error: Response.json({ detail: 'Solo el propietario puede dar de baja a una alumna.' }, { status: 403 }) };
  return { auth };
}
const reply = (auth: { setCookies: string[] }, body: unknown, status = 200) => withCookies(Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } }), auth.setCookies);

export async function GET(request: NextRequest) {
  const { auth, error } = await gate(request, false);
  if (error) return error;
  const students = await listStudents();
  if (!students) return Response.json({ detail: 'No se pudo leer la lista de alumnas.' }, { status: 503 });
  // La lista de acceso se sirve aunque la actividad no se pueda leer: entonces se declara `activity_available: false`
  // (sin totales, que serían ceros falsos) en vez de tumbar el panel.
  const days = periodDays(request.nextUrl.searchParams.get('days'));
  const now = new Date();
  const read = await readActivity({ sinceIso: new Date(now.getTime() - days * 86_400_000).toISOString() });
  if (!read) return reply(auth!, { students, days, activity_available: false, activity: [], totals: null, truncated: false });
  const byStudent = new Map<string, ActivityRow[]>();
  for (const row of read.rows) if (row.student_id) byStudent.set(row.student_id, [...(byStudent.get(row.student_id) ?? []), row]);
  const activity = students.filter(student => byStudent.has(student.id)).map(student => {
    const summary = summarize(byStudent.get(student.id)!, days, now);
    return { student: { id: student.id, email: student.email, status: student.status }, summary: { sessions: summary.sessions, last_seen: summary.last_seen, practice: summary.practice, training: summary.training, streak: summary.streak } };
  });
  const sevenDaysAgo = now.getTime() - 7 * 86_400_000;
  const entered7 = new Set(read.rows.filter(row => row.kind === 'session' && new Date(row.created_at).getTime() >= sevenDaysAgo).map(row => row.student_id)).size;
  const totals = { entered7, active: activity.length, practices: activity.reduce((n, a) => n + a.summary.practice.count, 0), exams_passed: activity.filter(a => a.summary.training.examPassed).length };
  return reply(auth!, { students, days, activity_available: true, activity, totals, truncated: read.truncated });
}
export async function POST(request: NextRequest) {
  const { auth, error } = await gate(request, true);
  if (error) return error;
  const body = await request.json().catch(() => ({})) as { email?: unknown };
  const out = await inviteStudent(body.email, auth!.admin.email, `${publicBaseUrl(request)}/alumna/reset`);
  return out.ok ? reply(auth!, { ok: true, email_sent: out.emailSent === true }, 201) : Response.json({ detail: out.detail }, { status: out.detail?.includes('no válido') ? 422 : 409 });
}
export async function PATCH(request: NextRequest) {
  const { auth, error } = await gate(request, true);
  if (error) return error;
  const body = await request.json().catch(() => ({})) as { id?: unknown; status?: unknown };
  return typeof body.id === 'string' && typeof body.status === 'string' && await setStudentStatus(body.id, body.status) ? reply(auth!, { ok: true }) : Response.json({ detail: 'Alumna o estado no válidos.' }, { status: 422 });
}
export async function DELETE(request: NextRequest) {
  const { auth, error } = await gate(request, true, true);
  if (error) return error;
  const id = request.nextUrl.searchParams.get('id') ?? '';
  return await removeStudent(id) ? reply(auth!, { ok: true }) : Response.json({ detail: 'No se pudo dar de baja.' }, { status: 503 });
}
