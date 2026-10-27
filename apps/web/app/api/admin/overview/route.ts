import { NextRequest } from 'next/server';
import { authenticate, withCookies } from '../../../../lib/adminAuth';
import { authHealthy, listAdmins } from '../../../../lib/supabaseAuth';
import { listConnections, PROVIDERS } from '../../../../lib/integrations';
import { countsByStatus, pausedSources, statsBySource } from '../../../../lib/external';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Panel «Fuentes y conexiones»: estado real de cada fuente del motor y de cada conexión. Solo lectura.
// Nunca devuelve valores de variables de entorno, solo si existen.
type Check = { id: string; name: string; status: 'ok' | 'error' | 'not_configured'; detail: string; ms?: number };

async function timed(fn: () => Promise<{ ok: boolean; detail: string }>): Promise<{ ok: boolean; detail: string; ms: number }> {
  const t0 = Date.now();
  try { return { ...(await fn()), ms: Date.now() - t0 }; } catch { return { ok: false, detail: 'Sin respuesta', ms: Date.now() - t0 }; }
}

// Un motor PUBLICADO y en pausa por cuota de plataforma no es lo mismo que un motor caído: el primero
// responde 429 con texto plano («This site has reached its hosting allowance») y se reactiva solo cuando la
// cuota del mes se reinicia; el segundo es un fallo que hay que mirar. El operador tiene que poder
// distinguirlos desde el panel, sin abrir registros.
type EngineProbe = { http_status: number | null; reason: 'allowance' | 'timeout' | 'down' | null };
const ENGINE_REASON: Record<string, string> = {
  allowance: 'En pausa por cuota de hosting (la plataforma responde 429). Sus ofertas no se pierden: se reactiva al reiniciarse la cuota del mes.',
  timeout: 'No responde a tiempo (más de 20 s).',
  down: 'No responde.',
};

async function engineGet(engine: string, path: string, probe: EngineProbe) {
  try {
    const response = await fetch(`${engine}${path}`, { cache: 'no-store', signal: AbortSignal.timeout(20000) });
    if (!response.ok) {
      probe.http_status = response.status;
      const text = await response.text().catch(() => '');
      probe.reason = response.status === 429 || /allowance/i.test(text) ? 'allowance' : 'down';
      throw new Error(String(response.status));
    }
    return response.json();
  } catch (error) {
    if (!probe.reason) probe.reason = (error as Error)?.name === 'TimeoutError' ? 'timeout' : 'down';
    throw error;
  }
}

export async function GET(request: NextRequest) {
  const auth = await authenticate(request);
  if (!auth.ok) return Response.json({ detail: auth.detail }, { status: auth.status });
  const engine = (process.env.CAREER_ENGINE_URL ?? '').replace(/\/$/, '');
  const env = (name: string) => Boolean(process.env[name]);

  const probe: EngineProbe = { http_status: null, reason: null };
  const [status, funnel, audit, authOk, admins, saved, extStats, extCounts, extPaused] = await Promise.all([
    engine ? engineGet(engine, '/api/status', probe).catch(() => null) : null,
    engine ? engineGet(engine, '/api/funnel', probe).catch(() => null) : null,
    engine ? engineGet(engine, '/api/audit', probe).catch(() => null) : null,
    timed(async () => ({ ok: await authHealthy(), detail: 'Supabase Auth (login y recuperación)' })),
    listAdmins(),
    listConnections(),
    statsBySource(),
    countsByStatus(),
    pausedSources(),
  ]);

  const connections: Check[] = [
    engine
      ? { id: 'engine', name: 'Motor cloud (Worker + D1)', status: status ? 'ok' : 'error', detail: status ? `${status.catalog_active} ofertas activas · ${status.raw_items} registros raw` : ENGINE_REASON[probe.reason ?? 'down'] }
      : { id: 'engine', name: 'Motor cloud (Worker + D1)', status: 'not_configured', detail: 'Falta CAREER_ENGINE_URL' },
    { id: 'supabase-auth', name: 'Supabase Auth', status: authOk.ok ? 'ok' : 'error', detail: authOk.ok ? authOk.detail : 'No responde', ms: authOk.ms },
    { id: 'supabase-db', name: 'Supabase · lista de operadores', status: admins ? 'ok' : 'error', detail: admins ? `${admins.length} usuario(s) con acceso` : 'No se pudo leer (¿service role?)' },
    { id: 'admin-token', name: 'Token admin del motor', status: env('CAREER_ADMIN_TOKEN') ? 'ok' : 'not_configured', detail: env('CAREER_ADMIN_TOKEN') ? 'Presente en el servidor' : 'Falta CAREER_ADMIN_TOKEN' },
  ];
  // Proveedores externos: estado de la clave guardada y de su última prueba. El motor cloud público no los usa
  // (gasto solo con orden explícita), así que «guardada» no implica que se esté consumiendo crédito.
  const paid: Check[] = Object.entries(PROVIDERS).map(([id, spec]) => {
    const row = saved?.find(r => r.provider === id);
    if (!row) return { id, name: spec.name, status: 'not_configured', detail: 'Sin clave guardada (pestaña APIs)' };
    return { id, name: spec.name, status: row.last_test_ok === false ? 'error' : 'ok',
      detail: `Clave …${row.last4} guardada · ${row.last_test_ok == null ? 'sin probar' : row.last_test_detail ?? ''} · el motor cloud no la usa todavía` };
  });

  const sources = Array.isArray(funnel?.sources) ? funnel.sources : [];
  return withCookies(Response.json({
    generated_at: new Date().toISOString(),
    engine_reason: engine ? probe.reason : null,
    engine_http_status: engine ? probe.http_status : null,
    engine: status ? { catalog_active: status.catalog_active, raw_items: status.raw_items, last_run: status.latest_run ? { day: status.latest_run.day, status: status.latest_run.status, completed_at: status.latest_run.completed_at } : null } : null,
    sources: sources.map((s: Record<string, unknown>) => ({ code: s.code, name: s.name, run_status: s.run_status ?? null, fetched: s.revisadas ?? null, catalog: s.catalogo ?? 0, eligible: s.elegible ?? 0, selected: s.seleccionada ?? 0, roles: s.roles ?? {}, warning: s.fuente ?? null })),
    pool: { eligible: funnel?.totales?.elegible ?? null, by_role: sources.reduce((acc: Record<string, number>, s: { roles?: Record<string, number> }) => { for (const [k, n] of Object.entries(s.roles ?? {})) acc[k] = (acc[k] ?? 0) + Number(n); return acc; }, {}) },
    // Recuentos exactos por estado (count=exact, solo ofertas vivas): antes se leían 500 filas y su longitud se
    // presentaba como total, así que por encima de 500 el panel decía «500 pendientes» aunque hubiera miles.
    external: { sources: extStats ?? [], counts: extCounts ?? null, pending: extCounts?.draft ?? 0, exceptions: extCounts?.needs_review ?? 0, paused: [...extPaused] },
    audit: audit && Array.isArray(audit.slugs) ? { day: audit.day, slugs: audit.slugs.map((s: Record<string, unknown>) => ({ source: s.source, slug: s.slug, status: s.status, http_status: s.http_status, canonical_url: s.canonical_url ?? null })) } : null,
    connections, paid,
  }, { headers: { 'Cache-Control': 'no-store' } }), auth.setCookies);
}
