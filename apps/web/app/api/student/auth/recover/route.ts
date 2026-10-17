import { NextRequest } from 'next/server';
import { originBlocked, publicBaseUrl } from '../../../../../lib/adminAuth';
import { studentSessionAvailable } from '../../../../../lib/studentAuth';
import { normalizeEmail, sendRecovery } from '../../../../../lib/supabaseAuth';
import { studentByEmail } from '../../../../../lib/students';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// «Olvidé mi contraseña»: respuesta idéntica exista o no la alumna; el correo solo sale para alumnas de la lista no pausadas.
export async function POST(request: NextRequest) {
  if (originBlocked(request)) return Response.json({ detail: 'Origen no permitido' }, { status: 403 });
  if (!studentSessionAvailable()) return Response.json({ detail: 'El acceso de alumnas no está configurado en este despliegue.' }, { status: 503 });
  const body = await request.json().catch(() => ({})) as { email?: unknown };
  const email = normalizeEmail(body.email);
  const row = email ? await studentByEmail(email) : null;
  if (email && row && row.status !== 'paused') await sendRecovery(email, `${publicBaseUrl(request)}/alumna/reset`).catch(() => false);
  return Response.json({ ok: true, message: 'Si el email tiene acceso, recibirás un enlace para crear una contraseña nueva.' });
}
