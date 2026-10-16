import { decryptSecret, encryptSecret } from './secrets';
import { serviceRest } from './supabaseAuth';

// Conexiones con proveedores externos. Las comprobaciones usan SOLO endpoints gratuitos que no gastan
// crédito (listar modelos, ver cuenta): probar una conexión nunca cuesta dinero. Guardar una clave no
// activa gasto: el motor cloud público no usa proveedores de pago (se activan aparte, con orden explícita).
export const PROVIDERS = {
  apify: { name: 'Apify', url: () => `${process.env.APIFY_API_BASE ?? 'https://api.apify.com'}/v2/users/me`, auth: 'bearer' },
  serpapi: { name: 'SerpApi', url: (k: string) => `${process.env.SERPAPI_API_BASE ?? 'https://serpapi.com'}/account.json?api_key=${encodeURIComponent(k)}`, auth: 'none' },
  groq: { name: 'Groq', url: () => `${process.env.GROQ_API_BASE ?? 'https://api.groq.com'}/openai/v1/models`, auth: 'bearer' },
  openai: { name: 'OpenAI', url: () => `${process.env.OPENAI_API_BASE ?? 'https://api.openai.com'}/v1/models`, auth: 'bearer' },
} as const;
export type Provider = keyof typeof PROVIDERS;
export const isProvider = (v: unknown): v is Provider => typeof v === 'string' && v in PROVIDERS;

export type ConnectionRow = { provider: Provider; last4: string; updated_by: string; updated_at: string; last_test_at: string | null; last_test_ok: boolean | null; last_test_detail: string | null };

export async function listConnections(): Promise<ConnectionRow[] | null> {
  const response = await serviceRest('integration_connections?select=provider,last4,updated_by,updated_at,last_test_at,last_test_ok,last_test_detail');
  const rows = response.ok ? await response.json().catch(() => null) : null;
  return Array.isArray(rows) ? rows : null;
}

export async function saveConnection(provider: Provider, secret: string, by: string): Promise<boolean> {
  const response = await serviceRest('integration_connections?on_conflict=provider', {
    method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ provider, secret_ciphertext: encryptSecret(secret), last4: secret.slice(-4), updated_by: by, updated_at: new Date().toISOString(), last_test_at: null, last_test_ok: null, last_test_detail: null }),
  });
  return response.ok;
}

export async function deleteConnection(provider: Provider): Promise<boolean> {
  return (await serviceRest(`integration_connections?provider=eq.${provider}`, { method: 'DELETE' })).ok;
}

export async function testConnection(provider: Provider): Promise<{ ok: boolean; detail: string } | null> {
  const row = await serviceRest(`integration_connections?provider=eq.${provider}&select=secret_ciphertext&limit=1`);
  const rows = row.ok ? await row.json().catch(() => []) : [];
  if (!Array.isArray(rows) || !rows[0]) return null;
  let outcome: { ok: boolean; detail: string };
  try {
    const secret = decryptSecret(rows[0].secret_ciphertext);
    const spec = PROVIDERS[provider];
    const response = await fetch(spec.url(secret), {
      cache: 'no-store', signal: AbortSignal.timeout(15000),
      headers: spec.auth === 'bearer' ? { Authorization: `Bearer ${secret}` } : undefined,
    });
    outcome = response.ok ? { ok: true, detail: 'Clave válida' }
      : response.status === 401 || response.status === 403 ? { ok: false, detail: `Clave rechazada (HTTP ${response.status})` }
      : { ok: false, detail: `El proveedor respondió HTTP ${response.status}` };
  } catch { outcome = { ok: false, detail: 'No se pudo contactar con el proveedor' }; }
  await serviceRest(`integration_connections?provider=eq.${provider}`, {
    method: 'PATCH', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ last_test_at: new Date().toISOString(), last_test_ok: outcome.ok, last_test_detail: outcome.detail }),
  });
  return outcome;
}
