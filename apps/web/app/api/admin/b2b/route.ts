import { NextRequest } from 'next/server';
import { authenticate, originBlocked, withCookies } from '../../../../lib/adminAuth';
import { importLeads, listLeads, setLeadStatus } from '../../../../lib/b2bLeads';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Leads B2B desde el panel: listar, importar (alta manual/CSV ya parseado) y cambiar estado. Solo operadores autorizados.
async function gate(request: NextRequest, write: boolean) {
  if (write && originBlocked(request)) return { error: Response.json({ detail: 'Origen no permitido' }, { status: 403 }) };
  const auth = await authenticate(request);
  if (!auth.ok) return { error: Response.json({ detail: auth.detail }, { status: auth.status }) };
  return { auth };
}
const reply = (auth: { setCookies: string[] }, body: unknown, status = 200) => withCookies(Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } }), auth.setCookies);

export async function GET(request: NextRequest) {
  const { auth, error } = await gate(request, false);
  if (error) return error;
  const leads = await listLeads({ status: request.nextUrl.searchParams.get('status') || undefined });
  if (!leads) return Response.json({ detail: 'No se pudo leer los leads.' }, { status: 503 });
  return reply(auth!, { leads });
}

export async function POST(request: NextRequest) {
  const { auth, error } = await gate(request, true);
  if (error) return error;
  const body = await request.json().catch(() => null) as { leads?: unknown } | null;
  if (!body || !Array.isArray(body.leads)) return Response.json({ detail: 'Se espera { leads: [...] }.' }, { status: 422 });
  try { return reply(auth!, await importLeads(body.leads)); } catch (err) { return Response.json({ detail: (err as Error).message }, { status: 503 }); }
}

export async function PATCH(request: NextRequest) {
  const { auth, error } = await gate(request, true);
  if (error) return error;
  const body = await request.json().catch(() => ({})) as { ids?: unknown; status?: unknown; notes?: unknown };
  const ids = Array.isArray(body.ids) ? body.ids.filter((i): i is string => typeof i === 'string') : [];
  const changed = typeof body.status === 'string' ? await setLeadStatus(ids, body.status, typeof body.notes === 'string' ? body.notes : undefined) : null;
  if (changed === null) return Response.json({ detail: 'Ids o estado no válidos (máximo 100 por vez).' }, { status: 422 });
  return reply(auth!, { ok: true, changed });
}
