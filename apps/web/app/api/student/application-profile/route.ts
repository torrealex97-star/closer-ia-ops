import { NextRequest } from 'next/server';
import { originBlocked, withCookies } from '../../../../lib/adminAuth';
import { authenticateStudent } from '../../../../lib/studentAuth';
import { AUTOFILL_CONSENT_VERSION, ANSWER_KEYS, CONTRACTS, LEVELS, WORK_AUTH, completeness, eraseAppProfile, getAppProfile, saveAppProfile, sanitizeAppProfile } from '../../../../lib/applicationProfile';
import { getProfile } from '../../../../lib/students';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Formulario base de la alumna logueada. El user_id sale SIEMPRE de la sesión (nunca del cuerpo ni de la URL).
async function gate(request: NextRequest, write: boolean) {
  if (write && originBlocked(request)) return { error: Response.json({ detail: 'Origen no permitido' }, { status: 403 }) };
  const auth = await authenticateStudent(request);
  if (!auth.ok) return { error: Response.json({ detail: auth.detail }, { status: auth.status }) };
  return { auth };
}
const reply = (auth: { setCookies: string[] }, body: unknown, status = 200) => withCookies(Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } }), auth.setCookies);
const options = { work_authorization: WORK_AUTH, levels: LEVELS, contracts: CONTRACTS, answers: ANSWER_KEYS };

export async function GET(request: NextRequest) {
  const { auth, error } = await gate(request, false);
  if (error) return error;
  const [profile, base] = await Promise.all([getAppProfile(auth!.student.user_id), getProfile(auth!.student.user_id)]);
  return reply(auth!, { profile, completeness: completeness(profile, base?.video_url ?? null), base_consent: Boolean(base?.consent_at), autofill_consent_version: AUTOFILL_CONSENT_VERSION, options });
}

export async function PUT(request: NextRequest) {
  const { auth, error } = await gate(request, true);
  if (error) return error;
  const out = await saveAppProfile(auth!.student.user_id, sanitizeAppProfile(await request.json().catch(() => null)));
  if (!out.ok) return Response.json({ detail: out.detail }, { status: out.status });
  const base = await getProfile(auth!.student.user_id);
  return reply(auth!, { ok: true, profile: out.profile, completeness: completeness(out.profile, base?.video_url ?? null) });
}

export async function DELETE(request: NextRequest) {
  const { auth, error } = await gate(request, true);
  if (error) return error;
  return await eraseAppProfile(auth!.student.user_id) ? reply(auth!, { ok: true }) : Response.json({ detail: 'No se pudo borrar el formulario.' }, { status: 503 });
}
