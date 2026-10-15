import { createHmac, timingSafeEqual } from 'node:crypto';

// Sesión del operador para el panel de administración hospedado (port fase 4).
// El token del engine (X-Admin-Token) NO llega al navegador: vive solo en las env
// del servidor Vercel; el navegador solo presenta esta cookie HttpOnly, cuyo valor
// es un derivado del password del operador (cambiar la env invalida las sesiones).
export const ADMIN_COOKIE = 'wdc_admin_session';

export function sessionUnavailable(): boolean {
  return !process.env.ADMIN_UI_PASSWORD;
}

// Derivado estable del password; verificación stateless sin almacén de sesiones.
export function expectedSessionValue(password = process.env.ADMIN_UI_PASSWORD ?? ''): string {
  return createHmac('sha256', password).update('wdc-admin-session-v1').digest('hex');
}

export function sessionIsValid(value: string | undefined | null): boolean {
  const expected = expectedSessionValue();
  if (!expected) return false; // sin password configurado: ninguna sesión es válida
  if (!value) return false;
  const a = Buffer.from(value, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

export function cookieAttributes() {
  return {
    httpOnly: true,
    // Secure en producción (https); el escritorio local no ha de almacenar la cookie http.
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    // Sesión de jornada: 12 h, luego pide el password otra vez.
    maxAge: 60 * 60 * 12,
  };
}

export const cookieClearAttributes = () => ({ ...cookieAttributes(), maxAge: 0 });
