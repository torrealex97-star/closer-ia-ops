import { createHash } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { allowlistConfigured, authConfigured, refreshSession, userFromToken, type Tokens } from './supabaseAuth';
import { linkStudent, studentByEmail } from './students';

// Sesión de la alumna: tokens de Supabase Auth en cookies HttpOnly PROPIAS (distintas de las del panel: una sesión de
// operador no abre el portal de alumnas ni al revés). Acceso = usuario de Auth válido Y fila en `students` no pausada.
export const STUDENT_ACCESS = 'wdc_student_at';
export const STUDENT_REFRESH = 'wdc_student_rt';
const REFRESH_MAX_AGE = 60 * 60 * 24 * 7;

export type Student = { user_id: string; email: string };
export type StudentAuth = { ok: true; student: Student; setCookies: string[] } | { ok: false; status: 401 | 403 | 503; detail: string };

const secure = () => (process.env.NODE_ENV === 'production' ? '; Secure' : '');
const cookie = (name: string, value: string, maxAge: number) => `${name}=${value}; Max-Age=${maxAge}; Path=/; HttpOnly; SameSite=Lax${secure()}`;
export const studentCookies = (t: Tokens) => [cookie(STUDENT_ACCESS, t.access_token, Math.max(60, Math.floor(t.expires_in || 3600))), cookie(STUDENT_REFRESH, t.refresh_token, REFRESH_MAX_AGE)];
export const clearStudentCookies = () => [STUDENT_ACCESS, STUDENT_REFRESH].map(n => cookie(n, '', 0));
export const studentSessionAvailable = () => authConfigured() && allowlistConfigured();

const verified = new Map<string, { student: Student; until: number }>();
// Una pausa corta el acceso en ≤ 30 s (caché por token). Configurable para pruebas.
const CACHE_MS = Number.isFinite(Number(process.env.STUDENT_AUTH_CACHE_MS)) && process.env.STUDENT_AUTH_CACHE_MS !== undefined ? Number(process.env.STUDENT_AUTH_CACHE_MS) : 30_000;
const hash = (t: string) => createHash('sha256').update(t).digest('hex');

async function authorize(user: { id: string; email: string }): Promise<Student | { status: 403; detail: string }> {
  const row = await studentByEmail(user.email);
  if (!row || row.status === 'paused') return { status: 403, detail: 'Tu cuenta no tiene acceso al portal de alumnas.' };
  await linkStudent(row, user.id).catch(() => undefined);
  return { user_id: user.id, email: user.email };
}

export async function authenticateStudent(request: NextRequest): Promise<StudentAuth> {
  if (!studentSessionAvailable()) return { ok: false, status: 503, detail: 'El acceso de alumnas no está configurado en este despliegue.' };
  const access = request.cookies.get(STUDENT_ACCESS)?.value;
  if (access) {
    const hit = verified.get(hash(access));
    if (hit && hit.until > Date.now()) return { ok: true, student: hit.student, setCookies: [] };
    const user = await userFromToken(access);
    if (user) {
      const out = await authorize(user);
      if ('user_id' in out) { verified.set(hash(access), { student: out, until: Date.now() + CACHE_MS }); return { ok: true, student: out, setCookies: [] }; }
      return { ok: false, ...out };
    }
  }
  const refresh = request.cookies.get(STUDENT_REFRESH)?.value;
  if (refresh) {
    const renewed = await refreshSession(refresh);
    if (renewed) {
      const out = await authorize(renewed.user);
      if ('user_id' in out) return { ok: true, student: out, setCookies: studentCookies(renewed.tokens) };
      return { ok: false, ...out };
    }
  }
  return { ok: false, status: 401, detail: 'Sesión de alumna no iniciada.' };
}
