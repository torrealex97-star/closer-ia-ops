import { NextRequest } from 'next/server';
import { engineUrl, parseQuery, supportsMarket, toStudentList } from '../../../../lib/cloudEngine';

export const dynamic = 'force-dynamic';
const allowed = new Set(['127.0.0.1:3100', 'localhost:3100']);

// Modo online: fuera de localhost, la vista de alumna se sirve desde el motor cloud (solo lectura).
// El panel admin y cualquier otra ruta del backend local siguen sin exponerse públicamente.
async function cloudStudent(request: NextRequest, path: string[]) {
  const engine = process.env.CAREER_ENGINE_URL!.replace(/\/$/, '');
  const origin = request.headers.get('origin');
  if (request.headers.get('sec-fetch-site') === 'cross-site' || (origin && origin !== `https://${request.headers.get('host')}`)) {
    return Response.json({ detail: 'Origen no permitido' }, { status: 403 });
  }
  if (request.method !== 'POST' || path.join('/') !== 'opportunities/search') {
    return Response.json({ detail: 'Esta función no está disponible en la versión online todavía.' }, { status: 501 });
  }
  const query = parseQuery(await request.json().catch(() => ({})));
  if (!supportsMarket(query.market)) return Response.json({ items: [], total: 0, selection_total: 0 }, { headers: { 'Cache-Control': 'no-store' } });
  try {
    const upstream = await fetch(`${engine}${engineUrl(query)}`, { cache: 'no-store', signal: AbortSignal.timeout(20000) });
    if (!upstream.ok) throw new Error(String(upstream.status));
    return Response.json(toStudentList(await upstream.json()), { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return Response.json({ detail: 'No pudimos cargar las oportunidades ahora. Inténtalo de nuevo en unos minutos.' }, { status: 503 });
  }
}

async function proxy(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const host = request.headers.get('host') ?? '';
  const origin = request.headers.get('origin');
  if (process.env.CAREER_ENGINE_URL && !allowed.has(host)) {
    const { path } = await context.params;
    return cloudStudent(request, path);
  }
  if (!allowed.has(host) || request.headers.get('sec-fetch-site') === 'cross-site' ||
      (origin && origin !== `http://${host}`)) {
    return Response.json({ detail: 'Origen no permitido' }, { status: 403 });
  }
  const token = process.env.CAREER_LOCAL_TOKEN;
  if (!token) return Response.json({ detail: 'Inicia la aplicación con npm run dev desde la raíz.' }, { status: 503 });
  const { path } = await context.params;
  if (path.some(p => !/^[a-zA-Z0-9_-]+$/.test(p))) return new Response(null, { status: 400 });
  try {
    // Los parámetros de consulta son parte del contrato (p. ej. editorial_status del listado WDC).
    const upstream = await fetch(`http://127.0.0.1:8100/v1/${path.join('/')}${request.nextUrl.search}`, {
      method: request.method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
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
