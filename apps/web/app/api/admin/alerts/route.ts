import { NextRequest } from 'next/server';
import { authenticate, originBlocked, withCookies } from '../../../../lib/adminAuth';
import { checkEngine, readStatus } from '../../../../lib/engineAlert';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Estado del motor para el aviso del panel (cualquier pestaña). Solo lectura.
// Un motor en pausa por cuota no es una caída, y un hueco no es un cero: se devuelve la causa, desde cuándo
// se detectó y qué se ha avisado ya, sin inventar nada cuando no se puede leer el historial.
export async function GET(request: NextRequest) {
  const auth = await authenticate(request);
  if (!auth.ok) return Response.json({ detail: auth.detail }, { status: auth.status });
  const report = await readStatus();
  return withCookies(Response.json(report, { headers: { 'Cache-Control': 'no-store, private' } }), auth.setCookies);
}

// «Comprobar ahora»: la MISMA comprobación que hace el cron diario, a mano, para no esperar a la pasada de
// la mañana. Registra la comprobación y avisa por correo solo si toca (un aviso por estado).
export async function POST(request: NextRequest) {
  if (originBlocked(request)) return Response.json({ detail: 'Origen no permitido' }, { status: 403 });
  const auth = await authenticate(request);
  if (!auth.ok) return Response.json({ detail: auth.detail }, { status: auth.status });
  const report = await checkEngine({ by: auth.admin.email });
  return withCookies(Response.json(report, { headers: { 'Cache-Control': 'no-store, private' } }), auth.setCookies);
}
