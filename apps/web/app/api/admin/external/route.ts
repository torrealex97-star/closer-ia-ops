import { NextRequest } from 'next/server';
import { authenticate, originBlocked, withCookies } from '../../../../lib/adminAuth';
import { callTimeout, createBudget, timeLeft } from '../../../../lib/cronBudget';
import { API_PROVIDERS, collectAll, type ApiProvider } from '../../../../lib/collectors';
import { collectGoogleJobs, GOOGLE_JOBS_SOURCE } from '../../../../lib/googleJobs';
import { runAiReview, undoAiDecisions } from '../../../../lib/aiReview';
import { approvalsToday, approveTop, countsByStatus, listOffersPage, pausedSources, recentRuns, setSourceEnabled, setStatus, statsBySource, verifyOffer, type PageQuery } from '../../../../lib/external';
import { DAILY_CAP, runAutoReview } from '../../../../lib/autoReview';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

// Fuentes externas desde el panel: listar, revisar en bloque, verificar y recoger ahora.
async function gate(request: NextRequest, ownerOnly = false) {
  if (originBlocked(request)) return { error: Response.json({ detail: 'Origen no permitido' }, { status: 403 }) };
  const auth = await authenticate(request);
  if (!auth.ok) return { error: Response.json({ detail: auth.detail }, { status: auth.status }) };
  if (ownerOnly && auth.admin.role !== 'owner') return { error: Response.json({ detail: 'Solo el propietario puede lanzar una recogida o pausar fuentes.' }, { status: 403 }) };
  return { auth };
}
const reply = (auth: { setCookies: string[] }, body: unknown, status = 200) => withCookies(Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } }), auth.setCookies);

const num = (v: string | null, d: number) => { const n = Number(v); return Number.isFinite(n) && v !== null && v !== '' ? n : d; };
function queryOf(p: URLSearchParams): PageQuery {
  return { status: p.get('status') || undefined, source: p.get('source') || undefined, role: p.get('role') || undefined, spain: p.get('spain') === '1', minScore: num(p.get('min_score'), 0), ai: (['human', 'withdraw', 'approve', 'none'] as const).find(x => x === p.get('ai')), q: p.get('q') || undefined, sort: p.get('sort') === 'recent' ? 'recent' : 'score' };
}

export async function GET(request: NextRequest) {
  const { auth, error } = await gate(request);
  if (error) return error;
  const p = request.nextUrl.searchParams;
  const pageSize = Math.min(Math.max(num(p.get('page_size'), 50), 10), 100), page = Math.max(num(p.get('page'), 1), 1);
  const [list, counts, sources, runs, paused, autoUsed] = await Promise.all([
    listOffersPage({ ...queryOf(p), limit: pageSize, offset: (page - 1) * pageSize }), countsByStatus(), statsBySource(), recentRuns(), pausedSources(), approvalsToday(),
  ]);
  if (!list) return Response.json({ detail: 'No se pudo leer las fuentes externas.' }, { status: 503 });
  return reply(auth!, { offers: list.rows, total: list.total, page, page_size: pageSize, counts: counts ?? {}, sources: sources ?? [], runs: runs ?? [], paused: [...paused], auto: { used_today: autoUsed, cap: DAILY_CAP } });
}

export async function PATCH(request: NextRequest) {
  const body = await request.json().catch(() => ({})) as { ids?: unknown; editorial_status?: unknown; source?: unknown; enabled?: unknown };
  const toggle = typeof body.source === 'string';
  const { auth, error } = await gate(request, toggle);
  if (error) return error;
  if (toggle) {
    if (typeof body.enabled !== 'boolean' || !await setSourceEnabled(body.source as string, body.enabled, auth!.admin.email)) return Response.json({ detail: 'Fuente o valor no válidos.' }, { status: 422 });
    return reply(auth!, { ok: true, source: body.source, enabled: body.enabled });
  }
  const ids = Array.isArray(body.ids) ? body.ids.filter((i): i is string => typeof i === 'string') : [];
  const changed = typeof body.editorial_status === 'string' ? await setStatus(ids, body.editorial_status, auth!.admin.email) : null;
  if (changed === null) return Response.json({ detail: 'Ids o estado no válidos (máximo 200 por vez).' }, { status: 422 });
  return reply(auth!, { ok: true, changed });
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({})) as { action?: unknown; provider?: unknown; ids?: unknown; n?: unknown; filters?: Record<string, string> };
  const { auth, error } = await gate(request, body.action === 'collect' || body.action === 'ai_review' || body.action === 'ai_undo' || body.action === 'auto_review');
  if (error) return error;
  if (body.action === 'auto_review') {
    // Mismo camino que el cron, con su reloj y su tope: aprobar a mano desde el panel no gasta otra cuota.
    const summary = await runAutoReview({ deadline: Date.now() + 45_000 }).catch(() => null);
    return summary ? reply(auth!, summary) : Response.json({ detail: 'No se pudo completar la revisión automática.' }, { status: 503 });
  }
  if (body.action === 'collect') {
    const only = typeof body.provider === 'string' && (API_PROVIDERS as readonly string[]).includes(body.provider) ? body.provider as ApiProvider : undefined;
    const budget = createBudget(45_000); // maxDuration = 60: el reloj compartido deja margen y el corte se declara
    // Google Jobs se pide solo, o como cuarto paso tras las APIs oficiales cuando no se elige proveedor.
    if (body.provider === GOOGLE_JOBS_SOURCE) {
      const googleJobs = await collectGoogleJobs('panel', budget.deadline(42_000));
      return reply(auth!, { outcomes: [googleJobs], ...(googleJobs.truncated ? { truncated: true } : {}) });
    }
    const outcomes = await collectAll('panel', only, budget.deadline(only ? 42_000 : 30_000));
    const googleJobs = only ? null : await collectGoogleJobs('panel', budget.deadline(10_000));
    return reply(auth!, { outcomes: googleJobs ? [...outcomes, googleJobs] : outcomes, ...((outcomes.some(o => o.truncated) || googleJobs?.truncated) ? { truncated: true } : {}) });
  }
  if (body.action === 'ai_review') return reply(auth!, await runAiReview({ deadline: createBudget(45_000).deadline(42_000) }));
  if (body.action === 'ai_undo') return reply(auth!, { undone: await undoAiDecisions(auth!.admin.email) });
  if (body.action === 'verify') {
    const ids = Array.isArray(body.ids) ? body.ids.filter((i): i is string => typeof i === 'string').slice(0, 25) : [];
    const results = [];
    const deadline = createBudget(45_000).deadline(42_000); let truncated = false;
    for (const id of ids) {
      if (timeLeft(deadline) < 1500) { truncated = true; break; }
      const r = await verifyOffer(id, callTimeout(10_000, deadline)); if (r) results.push(r);
    }
    return reply(auth!, { results, ...(truncated ? { truncated: true, pending: ids.length - results.length } : {}) });
  }
  if (body.action === 'approve_top') {
    const n = Number(body.n);
    if (!Number.isFinite(n) || n < 1) return Response.json({ detail: 'Indica cuántas aprobar (1-500).' }, { status: 422 });
    const params = new URLSearchParams(Object.entries(body.filters ?? {}).filter(([, v]) => typeof v === 'string') as Array<[string, string]>);
    const result = await approveTop({ ...queryOf(params), n }, auth!.admin.email);
    if (!result) return Response.json({ detail: 'No se pudo aprobar.' }, { status: 503 });
    return reply(auth!, result);
  }
  return Response.json({ detail: 'Acción no válida.' }, { status: 422 });
}
