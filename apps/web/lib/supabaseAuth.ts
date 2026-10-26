// Cliente mínimo de Supabase Auth (GoTrue) + lista de operadores, solo servidor.
// Se usa REST directo (sin SDK): el panel necesita login por contraseña, recuperación,
// invitación y baja, nada más. La service role NUNCA se envía al navegador.
const base = () => (process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').replace(/\/$/, '');
const anonKey = () => process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
const serviceKey = () => process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY ?? '';

export const authConfigured = () => Boolean(base() && anonKey());
export const allowlistConfigured = () => Boolean(base() && serviceKey());

export type AdminRole = 'owner' | 'admin';
export type Tokens = { access_token: string; refresh_token: string; expires_in: number };
export type AuthUser = { id: string; email: string };
export type AdminRow = { email: string; role: AdminRole; invited_by: string | null; created_at: string };

export const normalizeEmail = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
};

async function call(path: string, init: RequestInit & { key?: string; bearer?: string } = {}) {
  const { key = anonKey(), bearer, headers, ...rest } = init;
  return fetch(`${base()}${path}`, {
    cache: 'no-store', signal: AbortSignal.timeout(15000), ...rest,
    headers: { apikey: key, Authorization: `Bearer ${bearer ?? key}`, 'Content-Type': 'application/json', ...(headers as Record<string, string>) },
  });
}
const json = async (response: Response) => response.json().catch(() => ({}));

const toUser = (data: { id?: string; email?: string }): AuthUser | null =>
  data?.id && data?.email ? { id: data.id, email: data.email.toLowerCase() } : null;

export async function passwordLogin(email: string, password: string): Promise<{ tokens: Tokens; user: AuthUser } | null> {
  const response = await call('/auth/v1/token?grant_type=password', { method: 'POST', body: JSON.stringify({ email, password }) });
  if (!response.ok) return null;
  const data = await json(response);
  const user = toUser(data.user);
  return user && data.access_token ? { tokens: { access_token: data.access_token, refresh_token: data.refresh_token, expires_in: data.expires_in }, user } : null;
}

export async function refreshSession(refreshToken: string): Promise<{ tokens: Tokens; user: AuthUser } | null> {
  const response = await call('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: JSON.stringify({ refresh_token: refreshToken }) });
  if (!response.ok) return null;
  const data = await json(response);
  const user = toUser(data.user);
  return user && data.access_token ? { tokens: { access_token: data.access_token, refresh_token: data.refresh_token, expires_in: data.expires_in }, user } : null;
}

export async function userFromToken(accessToken: string): Promise<AuthUser | null> {
  const response = await call('/auth/v1/user', { bearer: accessToken });
  return response.ok ? toUser(await json(response)) : null;
}

export async function sendRecovery(email: string, redirectTo: string): Promise<boolean> {
  const response = await call(`/auth/v1/recover?redirect_to=${encodeURIComponent(redirectTo)}`, { method: 'POST', body: JSON.stringify({ email }) });
  return response.ok;
}

export async function setPassword(accessToken: string, password: string): Promise<{ ok: boolean; detail?: string }> {
  const response = await call('/auth/v1/user', { method: 'PUT', bearer: accessToken, body: JSON.stringify({ password }) });
  if (response.ok) return { ok: true };
  const data = await json(response);
  return { ok: false, detail: typeof data.msg === 'string' ? data.msg : typeof data.message === 'string' ? data.message : undefined };
}

export async function signOut(accessToken: string): Promise<void> {
  await call('/auth/v1/logout', { method: 'POST', bearer: accessToken }).catch(() => undefined);
}

export async function authHealthy(): Promise<boolean> {
  try { return (await call('/auth/v1/health')).ok; } catch { return false; }
}

// ---- lista cerrada de operadores (tabla public.admin_users, solo service role) ----
const rest = (path: string, init: RequestInit = {}) =>
  call(`/rest/v1/${path}`, { key: serviceKey(), ...init });
export const serviceRest = rest;

// PostgREST corta CADA respuesta en `db-max-rows` (1.000 en Supabase) aunque se pida más: una sola petición devolvía
// menos filas de las que hay SIN decirlo, así que los recuentos y los informes salían cortos y parecían exactos. Este
// paginador pide con `offset` hasta que una página llega vacía (una corta no prueba que no haya más), declara
// `truncated` si alcanza el tope y devuelve `null` si una página falla: nunca una lista parcial disfrazada de completa.
export type PagedRows<T> = { rows: T[]; truncated: boolean };
export async function pagedRest<T>(path: string, order: string, max = 10_000, page = 1000): Promise<PagedRows<T> | null> {
  const rows: T[] = [];
  for (;;) {
    const response = await rest(`${path}&order=${order}&limit=${page}&offset=${rows.length}`).catch(() => null);
    if (!response?.ok) return null;
    const batch = await json(response);
    if (!Array.isArray(batch)) return null;
    if (!batch.length) return { rows, truncated: false };
    if (rows.length + batch.length > max) return { rows: rows.concat(batch as T[]).slice(0, max), truncated: true };
    rows.push(...(batch as T[]));
  }
}
// Llamada a la API de Auth (admin) con la service role. Solo servidor.
export const serviceAuth = (path: string, init: RequestInit = {}) => call(path, { key: serviceKey(), ...init });

export async function adminRole(email: string): Promise<AdminRole | null> {
  const response = await rest(`admin_users?email=eq.${encodeURIComponent(email)}&select=role&limit=1`);
  if (!response.ok) return null;
  const rows = await json(response);
  const role = Array.isArray(rows) ? rows[0]?.role : null;
  return role === 'owner' || role === 'admin' ? role : null;
}

export async function listAdmins(): Promise<AdminRow[] | null> {
  const response = await rest('admin_users?select=email,role,invited_by,created_at&order=created_at.asc');
  const rows = response.ok ? await json(response) : null;
  return Array.isArray(rows) ? rows : null;
}

export async function findAuthUserId(email: string): Promise<string | null> {
  for (let page = 1; page <= 5; page++) {
    const response = await call(`/auth/v1/admin/users?page=${page}&per_page=200`, { key: serviceKey() });
    if (!response.ok) return null;
    const users = ((await json(response)).users ?? []) as Array<{ id: string; email?: string }>;
    const hit = users.find(u => u.email?.toLowerCase() === email);
    if (hit) return hit.id;
    if (users.length < 200) return null;
  }
  return null;
}

// Alta: primero la lista (la regla de BD solo deja crear usuarios ya invitados), luego el usuario
// de Auth sin contraseña y el correo de recuperación para que la persona fije la suya.
export async function inviteAdmin(email: string, role: AdminRole, invitedBy: string, redirectTo: string): Promise<{ ok: boolean; detail?: string; emailSent?: boolean }> {
  const added = await rest('admin_users', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ email, role, invited_by: invitedBy }) });
  if (!added.ok) return { ok: false, detail: added.status === 409 ? 'Ese usuario ya está en la lista.' : 'No se pudo guardar el usuario.' };
  const created = await call('/auth/v1/admin/users', { key: serviceKey(), method: 'POST', body: JSON.stringify({ email, email_confirm: true }) });
  if (!created.ok && created.status !== 422) {
    await rest(`admin_users?email=eq.${encodeURIComponent(email)}`, { method: 'DELETE' });
    return { ok: false, detail: 'No se pudo crear el usuario en Auth.' };
  }
  return { ok: true, emailSent: await sendRecovery(email, redirectTo) };
}

export async function removeAdmin(email: string): Promise<boolean> {
  const removed = await rest(`admin_users?email=eq.${encodeURIComponent(email)}`, { method: 'DELETE' });
  if (!removed.ok) return false;
  const id = await findAuthUserId(email);
  if (id) await call(`/auth/v1/admin/users/${id}`, { key: serviceKey(), method: 'DELETE' });
  return true;
}
