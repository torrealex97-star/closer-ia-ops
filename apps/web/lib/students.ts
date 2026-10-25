import { ORG, scrub } from './external';
import { findAuthUserId, normalizeEmail, sendRecovery, serviceAuth, serviceRest } from './supabaseAuth';
import { ROLE_LABELS } from './vocabulary';

// Alumnas: acceso solo por invitación (tabla `students`, igual que `admin_users` para el panel). Aquí viven la lista,
// la invitación y el perfil. Todo acceso a datos va por la service role Y filtrado por user_id/org (la RLS de BD es la
// segunda barrera). Los VÍDEOS no se guardan: solo el enlace a su propio Drive (`video_url`).
export type StudentStatus = 'invited' | 'active' | 'paused';
export type StudentRow = { id: string; email: string; user_id: string | null; status: StudentStatus; invited_by: string | null; created_at: string };
const json = async (r: Response) => r.json().catch(() => null);

export async function studentByEmail(email: string): Promise<StudentRow | null> {
  const r = await serviceRest(`students?org_id=eq.${ORG}&email=eq.${encodeURIComponent(email)}&select=id,email,user_id,status,invited_by,created_at&limit=1`);
  const rows = r.ok ? await json(r) : null;
  return Array.isArray(rows) && rows[0] ? rows[0] : null;
}
export async function listStudents(): Promise<StudentRow[] | null> {
  const r = await serviceRest(`students?org_id=eq.${ORG}&select=id,email,user_id,status,invited_by,created_at&order=created_at.desc&limit=1000`);
  const rows = r.ok ? await json(r) : null;
  return Array.isArray(rows) ? rows : null;
}
// Primer acceso: enlaza el usuario de Auth con su fila y la activa. Nunca reactiva a una pausada.
export async function linkStudent(s: StudentRow, userId: string): Promise<void> {
  if (s.user_id === userId && s.status !== 'invited') return;
  await serviceRest(`students?id=eq.${s.id}&status=neq.paused`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ user_id: userId, status: 'active' }) });
}

export async function inviteStudent(emailIn: unknown, invitedBy: string, redirectTo: string): Promise<{ ok: boolean; detail?: string; emailSent?: boolean }> {
  const email = normalizeEmail(emailIn);
  if (!email) return { ok: false, detail: 'Email no válido.' };
  const added = await serviceRest('students', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ org_id: ORG, email, invited_by: invitedBy }) });
  if (!added.ok) return { ok: false, detail: added.status === 409 ? 'Esa alumna ya está en la lista.' : 'No se pudo guardar la alumna.' };
  // Usuario de Auth sin contraseña (la regla de BD solo lo permite porque ya está invitada) y correo para fijarla.
  const created = await serviceAuth('/auth/v1/admin/users', { method: 'POST', body: JSON.stringify({ email, email_confirm: true }) });
  if (!created.ok && created.status !== 422) {
    await serviceRest(`students?org_id=eq.${ORG}&email=eq.${encodeURIComponent(email)}`, { method: 'DELETE' });
    return { ok: false, detail: 'No se pudo crear el usuario en Auth.' };
  }
  return { ok: true, emailSent: await sendRecovery(email, redirectTo).catch(() => false) };
}

export async function setStudentStatus(id: string, status: string): Promise<boolean> {
  if (!/^[0-9a-f-]{36}$/.test(id) || (status !== 'paused' && status !== 'active' && status !== 'invited')) return false;
  const r = await serviceRest(`students?org_id=eq.${ORG}&id=eq.${id}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ status }) });
  const rows = r.ok ? await json(r) : null;
  return Array.isArray(rows) && rows.length === 1;
}
// Baja: borra la fila y su usuario de Auth (el perfil cae por ON DELETE CASCADE). Irreversible: solo propietario.
export async function removeStudent(id: string): Promise<boolean> {
  if (!/^[0-9a-f-]{36}$/.test(id)) return false;
  const r = await serviceRest(`students?org_id=eq.${ORG}&id=eq.${id}&select=user_id,email`);
  const rows = r.ok ? await json(r) : null;
  const target = Array.isArray(rows) ? rows[0] as { user_id: string | null; email: string } | undefined : undefined;
  if (!target) return false;
  const authId = target.user_id ?? await findAuthUserId(target.email); // invitada que aún no entró: su usuario de Auth ya existe
  if (authId) await serviceAuth(`/auth/v1/admin/users/${authId}`, { method: 'DELETE' });
  const del = await serviceRest(`students?org_id=eq.${ORG}&id=eq.${id}`, { method: 'DELETE' });
  return del.ok;
}

// ---- Perfil ----
export const CONSENT_VERSION = 'v3-borrador'; // texto legal pendiente de revisión (v3: declara que la sala de práctica usa IA y recoge los términos)
export const LANGUAGES = ['es', 'en', 'pt', 'fr', 'de', 'it', 'ca'] as const;
export type Profile = { full_name: string | null; city: string | null; target_roles: string[]; languages: string[]; availability: string | null; video_url: string | null; consent_at: string | null; consent_version: string | null };
const clip = (v: unknown, n: number) => typeof v === 'string' ? scrub(v).slice(0, n) || null : null;
const pick = (v: unknown, allowed: readonly string[], max: number) => Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === 'string' && allowed.includes(x)))].slice(0, max) : [];

// Enlace al vídeo en SU Drive: https, sin credenciales ni IP literal ni host interno. Nunca se descarga ni se abre desde el servidor.
export function sanitizeVideoUrl(v: unknown): string | null {
  if (typeof v !== 'string' || !v.trim()) return null;
  let u: URL; try { u = new URL(v.trim()); } catch { return null; }
  const host = u.hostname.toLowerCase();
  if (u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443')) return null;
  if (!host.includes('.') || /^[\d.]+$/.test(host) || host.startsWith('[') || /(^|\.)(localhost|local|internal|intranet)$/.test(host)) return null;
  return u.href.length <= 1000 ? u.href : null;
}

export function sanitizeProfile(input: unknown): Omit<Profile, 'consent_at' | 'consent_version'> & { consent: boolean } | null {
  if (!input || typeof input !== 'object') return null;
  const c = input as Record<string, unknown>;
  return {
    full_name: clip(c.full_name, 120), city: clip(c.city, 80), availability: clip(c.availability, 200),
    target_roles: pick(c.target_roles, Object.keys(ROLE_LABELS), 8), languages: pick(c.languages, LANGUAGES, 8),
    video_url: sanitizeVideoUrl(c.video_url), consent: c.consent === true,
  };
}

const PCOLS = 'full_name,city,target_roles,languages,availability,video_url,consent_at,consent_version';
export async function getProfile(userId: string): Promise<Profile | null> {
  if (!/^[0-9a-f-]{36}$/.test(userId)) return null;
  const r = await serviceRest(`student_profiles?org_id=eq.${ORG}&user_id=eq.${userId}&select=${PCOLS}&limit=1`);
  const rows = r.ok ? await json(r) : null;
  return Array.isArray(rows) && rows[0] ? rows[0] : null;
}
// Guardar exige consentimiento (RGPD): se registra la fecha y versión la primera vez y no se sobreescribe.
export async function saveProfile(userId: string, input: ReturnType<typeof sanitizeProfile>): Promise<{ ok: true; profile: Profile } | { ok: false; status: number; detail: string }> {
  if (!input || !/^[0-9a-f-]{36}$/.test(userId)) return { ok: false, status: 422, detail: 'Perfil no válido.' };
  const current = await getProfile(userId);
  if (!current?.consent_at && !input.consent) return { ok: false, status: 422, detail: 'Debes aceptar el tratamiento de tus datos para guardar el perfil.' };
  const { consent, ...fields } = input;
  const body = { user_id: userId, org_id: ORG, ...fields, updated_at: new Date().toISOString(), ...(current?.consent_at ? {} : consent ? { consent_at: new Date().toISOString(), consent_version: CONSENT_VERSION } : {}) };
  const r = await serviceRest('student_profiles?on_conflict=user_id', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=representation' }, body: JSON.stringify(body) });
  const rows = r.ok ? await json(r) : null;
  if (!Array.isArray(rows) || !rows[0]) return { ok: false, status: 503, detail: 'No se pudo guardar el perfil.' };
  const { user_id: _u, org_id: _o, updated_at: _t, ...profile } = rows[0]; void _u; void _o; void _t;
  return { ok: true, profile };
}
// Derecho de supresión: borra el perfil (incluido el enlace al vídeo). La cuenta la da de baja el equipo.
export async function eraseProfile(userId: string): Promise<boolean> {
  if (!/^[0-9a-f-]{36}$/.test(userId)) return false;
  return (await serviceRest(`student_profiles?org_id=eq.${ORG}&user_id=eq.${userId}`, { method: 'DELETE' })).ok;
}
