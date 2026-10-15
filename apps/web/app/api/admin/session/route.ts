import { NextRequest } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { ADMIN_COOKIE, expectedSessionValue, sessionIsValid, sessionUnavailable, cookieAttributes, cookieClearAttributes } from '../../../../lib/adminSession';

const passwordMatches = (given: string) => {
  const expected = process.env.ADMIN_UI_PASSWORD ?? '';
  const a = Buffer.from(given, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Sesión del operador para el panel hospedado: el password se verifica contra la
// env del servidor (tiempo constante) y se emite una cookie HttpOnly. El token del
// engine nunca cruza hacia el navegador: el proxy /api/admin/* lo inyecta server-side.
const originAllowed = (request: NextRequest) => {
  const host = request.headers.get('host') ?? '';
  const origin = request.headers.get('origin');
  return !origin || origin === `https://${host}` || origin === `http://${host}`;
};

export async function GET(request: NextRequest) {
  return Response.json({ configured: !sessionUnavailable(), authenticated: sessionIsValid(request.cookies.get(ADMIN_COOKIE)?.value) }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(request: NextRequest) {
  if (!originAllowed(request)) return Response.json({ detail: 'Origen no permitido' }, { status: 403 });
  if (sessionUnavailable()) return Response.json({ detail: 'El panel de administración no está configurado en este despliegue.' }, { status: 503 });
  let body: { password?: unknown } = {};
  try { body = await request.json(); } catch { /* body opcional */ }
  const given = typeof body.password === 'string' ? body.password : '';
  if (!passwordMatches(given)) return Response.json({ detail: 'Contraseña incorrecta.' }, { status: 401 });
  const response = Response.json({ authenticated: true });
  response.headers.append('Set-Cookie',
    `${ADMIN_COOKIE}=${expectedSessionValue(given)}; Max-Age=${cookieAttributes().maxAge}; Path=/; HttpOnly; SameSite=Lax${cookieAttributes().secure ? '; Secure' : ''}`);
  return response;
}

export async function DELETE(request: NextRequest) {
  if (!originAllowed(request)) return Response.json({ detail: 'Origen no permitido' }, { status: 403 });
  const response = Response.json({ authenticated: false });
  response.headers.append('Set-Cookie',
    `${ADMIN_COOKIE}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax${cookieAttributes().secure ? '; Secure' : ''}`);
  return response;
}
