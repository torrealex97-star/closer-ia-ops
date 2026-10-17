import { NextRequest } from 'next/server';
import { originBlocked, withCookies } from '../../../../lib/adminAuth';
import { authenticateStudent } from '../../../../lib/studentAuth';
import { getAppProfile } from '../../../../lib/applicationProfile';
import { buildCopyData, deleteApplication, listApplications, prepareApplication, updateApplication } from '../../../../lib/applications';
import { getProfile } from '../../../../lib/students';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Candidaturas ASISTIDAS de la alumna logueada: borrador + datos para copiar + seguimiento. Aquí NO hay envío: ni correo, ni
// formularios de terceros, ni contacto con la empresa. El user_id sale siempre de la sesión.
async function gate(request: NextRequest, write: boolean) {
  if (write && originBlocked(request)) return { error: Response.json({ detail: 'Origen no permitido' }, { status: 403 }) };
  const auth = await authenticateStudent(request);
  if (!auth.ok) return { error: Response.json({ detail: auth.detail }, { status: auth.status }) };
  return { auth };
}
const reply = (auth: { setCookies: string[] }, body: unknown, status = 200) => withCookies(Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } }), auth.setCookies);

export async function GET(request: NextRequest) {
  const { auth, error } = await gate(request, false);
  if (error) return error;
  const uid = auth!.student.user_id;
  const [applications, base, app] = await Promise.all([listApplications(uid), getProfile(uid), getAppProfile(uid)]);
  if (!applications) return Response.json({ detail: 'No se pudieron leer tus candidaturas.' }, { status: 503 });
  return reply(auth!, { applications, copy: buildCopyData(base, app), assisted_only: true });
}

export async function POST(request: NextRequest) {
  const { auth, error } = await gate(request, true);
  if (error) return error;
  const body = await request.json().catch(() => ({})) as { offer_id?: unknown };
  const out = await prepareApplication(auth!.student.user_id, body.offer_id);
  return out.ok ? reply(auth!, { ok: true, created: out.created, application: out.application }, out.created ? 201 : 200) : Response.json({ detail: out.detail }, { status: out.status });
}

export async function PATCH(request: NextRequest) {
  const { auth, error } = await gate(request, true);
  if (error) return error;
  const body = await request.json().catch(() => ({})) as { id?: unknown; status?: unknown; cover_message?: unknown; notes?: unknown };
  const out = await updateApplication(auth!.student.user_id, body.id, { status: body.status, cover_message: body.cover_message, notes: body.notes });
  return out.ok ? reply(auth!, { ok: true, application: out.application }) : Response.json({ detail: out.detail }, { status: out.status });
}

export async function DELETE(request: NextRequest) {
  const { auth, error } = await gate(request, true);
  if (error) return error;
  return await deleteApplication(auth!.student.user_id, request.nextUrl.searchParams.get('id')) ? reply(auth!, { ok: true }) : Response.json({ detail: 'Candidatura no encontrada.' }, { status: 404 });
}
