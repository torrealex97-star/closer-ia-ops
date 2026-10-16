import { decryptSecret, encryptSecret } from './secrets';
import { serviceRest } from './supabaseAuth';

// Conexiones con proveedores externos. Las comprobaciones usan SOLO endpoints gratuitos que no gastan
// crédito (listar modelos, ver cuenta): probar una conexión nunca cuesta dinero. Guardar una clave no
// activa gasto: el motor cloud público no usa proveedores de pago (se activan aparte, con orden explícita).
const bearer = (k: string) => ({ Authorization: `Bearer ${k}` });
const basic = (id: string, secret: string) => ({ Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}` });
const pair = (k: string) => { const i = k.indexOf(':'); return i > 0 ? [k.slice(0, i), k.slice(i + 1)] as const : null; };
const get = (url: string, headers?: Record<string, string>) => fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(15000), headers });

// `probe` hace una llamada gratuita o de coste nulo; `hint` explica el formato de la clave en el panel.
export const PROVIDERS = {
  apify: { name: 'Apify', hint: 'Token de API', probe: (k: string) => get(`${process.env.APIFY_API_BASE ?? 'https://api.apify.com'}/v2/users/me`, bearer(k)) },
  serpapi: { name: 'SerpApi', hint: 'API key', probe: (k: string) => get(`${process.env.SERPAPI_API_BASE ?? 'https://serpapi.com'}/account.json?api_key=${encodeURIComponent(k)}`) },
  groq: { name: 'Groq', hint: 'API key', probe: (k: string) => get(`${process.env.GROQ_API_BASE ?? 'https://api.groq.com'}/openai/v1/models`, bearer(k)) },
  openai: { name: 'OpenAI', hint: 'API key', probe: (k: string) => get(`${process.env.OPENAI_API_BASE ?? 'https://api.openai.com'}/v1/models`, bearer(k)) },
  adzuna: { name: 'Adzuna', hint: 'app_id:app_key (separados por dos puntos)', probe: (k: string) => { const p = pair(k); return p ? get(`${process.env.ADZUNA_API_BASE ?? 'https://api.adzuna.com'}/v1/api/jobs/es/search/1?app_id=${encodeURIComponent(p[0])}&app_key=${encodeURIComponent(p[1])}&results_per_page=1`) : Promise.resolve(new Response(null, { status: 400 })); } },
  jooble: { name: 'Jooble', hint: 'API key', probe: (k: string) => fetch(`${process.env.JOOBLE_API_BASE ?? 'https://jooble.org'}/api/${encodeURIComponent(k)}`, { method: 'POST', cache: 'no-store', signal: AbortSignal.timeout(15000), headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ keywords: 'closer', location: 'España', page: 1 }) }) },
  infojobs: { name: 'InfoJobs', hint: 'client_id:client_secret (separados por dos puntos)', probe: (k: string) => { const p = pair(k); return p ? get(`${process.env.INFOJOBS_API_BASE ?? 'https://api.infojobs.net'}/api/9/offer?maxResults=1`, basic(p[0], p[1])) : Promise.resolve(new Response(null, { status: 400 })); } },
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

export async function getSecret(provider: Provider): Promise<string | null> {
  const response = await serviceRest(`integration_connections?provider=eq.${provider}&select=secret_ciphertext&limit=1`);
  const rows = response.ok ? await response.json().catch(() => []) : [];
  try { return Array.isArray(rows) && rows[0] ? decryptSecret(rows[0].secret_ciphertext) : null; } catch { return null; }
}

export async function testConnection(provider: Provider): Promise<{ ok: boolean; detail: string } | null> {
  const row = await serviceRest(`integration_connections?provider=eq.${provider}&select=secret_ciphertext&limit=1`);
  const rows = row.ok ? await row.json().catch(() => []) : [];
  if (!Array.isArray(rows) || !rows[0]) return null;
  let outcome: { ok: boolean; detail: string };
  try {
    const secret = decryptSecret(rows[0].secret_ciphertext);
    const response = await PROVIDERS[provider].probe(secret);
    outcome = response.status === 400 && (provider === 'adzuna' || provider === 'infojobs') ? { ok: false, detail: 'Formato de clave incorrecto (usa id:clave)' }
      : response.ok ? { ok: true, detail: 'Clave válida' }
      : response.status === 401 || response.status === 403 ? { ok: false, detail: `Clave rechazada (HTTP ${response.status})` }
      : { ok: false, detail: `El proveedor respondió HTTP ${response.status}` };
  } catch { outcome = { ok: false, detail: 'No se pudo contactar con el proveedor' }; }
  await serviceRest(`integration_connections?provider=eq.${provider}`, {
    method: 'PATCH', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ last_test_at: new Date().toISOString(), last_test_ok: outcome.ok, last_test_detail: outcome.detail }),
  });
  return outcome;
}
