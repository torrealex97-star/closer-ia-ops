import { NextRequest } from 'next/server';
import { harvestRun, listActors, listRuns, webhookTokenValid } from '../../../../lib/apify';
import { recoverAfter } from '../../../../lib/apifyAuto';
import { publicBaseUrl } from '../../../../lib/adminAuth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

// Aviso de Apify al terminar una ejecución (webhook ad hoc creado al lanzarla). Solo con el token del webhook;
// recoge los resultados de ESA ejecución, que debe existir en nuestra tabla. Si no da tiempo, lo reanuda el cron o el panel.
export async function POST(request: NextRequest) {
  if (!webhookTokenValid(request.nextUrl.searchParams.get('t') ?? '')) return Response.json({ detail: 'No autorizado.' }, { status: 401 });
  const body = await request.json().catch(() => null) as { resource?: { id?: unknown }; eventData?: { actorRunId?: unknown } } | null;
  const runId = typeof body?.resource?.id === 'string' ? body.resource.id : typeof body?.eventData?.actorRunId === 'string' ? body.eventData.actorRunId : '';
  if (!/^[A-Za-z0-9]{6,40}$/.test(runId)) return Response.json({ detail: 'Ejecución no válida.' }, { status: 422 });
  const [runs, actors] = await Promise.all([listRuns(60), listActors()]);
  const run = runs?.find(r => r.run_id === runId); const actor = actors?.find(a => a.id === run?.actor_id);
  if (!run || !actor) return Response.json({ detail: 'Ejecución desconocida.' }, { status: 404 });
  const result = await harvestRun(run, actor, 45000);
  // Si esta ejecución terminó mal o sin ofertas, se lanza el siguiente buscador del mismo portal.
  const recovery = await recoverAfter(run, actor, result, publicBaseUrl(request)).catch(() => undefined);
  return Response.json({ ok: true, ...result, ...(recovery ? { recovery } : {}) });
}
