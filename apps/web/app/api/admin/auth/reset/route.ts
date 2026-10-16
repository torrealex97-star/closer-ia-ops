import { NextRequest } from 'next/server';
import { originBlocked, sessionAvailable } from '../../../../../lib/adminAuth';
import { adminRole, setPassword, userFromToken } from '../../../../../lib/supabaseAuth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MIN_PASSWORD = 10;

// Fija la contraseña nueva con el token que trae el enlace del correo (llega en el # de la URL,
// nunca pasa por el servidor hasta este POST). No inicia sesión: la persona entra después con ella.
export async function POST(request: NextRequest) {
  if (originBlocked(request)) return Response.json({ detail: 'Origen no permitido' }, { status: 403 });
  if (!sessionAvailable()) return Response.json({ detail: 'El acceso al panel no está configurado en este despliegue.' }, { status: 503 });
  const body = await request.json().catch(() => ({})) as { access_token?: unknown; password?: unknown };
  const token = typeof body.access_token === 'string' ? body.access_token : '';
  const password = typeof body.password === 'string' ? body.password : '';
  if (password.length < MIN_PASSWORD || password.length > 200) {
    return Response.json({ detail: `La contraseña debe tener al menos ${MIN_PASSWORD} caracteres.` }, { status: 422 });
  }
  const user = token ? await userFromToken(token) : null;
  if (!user) return Response.json({ detail: 'El enlace ha caducado o ya se usó. Pide uno nuevo.' }, { status: 401 });
  if (!await adminRole(user.email)) return Response.json({ detail: 'Tu usuario no está autorizado para este panel.' }, { status: 403 });
  const outcome = await setPassword(token, password);
  if (!outcome.ok) return Response.json({ detail: outcome.detail ?? 'No se pudo guardar la contraseña.' }, { status: 422 });
  return Response.json({ ok: true });
}
