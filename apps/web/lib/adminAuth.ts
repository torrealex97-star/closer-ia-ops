import { createHash } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { adminRole, allowlistConfigured, authConfigured, refreshSession, userFromToken, type AdminRole, type Tokens } from './supabaseAuth';

// Sesión del panel /admin: tokens de Supabase Auth en cookies HttpOnly. Acceso = usuario de Auth
// válido Y presente en public.admin_users (quitar a alguien de la lista corta su acceso aunque
// conserve un token vivo). El token del engine sigue viviendo solo en el servidor.
export const ACCESS_COOKIE = 'wdc_admin_at';
export const REFRESH_COOKIE = 'wdc_admin_rt';
export const LEGACY_COOKIE = 'wdc_admin_session';
const REFRESH_MAX_AGE = 60 * 60 * 24 * 7;

export type Admin = { email: string; role: AdminRole };
export type AuthResult =
  | { ok: true; admin: Admin; setCookies: string[] }
  | { ok: false; status: 401 | 403 | 503; detail: string };

const secure = () => (process.env.NODE_ENV === 'production' ? '; Secure' : '');
const cookie = (name: string, value: string, maxAge: number) =>
  `${name}=${value}; Max-Age=${maxAge}; Path=/; HttpOnly; SameSite=Lax${secure()}`;

export const sessionCookies = (tokens: Tokens) => [
  cookie(ACCESS_COOKIE, tokens.access_token, Math.max(60, Math.floor(tokens.expires_in || 3600))),
  cookie(REFRESH_COOKIE, tokens.refresh_token, REFRESH_MAX_AGE),
  cookie(LEGACY_COOKIE, '', 0), // la cookie del password compartido ya no da acceso
];
export const clearCookies = () => [ACCESS_COOKIE, REFRESH_COOKIE, LEGACY_COOKIE].map(name => cookie(name, '', 0));

export const sessionAvailable = () => authConfigured() && allowlistConfigured();

// Caché corta por token para no consultar Auth + lista en cada fetch del panel.
const verified = new Map<string, { admin: Admin; until: number }>();
const CACHE_MS = 30_000;
const hash = (token: string) => createHash('sha256').update(token).digest('hex');

async function authorize(email: string): Promise<AuthResult | Admin> {
  const role = await adminRole(email);
  return role ? { email, role } : { ok: false, status: 403, detail: 'Tu usuario no está autorizado para este panel.' };
}

export async function authenticate(request: NextRequest): Promise<AuthResult> {
  if (!sessionAvailable()) return { ok: false, status: 503, detail: 'El acceso al panel no está configurado en este despliegue.' };
  const access = request.cookies.get(ACCESS_COOKIE)?.value;
  if (access) {
    const hit = verified.get(hash(access));
    if (hit && hit.until > Date.now()) return { ok: true, admin: hit.admin, setCookies: [] };
    const user = await userFromToken(access);
    if (user) {
      const outcome = await authorize(user.email);
      if (!('ok' in outcome)) {
        verified.set(hash(access), { admin: outcome, until: Date.now() + CACHE_MS });
        return { ok: true, admin: outcome, setCookies: [] };
      }
      return outcome;
    }
  }
  const refresh = request.cookies.get(REFRESH_COOKIE)?.value;
  if (refresh) {
    const renewed = await refreshSession(refresh);
    if (renewed) {
      const outcome = await authorize(renewed.user.email);
      if ('ok' in outcome) return outcome;
      return { ok: true, admin: outcome, setCookies: sessionCookies(renewed.tokens) };
    }
  }
  return { ok: false, status: 401, detail: 'Sesión de operador no iniciada.' };
}

export const withCookies = (response: Response, setCookies: string[]) => {
  for (const value of setCookies) response.headers.append('Set-Cookie', value);
  return response;
};

// Protección CSRF: mismas reglas que el proxy previo (mismo origen o sin Origin).
export const originBlocked = (request: NextRequest) => {
  const host = request.headers.get('host') ?? '';
  const origin = request.headers.get('origin');
  if (request.headers.get('sec-fetch-site') === 'cross-site') return true;
  return Boolean(origin) && origin !== `https://${host}` && origin !== `http://${host}`;
};

// Destino del enlace del correo. Fijo por env (no depende de la cabecera Host, que se puede falsear).
export const publicBaseUrl = (request: NextRequest) =>
  (process.env.ADMIN_PUBLIC_URL ?? (process.env.NODE_ENV === 'production' ? 'https://app.womendigitalclosers.com' : `https://${request.headers.get('host') ?? 'localhost'}`)).replace(/\/$/, '');
