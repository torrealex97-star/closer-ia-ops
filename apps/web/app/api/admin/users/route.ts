import { NextRequest } from 'next/server';
import { authenticate, originBlocked, publicBaseUrl, withCookies } from '../../../../lib/adminAuth';
import { inviteAdmin, listAdmins, normalizeEmail, removeAdmin, type AdminRole } from '../../../../lib/supabaseAuth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Gestión de operadores: cualquiera con acceso ve la lista; solo el propietario invita o da de baja.
async function gate(request: NextRequest, ownerOnly: boolean) {
  if (originBlocked(request)) return { error: Response.json({ detail: 'Origen no permitido' }, { status: 403 }) };
  const auth = await authenticate(request);
  if (!auth.ok) return { error: Response.json({ detail: auth.detail }, { status: auth.status }) };
  if (ownerOnly && auth.admin.role !== 'owner') return { error: Response.json({ detail: 'Solo el propietario puede gestionar usuarios.' }, { status: 403 }) };
  return { auth };
}

export async function GET(request: NextRequest) {
  const { auth, error } = await gate(request, false);
  if (error) return error;
  const users = await listAdmins();
  if (!users) return Response.json({ detail: 'No se pudo leer la lista de usuarios.' }, { status: 503 });
  return withCookies(Response.json({ users, me: auth!.admin }, { headers: { 'Cache-Control': 'no-store' } }), auth!.setCookies);
}

export async function POST(request: NextRequest) {
  const { auth, error } = await gate(request, true);
  if (error) return error;
  const body = await request.json().catch(() => ({})) as { email?: unknown; role?: unknown };
  const email = normalizeEmail(body.email);
  const role: AdminRole = body.role === 'owner' ? 'owner' : 'admin';
  if (!email) return Response.json({ detail: 'Email no válido.' }, { status: 422 });
  const outcome = await inviteAdmin(email, role, auth!.admin.email, `${publicBaseUrl(request)}/admin/reset`);
  if (!outcome.ok) return Response.json({ detail: outcome.detail }, { status: 409 });
  return withCookies(Response.json({ ok: true, email_sent: outcome.emailSent === true }, { status: 201 }), auth!.setCookies);
}

export async function DELETE(request: NextRequest) {
  const { auth, error } = await gate(request, true);
  if (error) return error;
  const email = normalizeEmail(request.nextUrl.searchParams.get('email'));
  if (!email) return Response.json({ detail: 'Email no válido.' }, { status: 422 });
  if (email === auth!.admin.email) return Response.json({ detail: 'No puedes quitarte a ti mismo.' }, { status: 409 });
  const users = await listAdmins();
  const target = users?.find(u => u.email === email);
  if (target?.role === 'owner' && users!.filter(u => u.role === 'owner').length <= 1) {
    return Response.json({ detail: 'Debe quedar al menos un propietario.' }, { status: 409 });
  }
  if (!await removeAdmin(email)) return Response.json({ detail: 'No se pudo dar de baja al usuario.' }, { status: 503 });
  return withCookies(Response.json({ ok: true }), auth!.setCookies);
}
