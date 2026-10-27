import { NextRequest } from 'next/server';
import { authenticate, originBlocked, withCookies } from '../../../../lib/adminAuth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
// La clasificación en bloque del catálogo tarda decenas de segundos en el motor (25 escrituras con su
// verificación cada una): con el tope por defecto la función se cortaría a mitad y el panel diría que
// falló un trabajo que sí se hizo. 60 s es el máximo de la plataforma.
export const maxDuration = 60;

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
      // POST incluye la activación en bloque (lenta a propósito: verifica cada enlace); el resto, corto.
      cache: 'no-store', signal: AbortSignal.timeout(request.method === 'POST' ? 55_000 : 30_000),
    });
    const contentType = upstream.headers.get('content-type');
    // El motor puede estar publicado y a la vez en pausa por cuota de la plataforma: entonces responde 429 con
    // TEXTO PLANO («This site has reached its hosting allowance»). Reenviar ese texto tal cual hacía que el
    // panel lo leyera como JSON vacío y mostrara un «La consulta falló.» genérico, sin decir la causa real.
    if (!upstream.ok && !(contentType ?? '').includes('json')) {
      const text = (await upstream.text().catch(() => '')).slice(0, 300);
      const paused = upstream.status === 429 || /allowance/i.test(text);
      return withCookies(Response.json({
        detail: paused
          ? 'El motor está en pausa por cuota de hosting (la plataforma responde 429). No es un fallo de la app y no se pierde ningún dato: se reactiva solo cuando la plataforma reinicia la cuota del mes.'
          : `El motor no responde correctamente (HTTP ${upstream.status}).`,
        // `engine_down` marca CUALQUIER fallo que no venga explicado por el motor: es lo que permite al panel
        // contarlo una sola vez (en el aviso con su causa) en lugar de repetirlo como error genérico.
        engine_paused: paused, engine_down: true, upstream_status: upstream.status,
      }, { status: paused ? 503 : upstream.status >= 500 ? 502 : upstream.status, headers: { 'Cache-Control': 'no-store' } }), auth.setCookies);
    }
    const headers = new Headers({ 'Cache-Control': 'no-store' });
    if (contentType) headers.set('content-type', contentType);
    return withCookies(new Response(upstream.body, { status: upstream.status, headers }), auth.setCookies);
  } catch {
    return Response.json({ detail: 'El engine cloud no responde.' }, { status: 503 });
  }
}
export { proxy as GET, proxy as PATCH, proxy as POST };
