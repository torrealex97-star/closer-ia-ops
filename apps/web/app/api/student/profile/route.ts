import { NextRequest } from 'next/server';
import { originBlocked, withCookies } from '../../../../lib/adminAuth';
import { authenticateStudent } from '../../../../lib/studentAuth';
import { eraseAppProfile } from '../../../../lib/applicationProfile';
import { eraseApplications } from '../../../../lib/applications';
import { eraseProfile, getProfile, saveProfile, sanitizeProfile, CONSENT_VERSION } from '../../../../lib/students';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Perfil de la alumna logueada. El user_id sale SIEMPRE de la sesión, nunca del cuerpo ni de la URL.
async function gate(request: NextRequest, write: boolean) {
  if (write && originBlocked(request)) return { error: Response.json({ detail: 'Origen no permitido' }, { status: 403 }) };
  const auth = await authenticateStudent(request);
  if (!auth.ok) return { error: Response.json({ detail: auth.detail }, { status: auth.status }) };
  return { auth };
}
const reply = (auth: { setCookies: string[] }, body: unknown, status = 200) => withCookies(Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } }), auth.setCookies);

export async function GET(request: NextRequest) {
  const { auth, error } = await gate(request, false);
  if (error) return error;
  return reply(auth!, { email: auth!.student.email, profile: await getProfile(auth!.student.user_id), consent_version: CONSENT_VERSION });
}

export async function PUT(request: NextRequest) {
  const { auth, error } = await gate(request, true);
  if (error) return error;
  const out = await saveProfile(auth!.student.user_id, sanitizeProfile(await request.json().catch(() => null)));
  return out.ok ? reply(auth!, { ok: true, profile: out.profile }) : Response.json({ detail: out.detail }, { status: out.status });
}

// Supresión del perfil (RGPD): borra los datos de perfil y el enlace al vídeo.
export async function DELETE(request: NextRequest) {
  const { auth, error } = await gate(request, true);
  if (error) return error;
  // Supresión completa de SUS datos: perfil, formulario base y candidaturas (borradores, mensajes, notas).
  const uid = auth!.student.user_id;
  const done = await Promise.all([eraseApplications(uid), eraseAppProfile(uid), eraseProfile(uid)]);
  return done.every(Boolean) ? reply(auth!, { ok: true }) : Response.json({ detail: 'No se pudo borrar todo; vuelve a intentarlo.' }, { status: 503 });
}
