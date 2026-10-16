import { NextRequest } from 'next/server';
import { authenticate, originBlocked, withCookies } from '../../../../lib/adminAuth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Proxy admin hacia el engine cloud (/v1/admin/*). Datos de control:
// - CAREER_ENGINE_URL: el engine cloud (Vercel). Sin esta env,modo local: el panel
//   del operador vive en /api/backend contra el backend local y aquí no hay nada.
// - CAREER_ADMIN_TOKEN: el token X-Admin-Token del engine. Solo en el servidor.
// La sesión del operador (cookie HttpOnly) es la única credencial que toca el navegador.
async function proxy(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const engine = process.env.CAREER_ENGINE_URL;
  if (!engine) return Response.json({ detail: 'El panel del operador en modo local vive en /admin con el backend local.' }, { status: 404 });
  if (originBlocked(request)) return Response.json({ detail: 'Origen no permitido' }, { status: 403 });
  const auth = await authenticate(request);
  if (!auth.ok) return Response.json({ detail: auth.detail }, { status: auth.status });
  const token = process.env.CAREER_ADMIN_TOKEN;
  if (!token) return Response.json({ detail: 'El token del engine no está configurado en este despliegue.' }, { status: 503 });
  const { path } = await context.params;
  if (path.length > 4 || path.some(p => !/^[a-zA-Z0-9_-]+$/.test(p))) return new Response(null, { status: 400 });  // Fase 3: POST admite la verificación de vigencia (opportunities/{id}/verify).
  if (!['GET', 'PATCH', 'POST'].includes(request.method)) return Response.json({ detail: 'Método no permitido en el proxy admin.' }, { status: 405 });
  try {
    const upstream = await fetch(`${engine}/v1/admin/${path.join('/')}${request.nextUrl.search}`, {
      method: request.method,
      headers: { 'X-Admin-Token': token, 'Content-Type': 'application/json' },
      body: ['PATCH', 'POST'].includes(request.method) ? await request.text() : undefined,
      cache: 'no-store', signal: AbortSignal.timeout(30000),
    });
    const headers = new Headers({ 'Cache-Control': 'no-store' });
    const contentType = upstream.headers.get('content-type');
    if (contentType) headers.set('content-type', contentType);
    return withCookies(new Response(upstream.body, { status: upstream.status, headers }), auth.setCookies);
  } catch {
    return Response.json({ detail: 'El engine cloud no responde.' }, { status: 503 });
  }
}
export { proxy as GET, proxy as PATCH, proxy as POST };
