import { NextRequest } from 'next/server';
import { originBlocked } from '../../../../../lib/adminAuth';
import { studentSessionAvailable } from '../../../../../lib/studentAuth';
import { setPassword, userFromToken } from '../../../../../lib/supabaseAuth';
import { studentByEmail } from '../../../../../lib/students';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
const MIN_PASSWORD = 10;

// Fija la contraseña con el token del enlace del correo (llega en el # y solo viaja en este POST). No inicia sesión.
export async function POST(request: NextRequest) {
  if (originBlocked(request)) return Response.json({ detail: 'Origen no permitido' }, { status: 403 });
  if (!studentSessionAvailable()) return Response.json({ detail: 'El acceso de alumnas no está configurado en este despliegue.' }, { status: 503 });
  const body = await request.json().catch(() => ({})) as { access_token?: unknown; password?: unknown };
  const token = typeof body.access_token === 'string' ? body.access_token : '', password = typeof body.password === 'string' ? body.password : '';
  if (password.length < MIN_PASSWORD || password.length > 200) return Response.json({ detail: `La contraseña debe tener al menos ${MIN_PASSWORD} caracteres.` }, { status: 422 });
  const user = token ? await userFromToken(token) : null;
  if (!user) return Response.json({ detail: 'El enlace ha caducado o ya se usó. Pide uno nuevo.' }, { status: 401 });
  const row = await studentByEmail(user.email);
  if (!row || row.status === 'paused') return Response.json({ detail: 'Tu cuenta no tiene acceso al portal de alumnas.' }, { status: 403 });
  const outcome = await setPassword(token, password);
  if (!outcome.ok) return Response.json({ detail: outcome.detail ?? 'No se pudo guardar la contraseña.' }, { status: 422 });
  return Response.json({ ok: true });
}
