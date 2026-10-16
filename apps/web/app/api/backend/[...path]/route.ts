import { NextRequest } from 'next/server';
import { externalForStudent } from '../../../../lib/externalSurface';

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
  // En producción solo https del mismo host; en una máquina de desarrollo (loopback) también http.
  const loopback = /^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host);
  if (engine && (request.headers.get('sec-fetch-site') === 'cross-site' ||
      (origin && origin !== `https://${host}` && !(loopback && origin === `http://${host}`)))) {
    return Response.json({ detail: 'Origen no permitido' }, { status: 403 });
  }
  const { path } = await context.params;
  if (local && !process.env.CAREER_LOCAL_TOKEN) return Response.json({ detail: 'Inicia la aplicación con npm run dev desde la raíz.' }, { status: 503 });
  if (path.some(p => !/^[a-zA-Z0-9_-]+$/.test(p))) return new Response(null, { status: 400 });
  if (engine) {
    const key = path.join('/');
    // Hosted: solo lectura de la superficie alumna. star es mutación con credencial
    // admin en el engine (fix audit run-1 finding 2); la vista alumna guarda en su
    // navegador, así que el proxy ya no reenvía star en modo hospedado.
    if (!HOSTED_PATHS.has(key)) {
      return Response.json({ detail: 'No disponible en el despliegue hospedado: la vista de alumna es la superficie pública.' }, { status: 404 });
    }
  }
  const token = !engine ? process.env.CAREER_LOCAL_TOKEN : null;
  const requestBody = ['GET', 'HEAD'].includes(request.method) ? '' : await request.text();
  try {
    // Los parámetros de consulta son parte del contrato (p. ej. editorial_status del listado WDC).
    const upstream = await fetch(`${upstreamOrigin}/v1/${path.join('/')}${request.nextUrl.search}`, {
      method: request.method,
      headers: token ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
                     : { 'Content-Type': 'application/json' },
      body: requestBody || undefined,
      cache: 'no-store', signal: AbortSignal.timeout(path[0] === 'source-assistant' ? 55000 : 45000),
    });
    const headers = new Headers({ 'Cache-Control': 'no-store' });
    for (const name of ['content-type', 'content-disposition']) {
      const value = upstream.headers.get(name);
      if (value) headers.set(name, value);
    }
    // Hosted: la búsqueda de alumna suma las ofertas externas aprobadas a las del motor (sin duplicar enlaces).
    if (engine && upstream.ok && path.join('/') === 'opportunities/search' && request.method === 'POST') {
      try {
        const body = JSON.parse(requestBody) as { role?: string | null; market?: string; days?: number; include_bilingual?: boolean; starred_only?: boolean };
        const mine = await upstream.clone().json() as { items: Array<{ source_url: string }>; total: number };
        const extra = await externalForStudent({ role: body.role ?? null, market: body.market ?? 'any', days: Number(body.days) || 10, include_bilingual: Boolean(body.include_bilingual), starred_only: Boolean(body.starred_only) }).catch(() => []);
        const seen = new Set(mine.items.map(i => i.source_url));
        const items = [...mine.items, ...extra.filter(e => !seen.has(e.source_url))];
        return Response.json({ ...mine, items, total: items.length }, { headers });
      } catch { /* si algo falla, se devuelve la respuesta del motor tal cual */ }
    }
    return new Response(upstream.body, { status: upstream.status, headers });
  } catch {
    return Response.json({ detail: 'El motor no está disponible. Comprueba que el lanzador sigue abierto.' }, { status: 503 });
  }
}
export { proxy as GET, proxy as POST, proxy as PATCH, proxy as PUT };
