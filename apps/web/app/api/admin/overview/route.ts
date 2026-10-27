import { NextRequest } from 'next/server';
import { authenticate, withCookies } from '../../../../lib/adminAuth';
import { authHealthy, listAdmins } from '../../../../lib/supabaseAuth';
import { listConnections, PROVIDERS } from '../../../../lib/integrations';
import { countsByStatus, pausedSources, statsBySource } from '../../../../lib/external';
import { ENGINE_STATUS_TEXT, engineBase, engineGet, type EngineStatus } from '../../../../lib/engineHealth';

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
// distinguirlos desde el panel, sin abrir registros. La clasificación y los textos viven en
// `lib/engineHealth.ts`, que es también la sonda del aviso automático: aquí no hay una segunda copia.
type StatusPayload = { catalog_active?: number; raw_items?: number; latest_run?: { day: string; status: string; completed_at: string | null } | null };
type FunnelPayload = { totales?: { elegible?: number | null }; sources?: Array<Record<string, unknown>> };
type AuditPayload = { day?: string; slugs?: Array<Record<string, unknown>> };

export async function GET(request: NextRequest) {
  const auth = await authenticate(request);
  if (!auth.ok) return Response.json({ detail: auth.detail }, { status: auth.status });
  const engine = engineBase();
  const env = (name: string) => Boolean(process.env[name]);

  const [probeStatus, probeFunnel, probeAudit, authOk, admins, saved, extStats, extCounts, extPaused] = await Promise.all([
    engine ? engineGet<StatusPayload>(`${engine}/api/status`) : null,
    engine ? engineGet<FunnelPayload>(`${engine}/api/funnel`) : null,
    engine ? engineGet<AuditPayload>(`${engine}/api/audit`) : null,
    timed(async () => ({ ok: await authHealthy(), detail: 'Supabase Auth (login y recuperación)' })),
    listAdmins(),
    listConnections(),
    statsBySource(),
    countsByStatus(),
    pausedSources(),
  ]);
  const status = probeStatus?.ok ? probeStatus.data : null;
  const funnel = probeFunnel?.ok ? probeFunnel.data : null;
  const audit = probeAudit?.ok ? probeAudit.data : null;
  // La causa que se declara es la primera llamada que falló; una pausa (429) no se cuenta como caída.
  const firstBad = [probeStatus, probeFunnel, probeAudit].find(result => result && !result.ok) ?? null;
  const engineReason: EngineStatus | null = engine ? (firstBad?.reason ?? null) : null;

  const connections: Check[] = [
    engine
      ? { id: 'engine', name: 'Motor cloud (Worker + D1)', status: status ? 'ok' : 'error', detail: status ? `${status.catalog_active} ofertas activas · ${status.raw_items} registros raw` : ENGINE_STATUS_TEXT[firstBad?.reason ?? 'down'] }
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
    engine_reason: engineReason,
    engine_http_status: engine ? (firstBad?.http_status ?? null) : null,
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
