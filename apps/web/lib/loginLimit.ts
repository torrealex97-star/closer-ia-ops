import { clientIp, type HeaderReader } from './practiceBudget';

// Limitador de intentos fallidos de inicio de sesión, en memoria de la instancia (serverless ⇒ best-effort, igual que
// el tope de la sala de práctica): frena el goteo de contraseñas desde un mismo origen sin necesitar una tabla. Dos
// claves, ambas contando SOLO fallos en una ventana corta:
//  · IP + email — pocos intentos: quien adivina una cuenta se para pronto.
//  · IP — más holgado: frena el barrido de muchas cuentas desde un origen.
// No hay bloqueo por email a secas: permitiría a cualquiera dejar fuera a la dueña de la cuenta (denegación de servicio).
export const WINDOW_MS = 15 * 60_000;
export const PER_ACCOUNT = 8;
export const PER_IP = 40;
export const MAX_KEYS = 5000;

export function createLoginLimiter(options: { now?: () => number } = {}) {
  const failures = new Map<string, { count: number; resetAt: number }>();
  const now = options.now ?? Date.now;
  const live = (key: string) => { const e = failures.get(key); if (!e) return null; if (e.resetAt <= now()) { failures.delete(key); return null; } return e; };
  const keys = (ip: string, email: string) => [{ key: `ip:${ip}`, limit: PER_IP }, { key: `acct:${ip}|${email}`, limit: PER_ACCOUNT }];
  return {
    /** Segundos hasta poder reintentar, o `null` si puede intentar. */
    blockedFor(ip: string, email: string): number | null {
      let wait = 0;
      for (const { key, limit } of keys(ip, email)) { const e = live(key); if (e && e.count >= limit) wait = Math.max(wait, Math.ceil((e.resetAt - now()) / 1000)); }
      return wait > 0 ? wait : null;
    },
    fail(ip: string, email: string): void {
      for (const { key } of keys(ip, email)) {
        const e = live(key);
        failures.set(key, e ? { count: e.count + 1, resetAt: e.resetAt } : { count: 1, resetAt: now() + WINDOW_MS });
      }
      if (failures.size > MAX_KEYS) { // tope duro: fuera lo caducado y, si aun así sobra, lo más antiguo
        for (const [k, v] of failures) if (v.resetAt <= now()) failures.delete(k);
        while (failures.size > MAX_KEYS) { const oldest = failures.keys().next().value; if (oldest === undefined) break; failures.delete(oldest); }
      }
    },
    /** Un acierto limpia el contador de esa cuenta en ese origen (no el de la IP: no se premia el barrido). */
    succeed(ip: string, email: string): void { failures.delete(`acct:${ip}|${email}`); },
    get size() { return failures.size; },
  };
}

export const loginIp = (headers: HeaderReader) => clientIp(headers);
export const tooManyAttempts = (seconds: number) => Response.json(
  { detail: 'Demasiados intentos. Espera unos minutos antes de volver a probar.' },
  { status: 429, headers: { 'Retry-After': String(seconds), 'Cache-Control': 'no-store' } });
