import { NextRequest } from 'next/server';
import { authenticate, originBlocked, withCookies } from '../../../../lib/adminAuth';
import { API_PROVIDERS, collectAll, type ApiProvider } from '../../../../lib/collectors';
import { listOffers, recentRuns, setStatus, statsBySource, verifyOffer } from '../../../../lib/external';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

// Fuentes externas desde el panel: listar, revisar en bloque, verificar y recoger ahora.
async function gate(request: NextRequest, ownerOnly = false) {
  if (originBlocked(request)) return { error: Response.json({ detail: 'Origen no permitido' }, { status: 403 }) };
  const auth = await authenticate(request);
  if (!auth.ok) return { error: Response.json({ detail: auth.detail }, { status: auth.status }) };
  if (ownerOnly && auth.admin.role !== 'owner') return { error: Response.json({ detail: 'Solo el propietario puede lanzar una recogida.' }, { status: 403 }) };
  return { auth };
}
const reply = (auth: { setCookies: string[] }, body: unknown, status = 200) => withCookies(Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } }), auth.setCookies);

export async function GET(request: NextRequest) {
  const { auth, error } = await gate(request);
  if (error) return error;
  const p = request.nextUrl.searchParams;
  const [offers, sources, runs] = await Promise.all([
    listOffers({ status: p.get('status') || undefined, source: p.get('source') || undefined, limit: 200, onlyLive: true }), statsBySource(), recentRuns(),
  ]);
  if (!offers) return Response.json({ detail: 'No se pudo leer las fuentes externas.' }, { status: 503 });
  const counts: Record<string, number> = {};
  for (const s of await listOffers({ limit: 500, onlyLive: true }) ?? []) counts[s.editorial_status] = (counts[s.editorial_status] ?? 0) + 1;
  return reply(auth!, { offers, counts, sources: sources ?? [], runs: runs ?? [] });
}

export async function PATCH(request: NextRequest) {
  const { auth, error } = await gate(request);
  if (error) return error;
  const body = await request.json().catch(() => ({})) as { ids?: unknown; editorial_status?: unknown };
  const ids = Array.isArray(body.ids) ? body.ids.filter((i): i is string => typeof i === 'string') : [];
  const changed = typeof body.editorial_status === 'string' ? await setStatus(ids, body.editorial_status, auth!.admin.email) : null;
  if (changed === null) return Response.json({ detail: 'Ids o estado no válidos (máximo 200 por vez).' }, { status: 422 });
  return reply(auth!, { ok: true, changed });
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({})) as { action?: unknown; provider?: unknown; ids?: unknown };
  const { auth, error } = await gate(request, body.action === 'collect');
  if (error) return error;
  if (body.action === 'collect') {
    const only = typeof body.provider === 'string' && (API_PROVIDERS as readonly string[]).includes(body.provider) ? body.provider as ApiProvider : undefined;
    return reply(auth!, { outcomes: await collectAll('panel', only) });
  }
  if (body.action === 'verify') {
    const ids = Array.isArray(body.ids) ? body.ids.filter((i): i is string => typeof i === 'string').slice(0, 25) : [];
    const results = [];
    for (const id of ids) { const r = await verifyOffer(id); if (r) results.push(r); }
    return reply(auth!, { results });
  }
  return Response.json({ detail: 'Acción no válida.' }, { status: 422 });
}
