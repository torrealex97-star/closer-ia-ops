import { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';
const allowed = new Set(['127.0.0.1:3100', 'localhost:3100']);

async function proxy(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const host = request.headers.get('host') ?? '';
  const origin = request.headers.get('origin');
  if (!allowed.has(host) || request.headers.get('sec-fetch-site') === 'cross-site' ||
      (origin && origin !== `http://${host}`)) {
    return Response.json({ detail: 'Origen no permitido' }, { status: 403 });
  }
  const token = process.env.CAREER_LOCAL_TOKEN;
  if (!token) return Response.json({ detail: 'Inicia la aplicación con npm run dev desde la raíz.' }, { status: 503 });
  const { path } = await context.params;
  if (path.some(p => !/^[a-zA-Z0-9_-]+$/.test(p))) return new Response(null, { status: 400 });
  try {
    const upstream = await fetch(`http://127.0.0.1:8100/v1/${path.join('/')}`, {
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
export { proxy as GET, proxy as POST, proxy as PATCH };
