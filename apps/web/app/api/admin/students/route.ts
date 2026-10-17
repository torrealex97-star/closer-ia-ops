import { NextRequest } from 'next/server';
import { authenticate, originBlocked, publicBaseUrl, withCookies } from '../../../../lib/adminAuth';
import { inviteStudent, listStudents, removeStudent, setStudentStatus } from '../../../../lib/students';

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
  return students ? reply(auth!, { students }) : Response.json({ detail: 'No se pudo leer la lista de alumnas.' }, { status: 503 });
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
