import { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';
const allowed = new Set(['127.0.0.1:3100', 'localhost:3100']);
// Superficie hospedada: solo la vista de alumna. El admin de edición sigue siendo local.
const HOSTED_PATHS = new Set(['opportunities/search']);
async function proxy(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const host = request.headers.get('host') ?? '';
  const origin = request.headers.get('origin');
  const engine = process.env.CAREER_ENGINE_URL;
  const upstreamOrigin = engine || 'http://127.0.0.1:8100';
  const local = !engine;
  if (local && (!allowed.has(host) || request.headers.get('sec-fetch-site') === 'cross-site' ||
      (origin && origin !== `http://${host}`))) {
    return Response.json({ detail: 'Origen no permitido' }, { status: 403 });
  }
  if (engine && (request.headers.get('sec-fetch-site') === 'cross-site' ||
      (origin && origin !== `https://${host}`))) {
    return Response.json({ detail: 'Origen no permitido' }, { status: 403 });
  }
  const { path } = await context.params;
  if (local && !process.env.CAREER_LOCAL_TOKEN) return Response.json({ detail: 'Inicia la aplicación con npm run dev desde la raíz.' }, { status: 503 });
  if (path.some(p => !/^[a-zA-Z0-9_-]+$/.test(p))) return new Response(null, { status: 400 });
  if (engine) {
    const key = path.join('/');
    const isStar = /^jobs\/[a-zA-Z0-9-]+\/star$/.test(key);
    if (!(HOSTED_PATHS.has(key) || (isStar && request.method === 'PATCH'))) {
      return Response.json({ detail: 'No disponible en el despliegue hospedado: la vista de alumna es la superficie pública.' }, { status: 404 });
    }
  }
  const token = !engine ? process.env.CAREER_LOCAL_TOKEN : null;
  try {
    // Los parámetros de consulta son parte del contrato (p. ej. editorial_status del listado WDC).
    const upstream = await fetch(`${upstreamOrigin}/v1/${path.join('/')}${request.nextUrl.search}`, {
      method: request.method,
      headers: token ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
                     : { 'Content-Type': 'application/json' },
      body: ['GET', 'HEAD'].includes(request.method) ? undefined : await request.text(),
      cache: 'no-store', signal: AbortSignal.timeout(path[0] === 'source-assistant' ? 55000 : 45000),
    });
    const headers = new Headers({ 'Cache-Control': 'no-store' });
    for (const name of ['content-type', 'content-disposition']) {
      const value = upstream.headers.get(name);
      if (value) headers.set(name, value);
    }
    return new Response(upstream.body, { status: upstream.status, headers });
  } catch {
    return Response.json({ detail: 'El motor no está disponible. Comprueba que el lanzador sigue abierto.' }, { status: 503 });
  }
}
export { proxy as GET, proxy as POST, proxy as PATCH, proxy as PUT };
