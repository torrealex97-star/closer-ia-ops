import { NextRequest } from 'next/server';
import { ACCESS_COOKIE, authenticate, clearCookies, originBlocked, sessionAvailable, sessionCookies, withCookies } from '../../../../lib/adminAuth';
import { adminRole, normalizeEmail, passwordLogin, signOut } from '../../../../lib/supabaseAuth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const noStore = { 'Cache-Control': 'no-store' };

export async function GET(request: NextRequest) {
  if (!sessionAvailable()) return Response.json({ configured: false, authenticated: false }, { headers: noStore });
  const auth = await authenticate(request);
  const body = auth.ok ? { configured: true, authenticated: true, email: auth.admin.email, role: auth.admin.role } : { configured: true, authenticated: false };
  return withCookies(Response.json(body, { headers: noStore }), auth.ok ? auth.setCookies : []);
}

// Login con email y contraseña (Supabase Auth). Mensaje único ante cualquier fallo de credenciales.
export async function POST(request: NextRequest) {
  if (originBlocked(request)) return Response.json({ detail: 'Origen no permitido' }, { status: 403 });
  if (!sessionAvailable()) return Response.json({ detail: 'El acceso al panel no está configurado en este despliegue.' }, { status: 503 });
  const body = await request.json().catch(() => ({})) as { email?: unknown; password?: unknown };
  const email = normalizeEmail(body.email);
  const password = typeof body.password === 'string' ? body.password : '';
  const invalid = Response.json({ detail: 'Email o contraseña incorrectos.' }, { status: 401 });
  if (!email || !password || password.length > 200) return invalid;
  const session = await passwordLogin(email, password);
  if (!session) return invalid;
  const role = await adminRole(session.user.email);
  if (!role) return Response.json({ detail: 'Tu usuario no está autorizado para este panel.' }, { status: 403 });
  return withCookies(Response.json({ authenticated: true, email: session.user.email, role }), sessionCookies(session.tokens));
}

export async function DELETE(request: NextRequest) {
  if (originBlocked(request)) return Response.json({ detail: 'Origen no permitido' }, { status: 403 });
  const access = request.cookies.get(ACCESS_COOKIE)?.value;
  if (access) await signOut(access);
  return withCookies(Response.json({ authenticated: false }), clearCookies());
}
