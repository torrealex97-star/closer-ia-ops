import { NextRequest } from 'next/server';
import { originBlocked, withCookies } from '../../../../lib/adminAuth';
import { authenticateStudent, clearStudentCookies, STUDENT_ACCESS, studentCookies, studentSessionAvailable } from '../../../../lib/studentAuth';
import { normalizeEmail, passwordLogin, signOut } from '../../../../lib/supabaseAuth';
import { linkStudent, studentByEmail } from '../../../../lib/students';
import { recordActivity, touchSession } from '../../../../lib/studentActivity';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
const noStore = { 'Cache-Control': 'no-store' };

export async function GET(request: NextRequest) {
  if (!studentSessionAvailable()) return Response.json({ configured: false, authenticated: false }, { headers: noStore });
  const auth = await authenticateStudent(request);
  // «Está dentro» para el panel: una entrada cada 10 minutos como máximo.
  if (auth.ok) await touchSession(auth.student.id).catch(() => undefined);
  return withCookies(Response.json(auth.ok ? { configured: true, authenticated: true, email: auth.student.email } : { configured: true, authenticated: false }, { headers: noStore }), auth.ok ? auth.setCookies : []);
}

// Login con email y contraseña. Mensaje único ante cualquier fallo de credenciales.
export async function POST(request: NextRequest) {
  if (originBlocked(request)) return Response.json({ detail: 'Origen no permitido' }, { status: 403 });
  if (!studentSessionAvailable()) return Response.json({ detail: 'El acceso de alumnas no está configurado en este despliegue.' }, { status: 503 });
  const body = await request.json().catch(() => ({})) as { email?: unknown; password?: unknown };
  const email = normalizeEmail(body.email), password = typeof body.password === 'string' ? body.password : '';
  const invalid = Response.json({ detail: 'Email o contraseña incorrectos.' }, { status: 401 });
  if (!email || !password || password.length > 200) return invalid;
  const session = await passwordLogin(email, password);
  if (!session) return invalid;
  const row = await studentByEmail(session.user.email);
  if (!row || row.status === 'paused') return Response.json({ detail: 'Tu cuenta no tiene acceso al portal de alumnas.' }, { status: 403 });
  await linkStudent(row, session.user.id).catch(() => undefined);
  await recordActivity(row.id, 'session').catch(() => undefined);
  return withCookies(Response.json({ authenticated: true, email: session.user.email }), studentCookies(session.tokens));
}

export async function DELETE(request: NextRequest) {
  if (originBlocked(request)) return Response.json({ detail: 'Origen no permitido' }, { status: 403 });
  const access = request.cookies.get(STUDENT_ACCESS)?.value;
  if (access) await signOut(access);
  return withCookies(Response.json({ authenticated: false }), clearStudentCookies());
}
