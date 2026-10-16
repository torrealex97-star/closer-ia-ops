import { NextRequest } from 'next/server';
import { authenticate, withCookies } from '../../../../lib/adminAuth';
import { authHealthy, listAdmins } from '../../../../lib/supabaseAuth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Panel «Fuentes y conexiones»: estado real de cada fuente del motor y de cada conexión. Solo lectura.
// Nunca devuelve valores de variables de entorno, solo si existen.
type Check = { id: string; name: string; status: 'ok' | 'error' | 'not_configured'; detail: string; ms?: number };

async function timed(fn: () => Promise<{ ok: boolean; detail: string }>): Promise<{ ok: boolean; detail: string; ms: number }> {
  const t0 = Date.now();
  try { return { ...(await fn()), ms: Date.now() - t0 }; } catch { return { ok: false, detail: 'Sin respuesta', ms: Date.now() - t0 }; }
}

async function engineGet(engine: string, path: string) {
  const response = await fetch(`${engine}${path}`, { cache: 'no-store', signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(String(response.status));
  return response.json();
}

export async function GET(request: NextRequest) {
  const auth = await authenticate(request);
  if (!auth.ok) return Response.json({ detail: auth.detail }, { status: auth.status });
  const engine = (process.env.CAREER_ENGINE_URL ?? '').replace(/\/$/, '');
  const env = (name: string) => Boolean(process.env[name]);

  const [status, funnel, audit, authOk, admins] = await Promise.all([
    engine ? engineGet(engine, '/api/status').catch(() => null) : null,
    engine ? engineGet(engine, '/api/funnel').catch(() => null) : null,
    engine ? engineGet(engine, '/api/audit').catch(() => null) : null,
    timed(async () => ({ ok: await authHealthy(), detail: 'Supabase Auth (login y recuperación)' })),
    listAdmins(),
  ]);

  const connections: Check[] = [
    engine
      ? { id: 'engine', name: 'Motor cloud (Worker + D1)', status: status ? 'ok' : 'error', detail: status ? `${status.catalog_active} ofertas activas · ${status.raw_items} registros raw` : 'No responde' }
      : { id: 'engine', name: 'Motor cloud (Worker + D1)', status: 'not_configured', detail: 'Falta CAREER_ENGINE_URL' },
    { id: 'supabase-auth', name: 'Supabase Auth', status: authOk.ok ? 'ok' : 'error', detail: authOk.ok ? authOk.detail : 'No responde', ms: authOk.ms },
    { id: 'supabase-db', name: 'Supabase · lista de operadores', status: admins ? 'ok' : 'error', detail: admins ? `${admins.length} usuario(s) con acceso` : 'No se pudo leer (¿service role?)' },
    { id: 'admin-token', name: 'Token admin del motor', status: env('CAREER_ADMIN_TOKEN') ? 'ok' : 'not_configured', detail: env('CAREER_ADMIN_TOKEN') ? 'Presente en el servidor' : 'Falta CAREER_ADMIN_TOKEN' },
  ];
  // Proveedores de pago: el recolector público no los usa por regla del proyecto (gasto solo con orden explícita).
  const paid: Check[] = ['Apify', 'SerpApi', 'Groq', 'OpenAI'].map(name => ({
    id: name.toLowerCase(), name, status: 'not_configured', detail: 'No conectado al motor cloud (solo disponible en la app local, opt-in)',
  }));

  const sources = Array.isArray(funnel?.sources) ? funnel.sources : [];
  return withCookies(Response.json({
    generated_at: new Date().toISOString(),
    engine: status ? { catalog_active: status.catalog_active, raw_items: status.raw_items, last_run: status.latest_run ? { day: status.latest_run.day, status: status.latest_run.status, completed_at: status.latest_run.completed_at } : null } : null,
    sources: sources.map((s: Record<string, unknown>) => ({ code: s.code, name: s.name, run_status: s.run_status ?? null, fetched: s.revisadas ?? null, catalog: s.catalogo ?? 0, eligible: s.elegible ?? 0, selected: s.seleccionada ?? 0, warning: s.fuente ?? null })),
    audit: audit && Array.isArray(audit.slugs) ? { day: audit.day, slugs: audit.slugs.map((s: Record<string, unknown>) => ({ source: s.source, slug: s.slug, status: s.status, http_status: s.http_status, canonical_url: s.canonical_url ?? null })) } : null,
    connections, paid,
  }, { headers: { 'Cache-Control': 'no-store' } }), auth.setCookies);
}
