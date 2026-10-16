import { NextRequest } from 'next/server';
import { authenticate, originBlocked, withCookies } from '../../../../lib/adminAuth';
import { deleteConnection, isProvider, listConnections, PROVIDERS, saveConnection, testConnection } from '../../../../lib/integrations';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Claves de APIs de proveedores. El navegador nunca recibe una clave: solo los últimos 4 caracteres.
// Ver y probar: cualquier operador. Guardar o borrar: solo el propietario.
async function gate(request: NextRequest, ownerOnly: boolean) {
  if (originBlocked(request)) return { error: Response.json({ detail: 'Origen no permitido' }, { status: 403 }) };
  const auth = await authenticate(request);
  if (!auth.ok) return { error: Response.json({ detail: auth.detail }, { status: auth.status }) };
  if (ownerOnly && auth.admin.role !== 'owner') return { error: Response.json({ detail: 'Solo el propietario puede cambiar las claves.' }, { status: 403 }) };
  return { auth };
}
const reply = (auth: { setCookies: string[] }, body: unknown, status = 200) =>
  withCookies(Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } }), auth.setCookies);

export async function GET(request: NextRequest) {
  const { auth, error } = await gate(request, false);
  if (error) return error;
  const rows = await listConnections();
  if (!rows) return Response.json({ detail: 'No se pudo leer las conexiones.' }, { status: 503 });
  const connections = Object.entries(PROVIDERS).map(([provider, spec]) => {
    const row = rows.find(r => r.provider === provider);
    return { provider, name: spec.name, configured: Boolean(row), last4: row?.last4 ?? null, updated_by: row?.updated_by ?? null, updated_at: row?.updated_at ?? null,
      last_test_at: row?.last_test_at ?? null, last_test_ok: row?.last_test_ok ?? null, last_test_detail: row?.last_test_detail ?? null };
  });
  return reply(auth!, { connections });
}

export async function PUT(request: NextRequest) {
  const { auth, error } = await gate(request, true);
  if (error) return error;
  const body = await request.json().catch(() => ({})) as { provider?: unknown; secret?: unknown };
  const secret = typeof body.secret === 'string' ? body.secret.trim() : '';
  if (!isProvider(body.provider)) return Response.json({ detail: 'Proveedor no válido.' }, { status: 422 });
  if (secret.length < 8 || secret.length > 400 || /\s/.test(secret)) return Response.json({ detail: 'La clave no parece válida.' }, { status: 422 });
  if (!await saveConnection(body.provider, secret, auth!.admin.email)) return Response.json({ detail: 'No se pudo guardar la clave.' }, { status: 503 });
  return reply(auth!, { ok: true, last4: secret.slice(-4) });
}

export async function POST(request: NextRequest) {
  const { auth, error } = await gate(request, false);
  if (error) return error;
  const body = await request.json().catch(() => ({})) as { provider?: unknown };
  if (!isProvider(body.provider)) return Response.json({ detail: 'Proveedor no válido.' }, { status: 422 });
  const outcome = await testConnection(body.provider);
  if (!outcome) return Response.json({ detail: 'Ese proveedor no tiene clave guardada.' }, { status: 404 });
  return reply(auth!, outcome);
}

export async function DELETE(request: NextRequest) {
  const { auth, error } = await gate(request, true);
  if (error) return error;
  const provider = request.nextUrl.searchParams.get('provider');
  if (!isProvider(provider)) return Response.json({ detail: 'Proveedor no válido.' }, { status: 422 });
  if (!await deleteConnection(provider)) return Response.json({ detail: 'No se pudo borrar.' }, { status: 503 });
  return reply(auth!, { ok: true });
}
