import { NextRequest } from 'next/server';
import { originBlocked, publicBaseUrl, sessionAvailable } from '../../../../../lib/adminAuth';
import { adminRole, normalizeEmail, sendRecovery } from '../../../../../lib/supabaseAuth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// «Olvidé mi contraseña». Respuesta idéntica exista o no el email (no revela quién tiene acceso)
// y el correo solo se pide para usuarios de la lista: nadie ajeno recibe mensajes desde aquí.
export async function POST(request: NextRequest) {
  if (originBlocked(request)) return Response.json({ detail: 'Origen no permitido' }, { status: 403 });
  if (!sessionAvailable()) return Response.json({ detail: 'El acceso al panel no está configurado en este despliegue.' }, { status: 503 });
  const body = await request.json().catch(() => ({})) as { email?: unknown };
  const email = normalizeEmail(body.email);
  if (email && await adminRole(email)) {
    await sendRecovery(email, `${publicBaseUrl(request)}/admin/reset`).catch(() => false);
  }
  return Response.json({ ok: true, message: 'Si el email tiene acceso, recibirás un enlace para crear una contraseña nueva.' });
}
