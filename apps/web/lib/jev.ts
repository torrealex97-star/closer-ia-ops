import { scrub } from './external';

// Segundo veredicto (Jev, TypeSafe AI vía Vercel AI Gateway). SOLO anota: nunca decide ni cambia estados.
// Aislado tras esta interfaz: sin JEV_API_KEY, o ante cualquier fallo, devuelve null y el revisor sigue.
// Contrato `POST {JEV_API_URL}/v1/evaluate` tomado del encargo; NO verificado contra el servicio real.
export type JevAnnotation = { verdict: string | null; score: number | null; note: string | null };
export type JevInput = { title: string; company: string | null; location: string | null; url: string; salary: string | null; description: string | null };

export async function jevAnnotate(offer: JevInput, env: NodeJS.ProcessEnv = process.env, fetchImpl: typeof fetch = fetch): Promise<JevAnnotation | null> {
  const key = env.JEV_API_KEY, base = env.JEV_API_URL;
  if (!key || !base || !/^https:\/\//.test(base)) return null;
  try {
    const response = await fetchImpl(`${base.replace(/\/$/, '')}/v1/evaluate`, {
      method: 'POST', cache: 'no-store', signal: AbortSignal.timeout(10000),
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: offer.title, company: offer.company, location: offer.location, url: offer.url, salary: offer.salary, description: (offer.description ?? '').slice(0, 3000) }),
    });
    if (!response.ok) return null;
    const d = await response.json().catch(() => null) as Record<string, unknown> | null;
    if (!d || typeof d !== 'object') return null;
    const s = Number(d.score);
    return { verdict: typeof d.verdict === 'string' ? scrub(d.verdict).slice(0, 40) : null, score: Number.isFinite(s) ? Math.min(100, Math.max(0, Math.round(s))) : null, note: typeof d.note === 'string' ? scrub(d.note).slice(0, 200) : null };
  } catch { return null; }
}
